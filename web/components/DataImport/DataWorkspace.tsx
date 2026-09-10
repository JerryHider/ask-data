'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import DbConnectionPanel from './DbConnectionPanel';
import FileImportPanel from './FileImportPanel';

interface TableColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  key: string;
}

interface DatabaseTable {
  schema: string;
  name: string;
  type: string;
  estimatedRowCount: number;
  columns: TableColumn[];
}

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
  sql: string;
}

type WorkspaceTab = 'query' | 'import' | 'connection';

const tabs: { key: WorkspaceTab; label: string }[] = [
  { key: 'query', label: '数据查询' },
  { key: 'import', label: '文件导入' },
  { key: 'connection', label: '数据库连接' },
];

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function DataWorkspace() {
  const [tab, setTab] = useState<WorkspaceTab>('query');
  const [tables, setTables] = useState<DatabaseTable[]>([]);
  const [selectedTable, setSelectedTable] = useState<DatabaseTable | null>(null);
  const [keyword, setKeyword] = useState('');
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loadingTables, setLoadingTables] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [error, setError] = useState('');

  const loadTables = useCallback(async () => {
    setLoadingTables(true);
    setError('');
    try {
      const response = await fetch('/api/ingest/tables');
      if (!response.ok) {
        const detail = (await response.json()) as { detail?: string };
        throw new Error(detail.detail ?? '表清单加载失败');
      }
      setTables(await response.json());
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoadingTables(false);
    }
  }, []);

  useEffect(() => {
    void loadTables();
  }, [loadTables]);

  const filteredTables = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) return tables;
    return tables.filter((table) =>
      `${table.schema}.${table.name}`.toLowerCase().includes(normalizedKeyword)
    );
  }, [keyword, tables]);

  function selectTable(table: DatabaseTable) {
    setSelectedTable(table);
    setTab('query');
    setSql(`SELECT *\nFROM \`${table.schema}\`.\`${table.name}\`\nLIMIT 100`);
    setResult(null);
    setError('');
  }

  async function runQuery() {
    if (!sql.trim() || querying) return;
    setQuerying(true);
    setError('');
    setResult(null);
    try {
      const response = await fetch('/api/ingest/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sql }),
      });
      const data = (await response.json()) as Partial<QueryResult> & { detail?: string };
      if (!response.ok) throw new Error(data.detail ?? '查询失败');
      if (!data.columns || !data.rows) throw new Error('查询结果格式错误');
      setResult({
        columns: data.columns,
        rows: data.rows,
        rowCount: data.rowCount ?? data.rows.length,
        durationMs: data.durationMs ?? 0,
        sql: data.sql ?? sql,
      });
    } catch (queryError) {
      setError((queryError as Error).message);
    } finally {
      setQuerying(false);
    }
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-white">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 px-4">
        <div className="flex items-center gap-1">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`rounded px-3 py-1.5 text-sm ${
                tab === item.key
                  ? 'bg-blue-50 font-semibold text-blue-700'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void loadTables()}
          disabled={loadingTables}
          className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {loadingTables ? '刷新中…' : '刷新表清单'}
        </button>
      </header>

      {tab === 'query' ? (
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-80 shrink-0 flex-col border-r border-slate-200 bg-slate-50">
            <div className="border-b border-slate-200 p-3">
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索表名"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {filteredTables.map((table) => (
                <button
                  key={`${table.schema}.${table.name}`}
                  type="button"
                  onClick={() => selectTable(table)}
                  className={`mb-2 w-full rounded border px-3 py-2 text-left text-sm ${
                    selectedTable?.schema === table.schema && selectedTable?.name === table.name
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-slate-200 bg-white hover:bg-slate-100'
                  }`}
                >
                  <span className="block truncate font-medium">{table.name}</span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {table.schema} · 约 {table.estimatedRowCount} 行 · {table.columns.length} 字段
                  </span>
                </button>
              ))}
              {!loadingTables && filteredTables.length === 0 ? (
                <p className="px-2 py-4 text-sm text-slate-500">暂无匹配的数据表</p>
              ) : null}
            </div>
            {selectedTable ? (
              <div className="max-h-64 shrink-0 overflow-auto border-t border-slate-200 p-3">
                <h3 className="text-xs font-semibold">
                  {selectedTable.schema}.{selectedTable.name}
                </h3>
                <ul className="mt-2 space-y-1 text-xs text-slate-600">
                  {selectedTable.columns.map((column) => (
                    <li key={column.name} className="flex justify-between gap-2">
                      <span className="truncate">{column.name}</span>
                      <span className="shrink-0 text-slate-400">{column.dataType}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="border-b border-slate-200 p-4">
              <textarea
                value={sql}
                onChange={(event) => setSql(event.target.value)}
                placeholder="输入 SELECT 查询语句，例如：SELECT * FROM askdata.fct_orders LIMIT 100"
                spellCheck={false}
                className="h-32 w-full resize-none rounded border border-slate-300 p-3 font-mono text-sm"
              />
              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-slate-500">仅支持只读 SELECT / WITH 查询，最多返回 1000 行</p>
                <button
                  type="button"
                  onClick={() => void runQuery()}
                  disabled={querying || !sql.trim()}
                  className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {querying ? '查询中…' : '执行查询'}
                </button>
              </div>
              {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              {result ? (
                <>
                  <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
                    <span>返回 {result.rowCount} 行 · {result.durationMs}ms</span>
                    <span className="truncate">执行 SQL：{result.sql}</span>
                  </div>
                  <div className="overflow-auto rounded border border-slate-200">
                    <table className="min-w-full border-collapse text-sm">
                      <thead className="sticky top-0 bg-slate-50">
                        <tr>
                          {result.columns.map((column) => (
                            <th
                              key={column}
                              className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-left font-semibold"
                            >
                              {column}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.rows.map((row, rowIndex) => (
                          <tr key={rowIndex} className="odd:bg-white even:bg-slate-50">
                            {result.columns.map((column) => (
                              <td
                                key={column}
                                className="max-w-64 truncate whitespace-nowrap border-b border-slate-100 px-3 py-2"
                              >
                                {formatCell(row[column])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  选择左侧数据表或输入查询语句
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'import' ? (
        <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-6">
          <div className="mx-auto max-w-4xl">
            <FileImportPanel />
          </div>
        </div>
      ) : null}

      {tab === 'connection' ? (
        <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-6">
          <div className="mx-auto max-w-4xl">
            <DbConnectionPanel />
          </div>
        </div>
      ) : null}
    </section>
  );
}
