'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Role = 'coach' | 'player' | 'scout';

export const ROLES: { id: Role; label: string; blurb: string }[] = [
  { id: 'coach', label: 'Coach', blurb: 'Match analysis & training focus' },
  { id: 'player', label: 'Player', blurb: 'Your development & benchmarks' },
  { id: 'scout', label: 'Scout', blurb: 'Recruitment & comparisons' },
];

const STORAGE_KEY = 'soccalytics.role';

const RoleContext = createContext<{ role: Role; setRole: (r: Role) => void }>({
  role: 'coach',
  setRole: () => undefined,
});

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>('coach');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'coach' || stored === 'player' || stored === 'scout') setRoleState(stored);
    } catch {
      // storage unavailable (private mode etc.) – keep default
    }
  }, []);

  const setRole = useCallback((r: Role) => {
    setRoleState(r);
    try {
      window.localStorage.setItem(STORAGE_KEY, r);
    } catch {
      // ignore
    }
  }, []);

  return <RoleContext.Provider value={{ role, setRole }}>{children}</RoleContext.Provider>;
}

export function useRole() {
  return useContext(RoleContext);
}
