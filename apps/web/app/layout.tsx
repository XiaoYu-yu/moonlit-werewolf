import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { AppProviders } from '@/components/app-providers';

import './globals.css';
import './ui-refactor.css';
import './interaction-refactor.css';

export const metadata: Metadata = {
  title: {
    default: '狼人杀 · 真人与 AI，共赴月夜',
    template: '%s · 狼人杀',
  },
  description: '一个支持真人与多模型 AI 同局的沉浸式狼人杀游戏。',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f9fc' },
    { media: '(prefers-color-scheme: dark)', color: '#07111f' },
  ],
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
