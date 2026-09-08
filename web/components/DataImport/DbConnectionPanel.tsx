'use client';

import { useCallback, useEffect, useState } from 'react';

interface DbConnection {
  id: number;
  name: string;
  type: string;
  host: string;
  port: number;
  database_name: string;
  username: string;
  is_default: boolean;
  last_test_ok: boolean | null;
}

interface ConnectionForm {
  name: string;
  type: string;
  host: string;
  port: number;
  database_name: string;
  username: string;
  password: string;
}

const emptyForm: ConnectionForm = {
  name: '',
  type: 'mysql',
  host: '127.0.0.1',
  port: 3306,
  database_name: 'askdata',
  username: 'root',
  password: '',
};

export default function DbConnectionPanel() {
  const [connections, setConnections] = useState<DbConnection[]>([]);
  const [form, setForm] = useState<ConnectionForm>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const response = await fetch('/api/registry/db-connections');
    if (response.ok) setConnections(await response.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function test(connectionId?: number) {
    const response = await fetch('/api/registry/db-connections/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        connectionId
          ? { connection_id: connectionId }
          : { connection: { ...form, password: form.password || undefined } }
      ),
    });
    const result = (await response.json()) as { ok?: boolean; latency_ms?: number; error?: string };
    setMessage(result.ok ? `连接成功（${result.latency_ms}ms）` : `连接失败：${result.error ?? '未知错误'}`);
    await load();
  }

  async function save() {
    const response = await fetch(
      editingId ? `/api/registry/db-connections/${editingId}` : '/api/registry/db-connections',
      {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      }
    );
    if (!response.ok) {
      const result = (await response.json()) as { detail?: string };
      setMessage(result.detail ?? '保存失败');
      return;
    }
    setForm(emptyForm);
    setEditingId(null);
    await load();
    await fetch('/api/datasources/refresh', { method: 'POST' });
    setMessage('连接已保存，数据源已刷新');
  }

  return (
    <section className='rounded border border-slate-200 bg-white p-3'>
      <h3 className='text-sm font-semibold'>数据库连接</h3>
      <div className='mt-2 space-y-2'>
        {connections.map((connection) => (
          <article key={connection.id} className='rounded border p-2 text-xs'>
            <div className='flex items-center justify-between'>
              <span className='font-semibold'>
                {connection.name}
                {connection.is_default ? (
                  <span className='ml-1 rounded bg-blue-50 px-1 text-[10px] text-blue-700'>默认</span>
                ) : null}
              </span>
              <span className={connection.last_test_ok ? 'text-green-600' : connection.last_test_ok === false ? 'text-red-600' : 'text-slate-400'}>
                ●
              </span>
            </div>
            <div className='text-[11px] text-slate-500'>
              {connection.type.toUpperCase()} · {connection.host}:{connection.port}
            </div>
            <div className='mt-2 flex gap-2 text-[11px]'>
              <button type='button' className='rounded border px-2 py-1' onClick={() => void test(connection.id)}>
                测试
              </button>
              <button
                type='button'
                className='rounded border px-2 py-1'
                onClick={() => {
                  setEditingId(connection.id);
                  setForm({ ...emptyForm, ...connection, password: '' });
                }}
              >
                编辑
              </button>
              {!connection.is_default ? (
                <button
                  type='button'
                  className='rounded border border-red-200 px-2 py-1 text-red-600'
                  onClick={async () => {
                    await fetch(`/api/registry/db-connections/${connection.id}`, { method: 'DELETE' });
                    await load();
                  }}
                >
                  删除
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      <div className='mt-3 grid gap-2 rounded border p-2'>
        <input
          className='rounded border border-slate-300 p-2 text-xs'
          placeholder='名称'
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
        <select
          className='rounded border border-slate-300 p-2 text-xs'
          value={form.type}
          onChange={(event) => setForm({ ...form, type: event.target.value })}
        >
          <option value='mysql'>mysql</option>
          <option value='postgresql' disabled>
            postgresql（预留）
          </option>
          <option value='clickhouse' disabled>
            clickhouse（预留）
          </option>
          <option value='starrocks' disabled>
            starrocks（预留）
          </option>
        </select>
        <input
          className='rounded border border-slate-300 p-2 text-xs'
          placeholder='Host'
          value={form.host}
          onChange={(event) => setForm({ ...form, host: event.target.value })}
        />
        <input
          type='number'
          className='rounded border border-slate-300 p-2 text-xs'
          value={form.port}
          onChange={(event) => setForm({ ...form, port: Number(event.target.value) })}
        />
        <input
          className='rounded border border-slate-300 p-2 text-xs'
          placeholder='Database'
          value={form.database_name}
          onChange={(event) => setForm({ ...form, database_name: event.target.value })}
        />
        <input
          className='rounded border border-slate-300 p-2 text-xs'
          placeholder='用户名'
          value={form.username}
          onChange={(event) => setForm({ ...form, username: event.target.value })}
        />
        <input
          type='password'
          className='rounded border border-slate-300 p-2 text-xs'
          placeholder={editingId ? '密码（留空不改）' : '密码'}
          value={form.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
        />
        <div className='flex gap-2'>
          <button type='button' className='flex-1 rounded border px-2 py-1 text-xs' onClick={() => void test()}>
            测试连接
          </button>
          <button type='button' className='flex-1 rounded bg-blue-600 px-2 py-1 text-xs text-white' onClick={() => void save()}>
            保存
          </button>
        </div>
      </div>
      {message ? <p className='mt-2 text-xs text-slate-600'>{message}</p> : null}
    </section>
  );
}
