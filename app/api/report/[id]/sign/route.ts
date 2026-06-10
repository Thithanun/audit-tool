import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { ReportSignature, ReportSignatures, ReportStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

// ── Build an authenticated Supabase client from the request cookies ───────────

function makeSupabase(request: NextRequest) {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const parsedCookies = cookieHeader
    .split(';')
    .map(c => c.trim())
    .filter(Boolean)
    .map(c => {
      const eqIdx = c.indexOf('=');
      return eqIdx === -1
        ? { name: c, value: '' }
        : { name: c.slice(0, eqIdx), value: c.slice(eqIdx + 1) };
    });

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll: () => parsedCookies,
        setAll: () => {},
      },
    },
  );
}

// ── Shared auth + role guard ──────────────────────────────────────────────────

async function guardRequest(request: NextRequest) {
  const supabase = makeSupabase(request);

  // 1. Authenticate
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return { error: 'Unauthorized', status: 401 as const, supabase, user: null, profile: null };

  // 2. Load profile
  const { data: profileRow, error: profErr } = await supabase
    .from('profiles')
    .select('role, name')
    .eq('id', user.id)
    .single();
  if (profErr || !profileRow) return { error: 'Profile not found', status: 403 as const, supabase, user: null, profile: null };

  const { role, name } = profileRow as { role: string; name: string | null };

  // 3. Only admin / auditor may touch signatures
  if (role !== 'admin' && role !== 'auditor') {
    return { error: 'เฉพาะ Admin / Auditor เท่านั้นที่มีสิทธิ์ลงนาม', status: 403 as const, supabase, user: null, profile: null };
  }

  return { error: null, status: null, supabase, user, profile: { role, name } };
}

// ── POST /api/report/[id]/sign ─────────────────────────────────────────────────
/**
 * Save a digital signature for the Management Committee approval block.
 *
 * Validates:
 *   1. Session is authenticated.
 *   2. User DB role is admin or auditor — viewer cannot sign.
 *   3. sigData (base64 PNG) is present in the body.
 *
 * Persists:
 *   - The drawn signature image (sigData)
 *   - Signer display name (from profiles.name or email fallback)
 *   - Signer user ID (for audit trail)
 *   - Signed-at ISO timestamp (server clock)
 *   - Sets reportStatus → 'approved'
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const guard = await guardRequest(request);
  if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { supabase, user, profile } = guard;

  // Parse body
  let body: { sigData: string };
  try {
    body = await request.json() as { sigData: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.sigData || typeof body.sigData !== 'string') {
    return NextResponse.json({ error: 'sigData is required' }, { status: 400 });
  }

  // Load the audit plan
  const { data: planRow, error: planErr } = await supabase
    .from('audit_plans')
    .select('id, data')
    .eq('id', id)
    .single();
  if (planErr || !planRow) {
    return NextResponse.json({ error: 'Audit plan not found' }, { status: 404 });
  }

  // Build the new signature object — signer name and ID come from the server
  const now = new Date().toISOString();
  const signature: ReportSignature = {
    sigData:    body.sigData,
    signedAt:   now,
    signerName: profile!.name ?? user!.email ?? 'ไม่ทราบชื่อ',
    signerId:   user!.id,
  };

  // Merge into existing plan data
  const existing = (planRow as { id: string; data: Record<string, unknown> }).data;
  const existingSigs = (existing.reportSignatures ?? {}) as ReportSignatures;
  const updatedData = {
    ...existing,
    reportSignatures: { ...existingSigs, management: signature } as ReportSignatures,
    reportStatus:     'approved' as ReportStatus,
  };

  const { error: saveErr } = await supabase
    .from('audit_plans')
    .upsert({ id, data: updatedData });
  if (saveErr) {
    console.error('[report/sign POST] save error:', saveErr);
    return NextResponse.json({ error: saveErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, signature, reportStatus: 'approved' });
}

// ── DELETE /api/report/[id]/sign ───────────────────────────────────────────────
/**
 * Clear the management signature and revert reportStatus to 'draft'.
 * Same role guard as POST — only admin / auditor.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const guard = await guardRequest(request);
  if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { supabase } = guard;

  // Load the audit plan
  const { data: planRow, error: planErr } = await supabase
    .from('audit_plans')
    .select('id, data')
    .eq('id', id)
    .single();
  if (planErr || !planRow) {
    return NextResponse.json({ error: 'Audit plan not found' }, { status: 404 });
  }

  const existing = (planRow as { id: string; data: Record<string, unknown> }).data;
  const existingSigs = (existing.reportSignatures ?? {}) as ReportSignatures;
  const { management: _removed, ...remainingSigs } = existingSigs;

  const updatedData = {
    ...existing,
    reportSignatures: remainingSigs,
    reportStatus:     'draft' as ReportStatus,
  };

  const { error: saveErr } = await supabase
    .from('audit_plans')
    .upsert({ id, data: updatedData });
  if (saveErr) {
    console.error('[report/sign DELETE] save error:', saveErr);
    return NextResponse.json({ error: saveErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, reportStatus: 'draft' });
}
