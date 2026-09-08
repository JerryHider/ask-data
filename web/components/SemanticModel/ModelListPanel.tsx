'use client';

import { useCallback, useEffect, useState } from 'react';
import TemplatePicker, { type SemanticTemplate } from './TemplatePicker';
import ModelEditorModal, { type SemanticModelRecord } from './ModelEditorModal';

export default function ModelListPanel() {
  const [templates, setTemplates] = useState<SemanticTemplate[]>([]);
  const [models, setModels] = useState<SemanticModelRecord[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<SemanticTemplate | null>(null);
  const [editingModel, setEditingModel] = useState<SemanticModelRecord | null>(null);

  const load = useCallback(async () => {
    const [templateResponse, modelResponse] = await Promise.all([
      fetch('/api/registry/semantic-models/templates'),
      fetch('/api/registry/semantic-models'),
    ]);
    if (templateResponse.ok) setTemplates(await templateResponse.json());
    if (modelResponse.ok) setModels(await modelResponse.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function togglePublish(model: SemanticModelRecord) {
    const action = model.status === 'published' ? 'unpublish' : 'publish';
    await fetch(`/api/registry/semantic-models/${model.id}/${action}`, { method: 'POST' });
    await load();
  }

  async function remove(model: SemanticModelRecord) {
    if (!window.confirm(`删除语义模型 ${model.name}？`)) return;
    await fetch(`/api/registry/semantic-models/${model.id}`, { method: 'DELETE' });
    await load();
  }

  const editingTemplate = templates.find(
    (template) => template.id === editingModel?.template_id
  );

  return (
    <section className='space-y-3'>
      <TemplatePicker
        templates={templates}
        onSelect={(template) => {
          setEditingModel(null);
          setSelectedTemplate(template);
        }}
      />
      <div className='rounded border border-slate-200 bg-white'>
        {models.length === 0 ? (
          <p className='p-3 text-xs text-slate-500'>暂无语义模型。</p>
        ) : (
          models.map((model) => (
            <article key={model.id} className='border-b p-3 last:border-b-0'>
              <div className='flex items-center justify-between gap-2'>
                <div className='min-w-0'>
                  <div className='truncate text-sm font-semibold'>{model.name}</div>
                  <div className='text-[11px] text-slate-500'>
                    {templates.find((template) => template.id === model.template_id)?.name ?? model.template_id}
                  </div>
                </div>
                <span
                  title={model.error_message ?? ''}
                  className={`rounded px-2 py-1 text-[11px] ${
                    model.status === 'published'
                      ? 'bg-green-50 text-green-700'
                      : model.error_message
                        ? 'bg-red-50 text-red-700'
                        : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {model.status}
                </span>
              </div>
              <div className='mt-2 flex gap-2 text-[11px]'>
                <button
                  type='button'
                  className='rounded border px-2 py-1'
                  onClick={() => {
                    setSelectedTemplate(null);
                    setEditingModel(model);
                  }}
                >
                  编辑
                </button>
                <button
                  type='button'
                  className='rounded border px-2 py-1'
                  onClick={() => void togglePublish(model)}
                >
                  {model.status === 'published' ? '撤销发布' : '发布'}
                </button>
                <button
                  type='button'
                  className='rounded border border-red-200 px-2 py-1 text-red-600'
                  onClick={() => void remove(model)}
                >
                  删除
                </button>
              </div>
            </article>
          ))
        )}
      </div>
      {selectedTemplate || (editingModel && editingTemplate) ? (
        <ModelEditorModal
          template={(selectedTemplate ?? editingTemplate)!}
          model={editingModel}
          onClose={() => {
            setSelectedTemplate(null);
            setEditingModel(null);
          }}
          onSaved={load}
        />
      ) : null}
    </section>
  );
}
