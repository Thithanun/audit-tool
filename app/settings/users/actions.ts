'use server';

import { createClient } from '@supabase/supabase-js';
import { createSupabaseServer } from '@/lib/supabase-server';

async function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function assertAdmin() {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') throw new Error('Forbidden: admin role required');
}

export async function inviteUser(
  email: string,
  fullName: string,
  role: string,
): Promise<void> {
  await assertAdmin();
  const admin = await getAdminClient();
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { name: fullName, role },
  });
  if (error) throw new Error(error.message);
}

export async function updateUserRole(userId: string, role: string): Promise<void> {
  await assertAdmin();
  const admin = await getAdminClient();
  const { error } = await admin
    .from('profiles')
    .update({ role })
    .eq('id', userId);
  if (error) throw new Error(error.message);
}

export async function removeUser(userId: string): Promise<void> {
  await assertAdmin();
  const admin = await getAdminClient();

  // Delete profile row first — avoids FK constraint errors when the
  // profiles table was created without ON DELETE CASCADE, or when the
  // cascade hasn't been applied yet.
  const { error: profileErr } = await admin
    .from('profiles')
    .delete()
    .eq('id', userId);
  if (profileErr) {
    console.error('[removeUser] profiles delete error:', profileErr.code, profileErr.message);
    // Non-fatal: profile row may already be gone; continue to auth deletion.
  }

  // Delete the auth user (requires service role key).
  const { error: authErr } = await admin.auth.admin.deleteUser(userId);
  if (authErr) {
    console.error('[removeUser] auth.admin.deleteUser error:', authErr.message);
    throw new Error(authErr.message);
  }
}
