import { supabase } from './supabase';
import { parseClauseText } from './clause-parser';
import type {
  AuditPlan, ChecklistItem, ChecklistTemplate, CorrectiveAction, PlanSession,
} from './types';

export function uid(): string {
  return crypto.randomUUID();
}

// ── Row mappers (DB snake_case ↔ TS camelCase) ────────────────────────────────

type Row = Record<string, unknown>;

function toAuditPlan(r: Row): AuditPlan {
  return {
    id:          r.id as string,
    objective:   (r.objective   as string) ?? '',
    standard:    (r.standard    as string) ?? 'ISO27001',
    scope:       (r.scope       as string) ?? '',
    auditAreas:  (r.audit_areas as string) ?? '',
    leadAuditor: (r.lead_auditor as string) ?? '',
    startDate:   (r.start_date  as string) ?? '',
    endDate:     (r.end_date    as string) ?? '',
    status:      (r.status      as string) ?? 'Planned',
    createdAt:   (r.created_at  as string) ?? '',
  } as AuditPlan;
}

function fromAuditPlan(p: AuditPlan) {
  return {
    id: p.id, objective: p.objective, standard: p.standard,
    scope: p.scope, audit_areas: p.auditAreas, lead_auditor: p.leadAuditor,
    start_date: p.startDate, end_date: p.endDate, status: p.status,
    created_at: p.createdAt,
  };
}

function toPlanSession(r: Row): PlanSession {
  const rc = r.related_clauses;
  return {
    id:             r.id as string,
    planId:         (r.plan_id       as string) ?? '',
    day:            (r.day           as number) ?? 1,
    date:           (r.date          as string) ?? '',
    time:           (r.time          as string) ?? '',
    areaOfAudit:    (r.area_of_audit as string) ?? '',
    relatedClauses: typeof rc === 'string'
      ? parseClauseText(rc)
      : (Array.isArray(rc) ? (rc as string[]) : []),
    auditee:     (r.auditee     as string) ?? '',
    mainAuditor: (r.main_auditor as string) ?? '',
    iaTeam:      Array.isArray(r.ia_team) ? (r.ia_team as string[]) : [],
    createdAt:   (r.created_at  as string) ?? '',
  };
}

function fromPlanSession(s: PlanSession) {
  return {
    id: s.id, plan_id: s.planId, day: s.day, date: s.date, time: s.time,
    area_of_audit: s.areaOfAudit, related_clauses: s.relatedClauses,
    auditee: s.auditee, main_auditor: s.mainAuditor, ia_team: s.iaTeam,
    created_at: s.createdAt,
  };
}

function toChecklistItem(r: Row): ChecklistItem {
  return {
    id:             r.id as string,
    sessionId:      (r.session_id   as string) ?? '',
    framework:      (r.framework    as string) ?? 'ISO27001',
    clauseRef:      (r.clause_ref   as string) ?? '',
    clauseTitle:    (r.clause_title as string) ?? '',
    requirement:    (r.requirement  as string) ?? '',
    question:       r.question       as string | undefined,
    status:         (r.status        as string) ?? 'Not Assessed',
    notes:          (r.notes         as string) ?? '',
    evidence:       (r.evidence      as string) ?? '',
    recommendation: r.recommendation as string | undefined,
    dueDate:        r.due_date       as string | undefined,
    itemNumber:     r.item_number    as number | undefined,
    createdAt:      (r.created_at   as string) ?? '',
    updatedAt:      (r.updated_at   as string) ?? '',
  } as ChecklistItem;
}

function fromChecklistItem(i: ChecklistItem) {
  return {
    id: i.id, session_id: i.sessionId, framework: i.framework,
    clause_ref: i.clauseRef, clause_title: i.clauseTitle,
    requirement: i.requirement, question: i.question ?? null,
    status: i.status, notes: i.notes, evidence: i.evidence,
    recommendation: i.recommendation ?? null,
    due_date: i.dueDate ?? null, item_number: i.itemNumber ?? null,
    created_at: i.createdAt, updated_at: i.updatedAt,
  };
}

function toCorrectiveAction(r: Row): CorrectiveAction {
  return {
    id:               r.id as string,
    checklistItemId:  (r.checklist_item_id as string) ?? '',
    sessionId:        (r.session_id   as string) ?? '',
    clauseRef:        (r.clause_ref   as string) ?? '',
    description:      (r.description  as string) ?? '',
    rootCause:        (r.root_cause   as string) ?? '',
    owner:            (r.owner        as string) ?? '',
    dueDate:          (r.due_date     as string) ?? '',
    status:           (r.status       as string) ?? 'Open',
    closureNotes:     (r.closure_notes as string) ?? '',
    createdAt:        (r.created_at   as string) ?? '',
    updatedAt:        (r.updated_at   as string) ?? '',
  } as CorrectiveAction;
}

function fromCorrectiveAction(ca: CorrectiveAction) {
  return {
    id: ca.id, checklist_item_id: ca.checklistItemId,
    session_id: ca.sessionId, clause_ref: ca.clauseRef,
    description: ca.description, root_cause: ca.rootCause,
    owner: ca.owner, due_date: ca.dueDate, status: ca.status,
    closure_notes: ca.closureNotes,
    created_at: ca.createdAt, updated_at: ca.updatedAt,
  };
}

