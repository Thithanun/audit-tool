'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type { AuditPlan, ChecklistItem, PlanSession, StandardUsed, SessionStatus } from '@/lib/types';
import {
  getAuditPlans,
  saveAuditPlan,
  deleteAuditPlan,
  getPlanSessions,
  savePlanSession,
  deletePlanSession,
  getChecklistBySession,
  computeSessionProgress,
  uid,
} from '@/lib/store';
import { ISMS_CLAUSES, ISO27001_CLAUSES } from '@/lib/seed-data';
import StatusBadge, { SESSION_STATUSES } from '@/components/StatusBadge';
import Modal from '@/components/Modal';

// ── helpers ───────────────────────────────────────────────────────────────────

const STANDARD_OPTIONS: { value: StandardUsed; label: string }[] = [
  { value: 'ISO27001', label: 'ISO 27001:2022' },
  { value: 'NIST_CSF', label: 'NIST CSF 2.0' },
  { value: 'BOTH',     label: 'ISO 27001:2022 + NIST CSF 2.0' },
];

function standardLabel(s: StandardUsed) {
  return STANDARD_OPTIONS.find(o => o.value === s)?.label ?? s;
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function dayDate(startDate: string, day: number): string {
  if (!startDate) return '';
  const d = new Date(startDate + 'T00:00:00');
  d.setDate(d.getDate() + day - 1);
  return d.toISOString().split('T')[0];
}

// ── Clause groups ─────────────────────────────────────────────────────────────

interface ClauseOption { ref: string; title: string }
interface ClauseGroup  { label: string; clauses: ClauseOption[] }

const CLAUSE_GROUPS: ClauseGroup[] = [
  { label: 'ISMS Requirements (Clause 4–10)', clauses: ISMS_CLAUSES.map(c => ({ ref: c.clauseRef, title: c.clauseTitle })) },
  { label: 'Annex A – Organizational Controls (A.5)', clauses: ISO27001_CLAUSES.filter(c => c.clauseRef.startsWith('A.5.')).map(c => ({ ref: c.clauseRef, title: c.clauseTitle })) },
  { label: 'Annex A – People Controls (A.6)',         clauses: ISO27001_CLAUSES.filter(c => c.clauseRef.startsWith('A.6.')).map(c => ({ ref: c.clauseRef, title: c.clauseTitle })) },
  { label: 'Annex A – Physical Controls (A.7)',       clauses: ISO27001_CLAUSES.filter(c => c.clauseRef.startsWith('A.7.')).map(c => ({ ref: c.clauseRef, title: c.clauseTitle })) },
  { label: 'Annex A – Technological Controls (A.8)', clauses: ISO27001_CLAUSES.filter(c => c.clauseRef.startsWith('A.8.')).map(c => ({ ref: c.clauseRef, title: c.clauseTitle })) },
];

function emptySession(planId: string, nextDay = 1, date = ''): Omit<PlanSession, 'id' | 'createdAt'> {
  return { planId, day: nextDay, date, time: '', areaOfAudit: '', relatedClauses: [], auditee: '', mainAuditor: '', iaTeam: [] };
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// ── component ─────────────────────────────────────────────────────────────────

export default function PlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [plan, setPlan] = useState<AuditPlan | null>(null);
  const [sessions, setSessions] = useState<PlanSession[]>([]);
  const [planItems, setPlanItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [editModal, setEditModal] = useState(false);
  const [planForm, setPlanForm] = useState<Omit<AuditPlan, 'id' | 'createdAt'> | null>(null);

  const [sessionModal, setSessionModal] = useState(false);
  const [editSession, setEditSession] = useState<PlanSession | null>(null);
  const [sessionForm, setSessionForm] = useState<Omit<PlanSession, 'id' | 'createdAt'>>(emptySession(''));
  const [iaInput, setIaInput] = useState('');

  const [deletePlanConfirm, setDeletePlanConfirm] = useState(false);
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setDbError(null);
    try {
      const [all, ss, items] = await Promise.all([
        getAuditPlans(),
        getPlanSessions(id),
        getChecklistBySession(id),
      ]);
      const found = all.find(p => p.id === id);
      if (!found) { setNotFound(true); return; }
      setPlan(found);
      setSessions(ss.sort((a, b) => a.day - b.day || a.time.localeCompare(b.time)));
      setPlanItems(items);
    } catch (e) {
      setDbError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { reload(); }, [reload]);

  // ── plan edit ────────────────────────────────────────────────────────────────

  function openEditPlan() {
    if (!plan) return;
    setPlanForm({
      objective: plan.objective, standard: plan.standard, scope: plan.scope,
      auditAreas: plan.auditAreas, leadAuditor: plan.leadAuditor,
      startDate: plan.startDate, endDate: plan.endDate, status: plan.status,
    });
    setEditModal(true);
  }

  async function handlePlanSave(e: React.FormEvent) {
    e.preventDefault();
    if (!plan || !planForm) return;
    try {
      await saveAuditPlan({ ...plan, ...planForm });
      setEditModal(false);
      await reload();
    } catch (err) {
      alert('Save failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function handleDeletePlan() {
    if (!plan) return;
    try {
      await deleteAuditPlan(plan.id);
      router.push('/audit-plan');
    } catch (err) {
      alert('Delete failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  // ── session CRUD ─────────────────────────────────────────────────────────────

  function openAddSession() {
    if (!plan) return;
    const nextDay = sessions.length > 0 ? Math.max(...sessions.map(s => s.day)) + 1 : 1;
    setEditSession(null);
    setSessionForm(emptySession(plan.id, nextDay, dayDate(plan.startDate, nextDay)));
    setIaInput('');
    setSessionModal(true);
  }

  function openEditSession(s: PlanSession) {
    setEditSession(s);
    setSessionForm({
      planId: s.planId, day: s.day, date: s.date, time: s.time,
      areaOfAudit: s.areaOfAudit, relatedClauses: s.relatedClauses,
      auditee: s.auditee, mainAuditor: s.mainAuditor, iaTeam: [...s.iaTeam],
    });
    setIaInput('');
    setSessionModal(true);
  }

  function toggleClause(ref: string) {
    setSessionForm(f => ({
      ...f,
      relatedClauses: f.relatedClauses.includes(ref)
        ? f.relatedClauses.filter(r => r !== ref)
        : [...f.relatedClauses, ref],
    }));
  }

  function selectAllGroup(refs: string[]) {
    setSessionForm(f => ({ ...f, relatedClauses: [...new Set([...f.relatedClauses, ...refs])] }));
  }

  function clearGroup(refs: string[]) {
    const s = new Set(refs);
    setSessionForm(f => ({ ...f, relatedClauses: f.relatedClauses.filter(r => !s.has(r)) }));
  }

  async function handleSessionSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      const now = new Date().toISOString();
      await savePlanSession(editSession
        ? { ...editSession, ...sessionForm }
        : { id: uid(), createdAt: now, ...sessionForm },
      );
      setSessionModal(false);
      await reload();
    } catch (err) {
      alert('Save failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function handleDeleteSession(sid: string) {
    try {
      await deletePlanSession(sid);
      setDeleteSessionId(null);
      await reload();
    } catch (err) {
      alert('Delete failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  // ── group by day ─────────────────────────────────────────────────────────────

  const byDay: Record<number, PlanSession[]> = {};
  for (const s of sessions) {
    if (!byDay[s.day]) byDay[s.day] = [];
    byDay[s.day].push(s);
  }
  const sortedDays = Object.keys(byDay).map(Number).sort((a, b) => a - b);

  // ── render ────────────────────────────────────────────────────────────────────

  if (loading) return <Spinner />;

  if (dbError) return (
    <div className="text-center py-16 bg-red-50 rounded-xl border border-red-200 mx-4 mt-8">
      <p className="text-red-600 font-medium mb-1">Unable to connect to database</p>
      <p className="text-sm text-red-500 mb-4">{dbError}</p>
      <button onClick={reload} className="text-sm text-blue-600 hover:underline">Try again</button>
    </div>
  );

  if (notFound) return (
    <div className="max-w-2xl mx-auto px-4 py-20 text-center">
      <p className="text-slate-500 mb-4">Audit plan not found.</p>
      <Link href="/audit-plan" className="text-blue-600 hover:underline text-sm">← Back to Audit Plans</Link>
    </div>
  );

  if (!plan) return null;

  const prog = computeSessionProgress(planItems, plan.id);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

      {/* Breadcrumb + actions */}
      <div className="flex items-center justify-between mb-6">
        <Link href="/audit-plan" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Audit Plans
        </Link>
        <div className="flex gap-2">
          <button onClick={openEditPlan}
            className="text-sm border border-slate-300 text-slate-700 px-4 py-1.5 rounded-lg hover:bg-slate-50 transition-colors font-medium">
            Edit Plan
          </button>
          <button onClick={() => setDeletePlanConfirm(true)}
            className="text-sm border border-red-200 text-red-600 px-4 py-1.5 rounded-lg hover:bg-red-50 transition-colors font-medium">
            Delete Plan
          </button>
        </div>
      </div>

      {/* Plan header */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <h1 className="text-xl font-bold text-slate-900 leading-snug flex-1">
            {plan.objective || <span className="text-slate-400 italic font-normal">No objective</span>}
          </h1>
          <StatusBadge status={plan.status} type="session" />
        </div>

        <div className="flex flex-wrap gap-2 mb-5">
          <span className="text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 rounded-full">
            {standardLabel(plan.standard)}
          </span>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          {plan.scope && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Scope of Audit</dt>
              <dd className="text-slate-700">{plan.scope}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Lead Auditor</dt>
            <dd className="text-slate-700">{plan.leadAuditor || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Audit Areas</dt>
            <dd className="text-slate-700">{plan.auditAreas || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Start Date</dt>
            <dd className="text-slate-700">{fmtDate(plan.startDate)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">End Date</dt>
            <dd className="text-slate-700">{fmtDate(plan.endDate)}</dd>
          </div>
        </dl>

        {prog.total > 0 && (
          <div className="mt-5 pt-4 border-t border-slate-100">
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>Checklist progress</span>
              <span>{prog.assessed} / {prog.total} assessed ({prog.pct}%)</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2">
              <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${prog.pct}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Sessions section */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">
            Sessions
            {sessions.length > 0 && <span className="ml-2 text-xs font-normal text-slate-400">({sessions.length})</span>}
          </h2>
          <button onClick={openAddSession}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Session
          </button>
        </div>

        {sessions.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">
            No sessions scheduled yet —{' '}
            <button onClick={openAddSession} className="text-blue-600 hover:underline">add the first one</button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2.5 w-32">Time</th>
                <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2.5">Area of Audit</th>
                <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2.5 w-36">Auditee</th>
                <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2.5 w-44">Auditor</th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody>
              {sortedDays.map(day => (
                <React.Fragment key={`day-${day}`}>
                  <tr className="bg-blue-50 border-t border-blue-100">
                    <td colSpan={5} className="px-4 py-2">
                      <span className="text-xs font-semibold text-blue-700">
                        Day {day}{byDay[day][0]?.date && ` · ${fmtDate(byDay[day][0].date)}`}
                      </span>
                    </td>
                  </tr>
                  {byDay[day].map(s => (
                    <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50 transition-colors group">
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 whitespace-nowrap">{s.time || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="text-slate-800 font-medium">{s.areaOfAudit || '—'}</div>
                        {s.relatedClauses.length > 0 && (
                          <div className="text-xs text-slate-400 mt-0.5">Clauses: {s.relatedClauses.join(', ')}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{s.auditee || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="text-slate-700">{s.mainAuditor || '—'}</div>
                        {s.iaTeam.length > 0 && (
                          <div className="text-xs text-slate-400 mt-0.5">IA: {s.iaTeam.join(', ')}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => openEditSession(s)}
                            className="text-xs text-slate-500 hover:text-blue-600 font-medium transition-colors">Edit</button>
                          <button onClick={() => setDeleteSessionId(s.id)}
                            className="text-xs text-slate-400 hover:text-red-500 transition-colors">✕</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit Plan Modal */}
      <Modal open={editModal} onClose={() => setEditModal(false)} title="Edit Audit Plan" size="lg">
        {planForm && (
          <form onSubmit={handlePlanSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                วัตถุประสงค์การตรวจประเมิน (Objective) <span className="text-red-500">*</span>
              </label>
              <textarea className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                rows={3} required value={planForm.objective}
                onChange={e => setPlanForm(f => f ? { ...f, objective: e.target.value } : f)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">มาตรฐานที่ใช้ (Standard Used)</label>
              <select className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={planForm.standard} disabled>
                {STANDARD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">ขอบเขตที่ตรวจประเมิน (Scope of Audit)</label>
              <textarea className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                rows={3} value={planForm.scope}
                onChange={e => setPlanForm(f => f ? { ...f, scope: e.target.value } : f)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">วันที่เริ่มตรวจ (Start Date)</label>
                <input type="date" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={planForm.startDate} onChange={e => setPlanForm(f => f ? { ...f, startDate: e.target.value } : f)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">วันที่สิ้นสุด (End Date)</label>
                <input type="date" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={planForm.endDate} onChange={e => setPlanForm(f => f ? { ...f, endDate: e.target.value } : f)} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">สถานที่ตรวจประเมิน (Audit Areas)</label>
              <input className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={planForm.auditAreas} onChange={e => setPlanForm(f => f ? { ...f, auditAreas: e.target.value } : f)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">หัวหน้าผู้ตรวจประเมิน (Lead Auditor)</label>
              <input className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={planForm.leadAuditor} onChange={e => setPlanForm(f => f ? { ...f, leadAuditor: e.target.value } : f)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
              <select className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={planForm.status} onChange={e => setPlanForm(f => f ? { ...f, status: e.target.value as SessionStatus } : f)}>
                {SESSION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setEditModal(false)}
                className="flex-1 border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">Cancel</button>
              <button type="submit"
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition-colors">Save Changes</button>
            </div>
          </form>
        )}
      </Modal>

      {/* Add / Edit Session Modal */}
      <Modal open={sessionModal} onClose={() => setSessionModal(false)}
        title={editSession ? 'Edit Session' : 'Add Session'} size="xl">
        <form onSubmit={handleSessionSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Day</label>
              <input type="number" min={1}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={sessionForm.day}
                onChange={e => setSessionForm(f => ({ ...f, day: Number(e.target.value), date: plan ? dayDate(plan.startDate, Number(e.target.value)) : '' }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
              <input type="date"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={sessionForm.date}
                onChange={e => setSessionForm(f => ({ ...f, date: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Time</label>
            <input className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., 09:00-10:00" value={sessionForm.time}
              onChange={e => setSessionForm(f => ({ ...f, time: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Area of Audit</label>
            <input className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., IT Infrastructure" value={sessionForm.areaOfAudit}
              onChange={e => setSessionForm(f => ({ ...f, areaOfAudit: e.target.value }))} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-slate-700">Clause ที่เกี่ยวข้อง (Related Clauses)</label>
              {sessionForm.relatedClauses.length > 0 && (
                <span className="text-xs text-blue-600 font-medium">{sessionForm.relatedClauses.length} selected</span>
              )}
            </div>
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-64 overflow-y-auto bg-slate-50">
              {CLAUSE_GROUPS.map(group => {
                const groupRefs = group.clauses.map(c => c.ref);
                return (
                  <div key={group.label} className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{group.label}</span>
                      <div className="flex gap-3">
                        <button type="button" onClick={() => selectAllGroup(groupRefs)}
                          className="text-xs text-blue-600 hover:text-blue-700 font-medium">Select all</button>
                        <button type="button" onClick={() => clearGroup(groupRefs)}
                          className="text-xs text-slate-400 hover:text-slate-600">Clear</button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      {group.clauses.map(c => (
                        <label key={c.ref} className="flex items-start gap-1.5 cursor-pointer hover:bg-white rounded px-1 py-0.5 transition-colors">
                          <input type="checkbox"
                            className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
                            checked={sessionForm.relatedClauses.includes(c.ref)}
                            onChange={() => toggleClause(c.ref)} />
                          <span className="text-xs leading-tight">
                            <span className="font-mono font-semibold text-slate-700">{c.ref}</span>{' '}
                            <span className="text-slate-500">{c.title}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Auditee</label>
              <input className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., IT Department" value={sessionForm.auditee}
                onChange={e => setSessionForm(f => ({ ...f, auditee: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Main Auditor</label>
              <input className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., John Doe" value={sessionForm.mainAuditor}
                onChange={e => setSessionForm(f => ({ ...f, mainAuditor: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">IA Team</label>
            {sessionForm.iaTeam.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {sessionForm.iaTeam.map((m, i) => (
                  <span key={i} className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 text-xs px-2.5 py-1 rounded-full">
                    {m}
                    <button type="button"
                      onClick={() => setSessionForm(f => ({ ...f, iaTeam: f.iaTeam.filter((_, idx) => idx !== i) }))}
                      className="text-slate-400 hover:text-red-500 transition-colors">×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Add team member name..." value={iaInput}
                onChange={e => setIaInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const n = iaInput.trim();
                    if (n) { setSessionForm(f => ({ ...f, iaTeam: [...f.iaTeam, n] })); setIaInput(''); }
                  }
                }} />
              <button type="button"
                onClick={() => { const n = iaInput.trim(); if (n) { setSessionForm(f => ({ ...f, iaTeam: [...f.iaTeam, n] })); setIaInput(''); } }}
                className="px-3 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm hover:bg-slate-50 transition-colors">
                Add
              </button>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setSessionModal(false)}
              className="flex-1 border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">Cancel</button>
            <button type="submit"
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition-colors">
              {editSession ? 'Save Changes' : 'Add Session'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Plan Confirm */}
      <Modal open={deletePlanConfirm} onClose={() => setDeletePlanConfirm(false)} title="Delete Audit Plan" size="md">
        <p className="text-slate-600 text-sm mb-4">
          Are you sure? All checklist items, corrective actions, and sessions in this plan will be permanently removed.
        </p>
        <div className="flex gap-3">
          <button onClick={() => setDeletePlanConfirm(false)}
            className="flex-1 border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">Cancel</button>
          <button onClick={handleDeletePlan}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg text-sm font-medium transition-colors">Delete</button>
        </div>
      </Modal>

      {/* Delete Session Confirm */}
      <Modal open={!!deleteSessionId} onClose={() => setDeleteSessionId(null)} title="Delete Session" size="md">
        <p className="text-slate-600 text-sm mb-4">Delete this session?</p>
        <div className="flex gap-3">
          <button onClick={() => setDeleteSessionId(null)}
            className="flex-1 border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">Cancel</button>
          <button onClick={() => { if (deleteSessionId) handleDeleteSession(deleteSessionId); }}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg text-sm font-medium transition-colors">Delete</button>
        </div>
      </Modal>
    </div>
  );
}
