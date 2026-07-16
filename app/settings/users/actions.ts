'use server';

import { createClient } from '@supabase/supabase-js';
import type { UserProfile } from '@/contexts/AuthContext';

// ── Admin Supabase client (service role, bypasses RLS) ────────────────────────

async function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url)        throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_URL');
  if (!serviceKey) throw new Error('Missing env var: SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wrap any thrown value into a plain string for the client. */
function toMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Exported server actions ───────────────────────────────────────────────────

export async function getUsers(): Promise<{ users: UserProfile[]; error: string | null }> {
  try {
    const admin = await getAdminClient();
    const { data, error } = await admin
      .from('profiles')
      .select('id, email, name, role')
      .order('email');
    if (error) throw new Error(error.message);
    return { users: (data ?? []) as UserProfile[], error: null };
  } catch (err) {
    return { users: [], error: toMsg(err) };
  }
}

export async function createUser(
  email: string,
  password: string,
  name: string,
  role: string,
): Promise<{ error: string | null }> {
  try {
    const admin = await getAdminClient();
    // email_confirm: true skips the confirmation email — user logs in immediately.
    // must_change_password is set to true by the DB column default, so the
    // trigger-created profile row will already have the flag set correctly.
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role },
    });
    if (error) throw new Error(error.message);

    // Explicitly upsert profile row in case the DB trigger doesn't exist
    if (created?.user) {
      await admin.from('profiles').upsert({
        id: created.user.id,
        email,
        name: name || null,
        role,
        must_change_password: true,
      });
    }
    return { error: null };
  } catch (err) {
    console.error('[createUser]', toMsg(err));
    return { error: toMsg(err) };
  }
}

export async function updateUserRole(
  userId: string,
  role: string,
): Promise<{ error: string | null }> {
  try {
    const admin = await getAdminClient();
    const { error } = await admin
      .from('profiles')
      .update({ role })
      .eq('id', userId);
    if (error) throw new Error(error.message);
    return { error: null };
  } catch (err) {
    console.error('[updateUserRole]', toMsg(err));
    return { error: toMsg(err) };
  }
}

export async function resetUserPassword(
  userId: string,
): Promise<{ error: string | null }> {
  try {
    const admin = await getAdminClient();
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password: 'P@ssw0rd',
    });
    if (error) throw new Error(error.message);
    console.log(`[resetUserPassword] target=${userId} at=${new Date().toISOString()}`);
    return { error: null };
  } catch (err) {
    console.error('[resetUserPassword]', toMsg(err));
    return { error: toMsg(err) };
  }
}

export async function removeUser(
  userId: string,
): Promise<{ error: string | null }> {
  try {
    const admin = await getAdminClient();

    // Delete profile row first — prevents FK constraint errors if the
    // table was created without ON DELETE CASCADE.
    const { error: profileErr } = await admin
      .from('profiles')
      .delete()
      .eq('id', userId);
    if (profileErr) {
      // Non-fatal: row may already be absent; log and continue.
      console.error('[removeUser] profile delete:', profileErr.code, profileErr.message);
    }

    const { error: authErr } = await admin.auth.admin.deleteUser(userId);
    if (authErr) throw new Error(authErr.message);

    return { error: null };
  } catch (err) {
    console.error('[removeUser]', toMsg(err));
    return { error: toMsg(err) };
  }
}
