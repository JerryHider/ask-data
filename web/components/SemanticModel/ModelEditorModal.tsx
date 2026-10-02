'use client';

import { useMemo, useState } from 'react';
import type { SemanticTemplate, TemplateField } from './TemplatePicker';

export interface SemanticModelRecord {
  id: number;
  name: string;
  template_id: string;
  status: string;
  config: Record<string, unknown>;
  error_message?: string | null;
  updated_at: string;
}

type Values = Record<string, unknown>;
type FieldErrors = Record<string, string>;

interface StructuredFieldError {
  field: string;
  index?: number | null;
  item_field?: string | null;
  message: string;
}

interface StructuredErrorDetail {
  message?: string;
  errors?: StructuredFieldError[];
}

function defaultValue(field: TemplateField): unknown {
  if (field.type === 'array') return [];
  if (field.type === 'string_array') return [];
  if (field.type === 'boolean') return false;
  if (field.type === 'select') return field.required ? field.options?.[0] ?? '' : '';
  return '';
}

function ScalarField({
  field,
  value,
  onChange,
  error,
}: {
  field: TemplateField;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
}) {
  const label = (
    <span className={error ? 'text-red-600' : undefined}>
      {field.label}
      {field.required ? <span className='text-red-500'> *</span> : null}
    </span>
  );

  if (field.type === 'boolean') {
    return (
      <label className='flex items-center gap-2 text-xs font-medium text-slate-600'>
        <input
          type='checkbox'
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        {label}
      </label>
    );
  }

  return (
    <label className='grid gap-1 text-xs font-medium text-slate-600'>
      {label}
      {error ? <span className='text-[11px] font-normal text-red-600'>{error}</span> : null}
      {field.type === 'textarea' ? (
        <textarea
          className={`rounded border p-2 text-sm font-normal ${
            error ? 'border-red-500 bg-red-50 focus:border-red-500' : 'border-slate-300'
          }`}
          rows={3}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : field.type === 'select' ? (
        <select
          className={`rounded border p-2 text-sm font-normal ${
            error ? 'border-red-500 bg-red-50 focus:border-red-500' : 'border-slate-300'
          }`}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        >
          {!field.required ? <option value=''>不设置</option> : null}
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          type='text'
          className={`rounded border p-2 text-sm font-normal ${
            error ? 'border-red-500 bg-red-50 focus:border-red-500' : 'border-slate-300'
          }`}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

function ArrayField({
  field,
  value,
  onChange,
  error,
  itemError,
}: {
  field: TemplateField;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  itemError: (index: number, key: string) => string | undefined;
}) {
  const items = Array.isArray(value) ? (value as Values[]) : [];

  function updateItem(index: number, key: string, itemValue: unknown) {
    onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: itemValue } : item));
  }

  function addItem() {
    const item: Values = {};
    for (const itemField of field.item_fields ?? []) {
      item[itemField.key] = defaultValue(itemField);
    }
    onChange([item, ...items]);
  }

  return (
    <section
      className={`grid gap-2 rounded border p-3 ${
        error ? 'border-red-500 bg-red-50' : 'border-slate-200'
      }`}
    >
      <div className='flex items-center justify-between'>
        <span className='text-xs font-semibold text-slate-700'>
          <span className={error ? 'text-red-600' : undefined}>{field.label}</span>
          {field.required ? <span className='text-red-500'> *</span> : null}
        </span>
        <button
          type='button'
          onClick={addItem}
          className='rounded border border-slate-300 px-2 py-1 text-[11px] hover:bg-slate-50'
        >
          添加
        </button>
      </div>
      {items.length === 0 ? (
        <p className={`text-xs ${error ? 'text-red-600' : 'text-slate-400'}`}>
          {error ?? '暂无条目'}
        </p>
      ) : null}
      {items.map((item, index) => (
        <div
          key={index}
          className={`grid gap-2 rounded p-3 ${
            (field.item_fields ?? []).some((itemField) => itemError(index, itemField.key))
              ? 'bg-red-50 ring-1 ring-red-200'
              : 'bg-slate-50'
          }`}
        >
          <div className='flex justify-end'>
            <button
              type='button'
              onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
              className='rounded border border-red-200 px-2 py-1 text-[11px] text-red-600 hover:bg-red-50'
            >
              删除
            </button>
          </div>
          <div className='grid gap-2 md:grid-cols-2'>
            {(field.item_fields ?? []).map((itemField) => (
              <ScalarField
                key={itemField.key}
                field={itemField}
                value={item[itemField.key]}
                onChange={(itemValue) => updateItem(index, itemField.key, itemValue)}
                error={itemError(index, itemField.key)}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function StringArrayField({
  field,
  value,
  onChange,
  error,
}: {
  field: TemplateField;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
}) {
  const items = Array.isArray(value) ? value.map(String) : [];
  return (
    <section
      className={`grid gap-2 rounded border p-3 ${
        error ? 'border-red-500 bg-red-50' : 'border-slate-200'
      }`}
    >
      <div className='flex items-center justify-between'>
        <span className={`text-xs font-semibold ${error ? 'text-red-600' : 'text-slate-700'}`}>
          {field.label}
        </span>
        <button
          type='button'
          onClick={() => onChange([...items, ''])}
          className='rounded border border-slate-300 px-2 py-1 text-[11px] hover:bg-slate-50'
        >
          添加
        </button>
      </div>
      {items.map((item, index) => (
        <div key={index} className='flex gap-2'>
          <input
            className={`flex-1 rounded border p-2 text-sm ${
              error ? 'border-red-500 bg-white focus:border-red-500' : 'border-slate-300'
            }`}
            value={item}
            onChange={(event) =>
              onChange(items.map((value, itemIndex) => itemIndex === index ? event.target.value : value))
            }
          />
          <button
            type='button'
            onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
            className='rounded border border-red-200 px-2 text-xs text-red-600'
          >
            删除
          </button>
        </div>
      ))}
    </section>
  );
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
    const values: Values = {};
    for (const field of template.fields) {
      values[field.key] = model?.config[field.key] ?? defaultValue(field);
    }
    return values;
  }, [model, template.fields]);
  const [values, setValues] = useState<Values>(initial);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  function update(key: string, value: unknown) {
    setValues((previous) => ({ ...previous, [key]: value }));
    setFieldErrors((previous) => {
      const next = { ...previous };
      delete next[key];
      for (const errorKey of Object.keys(next)) {
        if (errorKey.startsWith(`${key}.`)) delete next[errorKey];
      }
      return next;
    });
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    for (const field of template.fields) {
      const value = values[field.key];
      if (field.required && field.type === 'array' && (!Array.isArray(value) || value.length === 0)) {
        errors[field.key] = `${field.label}不能为空`;
      }
      if (
        field.required &&
        field.type !== 'array' &&
        field.type !== 'boolean' &&
        !String(value ?? '').trim()
      ) {
        errors[field.key] = `${field.label}不能为空`;
      }
      if (field.type === 'array' && Array.isArray(value)) {
        (value as Values[]).forEach((item, index) => {
          for (const itemField of field.item_fields ?? []) {
            if (itemField.required && !String(item[itemField.key] ?? '').trim()) {
              errors[`${field.key}.${index}.${itemField.key}`] = `${itemField.label}不能为空`;
            }
          }
        });
      }
    }
    return errors;
  }

  function applyBackendError(detail: unknown): string {
    if (typeof detail === 'string') return detail;
    if (typeof detail === 'object' && detail !== null) {
      const structured = detail as StructuredErrorDetail;
      if (Array.isArray(structured.errors)) {
        setFieldErrors(
          Object.fromEntries(
            structured.errors
              .filter((item) => item.field)
              .map((item) => [
                item.index === null || item.index === undefined || !item.item_field
                  ? item.field
                  : `${item.field}.${item.index}.${item.item_field}`,
                item.message,
              ])
          )
        );
        return structured.message ?? `存在 ${structured.errors.length} 项错误，请按标红字段修正`;
      }
      if (structured.message) return structured.message;
    }
    return '保存失败';
  }

  async function save(publish: boolean) {
    const validationErrors = validate();
    if (Object.keys(validationErrors).length) {
      setFieldErrors(validationErrors);
      setError(`存在 ${Object.keys(validationErrors).length} 项错误，请按标红字段修正`);
      return;
    }
    setSaving(true);
    setError('');
    setFieldErrors({});
    try {
      const payload: Values = {};
      for (const field of template.fields) {
        payload[field.key] = values[field.key];
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
      const saved = (await response.json()) as SemanticModelRecord & { detail?: unknown };
      if (!response.ok) {
        setError(applyBackendError(saved.detail || saved.error_message));
        return;
      }
      if (publish) {
        const publishResponse = await fetch(`/api/registry/semantic-models/${saved.id}/publish`, {
          method: 'POST',
        });
        const publishResult = (await publishResponse.json()) as { detail?: unknown };
        if (!publishResponse.ok) {
          setError(applyBackendError(publishResult.detail));
          return;
        }
      }
      await onSaved();
      onClose();
    } catch (caught) {
      setError((caught as Error).message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4'>
      <section className='flex max-h-[88vh] w-full max-w-5xl flex-col rounded bg-white shadow-xl'>
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
            该模型已发布。新增维度、补充描述等非破坏性变更可直接保存并发布；删除或重命名实体、维度、度量，或修改被依赖口径时，需先撤销依赖指标。
          </div>
        ) : null}
        <div className='grid gap-4 overflow-auto p-4'>
          {template.fields.map((field) =>
            field.type === 'array' ? (
              <ArrayField
                key={field.key}
                field={field}
                value={values[field.key]}
                onChange={(value) => update(field.key, value)}
                error={fieldErrors[field.key]}
                itemError={(index, key) => fieldErrors[`${field.key}.${index}.${key}`]}
              />
            ) : field.type === 'string_array' ? (
              <StringArrayField
                key={field.key}
                field={field}
                value={values[field.key]}
                onChange={(value) => update(field.key, value)}
                error={fieldErrors[field.key]}
              />
            ) : (
              <ScalarField
                key={field.key}
                field={field}
                value={values[field.key]}
                onChange={(value) => update(field.key, value)}
              />
            )
          )}
        </div>
        {error ? (
          <div className='bg-red-50 px-4 py-2 text-sm text-red-700'>
            <div className='font-semibold'>{error}</div>
            {Object.keys(fieldErrors).length ? (
              <ul className='mt-1 list-inside list-disc text-xs'>
                {Object.entries(fieldErrors).map(([key, message]) => (
                  <li key={key}>{message}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
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
