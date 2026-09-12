'use client';

export interface TemplateField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'boolean' | 'array' | 'string_array';
  required: boolean;
  options?: string[];
  item_fields?: TemplateField[];
}

export interface SemanticTemplate {
  id: string;
  name: string;
  description: string;
  fields: TemplateField[];
}

export default function TemplatePicker({
  templates,
  onSelect,
}: {
  templates: SemanticTemplate[];
  onSelect: (template: SemanticTemplate) => void;
}) {
  return (
    <div className='grid gap-2'>
      {templates.map((template) => (
        <button
          key={template.id}
          type='button'
          onClick={() => onSelect(template)}
          className='rounded border border-slate-300 bg-white p-3 text-left transition hover:border-blue-500 hover:bg-blue-50'
        >
          <div className='text-sm font-semibold'>{template.name}</div>
          <div className='mt-1 text-xs text-slate-500'>{template.description}</div>
          <div className='mt-1 text-[11px] text-slate-400'>{template.fields.length} 个字段</div>
        </button>
      ))}
    </div>
  );
}
