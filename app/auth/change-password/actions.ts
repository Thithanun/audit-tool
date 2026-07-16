'use server';

import { createSupabaseServer } from '@/lib/supabase-server';

export async function markPasswordChanged(): Promise<{ error: string | null }> {
  try {
    const supabase = await createSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

    const pub = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const rest = process.env.POSTGREST_INTERNAL_URL ?? `${pub}/rest/v1`;

    const res = await fetch(`${rest}/profiles?id=eq.${user.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${key}`,
        'apikey': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ must_change_password: false }),
    });

    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
