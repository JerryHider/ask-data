'use client';

import { useMemo, useState } from 'react';
import { useAskDataStore } from '../../lib/store';

export default function TableTab() {
  const tableResult = useAskDataStore((state) => state.tableResult);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [ascending, setAscending] = useState(true);
  const [page, setPage] = useState(0);
  const pageSize = 20;

  const sortedRows = useMemo(() => {
    if (!tableResult || !sortColumn) return tableResult?.queryResult.rows ?? [];
    return [...tableResult.queryResult.rows].sort((left, right) => {
      const leftValue = left[sortColumn];
      const rightValue = right[sortColumn];
      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        return ascending ? leftValue - rightValue : rightValue - leftValue;
      }
      return ascending
        ? String(leftValue ?? '').localeCompare(String(rightValue ?? ''), 'zh-CN')
        : String(rightValue ?? '').localeCompare(String(leftValue ?? ''), 'zh-CN');
    });
  }, [tableResult, sortColumn, ascending]);

  if (!tableResult) {
    return <p className="text-sm text-slate-500">暂无查询结果。</p>;
  }

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentRows = sortedRows.slice(page * pageSize, (page + 1) * pageSize);

  function exportCsv(): void {
    const columns = tableResult?.queryResult.columns ?? [];
    const csv = [
      columns.join(','),
      ...sortedRows.map((row) =>
        columns
          .map((column) => `"${String(row[column] ?? '').replace(/"/g, '""')}"`)
          .join(',')
      ),
    ].join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${tableResult?.title ?? 'query-result'}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{tableResult.title}</h2>
        <button
          type="button"
          onClick={exportCsv}
          className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700"
        >
          导出 CSV
        </button>
      </div>
      <div className="overflow-auto rounded border border-slate-200">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50">
              {tableResult.queryResult.columns.map((column) => (
                <th
                  key={column}
                  className="cursor-pointer border-b border-slate-200 px-3 py-2 text-left font-semibold"
                  onClick={() => {
                    if (sortColumn === column) setAscending(!ascending);
                    else {
                      setSortColumn(column);
                      setAscending(true);
                    }
                    setPage(0);
                  }}
                >
                  {column}
                  {sortColumn === column ? (ascending ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {currentRows.map((row, rowIndex) => (
              <tr key={rowIndex} className="odd:bg-white even:bg-slate-50">
                {tableResult.queryResult.columns.map((column) => (
                  <td key={column} className="border-b border-slate-100 px-3 py-2">
                    {String(row[column] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
        <span>
          {page + 1} / {pageCount}
        </span>
        <span className="flex gap-2">
          <button type="button" onClick={() => setPage(Math.max(0, page - 1))}>
            上一页
          </button>
          <button type="button" onClick={() => setPage(Math.min(pageCount - 1, page + 1))}>
            下一页
          </button>
        </span>
      </div>
    </section>
  );
}
