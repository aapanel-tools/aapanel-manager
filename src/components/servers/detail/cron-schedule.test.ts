import {describe, it, expect} from 'vitest';

import {scheduleText, clockTime} from './cron-schedule';

/** A task carrying only the fields the schedule is read from. */
const task = (over: Partial<Parameters<typeof scheduleText>[0]> = {}) => ({
  cycle: '',
  type: '',
  hour: null,
  minute: null,
  ...over,
});

describe('scheduleText', () => {
  it('shows the panel’s own sentence, untranslated', () => {
    // Only one combination of the structured fields has been observed on a
    // live panel. Rendering our own sentence from the rest would be a guess
    // about when something runs on someone else's production machine, so the
    // panel's wording wins even when it is not in the reader's language — the
    // same rule presentError follows for a panel's error text.
    expect(
      scheduleText(task({cycle: 'Один раз в день в 1:30', type: 'day', hour: 1, minute: 30})),
    ).toBe('Один раз в день в 1:30');
  });

  it('falls back to the shape and the time when the panel sends no sentence', () => {
    expect(scheduleText(task({type: 'day', hour: 1, minute: 30}))).toBe('day 01:30');
  });

  it('says only the shape when there is no time to say', () => {
    expect(scheduleText(task({type: 'minute-n'}))).toBe('minute-n');
  });

  it('leaves a dash rather than an empty cell when the panel says nothing', () => {
    expect(scheduleText(task())).toBe('—');
  });

  it('does not treat a blank sentence as a sentence', () => {
    // A panel that sends `cycle: "   "` would otherwise render a schedule
    // column that looks deliberately empty.
    expect(scheduleText(task({cycle: '   ', type: 'hour', minute: 5}))).toBe('hour --:05');
  });
});

describe('clockTime', () => {
  it('pads both halves, so a column of times lines up', () => {
    expect(clockTime({hour: 1, minute: 5})).toBe('01:05');
  });

  it('is null when the panel set no time at all', () => {
    // Not "00:00": a task with no hour set is not a task that runs at midnight,
    // and midnight is exactly how an operator would read it.
    expect(clockTime({hour: null, minute: null})).toBeNull();
  });

  it('marks the half that is missing instead of inventing it', () => {
    expect(clockTime({hour: null, minute: 30})).toBe('--:30');
    expect(clockTime({hour: 3, minute: null})).toBe('03:--');
  });
});
