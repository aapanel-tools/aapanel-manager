import {describe, it, expect} from 'vitest';
import {
  UPDATE_STEPS,
  initialStatus,
  advanceTo,
  markDone,
  markFailed,
  deriveStepStates,
} from './update-status';

describe('update-status', () => {
  it('starts running with no step entered', () => {
    const s = initialStatus('update', '0.5.0', 1000);
    expect(s.state).toBe('running');
    expect(s.current).toBeNull();
    expect(s.startedAt).toBe(1000);
    expect(s.updatedAt).toBe(1000);
    expect(s.error).toBeNull();
    // Before any step, nothing is done yet.
    const steps = deriveStepStates(s);
    expect(Object.values(steps)).toEqual(['pending', 'pending', 'pending', 'pending', 'pending']);
  });

  it('advancing marks prior steps done and the current one running', () => {
    let s = initialStatus('update', '0.5.0', 1000);
    s = advanceTo(s, 'install', 2000);
    expect(s.current).toBe('install');
    expect(s.updatedAt).toBe(2000);
    const steps = deriveStepStates(s);
    expect(steps.download).toBe('done');
    expect(steps.install).toBe('running');
    expect(steps.migrate).toBe('pending');
    expect(steps.build).toBe('pending');
    expect(steps.restart).toBe('pending');
  });

  it('marks every step done when finished', () => {
    let s = initialStatus('update', '0.5.0', 1000);
    s = advanceTo(s, 'restart', 5000);
    s = markDone(s, 6000);
    expect(s.state).toBe('done');
    expect(s.current).toBeNull();
    const steps = deriveStepStates(s);
    expect(Object.values(steps)).toEqual(['done', 'done', 'done', 'done', 'done']);
  });

  it('marks the failing step failed and leaves later steps pending', () => {
    let s = initialStatus('update', '0.5.0', 1000);
    s = advanceTo(s, 'build', 4000);
    s = markFailed(s, 'next build failed', 4500);
    expect(s.state).toBe('failed');
    expect(s.error).toBe('next build failed');
    const steps = deriveStepStates(s);
    expect(steps.download).toBe('done');
    expect(steps.install).toBe('done');
    expect(steps.migrate).toBe('done');
    expect(steps.build).toBe('failed');
    expect(steps.restart).toBe('pending');
  });

  it('keeps the canonical step order', () => {
    expect([...UPDATE_STEPS]).toEqual(['download', 'install', 'migrate', 'build', 'restart']);
  });
});
