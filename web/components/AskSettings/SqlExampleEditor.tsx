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
  const [selectedExample, setSelectedExample] = useState<SqlExample | null>(null);
  const [modalMode, setModalMode] = useState<'view' | 'edit'>('view');
  const [editQuestion, setEditQuestion] = useState('');
  const [editSql, setEditSql] = useState('');
  const [editMetricName, setEditMetricName] = useState('');
  const [error, setError] = useState('');
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

  function openView(example: SqlExample) {
    setSelectedExample(example);
    setModalMode('view');
    setError('');
  }

  function openEdit(example: SqlExample) {
    setSelectedExample(example);
    setEditQuestion(example.question);
    setEditSql(example.sql);
    setEditMetricName(example.metric_name ?? '');
    setModalMode('edit');
    setError('');
  }

  async function saveEdit() {
    if (!selectedExample) return;
    const response = await fetch(`/api/registry/sql-examples/${selectedExample.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: editQuestion,
        sql: editSql,
        metric_name: editMetricName || null,
      }),
    });
    if (!response.ok) {
      const result = (await response.json()) as { detail?: string };
      setError(result.detail ?? '保存失败');
      return;
    }
    await fetch('/api/registry/sql-examples/reindex', { method: 'POST' });
    setSelectedExample(null);
    await load();
  }

  return (
    <div className='space-y-2'>
      {examples.map((example) => (
        <article key={example.id} className='rounded border p-2 text-xs'>
          <button type='button' className='text-left font-semibold' onClick={() => openView(example)}>
            {example.question.slice(0, 30)}
          </button>
          <div className='text-[11px] text-slate-500'>{example.metric_name ?? '自由 SQL'}</div>
          <div className='mt-1 flex gap-2'>
            <button type='button' className='rounded border px-2 py-1 text-[11px]' onClick={() => openView(example)}>
              查看
            </button>
            <button type='button' className='rounded border px-2 py-1 text-[11px]' onClick={() => openEdit(example)}>
              编辑
            </button>
            <button
              type='button'
              className='rounded border px-2 py-1 text-[11px] text-red-600'
              onClick={async () => {
                await fetch(`/api/registry/sql-examples/${example.id}`, { method: 'DELETE' });
                await load();
              }}
            >
              删除
            </button>
          </div>
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
      {selectedExample ? (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4'>
          <section className='flex max-h-[85vh] w-full max-w-2xl flex-col rounded bg-white shadow-xl'>
            <header className='flex items-center justify-between border-b p-4'>
              <h3 className='text-base font-semibold'>
                {modalMode === 'view' ? '查看 NL→SQL 样例' : '编辑 NL→SQL 样例'}
              </h3>
              <button type='button' onClick={() => setSelectedExample(null)} className='text-sm text-slate-500'>
                关闭
              </button>
            </header>
            <div className='grid gap-3 overflow-auto p-4 text-xs'>
              {modalMode === 'view' ? (
                <>
                  <div>
                    <div className='font-semibold'>自然语言问题</div>
                    <div className='mt-1'>{selectedExample.question}</div>
                  </div>
                  <div>
                    <div className='font-semibold'>关联指标</div>
                    <div className='mt-1'>{selectedExample.metric_name ?? '自由 SQL'}</div>
                  </div>
                  <div>
                    <div className='font-semibold'>SQL</div>
                    <pre className='mt-1 overflow-auto rounded border bg-slate-50 p-2 text-[11px]'>
                      {selectedExample.sql}
                    </pre>
                  </div>
                </>
              ) : (
                <>
                  <label className='grid gap-1'>
                    自然语言问题
                    <input
                      className='rounded border p-2'
                      value={editQuestion}
                      onChange={(event) => setEditQuestion(event.target.value)}
                    />
                  </label>
                  <label className='grid gap-1'>
                    期望 SQL
                    <textarea
                      className='rounded border p-2'
                      rows={8}
                      value={editSql}
                      onChange={(event) => setEditSql(event.target.value)}
                    />
                  </label>
                  <label className='grid gap-1'>
                    关联指标（可选）
                    <input
                      className='rounded border p-2'
                      value={editMetricName}
                      onChange={(event) => setEditMetricName(event.target.value)}
                    />
                  </label>
                </>
              )}
            </div>
            {error ? <div className='bg-red-50 px-4 py-2 text-xs text-red-700'>{error}</div> : null}
            <footer className='flex justify-end gap-2 border-t p-4'>
              {modalMode === 'view' ? (
                <button
                  type='button'
                  className='rounded bg-blue-600 px-3 py-2 text-sm text-white'
                  onClick={() => openEdit(selectedExample)}
                >
                  编辑
                </button>
              ) : (
                <button
                  type='button'
                  className='rounded bg-blue-600 px-3 py-2 text-sm text-white'
                  onClick={() => void saveEdit()}
                >
                  保存并重建索引
                </button>
              )}
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
