'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { ChecklistItem, ClauseTemplate, FindingStatus, PlanSession, AuditPlan } from '@/lib/types';
import {
  getAuditPlans,
  getChecklistItems,
  saveChecklistItem,
  deleteChecklistItem,
  getPlanSessions,
  uid,
} from '@/lib/store';
import { ALL_CLAUSES } from '@/lib/seed-data';
import Modal from '@/components/Modal';

// ── Constants ─────────────────────────────────────────────────────────────────

const FINDING_STATUSES: FindingStatus[] = [
  'Not Assessed', 'Conformity', 'OBS', 'OFI', 'NC-Minor', 'NC-Major',
];

const GENERAL_KEYWORDS = [
  'เปิดประชุม', 'ปิดประชุม', 'ประชุม ia', 'สรุปผล',
  'opening', 'closing', 'wrap up', 'debrief',
];

const STATUS_BADGE: Record<FindingStatus, string> = {
  'Not Assessed': 'bg-slate-100 text-slate-500 border-slate-200',
  'Conformity':   'bg-green-100 text-green-700 border-green-200',
  'OBS':          'bg-orange-100 text-orange-700 border-orange-200',
  'OFI':          'bg-blue-100 text-blue-700 border-blue-200',
  'NC-Minor':     'bg-orange-200 text-orange-800 border-orange-300',
  'NC-Major':     'bg-red-100 text-red-700 border-red-200',
};

// ── Types ─────────────────────────────────────────────────────────────────────

type SummaryStatus = 'Passed' | 'Issues Found' | 'In Progress';

const SUMMARY_BADGE: Record<SummaryStatus, string> = {
  'Passed':       'bg-green-100 text-green-700 border-green-200',
  'Issues Found': 'bg-red-100 text-red-700 border-red-200',
  'In Progress':  'bg-yellow-100 text-yellow-700 border-yellow-200',
};

