'use client';

import TemplatePicker from './TemplatePicker';

export default function ModelListPanel() {
  return (
    <section className="space-y-3">
      <TemplatePicker />
      <p className="rounded border border-dashed border-slate-300 p-3 text-xs text-slate-500">
        已入库模型将在 Phase 6 接入 registry 后显示。
      </p>
    </section>
  );
}
