'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { AuditPlan, ChecklistItem, CorrectiveAction, CorrectiveActionStatus, FindingStatus, PlanSession } from '@/lib/types';
import {
  getAuditPlans,
  getChecklistItems,
  getCorrectiveActions,
  getPlanSessions,
  saveCorrectiveAction,
  deleteCorrectiveAction,
  uid,
} from '@/lib/store';
import StatusBadge, { FINDING_STATUSES } from '@/components/StatusBadge';
import Modal from '@/components/Modal';
import { useAuth } from '@/contexts/AuthContext';
import PageLoader, { DbError } from '@/components/PageLoader';

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<FindingStatus, string> = {
  'Not Assessed': 'bg-slate-200',
  'Conformity':   'bg-green-500',
  'OBS':          'bg-blue-400',
  'OFI':          'bg-amber-400',
  'NC-Minor':     'bg-orange-500',
  'NC-Major':     'bg-red-600',
};

const STATUS_TEXT: Record<FindingStatus, string> = {
  'Not Assessed': 'text-slate-600',
  'Conformity':   'text-green-700',
  'OBS':          'text-blue-700',
  'OFI':          'text-amber-700',
  'NC-Minor':     'text-orange-700',
  'NC-Major':     'text-red-700',
};

// ── NCR constants ─────────────────────────────────────────────────────────────

const NCR_TYPES = ['NC-Major', 'NC-Minor', 'OBS', 'OFI'] as const;
type NcrType = typeof NCR_TYPES[number];

const NCR_TYPE_LABEL: Record<NcrType, string> = {
  'NC-Major': 'Major NC',
  'NC-Minor': 'Minor NC',
  'OBS':      'Observation',
  'OFI':      'OFI',
};

const NCR_TYPE_BADGE: Record<NcrType, string> = {
  'NC-Major': 'bg-red-100 text-red-700 border border-red-200',
  'NC-Minor': 'bg-orange-100 text-orange-700 border border-orange-200',
  'OBS':      'bg-blue-100 text-blue-700 border border-blue-200',
  'OFI':      'bg-amber-100 text-amber-700 border border-amber-200',
};

const NCR_STATUS_LABEL: Record<CorrectiveActionStatus, string> = {
  'Open':        'รอแผนแก้ไข',
  'In Progress': 'ส่งแผนแล้ว',
  'Closed':      'อนุมัติแล้ว',
  'Overdue':     'เกินกำหนด',
};

const NCR_STATUS_BADGE: Record<CorrectiveActionStatus, string> = {
  'Open':        'bg-amber-50 text-amber-800 border border-amber-200',
  'In Progress': 'bg-blue-50 text-blue-800 border border-blue-200',
  'Closed':      'bg-green-50 text-green-800 border border-green-200',
  'Overdue':     'bg-red-50 text-red-800 border border-red-200',
};

// ── NCR Modal context type ────────────────────────────────────────────────────

type NcrModalCtx =
  | { mode: 'create' }
  | { mode: 'edit'; ncr: CorrectiveAction };

// ── Blank form ────────────────────────────────────────────────────────────────

