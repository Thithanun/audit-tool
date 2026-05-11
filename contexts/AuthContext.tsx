'use client';

import {
  createContext, useContext, useEffect, useState, useCallback,
} from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type UserRole = 'admin' | 'auditor' | 'viewer';

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
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
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  loading: true,
  canEditAuditPlan: false,
  canEditChecklist: false,
  canEditDashboard: false,
  canSeeChecklist: false,
  isAdmin: false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, name, role')
      .eq('id', userId)
      .single();
    if (error) {
      // PGRST116 = no row found; anything else is unexpected
      if (error.code !== 'PGRST116') {
        console.error('[AuthContext] fetchProfile error:', error.code, error.message);
      } else {
        console.warn('[AuthContext] No profiles row for user', userId,
          '— run supabase/auth-schema.sql and ensure the trigger fired.');
      }
    }
    setProfile(data as UserProfile | null);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      setUser(u);
      if (u) {
        fetchProfile(u.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const u = session?.user ?? null;
        setUser(u);
        if (u) {
          await fetchProfile(u.id);
        } else {
          setProfile(null);
        }
      },
    );

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  const role = profile?.role ?? null;
  const isAdmin          = role === 'admin';
  const canEditAuditPlan = role === 'admin';
  const canEditChecklist = role === 'admin' || role === 'auditor';
  const canEditDashboard = role === 'admin' || role === 'auditor';
  // Fail-open: hide Checklist ONLY when we are certain the role is 'viewer'.
  // While profile is still loading (role === null) we show the tab so admin/
  // auditor users never see it flicker away and back.
  const canSeeChecklist  = role !== 'viewer';

  return (
    <AuthContext.Provider value={{
      user, profile, loading,
      canEditAuditPlan, canEditChecklist, canEditDashboard, canSeeChecklist,
      isAdmin, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
