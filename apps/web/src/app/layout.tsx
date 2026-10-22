import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '../components/AppShell';
import './global.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'Soccalytics', template: '%s · Soccalytics' },
  description: 'AI-powered soccer analytics for players, coaches, scouts and academies.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0a0f0c' },
    { media: '(prefers-color-scheme: light)', color: '#f4f6f3' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