const BLANK: Partial<CorrectiveAction> = {
  ncrType: 'NC-Minor',
  clauseRef: '',
  description: '',
  impact: '',
  recommendation: '',
  rootCause: '',
  correctiveAction: '',
  preventiveAction: '',
  dueDate: '',
  owner: '',
  closureNotes: '',
};

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { canEditDashboard: canEdit } = useAuth();

  // ── State ─────────────────────────────────────────────────────────────────

  const [plans, setPlans]               = useState<AuditPlan[]>([]);
  const [sessions, setSessions]         = useState<PlanSession[]>([]);
  const [items, setItems]               = useState<ChecklistItem[]>([]);
  const [cas, setCas]                   = useState<CorrectiveAction[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('all');

  const [ncrModal, setNcrModal]         = useState<NcrModalCtx | null>(null);
  const [ncrForm, setNcrForm]           = useState<Partial<CorrectiveAction>>(BLANK);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [ncrSaving, setNcrSaving]       = useState(false);

  const [loading, setLoading]           = useState(false);
  const [dbError, setDbError]           = useState<string | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────

  const reload = useCallback(async () => {
    setLoading(true);
    setDbError(null);
    try {
      const [ps, sess, is, actions] = await Promise.all([
        getAuditPlans(),
        getPlanSessions(),   // all sessions — needed to resolve sessionId → planId
        getChecklistItems(),
        getCorrectiveActions(),
      ]);
      setPlans(ps);
      setSessions(sess);
      setItems(is);
      setCas(actions);
    } catch (e) {
      setDbError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // ── Derived ───────────────────────────────────────────────────────────────

  // Map planId → Set of plan_sessions.id that belong to it.
  // ChecklistItem.sessionId may be either audit_plans.id (when saved with no sub-session
  // selected) or plan_sessions.id (when a specific day/slot was selected in Checklist page).
  // Both cases must be covered when filtering by plan.
  const planSessionIdSet = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const s of sessions) {
      if (!map.has(s.planId)) map.set(s.planId, new Set());
      map.get(s.planId)!.add(s.id);
    }
    return map;
  }, [sessions]);

  const filteredItems = useMemo(() => {
    if (selectedPlanId === 'all') return items;
    const sids = planSessionIdSet.get(selectedPlanId) ?? new Set<string>();
    return items.filter(i => i.sessionId === selectedPlanId || sids.has(i.sessionId));
  }, [items, selectedPlanId, planSessionIdSet]);

  // NCRs = CorrectiveActions that have ncrType defined (created from NCR panel)
  const filteredNcrs = useMemo(() => {
    const ncrs = cas.filter(ca => ca.ncrType !== undefined);
    if (selectedPlanId === 'all') return ncrs;
    return ncrs.filter(ca => ca.sessionId === selectedPlanId);
  }, [cas, selectedPlanId]);

  const statusCounts = useMemo(() => {
    const c = Object.fromEntries(FINDING_STATUSES.map(s => [s, 0])) as Record<FindingStatus, number>;
    for (const i of filteredItems) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [filteredItems]);

  const total = filteredItems.length;
  const pct   = (n: number) => total === 0 ? 0 : Math.round((n / total) * 100);

  const ncrTypeCounts = useMemo(() => {
    const c: Record<string, number> = { 'NC-Major': 0, 'NC-Minor': 0, 'OBS': 0, 'OFI': 0 };
    for (const ncr of filteredNcrs) if (ncr.ncrType) c[ncr.ncrType]++;
    return c;
  }, [filteredNcrs]);

  const ncrStatusCounts = useMemo(() => {
    const c: Record<CorrectiveActionStatus, number> = { Open: 0, 'In Progress': 0, Closed: 0, Overdue: 0 };
    for (const ncr of filteredNcrs) c[ncr.status]++;
    return c;
  }, [filteredNcrs]);

  // ── NCR handlers ─────────────────────────────────────────────────────────

  function openCreate() {
    setNcrForm({ ...BLANK });
    setNcrModal({ mode: 'create' });
  }

  function openEdit(ncr: CorrectiveAction) {
    setNcrForm({ ...ncr });
    setNcrModal({ mode: 'edit', ncr });
  }

  async function handleSave(action: 'save' | 'submit' | 'approve') {
    const now = new Date().toISOString();
    setNcrSaving(true);
    try {
      let record: CorrectiveAction;

      if (ncrModal?.mode === 'create') {
        record = {
          id: uid(),
          checklistItemId: '',
          sessionId: selectedPlanId,          // link NCR to the selected plan
          clauseRef:        ncrForm.clauseRef ?? '',
          description:      ncrForm.description ?? '',
          rootCause:        ncrForm.rootCause ?? '',
          owner:            ncrForm.owner ?? '',
          dueDate:          ncrForm.dueDate ?? '',
          status:           'Open',
          closureNotes:     '',
          createdAt:        now,
          updatedAt:        now,
          ncrType:          ncrForm.ncrType,
          impact:           ncrForm.impact,
          recommendation:   ncrForm.recommendation,
          correctiveAction: ncrForm.correctiveAction,
          preventiveAction: ncrForm.preventiveAction,
        };
      } else {
        const base = (ncrModal as { mode: 'edit'; ncr: CorrectiveAction }).ncr;
        let status: CorrectiveActionStatus = base.status;
        if (action === 'submit')  status = 'In Progress';
        if (action === 'approve') status = 'Closed';
        record = { ...base, ...ncrForm, status, updatedAt: now };
      }

      await saveCorrectiveAction(record);
      setNcrModal(null);
      await reload();
    } catch (err) {
      alert('บันทึกไม่สำเร็จ: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setNcrSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    try {
      await deleteCorrectiveAction(deleteConfirm);
      setDeleteConfirm(null);
      await reload();
    } catch (err) {
      alert('ลบไม่สำเร็จ: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  // ── Guard ─────────────────────────────────────────────────────────────────

  if (loading) return <PageLoader message="กำลังโหลด Dashboard…" />;
  if (dbError)  return <DbError message={dbError} onRetry={reload} />;

  // ── Modal context (safe after early returns) ──────────────────────────────

  const editNcr      = ncrModal?.mode === 'edit' ? ncrModal.ncr : null;
  // Viewer can fill auditee plan only when NCR is still Open
  const isAuditeeMode = !canEdit && editNcr?.status === 'Open';
  // Auditor can approve when NCR has been submitted
  const canApprove    = canEdit && editNcr?.status === 'In Progress';
  // Viewer browsing a closed/submitted NCR — read-only
  const isViewOnly    = !canEdit && editNcr !== null && editNcr.status !== 'Open';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">Findings summary and NCR management</p>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 mr-2">Audit Plan</label>
          <select
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={selectedPlanId}
            onChange={e => setSelectedPlanId(e.target.value)}
          >
            <option value="all">All Plans</option>
            {plans.map(p => <option key={p.id} value={p.id}>{p.objective}</option>)}
          </select>
        </div>
      </div>

      {/* ── Summary Cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500 mb-1">Total Controls</p>
          <p className="text-3xl font-bold text-slate-900">{total}</p>
          <p className="text-xs text-slate-400 mt-1">{statusCounts['Not Assessed']} not assessed</p>
        </div>
        <div className="bg-green-50 rounded-xl border border-green-200 p-4">
          <p className="text-xs font-medium text-green-600 mb-1">Conformity</p>
          <p className="text-3xl font-bold text-green-700">{statusCounts['Conformity']}</p>
          <p className="text-xs text-green-500 mt-1">{pct(statusCounts['Conformity'])}% of total</p>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-200 p-4">
          <p className="text-xs font-medium text-red-600 mb-1">NC Major</p>
          <p className="text-3xl font-bold text-red-700">{statusCounts['NC-Major']}</p>
          <p className="text-xs text-red-500 mt-1">{pct(statusCounts['NC-Major'])}% of total</p>
        </div>
        <div className="bg-orange-50 rounded-xl border border-orange-200 p-4">
          <p className="text-xs font-medium text-orange-600 mb-1">NC Minor</p>
          <p className="text-3xl font-bold text-orange-700">{statusCounts['NC-Minor']}</p>
          <p className="text-xs text-orange-500 mt-1">{pct(statusCounts['NC-Minor'])}% of total</p>
        </div>
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
          <p className="text-xs font-medium text-blue-600 mb-1">OBS</p>
          <p className="text-3xl font-bold text-blue-700">{statusCounts['OBS']}</p>
          <p className="text-xs text-blue-500 mt-1">{pct(statusCounts['OBS'])}% of total</p>
        </div>
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
          <p className="text-xs font-medium text-amber-600 mb-1">OFI</p>
          <p className="text-3xl font-bold text-amber-700">{ncrTypeCounts['OFI'] ?? 0}</p>
          <p className="text-xs text-amber-500 mt-1">NCR Management</p>
        </div>
      </div>

      {/* ── 3-col charts ──────────────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-6 mb-6">

        {/* Status Distribution */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Status Distribution</h2>
          {total === 0 ? (
            <p className="text-slate-400 text-sm text-center py-8">No data</p>
          ) : (
            <div className="space-y-3">
              {FINDING_STATUSES.filter(s => s !== 'Not Assessed').map(s => {
                const count = statusCounts[s];
                const p = total === 0 ? 0 : Math.round((count / total) * 100);
                return (
                  <div key={s}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className={`font-medium ${STATUS_TEXT[s]}`}>{s}</span>
                      <span className="text-slate-500">{count} ({p}%)</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${STATUS_COLORS[s]}`}
                        style={{ width: `${p}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              <div className="pt-2 border-t border-slate-100">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Not Assessed</span>
                  <span className="text-slate-500">{statusCounts['Not Assessed']}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Session Progress */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Session Progress</h2>
          {plans.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-8">No plans</p>
          ) : (
            <div className="space-y-3">
              {plans.map(p => {
                const sids = planSessionIdSet.get(p.id) ?? new Set<string>();
                const relevant = items.filter(i => i.sessionId === p.id || sids.has(i.sessionId));
                const assessed = relevant.filter(i => i.status !== 'Not Assessed').length;
                const pct = relevant.length === 0 ? 0 : Math.round((assessed / relevant.length) * 100);
                return (
                  <div key={p.id}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium text-slate-700 truncate max-w-[140px]">{p.objective}</span>
                      <span className="text-slate-500 flex-shrink-0">{pct}%</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1">
                      <StatusBadge status={p.status} type="session" size="sm" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* NCR Summary */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">NCR Summary</h2>
          {filteredNcrs.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-8">ยังไม่มี NCR</p>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">ตามประเภท</p>
                {NCR_TYPES.map(t => (
                  <div key={t} className="flex items-center justify-between">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${NCR_TYPE_BADGE[t]}`}>
                      {NCR_TYPE_LABEL[t]}
                    </span>
                    <span className="text-sm font-semibold text-slate-700">{ncrTypeCounts[t] ?? 0}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-100 pt-3 space-y-2">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">ตามสถานะ</p>
                {(['Open', 'In Progress', 'Closed'] as CorrectiveActionStatus[]).map(s => (
                  <div key={s} className="flex items-center justify-between">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${NCR_STATUS_BADGE[s]}`}>
                      {NCR_STATUS_LABEL[s]}
                    </span>
                    <span className="text-sm font-semibold text-slate-700">{ncrStatusCounts[s] ?? 0}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── NCR Management ────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">

        {/* Toolbar */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-700">NCR Management</h2>
            {filteredNcrs.length > 0 && (
              <span className="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full font-medium">
                {filteredNcrs.length}
              </span>
            )}
          </div>
          {canEdit && selectedPlanId !== 'all' && (
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              สร้าง NCR
            </button>
          )}
        </div>

        {/* Empty state */}
        {filteredNcrs.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">
            {selectedPlanId === 'all'
              ? 'เลือก Audit Plan เพื่อดูและจัดการ NCR'
              : 'ยังไม่มี NCR ใน Audit Plan นี้'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left">
                  <th className="text-xs font-medium text-slate-500 pb-3 pr-3 w-8">#</th>
                  <th className="text-xs font-medium text-slate-500 pb-3 pr-3 w-28">ประเภท</th>
                  <th className="text-xs font-medium text-slate-500 pb-3 pr-3 w-28">ข้อกำหนด ISO</th>
                  <th className="text-xs font-medium text-slate-500 pb-3 pr-3">รายละเอียด</th>
                  <th className="text-xs font-medium text-slate-500 pb-3 pr-3 w-32">สถานะ</th>
                  <th className="text-xs font-medium text-slate-500 pb-3 w-28 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredNcrs.map((ncr, idx) => (
                  <tr key={ncr.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                    <td className="py-3 pr-3 text-xs text-slate-400 font-mono">{idx + 1}</td>
                    <td className="py-3 pr-3">
                      {ncr.ncrType && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${NCR_TYPE_BADGE[ncr.ncrType as NcrType]}`}>
                          {NCR_TYPE_LABEL[ncr.ncrType as NcrType]}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <span className="font-mono text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
                        {ncr.clauseRef || '—'}
                      </span>
                    </td>
                    <td className="py-3 pr-3">
                      <p className="text-slate-800 line-clamp-2">{ncr.description}</p>
                      {ncr.impact && (
                        <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                          ผลกระทบ: {ncr.impact}
                        </p>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${NCR_STATUS_BADGE[ncr.status]}`}>
                        {NCR_STATUS_LABEL[ncr.status]}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        {canEdit ? (
                          <>
                            <button
                              onClick={() => openEdit(ncr)}
                              className="text-xs text-blue-600 hover:text-blue-800 font-medium hover:underline"
                            >
                              {ncr.status === 'In Progress' ? 'ตรวจสอบ' : 'แก้ไข'}
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(ncr.id)}
                              className="text-xs text-slate-400 hover:text-red-500 transition-colors"
                            >
                              ลบ
                            </button>
                          </>
                        ) : ncr.status === 'Open' ? (
                          <button
                            onClick={() => openEdit(ncr)}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium hover:underline"
                          >
                            กรอกแผน
                          </button>
                        ) : (
                          <button
                            onClick={() => openEdit(ncr)}
                            className="text-xs text-slate-400 hover:text-slate-600"
                          >
                            ดู
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── NCR Create / Edit Modal ───────────────────────────────────────── */}
      <Modal
        open={!!ncrModal}
        onClose={() => setNcrModal(null)}
        title={
          ncrModal?.mode === 'create'
            ? 'สร้าง NCR ใหม่'
            : editNcr?.ncrType
              ? `NCR — ${NCR_TYPE_LABEL[editNcr.ncrType as NcrType]} · ${editNcr.clauseRef || 'ไม่ระบุข้อกำหนด'}`
              : 'NCR Detail'
        }
        size="lg"
      >
        <div className="space-y-5">

          {/* ── Section 1: NCR Details (Auditor fills) ───────────────────── */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
              รายละเอียด NCR
              <span className="ml-2 font-normal normal-case tracking-normal">(กรอกโดยผู้ตรวจสอบ)</span>
            </p>
            <div className="space-y-3">

              {/* ประเภท NCR */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">ประเภท NCR</label>
                {canEdit ? (
                  <div className="flex gap-2">
                    {NCR_TYPES.map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setNcrForm(f => ({ ...f, ncrType: t }))}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          ncrForm.ncrType === t
                            ? NCR_TYPE_BADGE[t] + ' ring-2 ring-offset-1 ring-blue-400'
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {NCR_TYPE_LABEL[t]}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${editNcr?.ncrType ? NCR_TYPE_BADGE[editNcr.ncrType as NcrType] : 'text-slate-400'}`}>
                    {editNcr?.ncrType ? NCR_TYPE_LABEL[editNcr.ncrType as NcrType] : '—'}
                  </span>
                )}
              </div>

              {/* ข้อกำหนด ISO */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">ข้อกำหนด ISO</label>
                {canEdit ? (
                  <input
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="เช่น A.9.1.1, 6.1.2"
                    value={ncrForm.clauseRef ?? ''}
                    onChange={e => setNcrForm(f => ({ ...f, clauseRef: e.target.value }))}
                  />
                ) : (
                  <p className="text-sm text-slate-700 font-mono bg-slate-50 rounded-lg px-3 py-2">{editNcr?.clauseRef || '—'}</p>
                )}
              </div>

              {/* รายละเอียด NCR */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">รายละเอียด NCR</label>
                {canEdit ? (
                  <textarea
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    rows={3}
                    placeholder="อธิบายข้อบกพร่องที่พบ..."
                    value={ncrForm.description ?? ''}
                    onChange={e => setNcrForm(f => ({ ...f, description: e.target.value }))}
                  />
                ) : (
                  <p className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2 leading-relaxed">{editNcr?.description || '—'}</p>
                )}
              </div>

              {/* ผลกระทบ */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">ผลกระทบ</label>
                {canEdit ? (
                  <textarea
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    rows={2}
                    placeholder="ผลกระทบต่อองค์กรหรือการดำเนินงาน..."
                    value={ncrForm.impact ?? ''}
                    onChange={e => setNcrForm(f => ({ ...f, impact: e.target.value }))}
                  />
                ) : (
                  <p className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2">{editNcr?.impact || '—'}</p>
                )}
              </div>

              {/* ข้อเสนอแนะ */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">ข้อเสนอแนะจากผู้ตรวจสอบ</label>
                {canEdit ? (
                  <textarea
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    rows={2}
                    placeholder="ข้อเสนอแนะการแก้ไข..."
                    value={ncrForm.recommendation ?? ''}
                    onChange={e => setNcrForm(f => ({ ...f, recommendation: e.target.value }))}
                  />
                ) : (
                  <p className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2">{editNcr?.recommendation || '—'}</p>
                )}
              </div>
            </div>
          </div>

          {/* ── Section 2: Auditee Plan (shown in edit mode only) ────────── */}
          {ncrModal?.mode === 'edit' && (
            <div className={`border rounded-xl p-4 ${
              isAuditeeMode
                ? 'border-blue-200 bg-blue-50/30'
                : 'border-slate-200 bg-slate-50/30'
            }`}>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
                แผนแก้ไข
                <span className="ml-2 font-normal normal-case tracking-normal">(กรอกโดยผู้รับการตรวจ)</span>
              </p>

              {isViewOnly ? (
                // Viewer on a submitted/approved NCR — read-only display
                <div className="space-y-2 text-sm text-slate-600">
                  <p><span className="font-medium text-slate-700">วิเคราะห์สาเหตุ:</span> {editNcr?.rootCause || '—'}</p>
                  <p><span className="font-medium text-slate-700">แนวทางแก้ไข:</span> {editNcr?.correctiveAction || '—'}</p>
                  <p><span className="font-medium text-slate-700">แนวทางป้องกัน:</span> {editNcr?.preventiveAction || '—'}</p>
                  <p><span className="font-medium text-slate-700">วันที่แล้วเสร็จ:</span> {editNcr?.dueDate || '—'}</p>
                  <p><span className="font-medium text-slate-700">ผู้รับผิดชอบ:</span> {editNcr?.owner || '—'}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* วิเคราะห์สาเหตุ */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">วิเคราะห์สาเหตุ (Root Cause)</label>
                    <textarea
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      rows={2}
                      placeholder="วิเคราะห์สาเหตุที่แท้จริงของปัญหา..."
                      value={ncrForm.rootCause ?? ''}
                      onChange={e => setNcrForm(f => ({ ...f, rootCause: e.target.value }))}
                    />
                  </div>
                  {/* แนวทางแก้ไข */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">แนวทางแก้ไข</label>
                    <textarea
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      rows={2}
                      placeholder="มาตรการแก้ไขที่จะดำเนินการ..."
                      value={ncrForm.correctiveAction ?? ''}
                      onChange={e => setNcrForm(f => ({ ...f, correctiveAction: e.target.value }))}
                    />
                  </div>
                  {/* แนวทางป้องกัน */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">แนวทางป้องกัน</label>
                    <textarea
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      rows={2}
                      placeholder="มาตรการป้องกันไม่ให้เกิดซ้ำ..."
                      value={ncrForm.preventiveAction ?? ''}
                      onChange={e => setNcrForm(f => ({ ...f, preventiveAction: e.target.value }))}
                    />
                  </div>
                  {/* วันที่ + ผู้รับผิดชอบ */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">วันที่แล้วเสร็จ</label>
                      <input
                        type="date"
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={ncrForm.dueDate ?? ''}
                        onChange={e => setNcrForm(f => ({ ...f, dueDate: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">ผู้รับผิดชอบ</label>
                      <input
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="ชื่อผู้รับผิดชอบ"
                        value={ncrForm.owner ?? ''}
                        onChange={e => setNcrForm(f => ({ ...f, owner: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Section 3: Approval notes (shown when auditor can approve) ── */}
          {canApprove && (
            <div className="border border-green-200 bg-green-50/30 rounded-xl p-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
                หมายเหตุการอนุมัติ
              </p>
              <textarea
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                rows={2}
                placeholder="หมายเหตุ / เงื่อนไขการอนุมัติ (optional)"
                value={ncrForm.closureNotes ?? ''}
                onChange={e => setNcrForm(f => ({ ...f, closureNotes: e.target.value }))}
              />
            </div>
          )}

          {/* ── Buttons ───────────────────────────────────────────────────── */}
          <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
            {/* Delete — auditor, edit mode only */}
            {canEdit && ncrModal?.mode === 'edit' && (
              <button
                type="button"
                onClick={() => { setDeleteConfirm(editNcr!.id); setNcrModal(null); }}
                className="text-xs text-red-500 hover:text-red-700 px-3 py-2 rounded-lg border border-red-200 hover:bg-red-50 transition-colors"
              >
                ลบ NCR
              </button>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setNcrModal(null)}
              className="border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              {isViewOnly ? 'ปิด' : 'ยกเลิก'}
            </button>

            {/* Create NCR */}
            {ncrModal?.mode === 'create' && (
              <button
                type="button"
                disabled={ncrSaving}
                onClick={() => handleSave('save')}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                {ncrSaving ? 'กำลังบันทึก…' : 'สร้าง NCR'}
              </button>
            )}

            {/* Save (auditor editing, not approving) */}
            {ncrModal?.mode === 'edit' && canEdit && (
              <button
                type="button"
                disabled={ncrSaving}
                onClick={() => handleSave('save')}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                {ncrSaving ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
            )}

            {/* Approve (auditor reviewing submitted plan) */}
            {canApprove && (
              <button
                type="button"
                disabled={ncrSaving}
                onClick={() => handleSave('approve')}
                className="bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                {ncrSaving ? 'กำลังบันทึก…' : '✓ อนุมัติ'}
              </button>
            )}

            {/* Submit plan (viewer/auditee on Open NCR) */}
            {isAuditeeMode && (
              <button
                type="button"
                disabled={ncrSaving}
                onClick={() => handleSave('submit')}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                {ncrSaving ? 'กำลังส่ง…' : 'ส่งแผนแก้ไข'}
              </button>
            )}
          </div>
        </div>
      </Modal>

      {/* ── Delete Confirm Modal ──────────────────────────────────────────── */}
      <Modal open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="ยืนยันการลบ NCR" size="md">
        <p className="text-slate-600 text-sm mb-5">ต้องการลบ NCR นี้หรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้</p>
        <div className="flex gap-3">
          <button
            onClick={() => setDeleteConfirm(null)}
            className="flex-1 border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            ยกเลิก
          </button>
          <button
            onClick={handleDelete}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg text-sm font-medium transition-colors"
          >
            ลบ NCR
          </button>
        </div>
      </Modal>

    </div>
  );
}
