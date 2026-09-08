'use client';

import { useCallback, useEffect, useState } from 'react';

interface RagSpace {
  id: number;
  name: string;
  enabled: boolean;
  doc_count: number;
  updated_at: string;
}

interface RagDoc {
  id: number;
  file_name: string;
  chunk_count: number;
}

export default function RagSpaceManager() {
  const [spaces, setSpaces] = useState<RagSpace[]>([]);
  const [name, setName] = useState('');
  const [docs, setDocs] = useState<Record<number, RagDoc[]>>({});

  const load = useCallback(async () => {
    const response = await fetch('/api/registry/rag/spaces');
    if (!response.ok) return;
    const result = (await response.json()) as RagSpace[];
    setSpaces(result);
    const nextDocs: Record<number, RagDoc[]> = {};
    await Promise.all(
      result.map(async (space) => {
        const docResponse = await fetch(`/api/registry/rag/spaces/${space.id}/docs`);
        if (docResponse.ok) nextDocs[space.id] = await docResponse.json();
      })
    );
    setDocs(nextDocs);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className='space-y-2'>
      {spaces.map((space) => (
        <article key={space.id} className='rounded border p-2 text-xs'>
          <div className='flex items-center justify-between'>
            <span className='font-semibold'>{space.name}</span>
            <label className='flex items-center gap-1 text-[11px]'>
              <input
                type='checkbox'
                checked={space.enabled}
                onChange={async () => {
                  await fetch(`/api/registry/rag/spaces/${space.id}`, {
                    method: 'PUT',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ name: space.name, enabled: !space.enabled }),
                  });
                  await load();
                }}
              />
              启用
            </label>
          </div>
          <div className='text-[11px] text-slate-500'>{space.doc_count} 个文档</div>
          <div className='mt-1 space-y-1'>
            {(docs[space.id] ?? []).map((doc) => (
              <div key={doc.id} className='flex items-center justify-between text-[11px]'>
                <span>
                  {doc.file_name} · {doc.chunk_count} 块
                </span>
                <button
                  type='button'
                  className='text-red-600'
                  onClick={async () => {
                    await fetch(`/api/registry/rag/docs/${doc.id}`, { method: 'DELETE' });
                    await load();
                  }}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
          <input
            type='file'
            accept='.md,.txt,.pdf'
            className='mt-2 w-full text-[11px]'
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const formData = new FormData();
              formData.append('file', file);
              await fetch(`/api/registry/rag/spaces/${space.id}/docs`, {
                method: 'POST',
                body: formData,
              });
              await load();
            }}
          />
        </article>
      ))}
      <div className='flex gap-2'>
        <input
          className='flex-1 rounded border p-2 text-xs'
          placeholder='新知识空间'
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type='button'
          className='rounded bg-blue-600 px-2 py-1 text-xs text-white'
          onClick={async () => {
            if (!name.trim()) return;
            await fetch('/api/registry/rag/spaces', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ name, enabled: false }),
            });
            setName('');
            await load();
          }}
        >
          新建
        </button>
      </div>
    </div>
  );
}
