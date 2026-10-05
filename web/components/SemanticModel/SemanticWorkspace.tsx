'use client';

import { useCallback, useEffect, useState } from 'react';
import ModelEditorModal, { type SemanticModelRecord } from './ModelEditorModal';
import ModelListPanel from './ModelListPanel';
import SemanticMetricQuery from './SemanticMetricQuery';
import type { SemanticTemplate } from './TemplatePicker';

export default function SemanticWorkspace() {
  const [templates, setTemplates] = useState<SemanticTemplate[]>([]);
  const [models, setModels] = useState<SemanticModelRecord[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<SemanticTemplate | null>(null);
  const [editingModel, setEditingModel] = useState<SemanticModelRecord | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [templateResponse, modelResponse] = await Promise.all([
        fetch('/api/registry/semantic-models/templates'),
        fetch('/api/registry/semantic-models'),
      ]);
      if (!templateResponse.ok) throw new Error('模板加载失败');
      if (!modelResponse.ok) throw new Error('语义模型加载失败');
      setTemplates(await templateResponse.json());
      setModels(await modelResponse.json());
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const editingTemplate = templates.find(
    (template) => template.id === editingModel?.template_id
  );

  async function togglePublish(model: SemanticModelRecord) {
    const action = model.status === 'published' ? 'unpublish' : 'publish';
    const response = await fetch(`/api/registry/semantic-models/${model.id}/${action}`, {
      method: 'POST',
    });
    if (!response.ok) {
      const detail = (await response.json()) as { detail?: string };
      setError(detail.detail ?? '发布操作失败');
      return;
    }
    await load();
  }

  async function remove(model: SemanticModelRecord) {
    if (!window.confirm(`删除语义模型 ${model.name}？`)) return;
    const response = await fetch(`/api/registry/semantic-models/${model.id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const detail = (await response.json()) as { detail?: string };
      setError(detail.detail ?? '删除失败');
      return;
    }
    await load();
  }

  return (
    <section className='flex h-full min-w-0 flex-1 bg-slate-100'>
      <aside className='flex h-full w-[400px] shrink-0 flex-col border-r border-slate-200 bg-slate-50'>
        <header className='flex h-12 shrink-0 items-center justify-between border-b border-slate-200 px-4'>
          <span className='text-base font-semibold'>语义模型</span>
          <span className='text-xs text-slate-500'>
            {models.filter((model) => model.status === 'published').length}/{models.length} 已发布
          </span>
        </header>
        <div className='min-h-0 flex-1 overflow-auto p-3'>
          {loading && models.length === 0 ? (
            <p className='text-xs text-slate-500'>加载中…</p>
          ) : (
            <ModelListPanel
              templates={templates}
              models={models}
              onCreate={(template) => {
                setEditingModel(null);
                setSelectedTemplate(template);
              }}
              onEdit={(model) => {
                setSelectedTemplate(null);
                setEditingModel(model);
              }}
              onTogglePublish={(model) => void togglePublish(model)}
              onDelete={(model) => void remove(model)}
            />
          )}
        </div>
      </aside>

      <div className='flex h-full min-w-0 flex-1 flex-col'>
        <header className='flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4'>
          <span className='font-semibold'>语义指标查询</span>
          <span className='rounded bg-blue-50 px-2 py-1 text-xs text-blue-700'>MetricFlow</span>
        </header>
        {error ? (
          <div className='border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700'>
            {error}
          </div>
        ) : null}
        <div className='min-h-0 flex-1'>
          <SemanticMetricQuery />
        </div>
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
