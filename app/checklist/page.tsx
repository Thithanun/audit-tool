'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { ChecklistItem, ChecklistTemplate, FindingStatus, PlanSession, AuditPlan } from '@/lib/types';
import {
  getAuditPlans,
  getChecklistItems,
  saveChecklistItem,
  deleteChecklistItem,
  getPlanSessions,
  getChecklistTemplates,
  saveChecklistTemplate,
  deleteChecklistTemplate,
  uid,
} from '@/lib/store';
import { ALL_CLAUSES } from '@/lib/seed-data';
import Modal from '@/components/Modal';
import { useAuth } from '@/contexts/AuthContext';
import PageLoader, { DbError } from '@/components/PageLoader';

// ── Constants ─────────────────────────────────────────────────────────────────

const FINDING_STATUSES: FindingStatus[] = [
  'Not Assessed', 'Conformity', 'OBS', 'OFI', 'NC-Minor', 'NC-Major',
];

const NEEDS_FINDING = new Set<FindingStatus>(['OBS', 'OFI', 'NC-Minor', 'NC-Major']);

const NIST_PREFIX = /^(GV|ID|PR|DE|RS|RC)\./;
function isNistItem(item: ChecklistItem) {
  return item.framework === 'NIST_CSF' || NIST_PREFIX.test(item.clauseRef);
}

const GENERAL_KEYWORDS = [
  'เปิดประชุม', 'ปิดประชุม', 'ประชุม ia', 'สรุปผล',
  'opening', 'closing', 'wrap up', 'debrief',
];

const STATUS_BADGE: Record<FindingStatus, string> = {
  'Not Assessed': 'bg-slate-100 text-slate-500',
  'Conformity':   'bg-green-100 text-green-700',
  'OBS':          'bg-orange-100 text-orange-700',
  'OFI':          'bg-blue-100 text-blue-700',
  'NC-Minor':     'bg-orange-200 text-orange-800',
  'NC-Major':     'bg-red-100 text-red-700',
};

