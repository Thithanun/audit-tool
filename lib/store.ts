import type { AuditPlan, ChecklistItem, ChecklistTemplate, CorrectiveAction, PlanSession } from './types';
import { parseClauseText } from './clause-parser';

const KEYS = {
  sessions: 'audit_sessions',
  checklist: 'audit_checklist',
  corrective: 'audit_corrective_actions',
  planSessions: 'audit_plan_sessions',
  templates: 'audit_checklist_templates',
} as const;

function load<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as T[];
  } catch {
    return [];
  }
}

function save<T>(key: string, data: T[]): void {
  localStorage.setItem(key, JSON.stringify(data));
}

export function uid(): string {
  return crypto.randomUUID();
}

// ── Audit Plans (was AuditSession) ──────────────────────────────────────────

export function getAuditPlans(): AuditPlan[] {
  return load<AuditPlan>(KEYS.sessions);
}

// Backward-compat alias
export const getSessions = getAuditPlans;

export function saveAuditPlan(plan: AuditPlan): void {
  const all = getAuditPlans();
  const idx = all.findIndex(s => s.id === plan.id);
  if (idx >= 0) all[idx] = plan;
  else all.push(plan);
  save(KEYS.sessions, all);
}

export const saveSession = saveAuditPlan;

export function deleteAuditPlan(id: string): void {
  save(KEYS.sessions, getAuditPlans().filter(s => s.id !== id));
  save(KEYS.checklist, getChecklistItems().filter(c => c.sessionId !== id));
  save(KEYS.corrective, getCorrectiveActions().filter(ca => ca.sessionId !== id));
  save(KEYS.planSessions, getPlanSessions().filter(ps => ps.planId !== id));
}

export const deleteSession = deleteAuditPlan;

// ── Plan Sessions (scheduling within a plan) ─────────────────────────────────

function migratePlanSession(raw: Record<string, unknown>): PlanSession {
  const rc = raw.relatedClauses;
  return {
    ...(raw as unknown as PlanSession),
    relatedClauses: typeof rc === 'string'
      ? parseClauseText(rc)
      : (Array.isArray(rc) ? (rc as string[]) : []),
  };
}

export function getPlanSessions(planId?: string): PlanSession[] {
  const all = load<Record<string, unknown>>(KEYS.planSessions).map(migratePlanSession);
  return planId ? all.filter(ps => ps.planId === planId) : all;
}

export function savePlanSession(session: PlanSession): void {
  const all = load<PlanSession>(KEYS.planSessions);
  const idx = all.findIndex(ps => ps.id === session.id);
  if (idx >= 0) all[idx] = session;
  else all.push(session);
  save(KEYS.planSessions, all);
}

export function deletePlanSession(id: string): void {
  save(KEYS.planSessions, load<PlanSession>(KEYS.planSessions).filter(ps => ps.id !== id));
}

// ── Checklist ────────────────────────────────────────────────────────────────

export function getChecklistItems(): ChecklistItem[] {
  return load<ChecklistItem>(KEYS.checklist);
}

export function getChecklistBySession(sessionId: string): ChecklistItem[] {
  return getChecklistItems().filter(c => c.sessionId === sessionId);
}

export function saveChecklistItem(item: ChecklistItem): void {
  const all = getChecklistItems();
  const idx = all.findIndex(c => c.id === item.id);
  if (idx >= 0) all[idx] = item;
  else all.push(item);
  save(KEYS.checklist, all);
}

export function deleteChecklistItem(id: string): void {
  save(KEYS.checklist, getChecklistItems().filter(c => c.id !== id));
  save(KEYS.corrective, getCorrectiveActions().filter(ca => ca.checklistItemId !== id));
}

// ── Corrective Actions ────────────────────────────────────────────────────────

export function getCorrectiveActions(): CorrectiveAction[] {
  return load<CorrectiveAction>(KEYS.corrective);
}

export function getCorrectiveActionsBySession(sessionId: string): CorrectiveAction[] {
  return getCorrectiveActions().filter(ca => ca.sessionId === sessionId);
}

export function saveCorrectiveAction(ca: CorrectiveAction): void {
  const all = getCorrectiveActions();
  const idx = all.findIndex(c => c.id === ca.id);
  if (idx >= 0) all[idx] = ca;
  else all.push(ca);
  save(KEYS.corrective, all);
}

export function deleteCorrectiveAction(id: string): void {
  save(KEYS.corrective, getCorrectiveActions().filter(ca => ca.id !== id));
}

// ── Checklist Templates ───────────────────────────────────────────────────────

export function getChecklistTemplates(): ChecklistTemplate[] {
  return load<ChecklistTemplate>(KEYS.templates);
}

export function saveChecklistTemplate(t: ChecklistTemplate): void {
  const all = getChecklistTemplates();
  const idx = all.findIndex(x => x.id === t.id);
  if (idx >= 0) all[idx] = t;
  else all.push(t);
  save(KEYS.templates, all);
}

export function deleteChecklistTemplate(id: string): void {
  save(KEYS.templates, getChecklistTemplates().filter(t => t.id !== id));
}

// ── Utilities ────────────────────────────────────────────────────────────────

export function getSessionProgress(sessionId: string): { total: number; assessed: number; pct: number } {
  const items = getChecklistBySession(sessionId);
  const assessed = items.filter(i => i.status !== 'Not Assessed').length;
  return {
    total: items.length,
    assessed,
    pct: items.length === 0 ? 0 : Math.round((assessed / items.length) * 100),
  };
}
