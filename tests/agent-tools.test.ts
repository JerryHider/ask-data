import { describe, expect, it } from 'vitest';
import { limitQueryResultForModel } from '../agent-server/agent-tools.js';
import type { QueryResult } from '../agent-server/types.js';

function queryResult(rowCount: number): QueryResult {
  return {
    columns: ['id', 'premium'],
    rows: Array.from({ length: rowCount }, (_item, index) => ({
      id: index + 1,
      premium: 100,
    })),
    rowCount,
    durationMs: 10,
    sql: 'SELECT id, premium FROM orders',
  };
}

describe('query result model truncation', () => {
  it('truncates results above 100 rows and keeps the original row count', () => {
    const result = limitQueryResultForModel(queryResult(101));

    expect(result.rows).toHaveLength(100);
    expect(result.rowCount).toBe(101);
    expect(result.returnedRowCount).toBe(100);
    expect(result.truncated).toBe(true);
  });

  it('keeps results of 100 rows or fewer unchanged', () => {
    const result = limitQueryResultForModel(queryResult(100));

    expect(result.rows).toHaveLength(100);
    expect(result.rowCount).toBe(100);
    expect(result.returnedRowCount).toBe(100);
    expect(result.truncated).toBe(false);
  });
});
