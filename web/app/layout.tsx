import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AskData 智能问数平台',
  description: '基于 pi-agent + dbt 的本地智能问数系统',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-slate-100 text-slate-900">{children}</body>
    </html>
  );
}
