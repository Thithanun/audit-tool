'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import type { AuditPlan, StandardUsed, SessionStatus } from '@/lib/types';
import {
  getAuditPlans,
  saveAuditPlan,
  deleteAuditPlan,
  saveChecklistItem,
  getSessionProgress,
  uid,
} from '@/lib/store';
import { ISO27001_CLAUSES, NIST_CSF_CLAUSES } from '@/lib/seed-data';
import StatusBadge, { SESSION_STATUSES } from '@/components/StatusBadge';
import Modal from '@/components/Modal';

const STANDARD_OPTIONS: { value: StandardUsed; label: string }[] = [
  { value: 'ISO27001', label: 'ISO 27001:2022' },
  { value: 'NIST_CSF', label: 'NIST CSF 2.0' },
  { value: 'BOTH',     label: 'ISO 27001:2022 + NIST CSF 2.0' },
];

function standardLabel(s: StandardUsed) {
  return STANDARD_OPTIONS.find(o => o.value === s)?.label ?? s;
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return '';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

const emptyPlan = (): Omit<AuditPlan, 'id' | 'createdAt'> => ({
  objective: '',
  standard: 'ISO27001',
  scope: '',
  auditAreas: '',
  leadAuditor: '',
  startDate: '',
  endDate: '',
  status: 'Planned',
});

export default function AuditPlanListPage() {
  const [plans, setPlans] = useState<AuditPlan[]>([]);
  const [planModal, setPlanModal] = useState(false);
  const [planForm, setPlanForm] = useState(emptyPlan());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const reload = useCallback(() => setPlans(getAuditPlans()), []);
  useEffect(() => { reload(); }, [reload]);

  function openCreate() {
    setPlanForm(emptyPlan());
    setPlanModal(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const now = new Date().toISOString();
    const plan: AuditPlan = { id: uid(), createdAt: now, ...planForm };
    saveAuditPlan(plan);
    const clauses = planForm.standard === 'BOTH'
      ? [...ISO27001_CLAUSES, ...NIST_CSF_CLAUSES]
      : planForm.standard === 'ISO27001' ? ISO27001_CLAUSES : NIST_CSF_CLAUSES;
    for (const c of clauses) {
      saveChecklistItem({
        id: uid(), sessionId: plan.id, framework: c.framework,
        clauseRef: c.clauseRef, clauseTitle: c.clauseTitle,
        requirement: c.requirement, status: 'Not Assessed',
        notes: '', evidence: '', createdAt: now, updatedAt: now,
      });
    }
    setPlanModal(false);
    reload();
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Audit Plan</h1>
          <p className="text-slate-500 text-sm mt-1">Manage audit plans and schedule sessions</p>
        </div>
        <button
          onClick={openCreate}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Audit Plan
        </button>
      </div>

      {plans.length === 0 ? (
        <div className="text-center py-20 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
          <div className="text-5xl mb-4">📋</div>
          <h3 className="text-slate-600 font-medium text-lg">No audit plans yet</h3>
          <p className="text-slate-400 text-sm mt-1 mb-4">Create a new plan to start your audit</p>
          <button
            onClick={openCreate}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            Create Audit Plan
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map(plan => {
            const prog = getSessionProgress(plan.id);
            return (
              <div key={plan.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col gap-3">
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-slate-900 leading-snug flex-1 min-w-0">
                    {plan.objective || <span className="text-slate-400 italic">No objective</span>}
                  </h3>
                  <StatusBadge status={plan.status} type="session" size="sm" />
                </div>

                <span className="text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 rounded-full self-start">
                  {standardLabel(plan.standard)}
                </span>

                {/* Meta */}
                <div className="flex flex-col gap-1 text-xs text-slate-500">
                  {plan.leadAuditor && (
                    <span>👤 <span className="text-slate-700">{plan.leadAuditor}</span></span>
                  )}
                  {(plan.startDate || plan.endDate) && (
                    <span>
                      📅{' '}
                      <span className="text-slate-700">
                        {fmtDate(plan.startDate)}
                        {plan.endDate && ` → ${fmtDate(plan.endDate)}`}
                      </span>
                    </span>
                  )}
                  {plan.auditAreas && (
                    <span>📍 <span className="text-slate-700">{plan.auditAreas}</span></span>
                  )}
                </div>

                {/* Progress */}
                <div>
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>Checklist</span>
                    <span>{prog.assessed}/{prog.total} ({prog.pct}%)</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5">
                    <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${prog.pct}%` }} />
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-1 border-t border-slate-100 mt-auto">
                  <Link
                    href={`/audit-plan/${plan.id}`}
                    className="flex-1 text-center text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 py-1.5 rounded-lg transition-colors"
                  >
                    View Plan
                  </Link>
                  <button
                    onClick={() => setDeleteConfirm(plan.id)}
                    className="text-sm text-slate-400 hover:text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      <Modal open={planModal} onClose={() => setPlanModal(false)} title="New Audit Plan" size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              วัตถุประสงค์การตรวจประเมิน (Objective) <span className="text-red-500">*</span>
            </label>
            <textarea
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={3} required
              placeholder="e.g., ตรวจประเมินความสอดคล้องกับ ISO 27001:2022 ประจำปี 2025"
              value={planForm.objective}
              onChange={e => setPlanForm(f => ({ ...f, objective: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">มาตรฐานที่ใช้ (Standard Used)</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={planForm.standard}
              onChange={e => setPlanForm(f => ({ ...f, standard: e.target.value as StandardUsed }))}
            >
              {STANDARD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <p className="text-xs text-slate-400 mt-1">Checklist จะถูก auto-seed ด้วย controls ของมาตรฐานที่เลือก</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">ขอบเขตที่ตรวจประเมิน (Scope of Audit)</label>
            <textarea
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={3}
              placeholder="e.g., ระบบสารสนเทศและกระบวนการที่เกี่ยวข้องในสำนักงานใหญ่"
              value={planForm.scope}
              onChange={e => setPlanForm(f => ({ ...f, scope: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">วันที่เริ่มตรวจ (Start Date)</label>
              <input type="date" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={planForm.startDate} onChange={e => setPlanForm(f => ({ ...f, startDate: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">วันที่สิ้นสุด (End Date)</label>
              <input type="date" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={planForm.endDate} onChange={e => setPlanForm(f => ({ ...f, endDate: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">สถานที่ตรวจประเมิน (Audit Areas)</label>
            <input className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., HQ Information Systems, Data Center"
              value={planForm.auditAreas} onChange={e => setPlanForm(f => ({ ...f, auditAreas: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">หัวหน้าผู้ตรวจประเมิน (Lead Auditor)</label>
            <input className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., John Doe"
              value={planForm.leadAuditor} onChange={e => setPlanForm(f => ({ ...f, leadAuditor: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
            <select className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={planForm.status} onChange={e => setPlanForm(f => ({ ...f, status: e.target.value as SessionStatus }))}>
              {SESSION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setPlanModal(false)} className="flex-1 border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">Cancel</button>
            <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition-colors">Create Audit Plan</button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirm */}
      <Modal open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete Audit Plan" size="md">
        <p className="text-slate-600 text-sm mb-4">
          Are you sure? All checklist items, corrective actions, and sessions will be permanently removed.
        </p>
        <div className="flex gap-3">
          <button onClick={() => setDeleteConfirm(null)} className="flex-1 border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">Cancel</button>
          <button
            onClick={() => { if (deleteConfirm) { deleteAuditPlan(deleteConfirm); setDeleteConfirm(null); reload(); } }}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg text-sm font-medium transition-colors"
          >Delete</button>
        </div>
      </Modal>
    </div>
  );
}
