import {describe, it, expect, beforeEach} from 'vitest';
import {DEFAULT_MAX_CONCURRENT, PanelBusyError, gateFor, panelOrigin, resetGates} from './rate-limit';

const never = new AbortController().signal;

describe('panelOrigin', () => {
  // The limit guards a machine, so two records pointing at the same panel must
  // land on the same key however their URLs are written.
  it('collapses different paths and trailing slashes to one key', () => {
    expect(panelOrigin('https://panel.example:8888/')).toBe('https://panel.example:8888');
    expect(panelOrigin('https://panel.example:8888/v2/files?action=x')).toBe(
      'https://panel.example:8888',
    );
  });

  it('separates different ports on the same host', () => {
    expect(panelOrigin('https://h:8888')).not.toBe(panelOrigin('https://h:9999'));
  });

  it('falls back to the raw string for something that is not a URL', () => {
    expect(panelOrigin('not a url')).toBe('not a url');
  });
});

describe('gateFor', () => {
  beforeEach(() => resetGates());

  it('reuses one gate per origin and keeps origins apart', () => {
    expect(gateFor('https://a:1')).toBe(gateFor('https://a:1'));
    expect(gateFor('https://a:1')).not.toBe(gateFor('https://b:1'));
  });

  it('defaults to a conservative limit', () => {
    expect(DEFAULT_MAX_CONCURRENT).toBe(4);
  });
});

describe('PanelGate', () => {
  beforeEach(() => resetGates());

  it('lets requests through up to the limit', async () => {
    const gate = gateFor('https://p:1', 2);
    const first = await gate.acquire(never);
    const second = await gate.acquire(never);

    expect(gate.active).toBe(2);
    expect(gate.waiting).toBe(0);
    first();
    second();
    expect(gate.active).toBe(0);
  });

  it('queues past the limit and hands the slot over on release', async () => {
    const gate = gateFor('https://p:1', 1);
    const held = await gate.acquire(never);
    expect(gate.active).toBe(1);

    let granted = false;
    const queued = gate.acquire(never).then((release) => {
      granted = true;
      return release;
    });

    // Still waiting: the only slot is taken.
    await Promise.resolve();
    expect(granted).toBe(false);
    expect(gate.waiting).toBe(1);

    held();
    const release = await queued;
    expect(granted).toBe(true);
    // The slot moved across rather than being freed and re-taken.
    expect(gate.active).toBe(1);
    expect(gate.waiting).toBe(0);
    release();
    expect(gate.active).toBe(0);
  });

  it('gives up waiting when the caller deadline passes, and leaves no ghost in the queue', async () => {
    const gate = gateFor('https://p:1', 1);
    const held = await gate.acquire(never);

    const controller = new AbortController();
    const waiting = gate.acquire(controller.signal);
    expect(gate.waiting).toBe(1);

    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(PanelBusyError);
    expect(gate.waiting).toBe(0);

    // The slot is still held by the first caller, not leaked by the failed waiter.
    expect(gate.active).toBe(1);
    held();
    expect(gate.active).toBe(0);
  });

  it('refuses immediately when the deadline has already passed', async () => {
    const gate = gateFor('https://p:1', 4);
    const controller = new AbortController();
    controller.abort();
    await expect(gate.acquire(controller.signal)).rejects.toBeInstanceOf(PanelBusyError);
    expect(gate.active).toBe(0);
  });

  // A double release would inflate the budget and quietly defeat the whole limit.
  it('ignores a repeated release', async () => {
    const gate = gateFor('https://p:1', 1);
    const release = await gate.acquire(never);
    release();
    release();
    expect(gate.active).toBe(0);

    // The limit still holds afterwards.
    await gate.acquire(never);
    expect(gate.active).toBe(1);
  });

  it('names the panel and the limit when it gives up', async () => {
    const gate = gateFor('https://panel.example:8888', 1);
    await gate.acquire(never);
    const controller = new AbortController();
    const waiting = gate.acquire(controller.signal);
    controller.abort();
    await expect(waiting).rejects.toThrow(/panel\.example:8888.*limit 1/);
  });
});
