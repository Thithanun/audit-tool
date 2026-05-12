'use client';

import {
  createContext, useContext, useEffect, useState, useCallback, useRef,
} from 'react';
import { useRouter, usePathname } from 'next/navigation';
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
});

// Events that need a fresh profile from the DB.
// TOKEN_REFRESHED = JWT was silently refreshed — profile data hasn't changed, skip.
// PASSWORD_RECOVERY = magic-link flow before user sets a password, skip too.
const PROFILE_FETCH_EVENTS = new Set([
  'INITIAL_SESSION', 'SIGNED_IN', 'USER_UPDATED',
]);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Track which userId we last fetched so we never fire two simultaneous requests.
  const lastFetchedRef = useRef<string | null>(null);

  const fetchProfile = useCallback(async (userId: string, force = false) => {
    // Skip if we already have a profile for this exact user and aren't forced.
    // (force = true on USER_UPDATED so role/name changes are reflected immediately.)
    if (!force && lastFetchedRef.current === userId) return;
    lastFetchedRef.current = userId;

    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, name, role, must_change_password')
      .eq('id', userId)
      .single();
    if (error) {
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
    // onAuthStateChange fires INITIAL_SESSION immediately on setup,
    // so we don't need a separate getUser() call (which would make an extra
    // network round-trip and trigger a second fetchProfile race).
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        const u = session?.user ?? null;
        setUser(u);

        if (!u) {
          // Signed out — clear profile and reset cache key.
          setProfile(null);
          lastFetchedRef.current = null;
          setLoading(false);
          return;
        }

        if (PROFILE_FETCH_EVENTS.has(event)) {
          // USER_UPDATED forces a fresh fetch even if userId is the same
          // (e.g. admin changed this user's role, or password was updated).
          await fetchProfile(u.id, event === 'USER_UPDATED');
        }
        // TOKEN_REFRESHED: JWT refreshed silently — profile unchanged, no fetch needed.

        setLoading(false);
      },
    );

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  // Enforce password change: redirect any protected page to /auth/set-password
  // when the flag is still true. Skip /auth/* and /login to avoid loops.
  useEffect(() => {
    if (
      !loading &&
      profile?.must_change_password === true &&
      !pathname.startsWith('/auth/') &&
      pathname !== '/login'
    ) {
      router.replace('/auth/set-password');
    }
  }, [loading, profile, pathname, router]);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  const role = profile?.role ?? null;
  const isAdmin            = role === 'admin';
  const canEditAuditPlan   = role === 'admin';
  const canEditChecklist   = role === 'admin' || role === 'auditor';
  const canEditDashboard   = role === 'admin' || role === 'auditor';
  const canSeeChecklist    = role !== 'viewer';
  const mustChangePassword = profile?.must_change_password === true;

  return (
    <AuthContext.Provider value={{
      user, profile, loading,
      canEditAuditPlan, canEditChecklist, canEditDashboard, canSeeChecklist,
      isAdmin, mustChangePassword, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
