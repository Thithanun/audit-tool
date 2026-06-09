'use server';

import { createClient } from '@supabase/supabase-js';
import { createSupabaseServer } from '@/lib/supabase-server';

// ── Admin Supabase client (service role, bypasses RLS) ────────────────────────

async function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url)        throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_URL');
  if (!serviceKey) throw new Error('Missing env var: SUPABASE_SERVICE_ROLE_KEY — add it in Vercel → Settings → Environment Variables');
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ── Guard: caller must be an authenticated admin ───────────────────────────────

async function assertAdmin() {
  const supabase = await createSupabaseServer();

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error('Session error: ' + authErr.message);
  if (!user)   throw new Error('Unauthorized — not logged in');

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileErr) throw new Error('Could not read profile: ' + profileErr.message);
  if (profile?.role !== 'admin') throw new Error('Forbidden — admin role required');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wrap any thrown value into a plain string for the client. */
function toMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Exported server actions ───────────────────────────────────────────────────
// All return { error: string | null } instead of throwing so that the real
// error message reaches the browser in production (Next.js sanitises thrown
// Server Action errors to a generic string for security).

export async function createUser(
  email: string,
  password: string,
  name: string,
  role: string,
): Promise<{ error: string | null }> {
  try {
    await assertAdmin();
    const admin = await getAdminClient();
    // email_confirm: true skips the confirmation email — user logs in immediately.
    // must_change_password is set to true by the DB column default, so the
    // trigger-created profile row will already have the flag set correctly.
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role },
    });
    if (error) throw new Error(error.message);
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
    await assertAdmin();
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
    await assertAdmin();

    // Prevent admin from resetting their own password via this page
    const supabase = await createSupabaseServer();
    const { data: { user: caller } } = await supabase.auth.getUser();
    if (caller?.id === userId) {
      throw new Error('Cannot reset your own password from this page');
    }

    const admin = await getAdminClient();
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password: 'P@ssw0rd',
    });
    if (error) throw new Error(error.message);

    // Audit log — who reset whose password and when
    console.log(
      `[resetUserPassword] admin=${caller?.id} target=${userId} at=${new Date().toISOString()}`,
    );
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
    await assertAdmin();
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