// ── Audit Plans ───────────────────────────────────────────────────────────────

export async function getAuditPlans(): Promise<AuditPlan[]> {
  const { data, error } = await supabase
    .from('audit_plans')
    .select('*')
    .order('created_at');
  if (error) throw error;
  return (data ?? []).map(toAuditPlan);
}

export const getSessions = getAuditPlans;

export async function saveAuditPlan(plan: AuditPlan): Promise<void> {
  const { error } = await supabase
    .from('audit_plans')
    .upsert(fromAuditPlan(plan));
  if (error) throw error;
}

export const saveSession = saveAuditPlan;

export async function deleteAuditPlan(id: string): Promise<void> {
  const sessions = await getPlanSessions(id);
  const allIds = [id, ...sessions.map(s => s.id)];

  await supabase.from('corrective_actions').delete().in('session_id', allIds);
  await supabase.from('checklist_items').delete().in('session_id', allIds);
  await supabase.from('plan_sessions').delete().eq('plan_id', id);
  const { error } = await supabase.from('audit_plans').delete().eq('id', id);
  if (error) throw error;
}

export const deleteSession = deleteAuditPlan;

// ── Plan Sessions ─────────────────────────────────────────────────────────────

export async function getPlanSessions(planId?: string): Promise<PlanSession[]> {
  let q = supabase.from('plan_sessions').select('*').order('day').order('time');
  if (planId) q = q.eq('plan_id', planId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(toPlanSession);
}

export async function savePlanSession(session: PlanSession): Promise<void> {
  const { error } = await supabase
    .from('plan_sessions')
    .upsert(fromPlanSession(session));
  if (error) throw error;
}

export async function deletePlanSession(id: string): Promise<void> {
  const { error } = await supabase
    .from('plan_sessions')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ── Checklist Items ───────────────────────────────────────────────────────────

export async function getChecklistItems(): Promise<ChecklistItem[]> {
  const { data, error } = await supabase
    .from('checklist_items')
    .select('*')
    .order('created_at');
  if (error) throw error;
  return (data ?? []).map(toChecklistItem);
}

export async function getChecklistBySession(sessionId: string): Promise<ChecklistItem[]> {
  const { data, error } = await supabase
    .from('checklist_items')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []).map(toChecklistItem);
}

export async function saveChecklistItem(item: ChecklistItem): Promise<void> {
  const { error } = await supabase
    .from('checklist_items')
    .upsert(fromChecklistItem(item));
  if (error) throw error;
}

export async function bulkSaveChecklistItems(items: ChecklistItem[]): Promise<void> {
  if (items.length === 0) return;
  const { error } = await supabase
    .from('checklist_items')
    .insert(items.map(fromChecklistItem));
  if (error) throw error;
}

export async function deleteChecklistItem(id: string): Promise<void> {
  await supabase.from('corrective_actions').delete().eq('checklist_item_id', id);
  const { error } = await supabase.from('checklist_items').delete().eq('id', id);
  if (error) throw error;
}

// ── Corrective Actions ────────────────────────────────────────────────────────

export async function getCorrectiveActions(): Promise<CorrectiveAction[]> {
  const { data, error } = await supabase
    .from('corrective_actions')
    .select('*')
    .order('created_at');
  if (error) throw error;
  return (data ?? []).map(toCorrectiveAction);
}

export async function getCorrectiveActionsBySession(sessionId: string): Promise<CorrectiveAction[]> {
  const { data, error } = await supabase
    .from('corrective_actions')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []).map(toCorrectiveAction);
}

export async function saveCorrectiveAction(ca: CorrectiveAction): Promise<void> {
  const { error } = await supabase
    .from('corrective_actions')
    .upsert(fromCorrectiveAction(ca));
  if (error) throw error;
}

export async function deleteCorrectiveAction(id: string): Promise<void> {
  const { error } = await supabase
    .from('corrective_actions')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ── Checklist Templates ───────────────────────────────────────────────────────

export async function getChecklistTemplates(): Promise<ChecklistTemplate[]> {
  const { data, error } = await supabase
    .from('checklist_templates')
    .select('*')
    .order('created_at');
  if (error) throw error;
  return (data ?? []).map(r => ({
    id:        r.id as string,
    question:  (r.question  as string) ?? '',
    clauseRef: (r.clause_ref as string) ?? '',
    createdAt: (r.created_at as string) ?? '',
  }));
}

export async function saveChecklistTemplate(t: ChecklistTemplate): Promise<void> {
  const { error } = await supabase
    .from('checklist_templates')
    .upsert({ id: t.id, question: t.question, clause_ref: t.clauseRef, created_at: t.createdAt });
  if (error) throw error;
}

export async function deleteChecklistTemplate(id: string): Promise<void> {
  const { error } = await supabase
    .from('checklist_templates')
    .delete()
    .eq('id', id);
  if (error) throw error;
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

// Backward-compat alias (now requires loaded items as first arg)
export const getSessionProgress = computeSessionProgress;
