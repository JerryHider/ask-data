'use client';

interface ReasoningTraceProps {
  reasoning: string;
  status: string | null;
}

export default function ReasoningTrace({ reasoning, status }: ReasoningTraceProps) {
  if (!reasoning && !status) return null;

  return (
    <details className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm" open>
      <summary className="cursor-pointer font-medium text-slate-700">
        思考过程
        {status ? <span className="ml-2 text-xs text-blue-600">{status}</span> : null}
      </summary>
      <pre className="mt-3 max-h-60 overflow-auto whitespace-pre-wrap text-xs leading-5 text-slate-600">
        {reasoning || status}
      </pre>
    </details>
  );
}
