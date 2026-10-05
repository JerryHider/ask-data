'use client';

import type { SemanticModelRecord } from './ModelEditorModal';
import type { SemanticTemplate } from './TemplatePicker';

export default function ModelListPanel({
  templates,
  models,
  onCreate,
  onEdit,
  onTogglePublish,
  onDelete,
}: {
  templates: SemanticTemplate[];
  models: SemanticModelRecord[];
  onCreate: (template: SemanticTemplate) => void;
  onEdit: (model: SemanticModelRecord) => void;
  onTogglePublish: (model: SemanticModelRecord) => void;
  onDelete: (model: SemanticModelRecord) => void;
}) {
  const orderedTemplates = [
    'semantic-model',
    'simple-metric',
    'ratio-metric',
    'derived-metric',
    'cumulative-metric',
    'conversion-metric',
  ];
  const templateName = (templateId: string) =>
    templates.find((template) => template.id === templateId)?.name ?? templateId;

  return (
    <div className='grid gap-3'>
      {orderedTemplates.map((templateId) => {
        const template = templates.find((item) => item.id === templateId);
        if (!template) return null;
        const group = models.filter((model) => model.template_id === templateId);
        return (
          <section key={templateId} className='rounded border border-slate-200 bg-white'>
            <header className='flex items-center justify-between border-b border-slate-200 p-3'>
              <div className='min-w-0'>
                <h3 className='truncate text-sm font-semibold'>{template.name}</h3>
                <p className='truncate text-[11px] text-slate-500'>{template.description}</p>
              </div>
              <button
                type='button'
                onClick={() => onCreate(template)}
                className='shrink-0 rounded border border-slate-300 px-2 py-1 text-[11px] hover:bg-slate-50'
              >
                新建
              </button>
            </header>
            <div>
              {group.length === 0 ? (
                <p className='p-3 text-xs text-slate-400'>暂无模型</p>
              ) : (
                group.map((model) => (
                  <article
                    key={model.id}
                    className='border-b border-slate-100 p-3 last:border-b-0'
                    title={model.error_message ?? ''}
                  >
                    <button
                      type='button'
                      onClick={() => onEdit(model)}
                      className='w-full text-left'
                    >
                      <div className='truncate text-sm font-medium text-slate-800'>{model.name}</div>
                      <div className='truncate text-[11px] text-slate-500'>
                        {String(model.config.label ?? model.config.description ?? '')}
                      </div>
                    </button>
                    <div className='mt-2 flex items-center justify-between gap-2'>
                      <span
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
                      <div className='flex gap-1 text-[11px]'>
                        <button
                          type='button'
                          className='rounded border px-2 py-1'
                          onClick={() => onEdit(model)}
                        >
                          编辑
                        </button>
                        <button
                          type='button'
                          className='rounded border px-2 py-1'
                          onClick={() => onTogglePublish(model)}
                        >
                          {model.status === 'published' ? '撤销' : '发布'}
                        </button>
                        <button
                          type='button'
                          className='rounded border border-red-200 px-2 py-1 text-red-600'
                          onClick={() => onDelete(model)}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        );
      })}
      {templates.some((template) => !orderedTemplates.includes(template.id)) ? (
        <section className='rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800'>
          存在未识别模板：{templates.filter((template) => !orderedTemplates.includes(template.id)).map((template) => templateName(template.id)).join('、')}
        </section>
      ) : null}
    </div>
  );
}
