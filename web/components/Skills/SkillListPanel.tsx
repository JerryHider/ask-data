'use client';

export default function SkillListPanel() {
  return (
    <section className="space-y-3">
      <button
        type="button"
        className="w-full rounded bg-blue-600 px-3 py-2 text-sm text-white"
      >
        + 新建 Skill
      </button>
      <p className="rounded border border-dashed border-slate-300 p-3 text-xs text-slate-500">
        Skill 列表将在 Phase 6 接入 registry 后显示。
      </p>
    </section>
  );
}
