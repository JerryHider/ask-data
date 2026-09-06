'use client';

const groups = ['模型配置', 'SQL 样例', '上下文与 RAG', '沙箱策略', '运行时'];

export default function SettingsPanel() {
  return (
    <section className="space-y-2">
      {groups.map((group) => (
        <details key={group} className="rounded border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-semibold">{group}</summary>
          <p className="mt-2 text-xs text-slate-500">Phase 6 接入 registry 配置。</p>
        </details>
      ))}
    </section>
  );
}
