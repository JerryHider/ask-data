'use client';

import { useState } from 'react';

export interface SkillRecord {
  id: number;
  name: string;
  description: string;
  trigger_keywords: string[];
  prompt_addition: string;
  allowed_tools: string[];
  enabled: boolean;
}

const tools = ['search_schema', 'query_metric', 'execute_sql', 'explain_metric', 'ask_clarification', 'render_table'];

export default function SkillEditorModal({
  skill,
  onClose,
  onSaved,
}: {
  skill: SkillRecord | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [name, setName] = useState(skill?.name ?? '');
  const [description, setDescription] = useState(skill?.description ?? '');
  const [keywords, setKeywords] = useState(skill?.trigger_keywords.join(',') ?? '');
  const [prompt, setPrompt] = useState(skill?.prompt_addition ?? '');
  const [allowedTools, setAllowedTools] = useState<string[]>(skill?.allowed_tools ?? []);
  const [enabled, setEnabled] = useState(skill?.enabled ?? false);
  const [error, setError] = useState('');

  async function save() {
    const payload = {
      name,
      description,
      trigger_keywords: keywords.split(',').map((item) => item.trim()).filter(Boolean),
      prompt_addition: prompt,
      allowed_tools: allowedTools,
      enabled,
    };
    const response = await fetch(skill ? `/api/registry/skills/${skill.id}` : '/api/registry/skills', {
      method: skill ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const result = (await response.json()) as { detail?: string };
      setError(result.detail ?? '保存失败');
      return;
    }
    await onSaved();
    onClose();
  }

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4'>
      <section className='flex max-h-[85vh] w-full max-w-xl flex-col rounded bg-white shadow-xl'>
        <header className='flex items-center justify-between border-b p-4'>
          <h3 className='text-base font-semibold'>{skill ? '编辑 Skill' : '新建 Skill'}</h3>
          <button type='button' onClick={onClose} className='text-sm text-slate-500'>
            关闭
          </button>
        </header>
        <div className='grid gap-3 overflow-auto p-4 text-xs'>
          <input className='rounded border p-2' placeholder='名称' value={name} onChange={(event) => setName(event.target.value)} />
          <input className='rounded border p-2' placeholder='描述' value={description} onChange={(event) => setDescription(event.target.value)} />
          <input className='rounded border p-2' placeholder='触发关键词（逗号分隔）' value={keywords} onChange={(event) => setKeywords(event.target.value)} />
          <textarea
            className='rounded border p-2'
            rows={5}
            placeholder='提示词增补'
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <div className='grid grid-cols-2 gap-2'>
            {tools.map((tool) => (
              <label key={tool} className='flex items-center gap-2'>
                <input
                  type='checkbox'
                  checked={allowedTools.includes(tool)}
                  onChange={(event) => {
                    setAllowedTools((previous) =>
                      event.target.checked ? [...previous, tool] : previous.filter((item) => item !== tool)
                    );
                  }}
                />
                {tool}
              </label>
            ))}
          </div>
          <label className='flex items-center gap-2'>
            <input type='checkbox' checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            启用
          </label>
        </div>
        {error ? <div className='bg-red-50 px-4 py-2 text-xs text-red-700'>{error}</div> : null}
        <footer className='flex justify-end border-t p-4'>
          <button type='button' className='rounded bg-blue-600 px-3 py-2 text-sm text-white' onClick={() => void save()}>
            保存
          </button>
        </footer>
      </section>
    </div>
  );
}
