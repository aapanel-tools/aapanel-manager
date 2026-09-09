import {describe, it, expect} from 'vitest';

import {formatTimestamp, formatTimestampOrNull} from './datetime';

describe('formatTimestamp', () => {
  const moment = new Date('2026-09-09T14:07:33.512Z');

  it('renders a stable "YYYY-MM-DD HH:MM:SS" in UTC', () => {
    expect(formatTimestamp(moment)).toBe('2026-09-09 14:07:33');
  });

  it('drops seconds when asked', () => {
    expect(formatTimestamp(moment, 'minutes')).toBe('2026-09-09 14:07');
  });

  it('accepts an ISO string, since serialised rows arrive as strings', () => {
    expect(formatTimestamp('2026-09-09T14:07:33.512Z')).toBe('2026-09-09 14:07:33');
  });

  it('does not depend on the machine timezone', () => {
    // The whole point of not localising: a server in UTC and a browser in +07
    // must render the same characters, or React reports a hydration mismatch
    // and the operator sees two different times for one event.
    const asString = formatTimestamp('2026-09-09T14:07:33.512Z');
    const asDate = formatTimestamp(new Date('2026-09-09T14:07:33.512Z'));
    expect(asString).toBe(asDate);
    expect(asString).not.toMatch(/[+Z]/);
  });
});

describe('formatTimestampOrNull', () => {
  it('passes null through for a moment that has not happened', () => {
    // A job that never started has no start time; rendering "1970-01-01" there
    // would be a lie about the machine, not a formatting detail.
    expect(formatTimestampOrNull(null)).toBeNull();
    expect(formatTimestampOrNull(undefined)).toBeNull();
  });

  it('formats a real date like formatTimestamp', () => {
    const d = new Date('2026-01-02T03:04:05.000Z');
    expect(formatTimestampOrNull(d)).toBe('2026-01-02 03:04:05');
    expect(formatTimestampOrNull(d, 'minutes')).toBe('2026-01-02 03:04');
  });
});
