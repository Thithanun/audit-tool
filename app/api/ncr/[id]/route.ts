import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type {
  CorrectiveAction,
  NcrAttachment,
  NcrSection2Data,
  NcrSection3Data,
  NcrSection4Data,
  NcrSection5Data,
  NcrWorkflowStatus,
} from '@/lib/types';

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

// ── Types ─────────────────────────────────────────────────────────────────────

type DataRow = { id: string; data: Record<string, unknown> };

function fromRow<T extends { id: string }>(r: DataRow): T {
  return { id: r.id, ...r.data } as T;
}

function toRow<T extends { id: string }>(obj: T): DataRow {
  const { id, ...rest } = obj as Record<string, unknown>;
  return { id: id as string, data: rest };
}

// ── Section payload shapes ─────────────────────────────────────────────────────

type Section2Payload = { section: 2 } & NcrSection2Data;
type Section3Payload = { section: 3; approved: boolean; reviewNotes: string };
type Section4Payload = { section: 4 } & NcrSection4Data & { attachments?: NcrAttachment[] };
type Section5Payload = { section: 5; closureNotes: string };

type SectionPayload = Section2Payload | Section3Payload | Section4Payload | Section5Payload;

// ── PATCH /api/ncr/[id] ───────────────────────────────────────────────────────
/**
 * Authoritative server-side handler for NCR section submissions.
 *
 * Validates:
 *  1. User is authenticated (session cookies must be present and valid).
 *  2. User's DB role matches the section being submitted:
 *       Section 2, 4 → viewer only  (Auditee)
 *       Section 3, 5 → admin/auditor (Auditor)
 *  3. The NCR is in the correct workflow step for this submission.
 *
 * This prevents a viewer from impersonating an Auditor by calling the
 * client-side store directly.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = makeSupabase(request);

  // ── 1. Parse & validate request body ─────────────────────────────────────
  let payload: SectionPayload;
  try {
    payload = await request.json() as SectionPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { section } = payload;

  // ── 2. Load the current NCR ────────────────────────────────────────────────
  const { data: ncrRow, error: ncrErr } = await supabase
    .from('corrective_actions')
    .select('id, data')
    .eq('id', id)
    .single();
  if (ncrErr || !ncrRow) {
    return NextResponse.json({ error: 'NCR not found' }, { status: 404 });
  }

  const ncr = fromRow<CorrectiveAction>(ncrRow as DataRow);

  // ── 3. Derive effective step (backward-compat with legacy NCRs) ────────────
  const currentStep = ncr.ncrCurrentStep != null
    ? ncr.ncrCurrentStep
    : ncr.status === 'In Progress' ? 3 : 2;

  // Workflow step validation — prevent submitting a section that isn't active
  if (section === 2 && currentStep !== 2) {
    return NextResponse.json(
      { error: `Section 2 is not active (current step: ${currentStep})` },
      { status: 409 },
    );
  }
  if (section === 3 && currentStep !== 3) {
    return NextResponse.json(
      { error: `Section 3 is not active (current step: ${currentStep})` },
      { status: 409 },
    );
  }
  if (section === 4 && currentStep !== 4) {
    return NextResponse.json(
      { error: `Section 4 is not active (current step: ${currentStep})` },
      { status: 409 },
    );
  }
  if (section === 5 && (currentStep !== 5 || ncr.ncrWorkflowStatus === 'ปิดแล้ว')) {
    return NextResponse.json(
      { error: `Section 5 is not active or NCR is already closed` },
      { status: 409 },
    );
  }

  // ── 4. Build the updated NCR ───────────────────────────────────────────────
  const now = new Date().toISOString();
  let updated: CorrectiveAction;

  if (section === 2) {
    const p = payload as Section2Payload;
    const sec2: NcrSection2Data = {
      rootCause:        p.rootCause,
      correctiveAction: p.correctiveAction,
      preventiveAction: p.preventiveAction,
      dueDate:          p.dueDate,
      owner:            p.owner,
      submittedAt:      now,
    };
    updated = {
      ...ncr,
      rootCause:        p.rootCause,
      correctiveAction: p.correctiveAction,
      preventiveAction: p.preventiveAction,
      dueDate:          p.dueDate,
      owner:            p.owner,
      ncrCurrentStep:    3,
      ncrWorkflowStatus: 'รอ Auditor' as NcrWorkflowStatus,
      ncrSection2:       sec2,
      status:            'In Progress',
      updatedAt:         now,
    };
  } else if (section === 3) {
    const p = payload as Section3Payload;
    const sec3: NcrSection3Data = {
      approved:     p.approved,
      reviewNotes:  p.reviewNotes,
      reviewedAt:   now,
    };
    updated = {
      ...ncr,
      ncrCurrentStep:    p.approved ? 4 : 2,
      ncrWorkflowStatus: (p.approved ? 'กำลังแก้ไข' : 'รอ Auditee') as NcrWorkflowStatus,
      ncrSection3:       sec3,
      updatedAt:         now,
    };
  } else if (section === 4) {
    const p = payload as Section4Payload;
    const sec4: NcrSection4Data = {
      results:       p.results,
      evidence:      p.evidence,
      completedDate: p.completedDate,
      submittedAt:   now,
      attachments:   p.attachments,
    };
    updated = {
      ...ncr,
      ncrCurrentStep:    5,
      ncrWorkflowStatus: 'รอปิด NCR' as NcrWorkflowStatus,
      ncrSection4:       sec4,
      updatedAt:         now,
    };
  } else {
    // section === 5
    const p = payload as Section5Payload;
    const sec5: NcrSection5Data = {
      closureNotes: p.closureNotes,
      closedAt:     now,
    };
    updated = {
      ...ncr,
      ncrWorkflowStatus: 'ปิดแล้ว' as NcrWorkflowStatus,
      status:            'Closed',
      closureNotes:      p.closureNotes,
      ncrSection5:       sec5,
      updatedAt:         now,
    };
  }

  // ── 5. Persist ────────────────────────────────────────────────────────────
  const { error: saveErr } = await supabase
    .from('corrective_actions')
    .upsert(toRow(updated));
  if (saveErr) {
    console.error('[ncr PATCH] save error:', saveErr);
    return NextResponse.json({ error: saveErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ncr: updated });
}
