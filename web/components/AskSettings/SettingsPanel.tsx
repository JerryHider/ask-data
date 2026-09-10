'use client';

import { useEffect, useState } from 'react';
import LlmConfigForm from './LlmConfigForm';
import SqlExampleEditor from './SqlExampleEditor';
import RagSpaceManager from './RagSpaceManager';
import SkillListPanel from '../Skills/SkillListPanel';

interface ContextSettings {
  history_window: number;
  compression_threshold_tokens: number;
  max_clarification_rounds: number;
  persist_clarified_contexts: boolean;
}

interface SandboxSettings {
  timeout_seconds: number;
  max_rows: number;
  mask_rules: { field_pattern: string; strategy: string }[];
  forbidden_keywords: string[];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className='rounded border border-slate-200 bg-white p-3'>
      <summary className='cursor-pointer text-sm font-semibold'>{title}</summary>
      <div className='mt-3'>{children}</div>
    </details>
  );
}

export default function SettingsPanel() {
  const [context, setContext] = useState<ContextSettings | null>(null);
  const [sandbox, setSandbox] = useState<SandboxSettings | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void (async () => {
      const [contextResponse, sandboxResponse] = await Promise.all([
        fetch('/api/registry/settings/context'),
        fetch('/api/registry/settings/sandbox'),
      ]);
      if (contextResponse.ok) setContext(await contextResponse.json());
      if (sandboxResponse.ok) setSandbox(await sandboxResponse.json());
    })();
  }, []);

  async function saveSetting(key: 'context' | 'sandbox') {
    const value = key === 'context' ? context : sandbox;
    if (!value) return;
    const response = await fetch(`/api/registry/settings/${key}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    setMessage(response.ok ? '设置已保存，新会话生效' : '保存失败');
  }

  return (
    <section className='space-y-2'>
      <Section title='LLM 模型配置'>
        <LlmConfigForm />
      </Section>
      <Section title='NL→SQL 转换样例'>
        <SqlExampleEditor />
      </Section>
      <Section title='上下文设置'>
        {context ? (
          <div className='grid gap-2 text-xs'>
            <label className='grid gap-1'>
              会话历史窗口条数
              <input
                type='number'
                value={context.history_window}
                onChange={(event) => setContext({ ...context, history_window: Number(event.target.value) })}
              />
            </label>
            <label className='grid gap-1'>
              上下文压缩触发阈值 tokens
              <input
                type='number'
                value={context.compression_threshold_tokens}
                onChange={(event) =>
                  setContext({ ...context, compression_threshold_tokens: Number(event.target.value) })
                }
              />
            </label>
            <label className='grid gap-1'>
              澄清最大轮数
              <input
                type='number'
                value={context.max_clarification_rounds}
                onChange={(event) =>
                  setContext({ ...context, max_clarification_rounds: Number(event.target.value) })
                }
              />
            </label>
            <label className='flex items-center gap-2'>
              <input
                type='checkbox'
                checked={context.persist_clarified_contexts}
                onChange={(event) =>
                  setContext({ ...context, persist_clarified_contexts: event.target.checked })
                }
              />
              澄清口径跨会话记忆
            </label>
            <button type='button' className='rounded bg-blue-600 px-2 py-1 text-white' onClick={() => void saveSetting('context')}>
              保存
            </button>
          </div>
        ) : null}
      </Section>
      <Section title='RAG 知识库'>
        <RagSpaceManager />
      </Section>
      <Section title='自定义 Skill'>
        <SkillListPanel />
      </Section>
      <Section title='沙箱设置'>
        {sandbox ? (
          <div className='grid gap-2 text-xs'>
            <label className='grid gap-1'>
              查询超时秒
              <input
                type='number'
                value={sandbox.timeout_seconds}
                onChange={(event) => setSandbox({ ...sandbox, timeout_seconds: Number(event.target.value) })}
              />
            </label>
            <label className='grid gap-1'>
              最大返回行数
              <input
                type='number'
                value={sandbox.max_rows}
                onChange={(event) => setSandbox({ ...sandbox, max_rows: Number(event.target.value) })}
              />
            </label>
            <label className='grid gap-1'>
              脱敏规则 JSON
              <textarea
                rows={3}
                value={JSON.stringify(sandbox.mask_rules)}
                onChange={(event) => {
                  try {
                    setSandbox({ ...sandbox, mask_rules: JSON.parse(event.target.value) });
                  } catch {
                    // 保留输入中的原值，保存前用户可修正 JSON
                  }
                }}
              />
            </label>
            <label className='grid gap-1'>
              禁止 SQL 关键词（逗号分隔）
              <input
                value={sandbox.forbidden_keywords.join(',')}
                onChange={(event) =>
                  setSandbox({
                    ...sandbox,
                    forbidden_keywords: event.target.value.split(',').map((item) => item.trim()).filter(Boolean),
                  })
                }
              />
            </label>
            <button type='button' className='rounded bg-blue-600 px-2 py-1 text-white' onClick={() => void saveSetting('sandbox')}>
              保存
            </button>
          </div>
        ) : null}
      </Section>
      {message ? <p className='text-xs text-slate-600'>{message}</p> : null}
    </section>
  );
}
