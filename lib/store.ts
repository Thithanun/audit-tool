import { supabase } from './supabase';
import type {
  AuditPlan, ChecklistItem, ChecklistTemplate, CorrectiveAction, PlanSession, Standard,
} from './types';

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

// ── Module-level query cache ───────────────────────────────────────────────────
// Next.js App Router preserves page state within a session, but every page
// component re-mounts on navigation (page.tsx is not a shared layout).
// This cache keeps the last successful fetch result in memory for TTL_MS so
// switching between menu tabs feels instant instead of showing a spinner every time.
//
// Mutations (save / delete) always invalidate the relevant entries so stale data
// is never shown after the user makes a change.

const TTL_MS = 30_000; // 30 seconds — short enough to stay fresh, long enough to help

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
};

// ── Audit Plans ───────────────────────────────────────────────────────────────

export async function getAuditPlans(): Promise<AuditPlan[]> {
  const cached = hit(qc.auditPlans);
  if (cached) return cached;

  const { data, error } = await supabase
    .from('audit_plans')
    .select('id, data');
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

  const { data, error } = await supabase
    .from('audit_plans')
    .select('id, data')
    .eq('id', id)
    .single();
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
  const { data, error } = await q;
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

  const { data, error } = await supabase
    .from('checklist_items')
    .select('id, data');
  if (error) throw pgErr(error);
  const result = (data ?? []).map(r => fromRow<ChecklistItem>(r as DataRow));
  qc.checklistItems = { data: result, at: Date.now() };
  return result;
}

export async function getChecklistBySession(sessionId: string): Promise<ChecklistItem[]> {
  const { data, error } = await supabase
    .from('checklist_items')
    .select('id, data')
    .eq('data->>sessionId', sessionId);
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

  const { data, error } = await supabase
    .from('corrective_actions')
    .select('id, data');
  if (error) throw pgErr(error);
  const result = (data ?? []).map(r => fromRow<CorrectiveAction>(r as DataRow));
  qc.correctiveActions = { data: result, at: Date.now() };
  return result;
}

export async function getCorrectiveActionsBySession(sessionId: string): Promise<CorrectiveAction[]> {
  const { data, error } = await supabase
    .from('corrective_actions')
    .select('id, data')
    .eq('data->>sessionId', sessionId);
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
  const { data, error } = await supabase
    .from('checklist_templates')
    .select('id, data');
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
  const { data, error } = await supabase
    .from('standards')
    .select('id, name, version, is_active, created_at')
    .order('name');
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
