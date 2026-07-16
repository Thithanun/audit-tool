'use server';

import type { UserProfile } from '@/contexts/AuthContext';

// On-premise: calls PostgREST/GoTrue directly (bypasses nginx).
// Local dev (Supabase Cloud): falls back to public URL.
function getUrls() {
  const pub = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  return {
    rest: process.env.POSTGREST_INTERNAL_URL ?? `${pub}/rest/v1`,
    auth: process.env.GOTRUE_INTERNAL_URL   ?? `${pub}/auth/v1`,
  };
}

function getServiceKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Missing env var: SUPABASE_SERVICE_ROLE_KEY');
  return key;
}

function hdrs(key: string, extra?: Record<string, string>) {
  return { 'Authorization': `Bearer ${key}`, 'apikey': key, 'Content-Type': 'application/json', ...extra };
}

function toMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Exported server actions ───────────────────────────────────────────────────

export async function getUsers(): Promise<{ users: UserProfile[]; error: string | null }> {
  try {
    const key = getServiceKey();
    const { rest } = getUrls();
    const res = await fetch(`${rest}/profiles?select=id,email,name,role&order=email`, { headers: hdrs(key) });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return { users: await res.json(), error: null };
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
    const key = getServiceKey();
    const { rest, auth } = getUrls();

    const authRes = await fetch(`${auth}/admin/users`, {
      method: 'POST',
      headers: hdrs(key),
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name, role } }),
    });
    if (!authRes.ok) throw new Error(`${authRes.status}: ${await authRes.text()}`);
    const created = await authRes.json();

    await fetch(`${rest}/profiles`, {
      method: 'POST',
      headers: hdrs(key, { 'Prefer': 'resolution=merge-duplicates' }),
      body: JSON.stringify({ id: created.id, email, name: name || null, role, must_change_password: true }),
    });

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
    const key = getServiceKey();
    const { rest } = getUrls();
    const res = await fetch(`${rest}/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: hdrs(key),
      body: JSON.stringify({ role }),
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
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
    const key = getServiceKey();
    const { auth } = getUrls();
    const res = await fetch(`${auth}/admin/users/${userId}`, {
      method: 'PUT',
      headers: hdrs(key),
      body: JSON.stringify({ password: 'P@ssw0rd' }),
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
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
    const key = getServiceKey();
    const { rest, auth } = getUrls();

    await fetch(`${rest}/profiles?id=eq.${userId}`, { method: 'DELETE', headers: hdrs(key) });

    const res = await fetch(`${auth}/admin/users/${userId}`, { method: 'DELETE', headers: hdrs(key) });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);

    return { error: null };
  } catch (err) {
    console.error('[removeUser]', toMsg(err));
    return { error: toMsg(err) };
  }
}
