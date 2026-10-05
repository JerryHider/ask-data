'use client';

import { useCallback, useEffect, useState } from 'react';
import SkillEditorModal, { type SkillRecord } from './SkillEditorModal';
import { useAskDataStore } from '../../lib/store';

export default function SkillListPanel() {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [editing, setEditing] = useState<SkillRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const startSkillTest = useAskDataStore((state) => state.startSkillTest);

  const load = useCallback(async () => {
    const response = await fetch('/api/registry/skills');
    if (response.ok) setSkills(await response.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(skill: SkillRecord) {
    await fetch(`/api/registry/skills/${skill.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...skill, enabled: !skill.enabled }),
    });
    await load();
  }

  return (
    <section className='space-y-3'>
      <button
        type='button'
        className='w-full rounded bg-blue-600 px-3 py-2 text-sm text-white'
        onClick={() => setCreating(true)}
      >
        + 新建 Skill
      </button>
      {skills.length === 0 ? (
        <p className='rounded border border-dashed border-slate-300 p-3 text-xs text-slate-500'>
          暂无 Skill。
        </p>
      ) : (
        skills.map((skill) => (
          <article key={skill.id} className='rounded border border-slate-200 bg-white p-3'>
            <div className='flex items-start justify-between gap-2'>
              <div className='min-w-0'>
                <div className='truncate text-sm font-semibold'>{skill.name}</div>
                <p className='mt-1 line-clamp-2 text-xs text-slate-500'>{skill.description}</p>
              </div>
              <label className='flex shrink-0 items-center gap-1 text-[11px]'>
                <input type='checkbox' checked={skill.enabled} onChange={() => void toggle(skill)} />
                启用
              </label>
            </div>
            <div className='mt-2 flex flex-wrap gap-1'>
              {skill.trigger_keywords.map((keyword) => (
                <span key={keyword} className='rounded bg-slate-100 px-2 py-0.5 text-[10px]'>
                  {keyword}
                </span>
              ))}
            </div>
            <div className='mt-2 flex gap-2 text-[11px]'>
              <button type='button' className='rounded border px-2 py-1' onClick={() => setEditing(skill)}>
                编辑
              </button>
              <button
                type='button'
                className='rounded border px-2 py-1'
                onClick={() => void startSkillTest(skill)}
              >
                测试
              </button>
              <button
                type='button'
                className='rounded border border-red-200 px-2 py-1 text-red-600'
                onClick={async () => {
                  if (!window.confirm(`删除 Skill ${skill.name}？`)) return;
                  await fetch(`/api/registry/skills/${skill.id}`, { method: 'DELETE' });
                  await load();
                }}
              >
                删除
              </button>
            </div>
          </article>
        ))
      )}
      {creating || editing ? (
        <SkillEditorModal
          skill={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={load}
        />
      ) : null}
    </section>
  );
}
