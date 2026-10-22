'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ROLES, useRole, type Role } from '../lib/role';
import { AssistantDrawer } from './AssistantDrawer';
import { Icon } from './icons';

interface NavItem {
  href: string;
  label: string;
  icon: (p: { size?: number }) => ReactNode;
}

const NAV: NavItem[] = [
  { href: '/', label: 'Overview', icon: Icon.overview },
  { href: '/matches', label: 'Matches', icon: Icon.matches },
  { href: '/players', label: 'Players', icon: Icon.players },
  { href: '/scouting', label: 'Scouting', icon: Icon.scouting },
  { href: '/analyse', label: 'Analyse', icon: Icon.analyse },
];

/** Each role gets its most relevant destinations first and emphasised. */
const ROLE_FOCUS: Record<Role, string[]> = {
  coach: ['/', '/matches', '/analyse', '/players', '/scouting'],
  player: ['/', '/players', '/matches', '/scouting', '/analyse'],
  scout: ['/scouting', '/players', '/', '/matches', '/analyse'],
};
const ROLE_EMPHASIS: Record<Role, string> = { coach: '/matches', player: '/players', scout: '/scouting' };

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-lg px-2 py-1">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-accent-ink">
        <Icon.ball size={18} />
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold tracking-tight">Soccalytics</span>
        <span className="block text-[11px] text-muted">AI match intelligence</span>
      </span>
    </Link>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { role } = useRole();
  const items = ROLE_FOCUS[role].map((h) => NAV.find((n) => n.href === h)).filter((n): n is NavItem => !!n);
  return (
    <nav aria-label="Main">
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const emphasised = ROLE_EMPHASIS[role] === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  active ? 'bg-accent-soft text-accent' : 'text-text-2 hover:bg-surface-2 hover:text-text',
                )}
              >
                <item.icon size={18} />
                <span className="flex-1">{item.label}</span>
                {emphasised && !active && (
                  <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    For you
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function RoleSwitcher() {
  const { role, setRole } = useRole();
  return (
    <fieldset className="rounded-xl border border-border bg-surface-2 p-3">
      <legend className="sr-only">Viewing as</legend>
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted" aria-hidden="true">
        Viewing as
      </div>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface p-1">
        {ROLES.map((r) => (
          <label
            key={r.id}
            className={clsx(
              'cursor-pointer rounded-md py-1.5 text-center text-xs font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
              role === r.id ? 'bg-accent text-accent-ink' : 'text-text-2 hover:text-text',
            )}
          >
            <input
              type="radio"
              name="role"
              value={r.id}
              checked={role === r.id}
              onChange={() => setRole(r.id)}
              className="sr-only"
            />
            {r.label}
          </label>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted">{ROLES.find((r) => r.id === role)?.blurb}</p>
    </fieldset>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-accent px-3 py-2 text-accent-ink focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col gap-6 border-r border-border bg-surface px-3 py-4 lg:flex">
        <Brand />
        <NavLinks />
        <div className="mt-auto">
          <RoleSwitcher />
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-surface/90 px-4 py-2 backdrop-blur lg:hidden">
        <Brand />
        <button
          type="button"
          className="grid h-10 w-10 place-items-center rounded-lg text-text-2 hover:bg-surface-2"
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          onClick={() => setMobileOpen(true)}
        >
          <Icon.menu />
        </button>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" id="mobile-nav" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-6 border-r border-border bg-surface px-3 py-4">
            <div className="flex items-center justify-between">
              <Brand />
              <button
                type="button"
                className="grid h-9 w-9 place-items-center rounded-lg text-text-2 hover:bg-surface-2"
                aria-label="Close navigation"
                onClick={() => setMobileOpen(false)}
              >
                <Icon.close />
              </button>
            </div>
            <NavLinks onNavigate={() => setMobileOpen(false)} />
            <div className="mt-auto">
              <RoleSwitcher />
            </div>
          </div>
        </div>
      )}

      <main id="main" className="lg:pl-60">
        <div className="mx-auto w-full max-w-[1400px] px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pt-8">{children}</div>
      </main>

      <AssistantDrawer />
    </div>
  );
}
