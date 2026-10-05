'use client';

import { useEffect, useMemo, useState } from 'react';

interface SemanticMetric {
  name: string;
  description: string;
  type: string;
  available_dimensions: string[];
}

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
  sql: string;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function SemanticMetricQuery() {
  const [metrics, setMetrics] = useState<SemanticMetric[]>([]);
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);
  const [selectedDimensions, setSelectedDimensions] = useState<string[]>([]);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [limit, setLimit] = useState(100);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSql, setShowSql] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/semantic-metrics');
        if (!response.ok) {
          const detail = (await response.json()) as { message?: string };
          throw new Error(detail.message ?? '指标加载失败');
        }
        const data = (await response.json()) as SemanticMetric[];
        setMetrics(data);
        if (data.some((metric) => metric.name === 'premium')) {
          setSelectedMetrics(['premium']);
        }
      } catch (caught) {
        setError((caught as Error).message);
      }
    })();
  }, []);

  const availableDimensions = useMemo(() => {
    const selected = metrics.filter((metric) => selectedMetrics.includes(metric.name));
    const dimensionSets = selected.map((metric) => new Set(metric.available_dimensions));
    if (dimensionSets.length === 0) return [];
    return [...dimensionSets[0]].filter((dimension) =>
      dimensionSets.every((dimensions) => dimensions.has(dimension))
    );
  }, [metrics, selectedMetrics]);

  function toggleValue(value: string, values: string[], setValues: (next: string[]) => void) {
    setValues(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  async function runQuery() {
    if (selectedMetrics.length === 0 || loading) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const response = await fetch('/api/semantic-metrics/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          metrics: selectedMetrics,
          groupBy: selectedDimensions,
          startTime: startTime || undefined,
          endTime: endTime || undefined,
          limit,
        }),
      });
      const data = (await response.json()) as Partial<QueryResult> & { message?: string };
      if (!response.ok) throw new Error(data.message ?? '查询失败');
      if (!data.columns || !data.rows) throw new Error('查询结果格式错误');
      setResult({
        columns: data.columns,
        rows: data.rows,
        rowCount: data.rowCount ?? data.rows.length,
        durationMs: data.durationMs ?? 0,
        sql: data.sql ?? '',
      });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className='grid h-full min-h-0 grid-rows-[auto_1fr] gap-4 p-4'>
      <div className='grid gap-4 rounded border border-slate-200 bg-white p-4 lg:grid-cols-3'>
        <div>
          <h3 className='text-sm font-semibold'>指标</h3>
          <div className='mt-2 max-h-56 space-y-1 overflow-auto pr-1'>
            {metrics.map((metric) => (
              <label key={metric.name} className='flex items-start gap-2 text-xs text-slate-700'>
                <input
                  type='checkbox'
                  checked={selectedMetrics.includes(metric.name)}
                  onChange={() => toggleValue(metric.name, selectedMetrics, setSelectedMetrics)}
                />
                <span>
                  <span className='font-medium'>{metric.name}</span>
                  <span className='ml-1 text-slate-400'>{metric.type}</span>
                </span>
              </label>
            ))}
            {metrics.length === 0 ? <p className='text-xs text-slate-400'>暂无已发布指标</p> : null}
          </div>
        </div>
        <div>
          <h3 className='text-sm font-semibold'>维度</h3>
          <div className='mt-2 max-h-56 space-y-1 overflow-auto pr-1'>
            {availableDimensions.map((dimension) => (
              <label key={dimension} className='flex items-center gap-2 text-xs text-slate-700'>
                <input
                  type='checkbox'
                  checked={selectedDimensions.includes(dimension)}
                  onChange={() => toggleValue(dimension, selectedDimensions, setSelectedDimensions)}
                />
                {dimension}
              </label>
            ))}
            {availableDimensions.length === 0 ? (
              <p className='text-xs text-slate-400'>当前指标组合无可用公共维度</p>
            ) : null}
          </div>
        </div>
        <div className='grid content-start gap-3'>
          <div className='grid grid-cols-2 gap-2'>
            <label className='grid gap-1 text-xs font-medium text-slate-600'>
              开始日期
              <input
                type='date'
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                className='rounded border border-slate-300 p-2 text-sm font-normal'
              />
            </label>
            <label className='grid gap-1 text-xs font-medium text-slate-600'>
              结束日期
              <input
                type='date'
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                className='rounded border border-slate-300 p-2 text-sm font-normal'
              />
            </label>
          </div>
          <label className='grid gap-1 text-xs font-medium text-slate-600'>
            返回行数（1-1000）
            <input
              type='number'
              min={1}
              max={1000}
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
              className='rounded border border-slate-300 p-2 text-sm font-normal'
            />
          </label>
          <button
            type='button'
            onClick={() => void runQuery()}
            disabled={loading || selectedMetrics.length === 0}
            className='rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50'
          >
            {loading ? '查询中…' : '查询指标'}
          </button>
        </div>
      </div>

      {error ? <p className='rounded bg-red-50 p-3 text-sm text-red-700'>{error}</p> : null}

      <div className='min-h-0 overflow-auto rounded border border-slate-200 bg-white'>
        {result ? (
          <div className='grid h-full min-h-0 grid-rows-[auto_auto_1fr] gap-3 p-4'>
            <div className='flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500'>
              <span>返回 {result.rowCount} 行 · {result.durationMs}ms</span>
              <button
                type='button'
                onClick={() => setShowSql(!showSql)}
                className='rounded border border-slate-300 px-2 py-1'
              >
                {showSql ? '隐藏 SQL' : '查看 SQL'}
              </button>
            </div>
            {showSql ? (
              <pre className='max-h-48 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100'>
                {result.sql}
              </pre>
            ) : null}
            <div className='min-h-0 overflow-auto'>
              <table className='min-w-full border-collapse text-sm'>
                <thead className='sticky top-0 bg-slate-50'>
                  <tr>
                    {result.columns.map((column) => (
                      <th
                        key={column}
                        className='whitespace-nowrap border-b border-slate-200 px-3 py-2 text-left font-semibold'
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className='odd:bg-white even:bg-slate-50'>
                      {result.columns.map((column) => (
                        <td
                          key={column}
                          className='max-w-64 truncate whitespace-nowrap border-b border-slate-100 px-3 py-2'
                        >
                          {formatCell(row[column])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className='flex h-full items-center justify-center text-sm text-slate-500'>
            选择已发布指标后查询，结果仅以表格展示
          </div>
        )}
      </div>
    </section>
  );
}
