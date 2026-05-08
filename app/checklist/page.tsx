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

const STATUS_BORDER: Record<FindingStatus, string> = {
  'Not Assessed': 'border-l-slate-300',
  'Conformity':   'border-l-green-500',
  'OBS':          'border-l-orange-400',
  'OFI':          'border-l-blue-500',
  'NC-Minor':     'border-l-orange-600',
  'NC-Major':     'border-l-red-500',
};

const STATUS_BADGE: Record<FindingStatus, string> = {
  'Not Assessed': 'bg-slate-100 text-slate-500',
  'Conformity':   'bg-green-100 text-green-700',
  'OBS':          'bg-orange-100 text-orange-700',
  'OFI':          'bg-blue-100 text-blue-700',
  'NC-Minor':     'bg-orange-200 text-orange-800',
  'NC-Major':     'bg-red-100 text-red-700',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function isGeneralSession(s: PlanSession): boolean {
  const area = s.areaOfAudit.toLowerCase();
  return GENERAL_KEYWORDS.some(kw => area.includes(kw));
}

// ── ChecklistItemCard ─────────────────────────────────────────────────────────

interface CardProps {
  item: ChecklistItem;
  index: number;
  onUpdate: (updated: ChecklistItem) => void;
  onDelete: () => void;
  onSaveAsTemplate: () => void;
}

function ChecklistItemCard({ item, index, onUpdate, onDelete, onSaveAsTemplate }: CardProps) {
  const needsFinding = NEEDS_FINDING.has(item.status);

  function patch(fields: Partial<ChecklistItem>) {
    onUpdate({ ...item, ...fields, updatedAt: new Date().toISOString() });
  }

  return (
    <div className={`bg-white rounded-lg border border-slate-200 border-l-4 ${STATUS_BORDER[item.status]} shadow-sm`}>
      {/* Top row */}
      <div className="flex items-start gap-3 p-4">
        <span className="text-xs font-mono text-slate-400 w-6 flex-shrink-0 pt-0.5 select-none">
          #{index}
        </span>

        <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded flex-shrink-0">
          {item.clauseRef}
        </span>

        <p className="text-sm text-slate-800 flex-1 min-w-0 leading-snug">
          {item.question?.trim() || item.clauseTitle}
        </p>

        <select
          className={`text-xs rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium flex-shrink-0 border-0 ${STATUS_BADGE[item.status]}`}
          value={item.status}
          onChange={e => patch({ status: e.target.value as FindingStatus })}
        >
          {FINDING_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={onSaveAsTemplate}
            title="Save as template"
            className="text-slate-400 hover:text-amber-500 px-1.5 py-1 rounded hover:bg-amber-50 transition-colors text-sm"
          >
            ☆
          </button>
          <button
            onClick={onDelete}
            title="Delete item"
            className="text-xs text-slate-400 hover:text-red-600 px-1.5 py-1 rounded hover:bg-red-50 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 pb-4 space-y-2">
        <textarea
          key={`${item.id}-notes`}
          className="w-full text-xs text-slate-600 border border-slate-200 rounded px-2 py-1.5 bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
          rows={2}
          placeholder="Findings / evidence / observation..."
          defaultValue={item.notes}
          onBlur={e => { if (e.target.value !== item.notes) patch({ notes: e.target.value }); }}
        />

        {needsFinding && (
          <div className="border border-orange-200 rounded-lg p-3 bg-orange-50 space-y-2">
            <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">Finding Details</p>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Recommendation</label>
              <textarea
                key={`${item.id}-rec`}
                className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                rows={2}
                placeholder="Enter recommendation..."
                defaultValue={item.recommendation ?? ''}
                onBlur={e => { if (e.target.value !== (item.recommendation ?? '')) patch({ recommendation: e.target.value }); }}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Due Date</label>
              <input
                key={`${item.id}-due`}
                type="date"
                className="text-xs border border-slate-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                defaultValue={item.dueDate ?? ''}
                onBlur={e => { if (e.target.value !== (item.dueDate ?? '')) patch({ dueDate: e.target.value }); }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ChecklistPage() {
  const [plans, setPlans] = useState<AuditPlan[]>([]);
  const [planSessions, setPlanSessions] = useState<PlanSession[]>([]);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);

  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [filterStatus, setFilterStatus] = useState<'' | FindingStatus>('');

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addTab, setAddTab] = useState<'new' | 'template'>('new');
  const [addForm, setAddForm] = useState({
    clauseRef: '',
    question: '',
    status: 'Not Assessed' as FindingStatus,
  });

  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);

  // ── Load ────────────────────────────────────────────────────────────────────

  const reload = useCallback(async () => {
    setLoading(true);
    setDbError(null);
    try {
      const [ps, is, ts] = await Promise.all([
        getAuditPlans(),
        getChecklistItems(),
        getChecklistTemplates(),
      ]);
      setPlans(ps);
      setItems(is.filter(i => !isNistItem(i)));
      setTemplates(ts);
    } catch (e) {
      setDbError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (plans.length > 0 && !selectedPlanId) {
      const pid = plans[0].id;
      setSelectedPlanId(pid);
      getPlanSessions(pid).then(setPlanSessions).catch(() => {});
    }
  }, [plans, selectedPlanId]);

  // ── Derived ─────────────────────────────────────────────────────────────────

  const auditSessions = useMemo(
    () => planSessions.filter(s => !isGeneralSession(s) && s.relatedClauses.length > 0),
    [planSessions],
  );

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

  // ── Handlers ────────────────────────────────────────────────────────────────

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

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (dbError) return (
    <div className="text-center py-16 bg-red-50 rounded-xl border border-red-200 mx-4 mt-8">
      <p className="text-red-600 font-medium mb-1">Unable to connect to database</p>
      <p className="text-sm text-red-500 mb-4">{dbError}</p>
      <button onClick={reload} className="text-sm text-blue-600 hover:underline">Try again</button>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-28">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Checklist</h1>
        <p className="text-slate-500 text-sm mt-1">Record findings item by item</p>
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

      {/* Session info card */}
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

      {/* Content */}
      {plans.length === 0 ? (
        <div className="text-center py-16 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
          <p className="text-slate-500 text-sm">Create an audit plan first to use the checklist.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-slate-500">
              {visibleItems.length} item{visibleItems.length !== 1 ? 's' : ''}
              {filterStatus ? ` · ${filterStatus}` : ''}
            </p>
            <button
              onClick={() => { setAddTab('new'); setAddModalOpen(true); }}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              + Add Item
            </button>
          </div>

          {visibleItems.length === 0 ? (
            <div className="text-center py-16 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
              <p className="text-slate-500 text-sm mb-3">
                {filterStatus ? `No items with status "${filterStatus}".` : 'No checklist items yet.'}
              </p>
              {!filterStatus && (
                <button
                  onClick={() => { setAddTab('new'); setAddModalOpen(true); }}
                  className="text-blue-600 hover:underline text-sm"
                >
                  Add the first item →
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {visibleItems.map((item, idx) => (
                <ChecklistItemCard
                  key={item.id}
                  item={item}
                  index={idx + 1}
                  onUpdate={handleUpdate}
                  onDelete={() => handleDelete(item.id)}
                  onSaveAsTemplate={() => handleSaveAsTemplate(item)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Fixed bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-3 flex items-center gap-4 z-40 print:hidden">
        <div className="flex items-center gap-4 text-xs text-slate-600 flex-1 flex-wrap">
          <span>
            <span className="font-semibold text-slate-900">{sessionItems.length}</span> items
          </span>
          <span>
            <span className="font-semibold text-slate-900">{assessed}</span> assessed
          </span>
          {statusCounts['NC-Major'] > 0 && (
            <span className="font-medium text-red-600">NC-Major: {statusCounts['NC-Major']}</span>
          )}
          {statusCounts['NC-Minor'] > 0 && (
            <span className="font-medium text-orange-700">NC-Minor: {statusCounts['NC-Minor']}</span>
          )}
          {statusCounts['OBS'] > 0 && (
            <span className="font-medium text-orange-600">OBS: {statusCounts['OBS']}</span>
          )}
          {statusCounts['OFI'] > 0 && (
            <span className="font-medium text-blue-600">OFI: {statusCounts['OFI']}</span>
          )}
        </div>
        <button
          onClick={() => window.print()}
          className="text-sm font-medium text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded border border-slate-300 hover:border-slate-400 transition-colors flex-shrink-0"
        >
          Export PDF
        </button>
      </div>

      {/* Add Item Modal */}
      <Modal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        title="Add Checklist Item"
        size="lg"
      >
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
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                className="flex-1 border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Add Item
              </button>
            </div>
          </form>
        ) : (
          <div>
            {templates.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-10">
                No templates yet. Use the ☆ button on any item to save it as a template.
              </p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {templates.map(t => (
                  <div
                    key={t.id}
                    className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-slate-500">{t.clauseRef}</p>
                      <p className="text-sm text-slate-800 mt-0.5 leading-snug">{t.question}</p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleAddFromTemplate(t)}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-100 transition-colors"
                      >
                        Use
                      </button>
                      <button
                        onClick={() => {
                          setTemplates(prev => prev.filter(x => x.id !== t.id));
                          deleteChecklistTemplate(t.id).catch(e => console.error('Delete template failed:', e));
                        }}
                        className="text-xs text-slate-400 hover:text-red-600 px-1.5 py-1 rounded hover:bg-red-50 transition-colors"
                      >
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
