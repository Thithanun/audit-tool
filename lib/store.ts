import { supabase } from './supabase';
import type {
  AuditPlan, ChecklistItem, ChecklistTemplate, CorrectiveAction, PlanSession, ReportSignatures, ReportStatus, Standard,
  StandardVersion, DbClause, Framework,
} from './types';
import { ISMS_CLAUSES, ISO27001_CLAUSES, NIST_CSF_CLAUSES } from './seed-data';

export function uid(): string {
  return crypto.randomUUID();
}

// All tables use { id: UUID, data: JSONB } shape.
// plan_sessions also has plan_id: UUID at the top level for indexed filtering.
// We store TypeScript objects (camelCase) directly in the data JSONB field.

type DataRow = { id: string; data: Record<string, unknown> };
type PlanSessionRow = { id: string; plan_id: string; data: Record<string, unknown> };

function fromRow<T extends { id: string }>(r: DataRow): T {
  return { id: r.id, ...r.data } as T;
}

function toRow<T extends { id: string }>(obj: T): DataRow {
  const { id, ...rest } = obj as Record<string, unknown>;
  return { id: id as string, data: rest };
}

// Supabase errors are plain objects { message, code, details, hint }, not Error instances.
// Wrapping them lets catch blocks use instanceof Error and e.message correctly.
function pgErr(e: { message?: string; code?: string } | null): Error {
  const msg = e?.message ?? 'Database error';
  const code = e?.code ? ` (${e.code})` : '';
  return new Error(`${msg}${code}`);
}

// ── Query timeout ─────────────────────────────────────────────────────────────
// Every Supabase call is raced against a 10-second deadline.
// If the network is down or the DB is unresponsive the caller receives a clear
// error instead of hanging the loading spinner indefinitely.

const QUERY_TIMEOUT_MS = 30_000;

function withTimeout<T>(query: PromiseLike<T>): Promise<T> {
  return Promise.race([
    Promise.resolve(query),
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error('การเชื่อมต่อหมดเวลา (10s) — กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่')),
        QUERY_TIMEOUT_MS,
      ),
    ),
  ]);
}

// ── Module-level query cache ───────────────────────────────────────────────────
// Next.js App Router preserves page state within a session, but every page
// component re-mounts on navigation (page.tsx is not a shared layout).
// This cache keeps the last successful fetch result in memory for TTL_MS so
// switching between menu tabs feels instant instead of showing a spinner every time.
//
// Mutations (save / delete) always invalidate the relevant entries so stale data
// is never shown after the user makes a change.

const TTL_MS = 5_000; // 5 seconds — just enough to de-dup concurrent mounts on the same page

interface CacheEntry<T> { data: T; at: number }

function fresh<T>(e: CacheEntry<T> | null): e is CacheEntry<T> {
  return e !== null && Date.now() - e.at < TTL_MS;
}

function hit<T>(e: CacheEntry<T> | null): T | undefined {
  return fresh(e) ? e!.data : undefined;
}

const qc = {
  auditPlans:        null as CacheEntry<AuditPlan[]>        | null,
  checklistItems:    null as CacheEntry<ChecklistItem[]>     | null,
  correctiveActions: null as CacheEntry<CorrectiveAction[]>  | null,
  standardVersions:  null as CacheEntry<StandardVersion[]>  | null,
};

/** Drop every cached entry immediately.
 *  Call this when the browser tab regains focus so that cross-tab edits
 *  are always reflected within one re-fetch cycle. */
export function clearAllCaches(): void {
  qc.auditPlans        = null;
  qc.checklistItems    = null;
  qc.correctiveActions = null;
  qc.standardVersions  = null;
}

// ── Audit Plans ───────────────────────────────────────────────────────────────

export async function getAuditPlans(): Promise<AuditPlan[]> {
  const cached = hit(qc.auditPlans);
  if (cached) return cached;

  const { data, error } = await withTimeout(
    supabase.from('audit_plans').select('id, data'),
  );
  if (error) throw pgErr(error);
  const result = (data ?? []).map(r => fromRow<AuditPlan>(r as DataRow));
  qc.auditPlans = { data: result, at: Date.now() };
  return result;
}

export const getSessions = getAuditPlans;

export async function getAuditPlanById(id: string): Promise<AuditPlan | null> {
  // Re-use list cache if we just fetched it — saves a round-trip on the detail page.
  const listCached = hit(qc.auditPlans);
  if (listCached) return listCached.find(p => p.id === id) ?? null;

  const { data, error } = await withTimeout(
    supabase.from('audit_plans').select('id, data').eq('id', id).single(),
  );
  if (error) {
    if (error.code === 'PGRST116') return null; // not found
    throw pgErr(error);
  }
  return fromRow<AuditPlan>(data as DataRow);
}