const SUMMARY_FILTER_ACTIVE: Record<string, string> = {
  '':             'bg-slate-800 text-white border-slate-800',
  'Passed':       'bg-green-600 text-white border-green-600',
  'Issues Found': 'bg-red-600 text-white border-red-600',
  'In Progress':  'bg-yellow-500 text-white border-yellow-500',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function isGeneralSession(s: PlanSession): boolean {
  const area = s.areaOfAudit.toLowerCase();
  return GENERAL_KEYWORDS.some(kw => area.includes(kw));
}

function clauseSummary(items: ChecklistItem[]): SummaryStatus {
  if (items.length === 0) return 'In Progress';
  if (items.some(i => ['OBS', 'OFI', 'NC-Minor', 'NC-Major'].includes(i.status))) return 'Issues Found';
  if (items.some(i => i.status === 'Not Assessed')) return 'In Progress';
  return 'Passed';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryBadge({ status }: { status: SummaryStatus }) {
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${SUMMARY_BADGE[status]}`}>
      {status}
    </span>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-16 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
      <p className="text-slate-500 text-sm">{message}</p>
    </div>
  );
}

interface RowProps {
  item: ChecklistItem;
  onStatusChange: (s: FindingStatus) => void;
  onRemarkBlur: (r: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}

function ChecklistItemRow({ item, onStatusChange, onRemarkBlur, onEdit, onDelete }: RowProps) {
  const displayQuestion = item.question?.trim() || item.clauseTitle || '(no question)';
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <p className="text-sm text-slate-800 flex-1 min-w-0 leading-snug">{displayQuestion}</p>
        <div className="flex items-center gap-1 flex-shrink-0">
          <select
            className={`text-xs border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium ${STATUS_BADGE[item.status]}`}
            value={item.status}
            onChange={e => onStatusChange(e.target.value as FindingStatus)}
          >
            {FINDING_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button
            onClick={onEdit}
            className="text-xs text-slate-400 hover:text-blue-600 px-1.5 py-1 rounded hover:bg-blue-50 transition-colors"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="text-xs text-slate-400 hover:text-red-600 px-1.5 py-1 rounded hover:bg-red-50 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>
      <textarea
        key={`${item.id}-remark`}
        className="w-full text-xs text-slate-600 border border-slate-200 rounded px-2 py-1.5 bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
        rows={2}
        placeholder="Remark / evidence / observation..."
        defaultValue={item.notes}
        onBlur={e => onRemarkBlur(e.target.value)}
      />
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const emptyForm = () => ({ question: '', status: 'Not Assessed' as FindingStatus, remark: '' });

export default function ChecklistPage() {
  const [plans, setPlans] = useState<AuditPlan[]>([]);
  const [planSessions, setPlanSessions] = useState<PlanSession[]>([]);
  const [items, setItems] = useState<ChecklistItem[]>([]);

  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [filterStatus, setFilterStatus] = useState<'' | FindingStatus>('');
  const [filterSummary, setFilterSummary] = useState<'' | SummaryStatus>('');
  const [search, setSearch] = useState('');
  const [expandedClauses, setExpandedClauses] = useState<Set<string>>(new Set());

  // Modal
  const [addModalClause, setAddModalClause] = useState<ClauseTemplate | null>(null);
  const [editItem, setEditItem] = useState<ChecklistItem | null>(null);
  const [form, setForm] = useState(emptyForm());

  // ── Load ────────────────────────────────────────────────────────────────────

  const reload = useCallback((planId?: string) => {
    const p = getAuditPlans();
    setPlans(p);
    setItems(getChecklistItems());
    if (planId !== undefined) setPlanSessions(getPlanSessions(planId));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (plans.length > 0 && !selectedPlanId) {
      const pid = plans[0].id;
      setSelectedPlanId(pid);
      setPlanSessions(getPlanSessions(pid));
    }
  }, [plans, selectedPlanId]);

  // ── Derived ─────────────────────────────────────────────────────────────────

  const auditSessions = useMemo(
    () => planSessions.filter(s => !isGeneralSession(s) && s.relatedClauses.length > 0),
    [planSessions],
  );

  const selectedSession = auditSessions.find(s => s.id === selectedSessionId) ?? null;

  const sessionClauses = useMemo((): ClauseTemplate[] => {
    if (selectedSessionId) {
      const session = auditSessions.find(s => s.id === selectedSessionId);
      if (!session) return [];
      return (session.relatedClauses ?? []).flatMap(ref => ALL_CLAUSES.find(c => c.clauseRef === ref) ?? []);
    }
    // All Sessions — derive clauses from stored items for this plan
    const refs = new Set(items.filter(i => i.sessionId === selectedPlanId).map(i => i.clauseRef));
    return Array.from(refs).flatMap(ref => ALL_CLAUSES.find(c => c.clauseRef === ref) ?? []);
  }, [selectedSessionId, auditSessions, items, selectedPlanId]);

  const itemsByClause = useMemo(() => {
    const map: Record<string, ChecklistItem[]> = {};
    for (const item of items.filter(i => i.sessionId === selectedPlanId)) {
      (map[item.clauseRef] ??= []).push(item);
    }
    return map;
  }, [items, selectedPlanId]);

  const PILL_STATUSES: FindingStatus[] = ['Conformity', 'OBS', 'OFI', 'NC-Minor', 'NC-Major'];

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = Object.fromEntries(PILL_STATUSES.map(s => [s, 0]));
    for (const c of sessionClauses) {
      for (const item of itemsByClause[c.clauseRef] ?? []) {
        if (counts[item.status] !== undefined) counts[item.status]++;
      }
    }
    return counts;
  }, [sessionClauses, itemsByClause]);

  const summaryCounts = useMemo(() => {
    const counts: Record<SummaryStatus, number> = { 'Passed': 0, 'Issues Found': 0, 'In Progress': 0 };
    for (const c of sessionClauses) counts[clauseSummary(itemsByClause[c.clauseRef] ?? [])]++;
    return counts;
  }, [sessionClauses, itemsByClause]);

  const visibleClauses = useMemo(() => {
    let clauses = sessionClauses;
    if (search) {
      const q = search.toLowerCase();
      clauses = clauses.filter(c =>
        c.clauseRef.toLowerCase().includes(q) || c.clauseTitle.toLowerCase().includes(q),
      );
    }
    if (filterStatus) {
      clauses = clauses.filter(c =>
        (itemsByClause[c.clauseRef] ?? []).some(i => i.status === filterStatus),
      );
    }
    if (filterSummary) {
      clauses = clauses.filter(c => clauseSummary(itemsByClause[c.clauseRef] ?? []) === filterSummary);
    }
    return clauses;
  }, [sessionClauses, itemsByClause, filterStatus, filterSummary, search]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  function toggleClause(ref: string) {
    setExpandedClauses(prev => {
      const next = new Set(prev);
      next.has(ref) ? next.delete(ref) : next.add(ref);
      return next;
    });
  }

  function openAdd(clause: ClauseTemplate) {
    setEditItem(null);
    setForm(emptyForm());
    setAddModalClause(clause);
  }

  function openEdit(item: ChecklistItem) {
    setEditItem(item);
    setForm({ question: item.question ?? '', status: item.status, remark: item.notes });
    setAddModalClause(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const now = new Date().toISOString();
    if (editItem) {
      saveChecklistItem({ ...editItem, question: form.question, status: form.status, notes: form.remark, updatedAt: now });
    } else if (addModalClause) {
      saveChecklistItem({
        id: uid(), createdAt: now, updatedAt: now,
        sessionId: selectedPlanId,
        framework: addModalClause.framework,
        clauseRef: addModalClause.clauseRef,
        clauseTitle: addModalClause.clauseTitle,
        requirement: addModalClause.requirement,
        question: form.question,
        status: form.status,
        notes: form.remark,
        evidence: '',
      });
    }
    setAddModalClause(null);
    setEditItem(null);
    reload(selectedPlanId);
  }

  function quickStatus(item: ChecklistItem, status: FindingStatus) {
    const updated = { ...item, status, updatedAt: new Date().toISOString() };
    saveChecklistItem(updated);
    setItems(prev => prev.map(i => i.id === item.id ? updated : i));
  }

  function saveRemark(item: ChecklistItem, remark: string) {
    if (remark === item.notes) return;
    const updated = { ...item, notes: remark, updatedAt: new Date().toISOString() };
    saveChecklistItem(updated);
    setItems(prev => prev.map(i => i.id === item.id ? updated : i));
  }

  const modalOpen = addModalClause !== null || editItem !== null;
  const modalTitle = editItem
    ? 'Edit Checklist Item'
    : `Add Checklist — ${addModalClause?.clauseRef}`;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Checklist</h1>
        <p className="text-slate-500 text-sm mt-1">Review controls and record findings by session</p>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Audit Plan */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Audit Plan</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedPlanId}
              onChange={e => {
                const pid = e.target.value;
                setSelectedPlanId(pid);
                setSelectedSessionId('');
                setFilterStatus('');
                setFilterSummary('');
                setSearch('');
                setExpandedClauses(new Set());
                setPlanSessions(getPlanSessions(pid));
              }}
            >
              {plans.length === 0 && <option value="">No plans</option>}
              {plans.map(p => <option key={p.id} value={p.id}>{p.objective}</option>)}
            </select>
          </div>

          {/* Session */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Session</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedSessionId}
              onChange={e => {
                setSelectedSessionId(e.target.value);
                setFilterStatus('');
                setFilterSummary('');
                setSearch('');
                setExpandedClauses(new Set());
              }}
            >
              <option value="">All Sessions</option>
              {auditSessions.map(s => (
                <option key={s.id} value={s.id}>
                  Day {s.day}{s.time ? ` · ${s.time}` : ''} · {s.areaOfAudit}
                </option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value as '' | FindingStatus)}
            >
              <option value="">All Statuses</option>
              {PILL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Search */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Search</label>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Clause ref or title..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Summary pills */}
        {selectedPlanId && (
          <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
            {PILL_STATUSES.map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
                className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                  STATUS_BADGE[s]
                } ${filterStatus === s ? 'ring-2 ring-blue-500' : ''}`}
              >
                {s} ×{statusCounts[s] ?? 0}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      {plans.length === 0 ? (
        <EmptyState message="Create an audit plan first to use the checklist." />
      ) : visibleClauses.length === 0 ? (
        <EmptyState message={
          filterStatus || filterSummary || search
            ? 'No clauses match the current filters.'
            : selectedSessionId
              ? 'No recognised clauses for this session. Check the Related Clauses field in the session.'
              : 'No checklist items yet. Select a session and add checklist items.'
        } />
      ) : (
        <div className="space-y-2">
          {visibleClauses.map(clause => {
            const clauseItems = itemsByClause[clause.clauseRef] ?? [];
            const summary = clauseSummary(clauseItems);
            const expanded = expandedClauses.has(clause.clauseRef);

            return (
              <div key={clause.clauseRef} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                {/* Accordion header */}
                <button
                  onClick={() => toggleClause(clause.clauseRef)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                >
                  <svg
                    className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>

                  <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded flex-shrink-0">
                    {clause.clauseRef}
                  </span>

                  <span className="text-sm font-medium text-slate-800 flex-1 min-w-0 truncate">
                    {clause.clauseTitle}
                  </span>

                  <span className="text-xs text-slate-400 flex-shrink-0">
                    {clauseItems.length} item{clauseItems.length !== 1 ? 's' : ''}
                  </span>

                  <SummaryBadge status={summary} />
                </button>

                {/* Expanded body */}
                {expanded && (
                  <div className="border-t border-slate-100 bg-slate-50">
                    {/* Control requirement */}
                    {clause.requirement && (
                      <div className="px-4 py-3 border-b border-slate-100">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                          Control Requirement
                        </p>
                        <p className="text-xs text-slate-600 leading-relaxed">{clause.requirement}</p>
                      </div>
                    )}

                    {/* Checklist items */}
                    <div className="px-4 py-3 space-y-2">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Checklist Items
                        </p>
                        <button
                          onClick={() => openAdd(clause)}
                          className="text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                        >
                          + Add Checklist
                        </button>
                      </div>

                      {clauseItems.length === 0 ? (
                        <p className="text-xs text-slate-400 py-2 text-center">
                          No checklist items yet —{' '}
                          <button onClick={() => openAdd(clause)} className="text-blue-600 hover:underline">
                            add the first one
                          </button>
                        </p>
                      ) : (
                        clauseItems.map(item => (
                          <ChecklistItemRow
                            key={item.id}
                            item={item}
                            onStatusChange={status => quickStatus(item, status)}
                            onRemarkBlur={remark => saveRemark(item, remark)}
                            onEdit={() => openEdit(item)}
                            onDelete={() => { deleteChecklistItem(item.id); reload(selectedPlanId); }}
                          />
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setAddModalClause(null); setEditItem(null); }}
        title={modalTitle}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Question / Topic <span className="text-red-500">*</span>
            </label>
            <textarea
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={3}
              required
              placeholder="e.g., Are privileged accounts documented and reviewed regularly?"
              value={form.question}
              onChange={e => setForm(f => ({ ...f, question: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value as FindingStatus }))}
            >
              {FINDING_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Remark</label>
            <textarea
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={3}
              placeholder="Findings, evidence, observations..."
              value={form.remark}
              onChange={e => setForm(f => ({ ...f, remark: e.target.value }))}
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => { setAddModalClause(null); setEditItem(null); }}
              className="flex-1 border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {editItem ? 'Save Changes' : 'Add Item'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
