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

interface RagDocDetail extends RagDoc {
  space_id: number;
  content: string;
  created_at: string;
}

export default function RagSpaceManager() {
  const [spaces, setSpaces] = useState<RagSpace[]>([]);
  const [name, setName] = useState('');
  const [docs, setDocs] = useState<Record<number, RagDoc[]>>({});
  const [selectedDoc, setSelectedDoc] = useState<RagDocDetail | null>(null);
  const [modalMode, setModalMode] = useState<'view' | 'edit'>('view');
  const [editFileName, setEditFileName] = useState('');
  const [editContent, setEditContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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

  async function openDoc(doc: RagDoc, mode: 'view' | 'edit') {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/registry/rag/docs/${doc.id}`);
      if (!response.ok) throw new Error('文档加载失败');
      const detail = (await response.json()) as RagDocDetail;
      setSelectedDoc(detail);
      setEditFileName(detail.file_name);
      setEditContent(detail.content);
      setModalMode(mode);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : '文档加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function saveDoc() {
    if (!selectedDoc) return;
    const response = await fetch(`/api/registry/rag/docs/${selectedDoc.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file_name: editFileName, content: editContent }),
    });
    if (!response.ok) {
      const result = (await response.json()) as { detail?: string };
      setError(result.detail ?? '保存失败');
      return;
    }
    setSelectedDoc(null);
    await load();
  }

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
                <button type='button' className='text-left' onClick={() => void openDoc(doc, 'view')}>
                  {doc.file_name} · {doc.chunk_count} 块
                </button>
                <div className='flex gap-2'>
                  <button type='button' onClick={() => void openDoc(doc, 'view')}>
                    查看
                  </button>
                  <button type='button' onClick={() => void openDoc(doc, 'edit')}>
                    编辑
                  </button>
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
      {loading ? <div className='text-[11px] text-slate-500'>文档加载中…</div> : null}
      {error && !selectedDoc ? <div className='text-[11px] text-red-600'>{error}</div> : null}
      {selectedDoc ? (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4'>
          <section className='flex max-h-[85vh] w-full max-w-3xl flex-col rounded bg-white shadow-xl'>
            <header className='flex items-center justify-between border-b p-4'>
              <h3 className='text-base font-semibold'>
                {modalMode === 'view' ? `查看 ${selectedDoc.file_name}` : `编辑 ${selectedDoc.file_name}`}
              </h3>
              <button type='button' onClick={() => setSelectedDoc(null)} className='text-sm text-slate-500'>
                关闭
              </button>
            </header>
            <div className='grid gap-3 overflow-auto p-4 text-xs'>
              {modalMode === 'view' ? (
                <>
                  <div className='text-[11px] text-slate-500'>
                    {selectedDoc.chunk_count} 块 · {selectedDoc.content.length} 字符
                  </div>
                  <pre className='overflow-auto rounded border bg-slate-50 p-3 text-[11px] leading-5'>
                    {selectedDoc.content}
                  </pre>
                </>
              ) : (
                <>
                  <label className='grid gap-1'>
                    文件名
                    <input
                      className='rounded border p-2'
                      value={editFileName}
                      onChange={(event) => setEditFileName(event.target.value)}
                    />
                  </label>
                  <label className='grid gap-1'>
                    文档内容
                    <textarea
                      className='rounded border p-2 font-mono'
                      rows={16}
                      value={editContent}
                      onChange={(event) => setEditContent(event.target.value)}
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
                  onClick={() => setModalMode('edit')}
                >
                  编辑
                </button>
              ) : (
                <button
                  type='button'
                  className='rounded bg-blue-600 px-3 py-2 text-sm text-white'
                  onClick={() => void saveDoc()}
                >
                  保存
                </button>
              )}
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
