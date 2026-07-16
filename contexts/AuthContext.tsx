'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

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
  canEditAuditPlan: boolean;
  canEditChecklist: boolean;
  canEditDashboard: boolean;
  canSeeChecklist: boolean;
  isAdmin: boolean;
  mustChangePassword: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
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
  mustChangePassword: false,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('id, email, name, role, must_change_password')
      .eq('id', userId)
      .single();
    setProfile(data as UserProfile | null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await fetchProfile(user.id);
  }, [user, fetchProfile]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) await fetchProfile(session.user.id);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setUser(session?.user ?? null);
        if (session?.user) {
          await fetchProfile(session.user.id);
        } else {
          setProfile(null);
        }
        setLoading(false);
      },
    );

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  const role = profile?.role;
  const isAdmin = role === 'admin';
  const isAuditorOrAdmin = role === 'admin' || role === 'auditor';

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      loading,
      canEditAuditPlan: isAdmin,
      canEditChecklist: isAuditorOrAdmin,
      canEditDashboard: isAuditorOrAdmin,
      canSeeChecklist: isAuditorOrAdmin,
      isAdmin,
      mustChangePassword: profile?.must_change_password ?? false,
      signOut,
      refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
