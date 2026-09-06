'use client';

const templates = ['事件表', '维度表', '指标汇总表'];

export default function TemplatePicker() {
  return (
    <div className="flex flex-wrap gap-2">
      {templates.map((template) => (
        <button
          key={template}
          type="button"
          className="rounded border border-slate-300 bg-white px-3 py-2 text-xs"
        >
          {template}
        </button>
      ))}
    </div>
  );
}
