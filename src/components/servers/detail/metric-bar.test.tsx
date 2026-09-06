import {describe, it, expect} from 'vitest';
import {barColor} from './metric-bar';

describe('barColor', () => {
  it('maps usage to ok/warn/crit thresholds', () => {
    expect(barColor(10)).toBe('ok');
    expect(barColor(80)).toBe('warn');
    expect(barColor(95)).toBe('crit');
    expect(barColor(null)).toBe('unknown');
  });
});
