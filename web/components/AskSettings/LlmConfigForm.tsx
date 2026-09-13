'use client';

import { useCallback, useEffect, useState } from 'react';

interface LlmConfig {
  id: number;
  name: string;
  provider: string;
  model: string;
  base_url: string | null;
  temperature: number;
  max_tokens: number;
  is_active: boolean;
}

const emptyForm = {
  name: '',
  provider: 'openai',
  model: '',
  api_key: '',
  base_url: '',
  temperature: 0.2,
  max_tokens: 8192,
  is_active: false,
};

export default function LlmConfigForm() {
  const [configs, setConfigs] = useState<LlmConfig[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const response = await fetch('/api/registry/llm-configs');
    if (response.ok) setConfigs(await response.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    const response = await fetch(
      editingId ? `/api/registry/llm-configs/${editingId}` : '/api/registry/llm-configs',
      {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      }
    );
    if (!response.ok) {
      setMessage('保存失败');
      return;
    }
    setForm(emptyForm);
    setEditingId(null);
    await load();
  }

  async function test(configId: number) {
    const response = await fetch(`/api/registry/llm-configs/${configId}/test`, { method: 'POST' });
    const result = (await response.json()) as { ok?: boolean; latency_ms?: number; error?: string };
    setMessage(result.ok ? `连接成功（${result.latency_ms}ms）` : `连接失败：${result.error}`);
  }

  async function remove(config: LlmConfig) {
    if (!window.confirm(`确定删除模型配置「${config.name}」吗？`)) return;

    const response = await fetch(`/api/registry/llm-configs/${config.id}`, { method: 'DELETE' });
    if (!response.ok) {
      setMessage('删除失败');
      return;
    }

    if (editingId === config.id) {
      setEditingId(null);
      setForm(emptyForm);
    }
    setMessage('配置已删除');
    await load();
  }

  return (
    <div className='space-y-2'>
      {configs.map((config) => (
        <article key={config.id} className='rounded border p-2 text-xs'>
          <div className='flex items-center justify-between'>
            <span className='font-semibold'>{config.name}</span>
            {config.is_active ? (
              <span className='rounded bg-green-50 px-1 text-[10px] text-green-700'>激活</span>
            ) : null}
          </div>
          <div className='text-[11px] text-slate-500'>
            {config.provider} · {config.model}
          </div>
          <div className='mt-2 flex gap-2 text-[11px]'>
            <button type='button' className='rounded border px-2 py-1' onClick={() => void test(config.id)}>
              测试
            </button>
            <button
              type='button'
              className='rounded border px-2 py-1'
              onClick={() => {
                setEditingId(config.id);
                setForm({ ...emptyForm, ...config, api_key: '', base_url: config.base_url ?? '' });
              }}
            >
              编辑
            </button>
            <button
              type='button'
              className='rounded border px-2 py-1'
              onClick={async () => {
                await fetch(`/api/registry/llm-configs/${config.id}/activate`, { method: 'POST' });
                await load();
              }}
            >
              设为激活
            </button>
            <button
              type='button'
              className='rounded border border-red-200 px-2 py-1 text-red-600'
              onClick={() => void remove(config)}
            >
              删除
            </button>
          </div>
        </article>
      ))}
      <div className='grid gap-2 rounded border p-2'>
        <input
          className='rounded border p-2 text-xs'
          placeholder='配置名称'
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
        <select
          className='rounded border p-2 text-xs'
          value={form.provider}
          onChange={(event) => setForm({ ...form, provider: event.target.value })}
        >
          {['openai', 'anthropic', 'deepseek', 'ollama', 'custom_openai_compatible'].map((provider) => (
            <option key={provider} value={provider}>
              {provider}
            </option>
          ))}
        </select>
        <input
          className='rounded border p-2 text-xs'
          placeholder='模型'
          value={form.model}
          onChange={(event) => setForm({ ...form, model: event.target.value })}
        />
        <input
          type='password'
          className='rounded border p-2 text-xs'
          placeholder={editingId ? 'API Key（留空不改）' : 'API Key'}
          value={form.api_key}
          onChange={(event) => setForm({ ...form, api_key: event.target.value })}
        />
        <input
          className='rounded border p-2 text-xs'
          placeholder='Base URL'
          value={form.base_url}
          onChange={(event) => setForm({ ...form, base_url: event.target.value })}
        />
        <button type='button' className='rounded bg-blue-600 px-2 py-1 text-xs text-white' onClick={() => void save()}>
          保存配置
        </button>
      </div>
      {message ? <p className='text-[11px] text-slate-600'>{message}</p> : null}
    </div>
  );
}