export async function saveAuditPlan(plan: AuditPlan): Promise<void> {
  const { error } = await supabase
    .from('audit_plans')
    .upsert(toRow(plan));
  if (error) throw pgErr(error);
  qc.auditPlans = null; // invalidate — next read will fetch fresh list
}

export const saveSession = saveAuditPlan;

export async function deleteAuditPlan(id: string): Promise<void> {
  const sessions = await getPlanSessions(id);
  const sessionIds = [id, ...sessions.map(s => s.id)];

  await supabase.from('corrective_actions').delete().in('data->>sessionId', sessionIds);
  await supabase.from('checklist_items').delete().in('data->>sessionId', sessionIds);
  await supabase.from('plan_sessions').delete().eq('plan_id', id);
  const { error } = await supabase.from('audit_plans').delete().eq('id', id);
  if (error) throw pgErr(error);
  qc.auditPlans = null;
  qc.checklistItems = null;
  qc.correctiveActions = null;
}

export const deleteSession = deleteAuditPlan;

/** Stamp the "issued at" timestamp when an auditor clicks Create Report. */
export async function saveReportIssuedAt(planId: string, issuedAt: string): Promise<void> {
  const plan = await getAuditPlanById(planId);
  if (!plan) throw new Error(`Audit plan ${planId} not found`);
  await saveAuditPlan({ ...plan, reportIssuedAt: issuedAt });
}

/** Persist digital signatures for a Management Report without overwriting other plan fields. */
export async function saveReportSignatures(
  planId: string,
  signatures: ReportSignatures,
): Promise<void> {
  const plan = await getAuditPlanById(planId);
  if (!plan) throw new Error(`Audit plan ${planId} not found`);
  await saveAuditPlan({ ...plan, reportSignatures: signatures });
}

/** Change the workflow status of a Management Report (draft → in_review → approved). */
export async function saveReportStatus(planId: string, status: ReportStatus): Promise<void> {
  const plan = await getAuditPlanById(planId);
  if (!plan) throw new Error(`Audit plan ${planId} not found`);
  await saveAuditPlan({ ...plan, reportStatus: status });
}

/** Remove the issued-at stamp and signatures — effectively "un-publishes" a Management Report. */
export async function deleteReport(planId: string): Promise<void> {
  const plan = await getAuditPlanById(planId);
  if (!plan) throw new Error(`Audit plan ${planId} not found`);
  // Setting optional fields to undefined causes toRow to omit them from JSONB
  await saveAuditPlan({ ...plan, reportIssuedAt: undefined, reportSignatures: undefined });
}

// ── Plan Sessions ─────────────────────────────────────────────────────────────

