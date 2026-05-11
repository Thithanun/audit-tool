import { supabase } from './supabase';
import type {
  AuditPlan, ChecklistItem, ChecklistTemplate, CorrectiveAction, PlanSession,
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

// ── Audit Plans ───────────────────────────────────────────────────────────────

export async function getAuditPlans(): Promise<AuditPlan[]> {
  const { data, error } = await supabase
    .from('audit_plans')
    .select('id, data');
  if (error) throw pgErr(error);
  return (data ?? []).map(r => fromRow<AuditPlan>(r as DataRow));
}

export const getSessions = getAuditPlans;

export async function saveAuditPlan(plan: AuditPlan): Promise<void> {
  const { error } = await supabase
    .from('audit_plans')
    .upsert(toRow(plan));
  if (error) throw pgErr(error);
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
}

export const deleteSession = deleteAuditPlan;

// ── Plan Sessions ─────────────────────────────────────────────────────────────

export async function getPlanSessions(planId?: string): Promise<PlanSession[]> {
  let q = supabase.from('plan_sessions').select('id, plan_id, data');
  if (planId) q = q.eq('plan_id', planId);
  const { data, error } = await q;
  if (error) throw pgErr(error);
  return (data ?? []).map((r: PlanSessionRow) => ({
    id: r.id,
    planId: r.plan_id,
    ...r.data,
  } as PlanSession));
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
  const { data, error } = await supabase
    .from('checklist_items')
    .select('id, data');
  if (error) throw pgErr(error);
  return (data ?? []).map(r => fromRow<ChecklistItem>(r as DataRow));
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
}

export async function bulkSaveChecklistItems(items: ChecklistItem[]): Promise<void> {
  if (items.length === 0) return;
  const { error } = await supabase
    .from('checklist_items')
    .insert(items.map(toRow));
  if (error) throw pgErr(error);
}

export async function deleteChecklistItem(id: string): Promise<void> {
  await supabase.from('corrective_actions').delete().eq('data->>checklistItemId', id);
  const { error } = await supabase.from('checklist_items').delete().eq('id', id);
  if (error) throw pgErr(error);
}

// ── Corrective Actions ────────────────────────────────────────────────────────

export async function getCorrectiveActions(): Promise<CorrectiveAction[]> {
  const { data, error } = await supabase
    .from('corrective_actions')
    .select('id, data');
  if (error) throw pgErr(error);
  return (data ?? []).map(r => fromRow<CorrectiveAction>(r as DataRow));
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
}

export async function deleteCorrectiveAction(id: string): Promise<void> {
  const { error } = await supabase
    .from('corrective_actions')
    .delete()
    .eq('id', id);
  if (error) throw pgErr(error);
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
