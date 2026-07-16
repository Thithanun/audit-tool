'use server';

export async function markPasswordChanged(userId: string): Promise<{ error: string | null }> {
  try {
    if (!userId) throw new Error('Missing userId');

    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

    const pub = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const rest = process.env.POSTGREST_INTERNAL_URL ?? `${pub}/rest/v1`;

    const res = await fetch(`${rest}/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${key}`,
        'apikey': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ must_change_password: false }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
