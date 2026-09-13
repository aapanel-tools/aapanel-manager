'use client';

import {useCallback} from 'react';
import {useFormatter} from 'next-intl';

const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

/**
 * A byte count in the reader's own number format — "4,1 кБ", "4.1 kB".
 *
 * Steps are powers of 1024, the way file managers count, under the unit names
 * Intl offers (it has no kibibyte). Unlike a date, a number formats to the same
 * text on the server and in the browser for one locale, so there is no
 * hydration mismatch to design around.
 */
export function useFileSize(): (bytes: number | null) => string {
  const format = useFormatter();

  return useCallback(
    (bytes: number | null): string => {
      if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '—';
      let value = bytes;
      let unit = 0;
      while (value >= 1024 && unit < UNITS.length - 1) {
        value /= 1024;
        unit += 1;
      }
      return format.number(value, {
        style: 'unit',
        unit: UNITS[unit],
        unitDisplay: 'short',
        maximumFractionDigits: unit === 0 ? 0 : 1,
      });
    },
    [format],
  );
}
