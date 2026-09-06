'use client';

import { useAskDataStore } from '../../lib/store';

export default function ClarifyCard({
  question,
  options,
}: {
  question: string;
  options: string[];
}) {
  const sendMessage = useAskDataStore((state) => state.sendMessage);
  return (
    <section className="max-w-xl rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
      <p className="text-sm font-semibold text-amber-900">{question}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => void sendMessage(option)}
            className="rounded border border-amber-400 bg-white px-3 py-1 text-xs text-amber-800"
          >
            {option}
          </button>
        ))}
      </div>
    </section>
  );
}
