'use server';

import { createClient } from '@supabase/supabase-js';
import { createSupabaseServer } from '@/lib/supabase-server';

function toMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Clears the must_change_password flag for the currently logged-in user.
 * Uses the service-role client to bypass RLS (profiles has no self-update policy).
 */
export async function clearMustChangePassword(): Promise<{ error: string | null }> {
  try {
    // Verify caller is authenticated
    const serverClient = await createSupabaseServer();
    const { data: { user }, error: authErr } = await serverClient.auth.getUser();
    if (authErr) throw new Error('Session error: ' + authErr.message);
    if (!user)   throw new Error('Not authenticated');

    // Use service role to update the flag
    const url        = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (!url || !serviceKey) throw new Error('Missing Supabase env vars');

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error } = await admin
      .from('profiles')
      .update({ must_change_password: false })
      .eq('id', user.id);

    if (error) throw new Error(error.message);
    return { error: null };
  } catch (err) {
    console.error('[clearMustChangePassword]', toMsg(err));
    return { error: toMsg(err) };
  }
}
