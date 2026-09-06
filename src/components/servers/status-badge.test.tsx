import {describe, it, expect} from 'vitest';
import {statusVariant} from './status-badge';

describe('statusVariant', () => {
  it('maps online/offline/unknown', () => {
    expect(statusVariant(true)).toBe('online');
    expect(statusVariant(false)).toBe('offline');
    expect(statusVariant(null)).toBe('unknown');
  });
});