const STATUS_ROW: Record<FindingStatus, string> = {
  'Not Assessed': '',
  'Conformity':   '',
  'OBS':          'bg-orange-50',
  'OFI':          'bg-blue-50',
  'NC-Minor':     'bg-orange-50',
  'NC-Major':     'bg-red-50',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function isGeneralSession(s: PlanSession): boolean {
  const area = s.areaOfAudit.toLowerCase();
  return GENERAL_KEYWORDS.some(kw => area.includes(kw));
}

// ── EditModal ─────────────────────────────────────────────────────────────────

interface EditModalProps {
  item: ChecklistItem | null;
  canEdit: boolean;
  onClose: () => void;
  onSave: (updated: ChecklistItem) => void;
  onSaveAsTemplate: (item: ChecklistItem) => void;
}

function EditModal({ item, canEdit, onClose, onSave, onSaveAsTemplate }: EditModalProps) {
  const [draft, setDraft] = useState<ChecklistItem | null>(null);

  useEffect(() => { setDraft(item ? { ...item } : null); }, [item]);

  if (!draft) return null;

  const needsFinding = NEEDS_FINDING.has(draft.status);

  function patch(fields: Partial<ChecklistItem>) {
    setDraft(d => d ? { ...d, ...fields } : d);
  }

  function handleSave() {
    if (!draft) return;
    onSave({ ...draft, updatedAt: new Date().toISOString() });
    onClose();
  }

  return (
    <Modal open={!!item} onClose={onClose} title={`${draft.clauseRef} — ${draft.clauseTitle}`} size="lg">
      <div className="space-y-4">
        {/* Clause info */}
        <div className="bg-slate-50 rounded-lg px-3 py-2 text-xs text-slate-600 leading-relaxed">
          {draft.question?.trim() || draft.requirement}
        </div>

        {/* Status */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
          {canEdit ? (
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={draft.status}
              onChange={e => patch({ status: e.target.value as FindingStatus })}
            >
              {FINDING_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <span className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_BADGE[draft.status]}`}>
              {draft.status}
            </span>
          )}
        </div>

        {/* Remark / Notes */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Remark / Notes</label>
          <textarea
            readOnly={!canEdit}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none read-only:bg-slate-50 read-only:cursor-default"
            rows={3}
            placeholder="Findings / evidence / observation..."
            value={draft.notes}
            onChange={e => patch({ notes: e.target.value })}
          />
        </div>

        {/* Finding details — only when status requires */}
        {needsFinding && (
          <div className="border border-orange-200 rounded-lg p-3 bg-orange-50 space-y-3">
            <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">Finding Details</p>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Recommendation</label>
              <textarea
                readOnly={!canEdit}
                className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none read-only:bg-slate-50"
                rows={2}
                placeholder="Enter recommendation..."
                value={draft.recommendation ?? ''}
                onChange={e => patch({ recommendation: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Due Date</label>
              <input
                type="date"
                readOnly={!canEdit}
                className="text-xs border border-slate-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 read-only:bg-slate-50"
                value={draft.dueDate ?? ''}
                onChange={e => patch({ dueDate: e.target.value })}
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          {canEdit && (
            <button
              onClick={() => { onSaveAsTemplate(draft); }}
              className="text-xs text-amber-600 hover:text-amber-800 border border-amber-300 hover:bg-amber-50 px-3 py-1.5 rounded-lg transition-colors"
            >
              ☆ Save as template
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            {canEdit ? 'Cancel' : 'Close'}
          </button>
          {canEdit && (
            <button
              onClick={handleSave}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Save
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ChecklistPage() {
  const { canEditChecklist: canEdit } = useAuth();

  const [plans, setPlans] = useState<AuditPlan[]>([]);
  const [planSessions, setPlanSessions] = useState<PlanSession[]>([]);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);

  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [filterStatus, setFilterStatus] = useState<'' | FindingStatus>('');

  const [editItem, setEditItem] = useState<ChecklistItem | null>(null);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addTab, setAddTab] = useState<'new' | 'template'>('new');
  const [addForm, setAddForm] = useState({
    clauseRef: '',
    question: '',
    status: 'Not Assessed' as FindingStatus,
  });

  // Start as false — prevents permanent spinner if Next.js restores component
  // from navigation cache before useEffect re-fires.
  const [loading, setLoading] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────

  const reload = useCallback(async () => {
    setLoading(true);
    setDbError(null);
    try {
      // Critical path: plans + checklist items in parallel
      const [ps, is] = await Promise.all([
        getAuditPlans(),
        getChecklistItems(),
      ]);
      setPlans(ps);
      setItems(is.filter(i => !isNistItem(i)));

      // Fetch plan sessions for the first plan immediately — no second render
      // cycle needed (eliminates the sequential useEffect round-trip)
      if (ps.length > 0) {
        const pid = ps[0].id;
        setSelectedPlanId(pid);
        const ss = await getPlanSessions(pid);
        setPlanSessions(ss);
      }
    } catch (e) {
      setDbError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
    // Templates are non-critical — never block the page
    try {
      setTemplates(await getChecklistTemplates());
    } catch (e) {
      console.warn('[Checklist] Could not load templates:', e);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const auditSessions = useMemo(() => {
    // Extract "HH:MM" start time from a "HH:MM-HH:MM" or "HH:MM" string.
    // Falls back to empty string (sorts last) when the field is blank.
    function startTime(s: PlanSession): string {
      return (s.time ?? '').split('-')[0].trim();
    }

    return planSessions
      .filter(s => !isGeneralSession(s) && s.relatedClauses.length > 0)
      .sort((a, b) => {
        // 1. date (ISO "YYYY-MM-DD") — sorts lexicographically, blanks go last
        const dateA = a.date ?? '';
        const dateB = b.date ?? '';
        if (dateA !== dateB) {
          if (!dateA) return 1;
          if (!dateB) return -1;
          return dateA.localeCompare(dateB);
        }
        // 2. day number — tie-break when date is missing or identical
        if (a.day !== b.day) return a.day - b.day;
        // 3. start time within the same day
        return startTime(a).localeCompare(startTime(b));
      });
  }, [planSessions]);

  const selectedSession = useMemo(
    () => auditSessions.find(s => s.id === selectedSessionId) ?? null,
    [auditSessions, selectedSessionId],
  );

  const planSessionIds = useMemo(() => new Set(planSessions.map(s => s.id)), [planSessions]);

  const sessionItems = useMemo(() => {
    if (!selectedPlanId) return [];
    if (selectedSessionId) return items.filter(i => i.sessionId === selectedSessionId);
    return items.filter(i => i.sessionId === selectedPlanId || planSessionIds.has(i.sessionId));
  }, [items, selectedPlanId, selectedSessionId, planSessionIds]);

  const visibleItems = useMemo(
    () => filterStatus ? sessionItems.filter(i => i.status === filterStatus) : sessionItems,
    [sessionItems, filterStatus],
  );

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = Object.fromEntries(FINDING_STATUSES.map(s => [s, 0]));
    for (const i of sessionItems) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [sessionItems]);

  const assessed = useMemo(
    () => sessionItems.filter(i => i.status !== 'Not Assessed').length,
    [sessionItems],
  );

  const availableClauses = useMemo(
    () => selectedSession
      ? (selectedSession.relatedClauses ?? []).flatMap(ref => ALL_CLAUSES.find(c => c.clauseRef === ref) ?? [])
      : ALL_CLAUSES,
    [selectedSession],
  );

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleUpdate(updated: ChecklistItem) {
    setItems(prev => prev.map(i => i.id === updated.id ? updated : i));
    saveChecklistItem(updated).catch(e => console.error('Save failed:', e));
  }

  async function handleDelete(id: string) {
    setItems(prev => prev.filter(i => i.id !== id));
    try { await deleteChecklistItem(id); }
    catch (e) { console.error('Delete failed:', e); await reload(); }
  }

  function handleSaveAsTemplate(item: ChecklistItem) {
    const t: ChecklistTemplate = {
      id: uid(),
      question: item.question?.trim() || item.clauseTitle,
      clauseRef: item.clauseRef,
      createdAt: new Date().toISOString(),
    };
    setTemplates(prev => [...prev, t]);
    saveChecklistTemplate(t).catch(e => console.error('Template save failed:', e));
  }

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    const clauseInfo = ALL_CLAUSES.find(c => c.clauseRef === addForm.clauseRef);
    if (!clauseInfo) return;
    const now = new Date().toISOString();
    const newItem: ChecklistItem = {
      id: uid(),
      sessionId: selectedSessionId || selectedPlanId,
      framework: clauseInfo.framework,
      clauseRef: clauseInfo.clauseRef,
      clauseTitle: clauseInfo.clauseTitle,
      requirement: clauseInfo.requirement,
      question: addForm.question,
      status: addForm.status,
      notes: '',
      evidence: '',
      createdAt: now,
      updatedAt: now,
    };
    try {
      await saveChecklistItem(newItem);
      setItems(prev => [...prev, newItem]);
      setAddModalOpen(false);
      setAddForm({ clauseRef: '', question: '', status: 'Not Assessed' });
    } catch (err) {
      alert('Save failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function handleAddFromTemplate(t: ChecklistTemplate) {
    const clauseInfo = ALL_CLAUSES.find(c => c.clauseRef === t.clauseRef);
    if (!clauseInfo) return;
    const now = new Date().toISOString();
    const newItem: ChecklistItem = {
      id: uid(),
      sessionId: selectedSessionId || selectedPlanId,
      framework: clauseInfo.framework,
      clauseRef: clauseInfo.clauseRef,
      clauseTitle: clauseInfo.clauseTitle,
      requirement: clauseInfo.requirement,
      question: t.question,
      status: 'Not Assessed',
      notes: '',
      evidence: '',
      createdAt: now,
      updatedAt: now,
    };
    try {
      await saveChecklistItem(newItem);
      setItems(prev => [...prev, newItem]);
      setAddModalOpen(false);
    } catch (err) {
      alert('Save failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <PageLoader message="กำลังโหลด Checklist…" />;
  if (dbError) return <DbError message={dbError} onRetry={reload} />;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-28">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Checklist</h1>
          <p className="text-slate-500 text-sm mt-1">Record findings item by item</p>
        </div>
        {canEdit && (
          <button
            onClick={() => { setAddTab('new'); setAddModalOpen(true); }}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Item
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Audit Plan</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedPlanId}
              onChange={async e => {
                const pid = e.target.value;
                setSelectedPlanId(pid);
                setSelectedSessionId('');
                setFilterStatus('');
                try { setPlanSessions(await getPlanSessions(pid)); } catch {}
              }}
            >
              {plans.length === 0 && <option value="">No plans</option>}
              {plans.map(p => <option key={p.id} value={p.id}>{p.objective}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Session</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedSessionId}
              onChange={e => { setSelectedSessionId(e.target.value); setFilterStatus(''); }}
            >
              <option value="">All Sessions</option>
              {auditSessions.map(s => (
                <option key={s.id} value={s.id}>
                  Day {s.day}{s.time ? ` · ${s.time}` : ''} · {s.areaOfAudit}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value as '' | FindingStatus)}
            >
              <option value="">All Statuses</option>
              {FINDING_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Status chips */}
        {selectedPlanId && (
          <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
            {FINDING_STATUSES.map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
                className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${STATUS_BADGE[s]} ${filterStatus === s ? 'ring-2 ring-blue-500' : ''}`}
              >
                {s} {statusCounts[s] ?? 0}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Session info */}
      {selectedSession && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
          <div className="flex items-start justify-between mb-2">
            <div>
              <p className="text-sm font-semibold text-slate-800">
                Day {selectedSession.day} · {selectedSession.areaOfAudit}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {selectedSession.date}{selectedSession.time ? ` · ${selectedSession.time}` : ''}
                {selectedSession.auditee ? ` · Auditee: ${selectedSession.auditee}` : ''}
                {selectedSession.mainAuditor ? ` · Auditor: ${selectedSession.mainAuditor}` : ''}
              </p>
            </div>
            <p className="text-xs text-slate-500 flex-shrink-0">
              {assessed}/{sessionItems.length} assessed
            </p>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-1.5">
            <div
              className="bg-blue-500 h-1.5 rounded-full transition-all"
              style={{ width: sessionItems.length === 0 ? '0%' : `${Math.round(assessed / sessionItems.length * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Main content */}
      {plans.length === 0 ? (
        <div className="text-center py-16 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
          <p className="text-slate-500 text-sm">Create an audit plan first to use the checklist.</p>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="text-center py-16 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
          <p className="text-slate-500 text-sm mb-3">
            {filterStatus ? `No items with status "${filterStatus}".` : 'No checklist items yet.'}
          </p>
          {!filterStatus && canEdit && (
            <button
              onClick={() => { setAddTab('new'); setAddModalOpen(true); }}
              className="text-blue-600 hover:underline text-sm"
            >
              Add the first item →
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {/* item count */}
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
            <p className="text-xs text-slate-500">
              {visibleItems.length} item{visibleItems.length !== 1 ? 's' : ''}
              {filterStatus ? ` · filtered by "${filterStatus}"` : ''}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left">
                  <th className="text-xs font-semibold text-slate-500 px-4 py-3 w-10">#</th>
                  <th className="text-xs font-semibold text-slate-500 px-4 py-3 w-28">ข้อกำหนด</th>
                  <th className="text-xs font-semibold text-slate-500 px-4 py-3">Checklist</th>
                  <th className="text-xs font-semibold text-slate-500 px-4 py-3 w-36">Status</th>
                  <th className="text-xs font-semibold text-slate-500 px-4 py-3 w-64">Remark</th>
                  {canEdit && (
                    <th className="text-xs font-semibold text-slate-500 px-4 py-3 w-24 text-center">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item, idx) => (
                  <tr
                    key={item.id}
                    className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${STATUS_ROW[item.status]}`}
                  >
                    {/* # */}
                    <td className="px-4 py-3 text-xs text-slate-400 font-mono align-top">
                      {idx + 1}
                    </td>

                    {/* ข้อกำหนด (clause) */}
                    <td className="px-4 py-3 align-top">
                      <span className="inline-block text-xs font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded whitespace-nowrap">
                        {item.clauseRef}
                      </span>
                      <p className="text-xs text-slate-400 mt-1 leading-snug">{item.clauseTitle}</p>
                    </td>

                    {/* Checklist (คำถาม) */}
                    <td className="px-4 py-3 align-top">
                      <p className="text-sm text-slate-800 leading-snug">
                        {item.question?.trim() || item.requirement}
                      </p>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3 align-top">
                      {canEdit ? (
                        <select
                          className={`text-xs rounded-full px-2.5 py-1 font-medium border-0 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer ${STATUS_BADGE[item.status]}`}
                          value={item.status}
                          onChange={e => handleUpdate({
                            ...item,
                            status: e.target.value as FindingStatus,
                            updatedAt: new Date().toISOString(),
                          })}
                        >
                          {FINDING_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : (
                        <span className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_BADGE[item.status]}`}>
                          {item.status}
                        </span>
                      )}
                    </td>

                    {/* Remark */}
                    <td className="px-4 py-3 align-top">
                      {canEdit ? (
                        <textarea
                          key={`${item.id}-notes`}
                          className="w-full text-xs text-slate-600 border border-slate-200 rounded px-2 py-1.5 bg-transparent focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none hover:border-slate-300 transition-colors"
                          rows={2}
                          placeholder="บันทึก / หลักฐาน..."
                          defaultValue={item.notes}
                          onBlur={e => {
                            if (e.target.value !== item.notes)
                              handleUpdate({ ...item, notes: e.target.value, updatedAt: new Date().toISOString() });
                          }}
                        />
                      ) : (
                        <p className="text-xs text-slate-600 leading-relaxed">
                          {item.notes || <span className="text-slate-300 italic">—</span>}
                        </p>
                      )}
                    </td>

                    {/* Actions */}
                    {canEdit && (
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center justify-center gap-1">
                          {/* Save as template */}
                          {(() => {
                            const isSaved = templates.some(
                              t => t.clauseRef === item.clauseRef &&
                                   t.question === (item.question?.trim() || item.clauseTitle)
                            );
                            return (
                              <button
                                onClick={() => !isSaved && handleSaveAsTemplate(item)}
                                title={isSaved ? 'Already saved as template' : 'Save as template'}
                                className={`p-1.5 rounded transition-colors ${isSaved ? 'text-amber-400 cursor-default' : 'text-slate-400 hover:text-amber-500 hover:bg-amber-50'}`}
                              >
                                <svg className="w-4 h-4" fill={isSaved ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                                </svg>
                              </button>
                            );
                          })()}
                          {/* Edit */}
                          <button
                            onClick={() => setEditItem(item)}
                            title="Edit"
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          {/* Delete */}
                          <button
                            onClick={() => handleDelete(item.id)}
                            title="Delete"
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Fixed bottom summary bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-3 flex items-center gap-4 z-40 print:hidden">
        <div className="flex items-center gap-4 text-xs text-slate-600 flex-1 flex-wrap">
          <span><span className="font-semibold text-slate-900">{sessionItems.length}</span> items</span>
          <span><span className="font-semibold text-slate-900">{assessed}</span> assessed</span>
          {statusCounts['NC-Major'] > 0 && <span className="font-medium text-red-600">NC-Major: {statusCounts['NC-Major']}</span>}
          {statusCounts['NC-Minor'] > 0 && <span className="font-medium text-orange-700">NC-Minor: {statusCounts['NC-Minor']}</span>}
          {statusCounts['OBS'] > 0 && <span className="font-medium text-orange-600">OBS: {statusCounts['OBS']}</span>}
          {statusCounts['OFI'] > 0 && <span className="font-medium text-blue-600">OFI: {statusCounts['OFI']}</span>}
        </div>
        <button
          onClick={() => window.print()}
          className="text-sm font-medium text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded border border-slate-300 hover:border-slate-400 transition-colors flex-shrink-0"
        >
          Export PDF
        </button>
      </div>

      {/* Edit Modal */}
      <EditModal
        item={editItem}
        canEdit={canEdit}
        onClose={() => setEditItem(null)}
        onSave={handleUpdate}
        onSaveAsTemplate={item => { handleSaveAsTemplate(item); }}
      />

      {/* Add Item Modal */}
      <Modal open={addModalOpen} onClose={() => setAddModalOpen(false)} title="Add Checklist Item" size="lg">
        <div className="flex border-b border-slate-200 mb-4 -mt-2">
          {(['new', 'template'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setAddTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                addTab === tab
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab === 'new' ? 'New Question' : `From Template (${templates.length})`}
            </button>
          ))}
        </div>

        {addTab === 'new' ? (
          <form onSubmit={handleAddItem} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Clause <span className="text-red-500">*</span>
              </label>
              <select
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
                value={addForm.clauseRef}
                onChange={e => setAddForm(f => ({ ...f, clauseRef: e.target.value }))}
              >
                <option value="">Select a clause...</option>
                {availableClauses.map(c => (
                  <option key={c.clauseRef} value={c.clauseRef}>
                    {c.clauseRef} — {c.clauseTitle}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Question / Topic <span className="text-red-500">*</span>
              </label>
              <textarea
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                rows={3}
                required
                placeholder="e.g., Are access rights reviewed quarterly?"
                value={addForm.question}
                onChange={e => setAddForm(f => ({ ...f, question: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Initial Status</label>
              <select
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={addForm.status}
                onChange={e => setAddForm(f => ({ ...f, status: e.target.value as FindingStatus }))}
              >
                {FINDING_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setAddModalOpen(false)}
                className="flex-1 border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button type="submit"
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition-colors">
                Add Item
              </button>
            </div>
          </form>
        ) : (
          <div>
            {templates.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-10">
                No templates yet. Open an item and use &quot;Save as template&quot;.
              </p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {templates.map(t => (
                  <div key={t.id} className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-slate-500">{t.clauseRef}</p>
                      <p className="text-sm text-slate-800 mt-0.5 leading-snug">{t.question}</p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => handleAddFromTemplate(t)}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-100 transition-colors">
                        Use
                      </button>
                      <button
                        onClick={() => {
                          setTemplates(prev => prev.filter(x => x.id !== t.id));
                          deleteChecklistTemplate(t.id).catch(e => console.error('Delete template failed:', e));
                        }}
                        className="text-xs text-slate-400 hover:text-red-600 px-1.5 py-1 rounded hover:bg-red-50 transition-colors">
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