// Parse the start time of a session into minutes since midnight (for numeric sort).
// Handles "9:00-10:00", "09:00-10:00", "9:00 - 10:00", "09.00-10.00" etc.
// Regex matches the FIRST H:MM or HH:MM pattern in the string.
function sessionStartMinutes(time: string | undefined): number {
  const m = (time ?? '').match(/(\d{1,2})[:.h](\d{2})/);
  if (!m) return Infinity; // no recognisable time → sort last
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export async function getPlanSessions(planId?: string): Promise<PlanSession[]> {
  let q = supabase.from('plan_sessions').select('id, plan_id, data');
  if (planId) q = q.eq('plan_id', planId);
  const { data, error } = await withTimeout(q);
  if (error) throw pgErr(error);
  const sessions = (data ?? []).map((r: PlanSessionRow) => ({
    id: r.id,
    planId: r.plan_id,
    ...r.data,
  } as PlanSession));

  // Sort priority:
  //   1. date (ISO "YYYY-MM-DD") — lexicographic ≡ chronological; blanks last
  //   2. day  (numeric) — tie-break when date is missing or identical
  //   3. start time as minutes — avoids "10:00" < "9:00" string trap
  return sessions.slice().sort((a, b) => {
    const dateA = a.date ?? '';
    const dateB = b.date ?? '';
    if (dateA !== dateB) {
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateA.localeCompare(dateB);
    }
    const dayA = typeof a.day === 'number' ? a.day : Number(a.day);
    const dayB = typeof b.day === 'number' ? b.day : Number(b.day);
    if (dayA !== dayB) return dayA - dayB;
    return sessionStartMinutes(a.time) - sessionStartMinutes(b.time);
  });
}

export async function savePlanSession(session: PlanSession): Promise<void> {
  const { id, planId, ...rest } = session;
  const { error } = await supabase
    .from('plan_sessions')
    .upsert({ id, plan_id: planId, data: rest });
  if (error) throw pgErr(error);
}

export async function deletePlanSession(id: string): Promise<void> {
  const { error } = await supabase
    .from('plan_sessions')
    .delete()
    .eq('id', id);
  if (error) throw pgErr(error);
}

// ── Checklist Items ───────────────────────────────────────────────────────────

export async function getChecklistItems(): Promise<ChecklistItem[]> {
  const cached = hit(qc.checklistItems);
  if (cached) return cached;

  const { data, error } = await withTimeout(
    supabase.from('checklist_items').select('id, data'),
  );
  if (error) throw pgErr(error);
  const result = (data ?? []).map(r => fromRow<ChecklistItem>(r as DataRow));
  qc.checklistItems = { data: result, at: Date.now() };
  return result;
}

export async function getChecklistBySession(sessionId: string): Promise<ChecklistItem[]> {
  const { data, error } = await withTimeout(
    supabase.from('checklist_items').select('id, data').eq('data->>sessionId', sessionId),
  );
  if (error) throw pgErr(error);
  return (data ?? []).map(r => fromRow<ChecklistItem>(r as DataRow));
}

export async function saveChecklistItem(item: ChecklistItem): Promise<void> {
  const { error } = await supabase
    .from('checklist_items')
    .upsert(toRow(item));
  if (error) throw pgErr(error);
  qc.checklistItems = null;
}

export async function bulkSaveChecklistItems(items: ChecklistItem[]): Promise<void> {
  if (items.length === 0) return;
  const { error } = await supabase
    .from('checklist_items')
    .insert(items.map(toRow));
  if (error) throw pgErr(error);
  qc.checklistItems = null;
}

export async function deleteChecklistItem(id: string): Promise<void> {
  await supabase.from('corrective_actions').delete().eq('data->>checklistItemId', id);
  const { error } = await supabase.from('checklist_items').delete().eq('id', id);
  if (error) throw pgErr(error);
  qc.checklistItems = null;
  qc.correctiveActions = null;
}

// ── Corrective Actions ────────────────────────────────────────────────────────

export async function getCorrectiveActions(): Promise<CorrectiveAction[]> {
  const cached = hit(qc.correctiveActions);
  if (cached) return cached;

  const { data, error } = await withTimeout(
    supabase.from('corrective_actions').select('id, data'),
  );
  if (error) throw pgErr(error);
  const result = (data ?? []).map(r => fromRow<CorrectiveAction>(r as DataRow));
  qc.correctiveActions = { data: result, at: Date.now() };
  return result;
}

export async function getCorrectiveActionsBySession(sessionId: string): Promise<CorrectiveAction[]> {
  const { data, error } = await withTimeout(
    supabase.from('corrective_actions').select('id, data').eq('data->>sessionId', sessionId),
  );
  if (error) throw pgErr(error);
  return (data ?? []).map(r => fromRow<CorrectiveAction>(r as DataRow));
}

export async function saveCorrectiveAction(ca: CorrectiveAction): Promise<void> {
  const { error } = await supabase
    .from('corrective_actions')
    .upsert(toRow(ca));
  if (error) throw pgErr(error);
  qc.correctiveActions = null;
}

export async function deleteCorrectiveAction(id: string): Promise<void> {
  const { error } = await supabase
    .from('corrective_actions')
    .delete()
    .eq('id', id);
  if (error) throw pgErr(error);
  qc.correctiveActions = null;
}

// ── Checklist Templates ───────────────────────────────────────────────────────

export async function getChecklistTemplates(): Promise<ChecklistTemplate[]> {
  const { data, error } = await withTimeout(
    supabase.from('checklist_templates').select('id, data'),
  );
  if (error) throw pgErr(error);
  return (data ?? []).map(r => fromRow<ChecklistTemplate>(r as DataRow));
}

export async function saveChecklistTemplate(t: ChecklistTemplate): Promise<void> {
  const { error } = await supabase
    .from('checklist_templates')
    .upsert(toRow(t));
  if (error) throw pgErr(error);
}

export async function deleteChecklistTemplate(id: string): Promise<void> {
  const { error } = await supabase
    .from('checklist_templates')
    .delete()
    .eq('id', id);
  if (error) throw pgErr(error);
}

// ── Standards ─────────────────────────────────────────────────────────────────
// Note: standards table uses native columns, not the { id, data: JSONB } pattern.

export async function getStandards(): Promise<Standard[]> {
  const { data, error } = await withTimeout(
    supabase.from('standards').select('id, name, version, is_active, created_at').order('name'),
  );
  if (error) throw pgErr(error);
  return (data ?? []) as Standard[];
}

export async function saveStandard(
  s: Omit<Standard, 'id' | 'created_at'> | Standard,
): Promise<void> {
  const { error } = await supabase.from('standards').upsert(s);
  if (error) throw pgErr(error);
}

export async function deleteStandard(id: string): Promise<void> {
  const { error } = await supabase.from('standards').delete().eq('id', id);
  if (error) throw pgErr(error);
}

// ── NCR Number Generator ──────────────────────────────────────────────────────

/**
 * Generate the next available NCR number for the current year.
 * Format: NCRXXYYY  where XX = 2-digit year (e.g. "26" for 2026)
 *                         YYY = zero-padded 3-digit sequence (001, 002, …)
 *
 * Pass the full list of existing NCR CorrectiveActions so the function can
 * find the highest sequence already used this year and increment it.
 */
export function generateNcrNumber(existingNcrs: CorrectiveAction[]): string {
  const year = new Date().getFullYear();
  const xx     = String(year).slice(-2);          // "26"
  const prefix = `NCR${xx}`;                      // "NCR26"
  let maxSeq = 0;
  for (const ncr of existingNcrs) {
    if (ncr.ncrNumber?.startsWith(prefix)) {
      const seq = parseInt(ncr.ncrNumber.slice(prefix.length), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }
  const yyy = String(maxSeq + 1).padStart(3, '0');
  return `${prefix}${yyy}`;
}

// ── Standard Versions & Clauses ───────────────────────────────────────────────
// standard_versions + clauses tables use native columns (not the JSONB pattern).
// ensureClausesSeeded() auto-populates both tables on first run so no manual
// SQL inserts are needed when deploying.  Adding a future version (e.g. ISO 27001:2025)
// is a pure INSERT — no code change required.

let _seedDone = false;
let _seedPromise: Promise<void> | null = null;

/**
 * Idempotent seeder.  Runs once per browser session (module-level flag).
 * If the standard_versions table is empty it inserts ISO 27001:2022 and
 * NIST CSF:2.0 plus all their clauses from seed-data.ts.
 */
export async function ensureClausesSeeded(): Promise<void> {
  if (_seedDone) return;
  if (_seedPromise) return _seedPromise;

  _seedPromise = (async () => {
    try {
      // Check how many versions already exist.
      const { count, error: countErr } = await supabase
        .from('standard_versions')
        .select('id', { count: 'exact', head: true });

      if (countErr) {
        // Table probably not created yet — skip silently so the rest of the app still works.
        console.warn('[ensureClausesSeeded] standard_versions not available:', countErr.message);
        return;
      }

      if ((count ?? 0) > 0) {
        _seedDone = true;
        return; // already seeded
      }

      // ── Insert standard versions ──────────────────────────────────────────
      const { data: isoRow, error: isoVerErr } = await supabase
        .from('standard_versions')
        .insert({ standard_name: 'ISO 27001', version: '2022', is_active: true })
        .select('id')
        .single();
      if (isoVerErr) throw pgErr(isoVerErr);

      const { data: nistRow, error: nistVerErr } = await supabase
        .from('standard_versions')
        .insert({ standard_name: 'NIST CSF', version: '2.0', is_active: true })
        .select('id')
        .single();
      if (nistVerErr) throw pgErr(nistVerErr);

      // ── Insert ISO 27001:2022 clauses (ISMS + Annex A) ───────────────────
      const isoClauses = [...ISMS_CLAUSES, ...ISO27001_CLAUSES].map((c, i) => ({
        standard_version_id: isoRow.id,
        clause_ref:   c.clauseRef,
        clause_title: c.clauseTitle,
        framework:    c.framework,
        requirement:  c.requirement,
        display_order: i,
      }));

      // Insert in chunks of 500 to stay under Supabase's request-body limit.
      for (let i = 0; i < isoClauses.length; i += 500) {
        const { error } = await supabase.from('clauses').insert(isoClauses.slice(i, i + 500));
        if (error) throw pgErr(error);
      }

      // ── Insert NIST CSF 2.0 clauses ───────────────────────────────────────
      const nistClauses = NIST_CSF_CLAUSES.map((c, i) => ({
        standard_version_id: nistRow.id,
        clause_ref:   c.clauseRef,
        clause_title: c.clauseTitle,
        framework:    c.framework,
        requirement:  c.requirement,
        display_order: i,
      }));

      const { error: nistClauseErr } = await supabase.from('clauses').insert(nistClauses);
      if (nistClauseErr) throw pgErr(nistClauseErr);

      _seedDone = true;
    } catch (err) {
      // Another tab may have won the race and inserted first — not fatal.
      // We still mark done so we don't keep retrying on every call.
      console.warn('[ensureClausesSeeded] seed error (may be duplicate race):', err);
      _seedDone = true;
    } finally {
      _seedPromise = null;
    }
  })();

  return _seedPromise;
}

/** Fetch all active standard versions from the DB (seeds first if needed). */
export async function getStandardVersions(): Promise<StandardVersion[]> {
  const cached = hit(qc.standardVersions);
  if (cached) return cached;

  await ensureClausesSeeded();

  const { data, error } = await withTimeout(
    supabase
      .from('standard_versions')
      .select('id, standard_name, version, is_active, effective_date, created_at')
      .eq('is_active', true)
      // Latest versions first: effective_date DESC (nulls last) → created_at DESC
      // So when a future ISO 27001:2025 is inserted it automatically becomes the default.
      .order('effective_date', { ascending: false, nullsFirst: false })
      .order('created_at',     { ascending: false }),
  );
  if (error) throw pgErr(error);
  const result = (data ?? []) as StandardVersion[];
  qc.standardVersions = { data: result, at: Date.now() };
  return result;
}

/** Fetch all clauses for a given standard version, sorted by display_order. */
export async function getDbClauses(standardVersionId: string): Promise<DbClause[]> {
  const { data, error } = await withTimeout(
    supabase
      .from('clauses')
      .select('id, standard_version_id, clause_ref, clause_title, framework, requirement, display_order, created_at')
      .eq('standard_version_id', standardVersionId)
      .order('display_order'),
  );
  if (error) throw pgErr(error);
  return (data ?? []) as DbClause[];
}

/**
 * Group DB clauses by section label.
 *
 * ISO 27001: groups by Annex A section (A.5 / A.6 / A.7 / A.8) or ISMS (Clause 4-10).
 * NIST CSF:  groups by Function prefix (GV / ID / PR / DE / RS / RC).
 *
 * The grouping logic is data-driven — no hardcoded version numbers.
 * Adding a new standard version is a pure DB insert; no code change needed here.
 */
export function groupDbClauses(clauses: DbClause[]): Record<string, DbClause[]> {
  const groups: Record<string, DbClause[]> = {};
  for (const c of clauses) {
    let group: string;
    if (c.framework === 'ISO27001') {
      if (c.clause_ref.startsWith('A.5'))       group = 'Organizational Controls (A.5)';
      else if (c.clause_ref.startsWith('A.6'))   group = 'People Controls (A.6)';
      else if (c.clause_ref.startsWith('A.7'))   group = 'Physical Controls (A.7)';
      else if (c.clause_ref.startsWith('A.8'))   group = 'Technological Controls (A.8)';
      else                                        group = 'ISMS Requirements (Clause 4–10)';
    } else {
      // NIST CSF ref format: GV.OC-01 → Function prefix = "GV"
      group = c.clause_ref.split('.')[0];
    }
    if (!groups[group]) groups[group] = [];
    groups[group].push(c);
  }
  return groups;
}

/**
 * Resolve a human-readable version label for display (e.g. "ISO 27001 · 2022").
 *
 * Prefers the DB-backed label when standardVersionId + versionsMap are provided.
 * Falls back to a static string derived from `framework` for legacy checklist items
 * that were created before the standard_versions table existed.
 */
export function getVersionLabel(
  framework: Framework,
  standardVersionId?: string,
  versionsMap?: Map<string, StandardVersion>,
): string {
  if (standardVersionId && versionsMap) {
    const v = versionsMap.get(standardVersionId);
    if (v) return `${v.standard_name} · ${v.version}`;
  }
  // Historic fallback — old items always had ISO 27001:2022 or NIST CSF 2.0.
  return framework === 'ISO27001' ? 'ISO 27001 · 2022' : 'NIST CSF · 2.0';
}

// ── Utilities ─────────────────────────────────────────────────────────────────

export function computeSessionProgress(
  items: ChecklistItem[],
  sessionId: string,
): { total: number; assessed: number; pct: number } {
  const relevant = items.filter(i => i.sessionId === sessionId);
  const assessed = relevant.filter(i => i.status !== 'Not Assessed').length;
  return {
    total: relevant.length,
    assessed,
    pct: relevant.length === 0 ? 0 : Math.round((assessed / relevant.length) * 100),
  };
}

export const getSessionProgress = computeSessionProgress;
