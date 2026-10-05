import { describe, expect, it } from 'vitest';
import { buildCsv } from '../web/lib/csv.js';

describe('CSV export', () => {
  it('keeps exported content aligned with table columns and rows', () => {
    expect(
      buildCsv(['id', 'region', 'amount'], [
        { id: 1, region: '华东', amount: '1,200.00' },
        { id: 2, region: 'South "A"', amount: null },
      ])
    ).toBe('id,region,amount\n"1","华东","1,200.00"\n"2","South ""A""",""');
  });
});
