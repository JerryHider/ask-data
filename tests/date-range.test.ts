import { describe, expect, it } from 'vitest';
import { parseDateRange } from '../agent-server/date-range.js';

describe('date range parser', () => {
  it('parses the previous calendar month', () => {
    expect(parseDateRange('上月 GMV', new Date('2026-09-06T00:00:00'))).toEqual({
      startTime: '2026-08-01',
      endTime: '2026-08-31',
    });
  });

  it('parses an explicit year and month', () => {
    expect(parseDateRange('2026年8月 GMV')).toEqual({
      startTime: '2026-08-01',
      endTime: '2026-08-31',
    });
  });
});
