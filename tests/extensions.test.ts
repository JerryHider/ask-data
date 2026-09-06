import { describe, expect, it } from 'vitest';
import { shouldBlockExecuteSql } from '../extensions/dual-router/interceptor.js';
import { renderMarkdownTable } from '../extensions/table-render/index.js';

describe('dual router interceptor', () => {
  it('blocks execute_sql before search_schema', () => {
    const result = shouldBlockExecuteSql({
      name: 'execute_sql',
      state: { searchedSchema: false },
    });
    expect(result).toEqual({
      block: true,
      reason: '????? search_schema ????',
    });
  });

  it('allows execute_sql after search_schema', () => {
    const result = shouldBlockExecuteSql({
      name: 'execute_sql',
      state: { searchedSchema: true },
    });
    expect(result.block).toBeUndefined();
  });
});

describe('table renderer', () => {
  it('renders a valid markdown table', () => {
    const markdown = renderMarkdownTable({
      columns: ['region', 'amount'],
      rows: [{ region: 'East', amount: 100 }],
      rowCount: 1,
    });
    expect(markdown).toContain('| region | amount |');
    expect(markdown).toContain('| East | 100 |');
  });

  it('adds a truncation note after 20 rows', () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      region: `region-${index}`,
      amount: index,
    }));
    const markdown = renderMarkdownTable({
      columns: ['region', 'amount'],
      rows,
      rowCount: 21,
    });
    expect(markdown).toContain('? 21 ?');
  });
});
