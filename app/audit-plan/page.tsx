'use client';

import { useState, useEffect, useCallback } from 'react';
import type { AuditSession, Framework, SessionStatus } from '@/lib/types';
import {
  getSessions,
  saveSession,
  deleteSession,
  getSessionProgress,
  uid,
} from '@/lib/store';
import { getClausesByFramework } from '@/lib/seed-data';
import { saveChecklistItem } from '@/lib/store';
import StatusBadge, { SESSION_STATUSES } from '@/components/StatusBadge';
import Modal from '@/components/Modal';

const FRAMEWORKS: { value: Framework; label: string }[] = [
  { value: 'ISO27001', label: 'ISO 27001:2022' },
  { value: 'NIST_CSF', label: 'NIST CSF 2.0' },
];

const empty = (): Omit<AuditSession, 'id' | 'createdAt'> => ({
  name: '',
  framework: 'ISO27001',
  scope: '',
  auditor: '',
  startDate: '',
  endDate: '',
  status: 'Planned',
});

export default function AuditPlanPage() {
  const [sessions, setSessions] = useState<AuditSession[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AuditSession | null>(null);
  const [form, setForm] = useState(empty());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const reload = useCallback(() => setSessions(getSessions()), []);

  useEffect(() => { reload(); }, [reload]);

  function openCreate() {
    setEditTarget(null);
    setForm(empty());
    setModalOpen(true);
  }

  function openEdit(s: AuditSession) {
    setEditTarget(s);
    setForm({ name: s.name, framework: s.framework, scope: s.scope, auditor: s.auditor, startDate: s.startDate, endDate: s.endDate, status: s.status });
    setModalOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const now = new Date().toISOString();
    if (editTarget) {
      saveSession({ ...editTarget, ...form });
    } else {
      const session: AuditSession = { id: uid(), createdAt: now, ...form };
      saveSession(session);
      // Auto-seed checklist with all controls for the selected framework
      const clauses = getClausesByFramework(form.framework);
      for (const c of clauses) {
        saveChecklistItem({
          id: uid(),
          sessionId: session.id,
          framework: session.framework,
          clauseRef: c.clauseRef,
          clauseTitle: c.clauseTitle,
          requirement: c.requirement,
          status: 'Not Assessed',
          notes: '',
          evidence: '',
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    setModalOpen(false);
    reload();
  }

  function handleDelete(id: string) {
    deleteSession(id);
    setDeleteConfirm(null);
    reload();
  }

  const field = (key: keyof typeof form, label: string, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        value={form[key] as string}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        {...extra}
      />
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Audit Plan</h1>
          <p className="text-slate-500 text-sm mt-1">Manage audit sessions and track overall progress</p>
        </div>
        <button
          onClick={openCreate}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Session
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="text-center py-20 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
          <div className="text-slate-400 text-5xl mb-4">📋</div>
          <h3 className="text-slate-600 font-medium text-lg">No audit sessions yet</h3>
          <p className="text-slate-400 text-sm mt-1 mb-4">Create a new session to start your audit</p>
          <button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            Create First Session
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sessions.map(s => {
            const prog = getSessionProgress(s.id);
            return (
              <div key={s.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-slate-900 truncate">{s.name}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {FRAMEWORKS.find(f => f.value === s.framework)?.label}
                    </p>
                  </div>
                  <StatusBadge status={s.status} type="session" />
                </div>

                {s.scope && (
                  <p className="text-sm text-slate-600 line-clamp-2">{s.scope}</p>
                )}

                <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
                  {s.auditor && <span>👤 {s.auditor}</span>}
                  {s.startDate && <span>📅 {s.startDate}</span>}
                  {s.endDate && <span>🏁 {s.endDate}</span>}
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>Progress</span>
                    <span>{prog.assessed} / {prog.total} assessed ({prog.pct}%)</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all"
                      style={{ width: `${prog.pct}%` }}
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-1 border-t border-slate-100">
                  <button
                    onClick={() => openEdit(s)}
                    className="flex-1 text-sm text-slate-600 hover:text-blue-600 hover:bg-blue-50 py-1.5 rounded-lg transition-colors font-medium"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(s.id)}
                    className="flex-1 text-sm text-slate-600 hover:text-red-600 hover:bg-red-50 py-1.5 rounded-lg transition-colors font-medium"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editTarget ? 'Edit Session' : 'New Audit Session'}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {field('name', 'Session Name', { required: true, placeholder: 'e.g., Q2 2025 ISO 27001 Audit' })}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Framework</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.framework}
              onChange={e => setForm(f => ({ ...f, framework: e.target.value as Framework }))}
              disabled={!!editTarget}
            >
              {FRAMEWORKS.map(fw => (
                <option key={fw.value} value={fw.value}>{fw.label}</option>
              ))}
            </select>
            {!editTarget && (
              <p className="text-xs text-slate-400 mt-1">Checklist will be auto-seeded with all controls</p>
            )}
          </div>

          {field('scope', 'Scope', { placeholder: 'e.g., HQ Information Systems' })}
          {field('auditor', 'Lead Auditor', { placeholder: 'e.g., John Doe' })}

          <div className="grid grid-cols-2 gap-3">
            {field('startDate', 'Start Date', { type: 'date' })}
            {field('endDate', 'End Date', { type: 'date' })}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value as SessionStatus }))}
            >
              {SESSION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="flex-1 border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {editTarget ? 'Save Changes' : 'Create Session'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Session"
        size="md"
      >
        <p className="text-slate-600 text-sm mb-4">
          Are you sure you want to delete this session? All checklist items and corrective actions will be permanently removed.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setDeleteConfirm(null)}
            className="flex-1 border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg text-sm font-medium transition-colors"
          >
            Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}
