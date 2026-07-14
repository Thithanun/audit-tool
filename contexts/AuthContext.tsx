'use client';

import { createContext, useContext } from 'react';
import type { User } from '@supabase/supabase-js';

export type UserRole = 'admin' | 'auditor' | 'viewer';

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  must_change_password: boolean;
}

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  /** Admin only: create/edit/delete Audit Plans */
  canEditAuditPlan: boolean;
  /** Admin + Auditor: create/edit/delete Checklist items */
  canEditChecklist: boolean;
  /** Admin + Auditor: update Corrective Actions on Dashboard */
  canEditDashboard: boolean;
  /** Admin + Auditor: Checklist tab is visible; hidden for Viewer */
  canSeeChecklist: boolean;
  isAdmin: boolean;
  mustChangePassword: boolean;
  signOut: () => Promise<void>;
}

// No-auth mode: every visitor gets full admin permissions.
// Original auth implementation preserved in middleware.ts (deleted) and proxy.ts.
const defaultValue: AuthContextValue = {
  user: null,
  profile: null,
  loading: false,
  canEditAuditPlan: true,
  canEditChecklist: true,
  canEditDashboard: true,
  canSeeChecklist: true,
  isAdmin: true,
  mustChangePassword: false,
  signOut: async () => {},
};

const AuthContext = createContext<AuthContextValue>(defaultValue);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <AuthContext.Provider value={defaultValue}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
