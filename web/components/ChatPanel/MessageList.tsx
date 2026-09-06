'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ClarifyCard from './ClarifyCard';
import ToolCallCard from './ToolCallCard';
import { useAskDataStore } from '../../lib/store';

export default function MessageList() {
  const messages = useAskDataStore((state) => state.messages);

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-6">
      {messages.length === 0 ? (
        <p className="text-sm text-slate-500">新建任务后输入业务问题，例如“上月 GMV”。</p>
      ) : null}
      {messages.map((message) => (
        <div key={message.id} className={message.role === 'user' ? 'flex justify-end' : ''}>
          {message.role === 'user' ? (
            <div className="max-w-2xl rounded-lg bg-blue-100 px-4 py-3 text-sm">{message.text}</div>
          ) : message.role === 'clarify' ? (
            <ClarifyCard question={message.text} options={message.options ?? []} />
          ) : (
            <article className="prose prose-slate max-w-3xl rounded-lg bg-slate-50 px-4 py-3 text-sm">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
              <ToolCallCard name="render_table" input={{}} />
            </article>
          )}
        </div>
      ))}
    </div>
  );
}
