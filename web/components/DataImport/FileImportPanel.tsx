'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface ParsedColumn {
  name: string;
  inferred_type: string;
}

interface ParseResult {
  sheets: string[];
  columns: ParsedColumn[];
  preview_rows: Record<string, unknown>[];
  total_rows: number;
  file_id: string;
}

interface ImportHistoryItem {
  id: number;
  table_name: string;
  source_file: string;
  row_count: number;
  duration_ms: number;
  created_at: string;
}

type Stage = 'upload' | 'parsing' | 'mapping' | 'importing' | 'done';

export default function FileImportPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [tableName, setTableName] = useState('');
  const [columns, setColumns] = useState<ParsedColumn[]>([]);
  const [primaryKey, setPrimaryKey] = useState('');
  const [autoDraft, setAutoDraft] = useState(true);
  const [progress, setProgress] = useState({ inserted: 0, total: 0 });
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<ImportHistoryItem[]>([]);

  const loadHistory = useCallback(async () => {
    const response = await fetch('/api/ingest/imports');
    if (response.ok) setHistory(await response.json());
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function parse(selectedFile: File, sheet?: string) {
    if (selectedFile.size > 50 * 1024 * 1024) {
      setMessage('文件超过 50MB 限制');
      return;
    }
    setStage('parsing');
    setMessage('');
    const formData = new FormData();
    formData.append('file', selectedFile);
    const response = await fetch(`/api/ingest/parse${sheet ? `?sheet=${encodeURIComponent(sheet)}` : ''}`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      setStage('upload');
      setMessage('文件解析失败');
      return;
    }
    const result = (await response.json()) as ParseResult;
    setParsed(result);
    setColumns(result.columns);
    setTableName(
      selectedFile.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'imported_table'
    );
    setStage('mapping');
  }

  async function importFile() {
    if (!parsed) return;
    setStage('importing');
    const response = await fetch('/api/ingest/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file_id: parsed.file_id,
        table_name: tableName,
        columns,
        primary_key: primaryKey || null,
        target_datasource: 'mysql',
      }),
    });
    const reader = response.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;
    while (!done) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) {
        const eventName = chunk.match(/event: (.+)/)?.[1];
        const data = JSON.parse(chunk.match(/data: (.+)/)?.[1] ?? '{}');
        if (eventName === 'import_progress') setProgress(data);
        if (eventName === 'import_done') {
          done = true;
          setProgress({ inserted: data.inserted, total: data.inserted });
          setMessage(`导入完成：${data.table_name}，${data.inserted} 行，${data.duration_ms}ms`);
          if (autoDraft) {
            const draftResponse = await fetch('/api/registry/semantic-models/auto-draft', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ table_name: data.table_name }),
            });
            if (draftResponse.ok) setMessage('已生成语义模型草稿，请前往语义模型模块完善后发布');
          }
          await loadHistory();
        }
        if (eventName === 'import_failed') {
          done = true;
          setMessage(`导入失败：${data.error}`);
        }
      }
    }
    setStage('done');
  }

  return (
    <section className='rounded border border-slate-200 bg-white p-3'>
      <h3 className='text-sm font-semibold'>文件导入</h3>
      <div className='mt-2 rounded border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500'>
        <input
          ref={inputRef}
          type='file'
          accept='.csv,.xlsx,.xls'
          className='hidden'
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) {
              setFile(selected);
              void parse(selected);
            }
          }}
        />
        <button type='button' onClick={() => inputRef.current?.click()} className='text-blue-600'>
          点击选择
        </button>
        <span> 或拖拽 CSV / Excel（≤50MB）</span>
      </div>
      {stage === 'parsing' ? <p className='mt-2 text-xs text-slate-500'>正在解析...</p> : null}
      {parsed?.sheets.length && stage === 'mapping' ? (
        <div className='mt-2 flex flex-wrap gap-2'>
          {parsed.sheets.map((sheet) => (
            <button
              key={sheet}
              type='button'
              className='rounded border px-2 py-1 text-[11px]'
              onClick={() => file && void parse(file, sheet)}
            >
              {sheet}
            </button>
          ))}
        </div>
      ) : null}
      {stage === 'mapping' ? (
        <div className='mt-3 space-y-2'>
          <label className='grid gap-1 text-xs'>
            目标表名
            <input
              className='rounded border border-slate-300 p-2'
              value={tableName}
              onChange={(event) => setTableName(event.target.value)}
            />
          </label>
          <div className='grid gap-2'>
            {columns.map((column, index) => (
              <div key={column.name} className='grid grid-cols-[1fr_100px] gap-2'>
                <input
                  className='rounded border border-slate-300 p-2 text-xs'
                  value={column.name}
                  onChange={(event) => {
                    const next = [...columns];
                    next[index] = { ...column, name: event.target.value };
                    setColumns(next);
                  }}
                />
                <select
                  className='rounded border border-slate-300 p-2 text-xs'
                  value={column.inferred_type}
                  onChange={(event) => {
                    const next = [...columns];
                    next[index] = { ...column, inferred_type: event.target.value };
                    setColumns(next);
                  }}
                >
                  {['integer', 'float', 'string', 'date'].map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <label className='grid gap-1 text-xs'>
            主键列
            <select
              className='rounded border border-slate-300 p-2'
              value={primaryKey}
              onChange={(event) => setPrimaryKey(event.target.value)}
            >
              <option value=''>无</option>
              {columns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
          <label className='flex items-center gap-2 text-xs'>
            <input
              type='checkbox'
              checked={autoDraft}
              onChange={(event) => setAutoDraft(event.target.checked)}
            />
            导入后自动生成语义模型草稿
          </label>
          <button
            type='button'
            className='w-full rounded bg-blue-600 px-3 py-2 text-sm text-white'
            onClick={() => void importFile()}
          >
            开始导入
          </button>
        </div>
      ) : null}
      {stage === 'importing' ? (
        <p className='mt-2 text-xs text-slate-600'>
          导入中 {progress.inserted}/{progress.total}
        </p>
      ) : null}
      {message ? <p className='mt-2 rounded bg-slate-50 p-2 text-xs'>{message}</p> : null}
      {history.length ? (
        <div className='mt-3'>
          <h4 className='text-xs font-semibold'>导入历史</h4>
          {history.map((item) => (
            <div key={item.id} className='mt-1 border-t pt-1 text-[11px] text-slate-600'>
              {item.table_name} · {item.row_count} 行 · {item.source_file}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
