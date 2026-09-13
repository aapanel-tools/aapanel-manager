import {describe, it, expect} from 'vitest';
import {UNKNOWN_METRIC, cpuText, percentText} from './metric-text';

describe('metric text', () => {
  it('keeps one decimal for CPU and a whole number for memory', () => {
    expect(cpuText(4.2)).toBe('4.2%');
    expect(cpuText(0)).toBe('0.0%');
    expect(percentText(25.4)).toBe('25%');
    expect(percentText(0)).toBe('0%');
  });

  it('shows a figure nobody reported as a dash, never as zero', () => {
    for (const missing of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(cpuText(missing)).toBe(UNKNOWN_METRIC);
      expect(percentText(missing)).toBe(UNKNOWN_METRIC);
    }
  });
});
