'use client';

import { useCallback, useEffect, useState } from 'react';

interface SqlExample {
  id: number;
  question: string;
  sql: string;
  metric_name: string | null;
}

export default function SqlExampleEditor() {
  const [examples, setExamples] = useState<SqlExample[]>([]);
  const [question, setQuestion] = useState('');
  const [sql, setSql] = useState('');
  const [metricName, setMetricName] = useState('');

  const load = useCallback(async () => {
    const response = await fetch('/api/registry/sql-examples');
    if (response.ok) setExamples(await response.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    await fetch('/api/registry/sql-examples', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, sql, metric_name: metricName || null }),
    });
    setQuestion('');
    setSql('');
    setMetricName('');
    await fetch('/api/registry/sql-examples/reindex', { method: 'POST' });
    await load();
  }

  return (
    <div className='space-y-2'>
      {examples.map((example) => (
        <article key={example.id} className='rounded border p-2 text-xs'>
          <div className='font-semibold'>{example.question.slice(0, 30)}</div>
          <div className='text-[11px] text-slate-500'>{example.metric_name ?? '自由 SQL'}</div>
          <button
            type='button'
            className='mt-1 rounded border px-2 py-1 text-[11px]'
            onClick={async () => {
              await fetch(`/api/registry/sql-examples/${example.id}`, { method: 'DELETE' });
              await load();
            }}
          >
            删除
          </button>
        </article>
      ))}
      <div className='grid gap-2 rounded border p-2'>
        <input
          className='rounded border p-2 text-xs'
          placeholder='自然语言问题'
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <textarea
          className='rounded border p-2 text-xs'
          rows={4}
          placeholder='期望 SQL'
          value={sql}
          onChange={(event) => setSql(event.target.value)}
        />
        <input
          className='rounded border p-2 text-xs'
          placeholder='关联指标（可选）'
          value={metricName}
          onChange={(event) => setMetricName(event.target.value)}
        />
        <button type='button' className='rounded bg-blue-600 px-2 py-1 text-xs text-white' onClick={() => void save()}>
          新增样例并重建索引
        </button>
      </div>
    </div>
  );
}
