'use client';

import { useMemo, useState } from 'react';
import type { SemanticTemplate } from './TemplatePicker';

export interface SemanticModelRecord {
  id: number;
  name: string;
  template_id: string;
  status: string;
  config: Record<string, unknown>;
  error_message?: string | null;
  updated_at: string;
}

export default function ModelEditorModal({
  template,
  model,
  onClose,
  onSaved,
}: {
  template: SemanticTemplate;
  model: SemanticModelRecord | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const initial = useMemo(() => {
    const values: Record<string, unknown> = {};
    for (const field of template.fields) {
      values[field.key] =
        model?.config[field.key] ??
        (field.type === 'array' ? [] : field.type === 'select' ? field.options?.[0] ?? '' : '');
    }
    return values;
  }, [model, template.fields]);
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function update(key: string, value: unknown) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  async function save(publish: boolean) {
    setSaving(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {};
      for (const field of template.fields) {
        const value = values[field.key];
        payload[field.key] =
          field.type === 'array' && typeof value === 'string'
            ? JSON.parse(value || '[]')
            : value;
      }
      const response = await fetch(
        model ? `/api/registry/semantic-models/${model.id}` : '/api/registry/semantic-models',
        {
          method: model ? 'PUT' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            model ? { config: payload } : { template_id: template.id, config: payload }
          ),
        }
      );
      const saved = (await response.json()) as SemanticModelRecord;
      if (!response.ok) throw new Error(saved.error_message || '保存失败');
      if (publish) {
        const publishResponse = await fetch(`/api/registry/semantic-models/${saved.id}/publish`, {
          method: 'POST',
        });
        if (!publishResponse.ok) {
          const result = (await publishResponse.json()) as { detail?: string };
          throw new Error(result.detail || '发布失败');
        }
      }
      await onSaved();
      onClose();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4'>
      <section className='flex max-h-[85vh] w-full max-w-2xl flex-col rounded bg-white shadow-xl'>
        <header className='flex items-center justify-between border-b p-4'>
          <div>
            <h3 className='text-base font-semibold'>{template.name}</h3>
            <p className='text-xs text-slate-500'>{model ? '编辑语义模型' : '创建语义模型'}</p>
          </div>
          <button type='button' onClick={onClose} className='text-sm text-slate-500'>
            关闭
          </button>
        </header>
        {model?.status === 'published' ? (
          <div className='bg-yellow-50 px-4 py-2 text-xs text-yellow-800'>
            该模型已发布，保存修改后将回退为草稿并需重新发布
          </div>
        ) : null}
        <div className='grid gap-3 overflow-auto p-4'>
          {template.fields.map((field) => (
            <label key={field.key} className='grid gap-1 text-xs font-medium text-slate-600'>
              {field.label}
              {field.type === 'textarea' || field.type === 'array' ? (
                <textarea
                  className='rounded border border-slate-300 p-2 text-sm font-normal'
                  rows={field.type === 'array' ? 5 : 3}
                  value={
                    field.type === 'array'
                      ? typeof values[field.key] === 'string'
                        ? String(values[field.key])
                        : JSON.stringify(values[field.key] ?? [], null, 2)
                      : String(values[field.key] ?? '')
                  }
                  onChange={(event) => update(field.key, event.target.value)}
                />
              ) : field.type === 'select' ? (
                <select
                  className='rounded border border-slate-300 p-2 text-sm font-normal'
                  value={String(values[field.key] ?? '')}
                  onChange={(event) => update(field.key, event.target.value)}
                >
                  {(field.options ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className='rounded border border-slate-300 p-2 text-sm font-normal'
                  value={String(values[field.key] ?? '')}
                  onChange={(event) => update(field.key, event.target.value)}
                />
              )}
            </label>
          ))}
        </div>
        {error ? <div className='bg-red-50 px-4 py-2 text-xs text-red-700'>{error}</div> : null}
        <footer className='flex justify-end gap-2 border-t p-4'>
          <button
            type='button'
            disabled={saving}
            onClick={() => void save(false)}
            className='rounded border px-3 py-2 text-sm'
          >
            保存草稿
          </button>
          <button
            type='button'
            disabled={saving}
            onClick={() => void save(true)}
            className='rounded bg-blue-600 px-3 py-2 text-sm text-white'
          >
            入库并发布
          </button>
        </footer>
      </section>
    </div>
  );
}
