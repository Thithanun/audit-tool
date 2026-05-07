'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ChecklistItem, FindingStatus, CorrectiveAction, CorrectiveActionStatus } from '@/lib/types';
import {
  getSessions,
  getChecklistItems,
  saveChecklistItem,
  deleteChecklistItem,
  getCorrectiveActions,
  saveCorrectiveAction,
  deleteCorrectiveAction,
  uid,
} from '@/lib/store';
import type { AuditSession } from '@/lib/types';
import { ALL_CLAUSES } from '@/lib/seed-data';
import StatusBadge, { FINDING_STATUSES, CA_STATUSES } from '@/components/StatusBadge';
import Modal from '@/components/Modal';

const emptyItem = (sessionId = '', framework: ChecklistItem['framework'] = 'ISO27001'): Omit<ChecklistItem, 'id' | 'createdAt' | 'updatedAt'> => ({
  sessionId,
  framework,
  clauseRef: '',
  clauseTitle: '',
  requirement: '',
  status: 'Not Assessed',
  notes: '',
  evidence: '',
});

const emptyCA = (item: ChecklistItem): Omit<CorrectiveAction, 'id' | 'createdAt' | 'updatedAt'> => ({
  checklistItemId: item.id,
  sessionId: item.sessionId,
  clauseRef: item.clauseRef,
  description: '',
  rootCause: '',
  owner: '',
  dueDate: '',
  status: 'Open',
  closureNotes: '',
});

export default function ChecklistPage() {
  const [sessions, setSessions] = useState<AuditSession[]>([]);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [caMap, setCaMap] = useState<Record<string, CorrectiveAction[]>>({});

  const [selectedSession, setSelectedSession] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterClause, setFilterClause] = useState<string>('');
  const [search, setSearch] = useState('');

  const [itemModal, setItemModal] = useState(false);
  const [editItem, setEditItem] = useState<ChecklistItem | null>(null);
  const [itemForm, setItemForm] = useState(emptyItem());

  const [caModal, setCaModal] = useState(false);
  const [caTarget, setCaTarget] = useState<ChecklistItem | null>(null);
  const [editCA, setEditCA] = useState<CorrectiveAction | null>(null);
  const [caForm, setCaForm] = useState<Omit<CorrectiveAction, 'id' | 'createdAt' | 'updatedAt'> | null>(null);

  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const reload = useCallback(() => {
    setSessions(getSessions());
    const all = getChecklistItems();
    setItems(all);
    const cas = getCorrectiveActions();
    const map: Record<string, CorrectiveAction[]> = {};
    for (const ca of cas) {
      if (!map[ca.checklistItemId]) map[ca.checklistItemId] = [];
      map[ca.checklistItemId].push(ca);
    }
    setCaMap(map);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (sessions.length > 0 && !selectedSession) {
      setSelectedSession(sessions[0].id);
    }
  }, [sessions, selectedSession]);

  const currentSession = sessions.find(s => s.id === selectedSession);

  const clauseGroups = useMemo(() => {
    if (!currentSession) return [];
    const sessionItems = items.filter(i => i.sessionId === selectedSession);
    const groups = new Set(sessionItems.map(i => i.clauseRef.split('.').slice(0, 2).join('.')));
    return Array.from(groups).sort();
  }, [items, selectedSession, currentSession]);

  const filtered = useMemo(() => {
    return items.filter(i => {
      if (i.sessionId !== selectedSession) return false;
      if (filterStatus && i.status !== filterStatus) return false;
      if (filterClause && !i.clauseRef.startsWith(filterClause)) return false;
      if (search) {
        const q = search.toLowerCase();
        return i.clauseRef.toLowerCase().includes(q) || i.clauseTitle.toLowerCase().includes(q) || i.notes.toLowerCase().includes(q);
      }
      return true;
    });
  }, [items, selectedSession, filterStatus, filterClause, search]);

  function openCreateItem() {
    setEditItem(null);
    setItemForm(emptyItem(selectedSession, currentSession?.framework ?? 'ISO27001'));
    setItemModal(true);
  }

  function openEditItem(item: ChecklistItem) {
    setEditItem(item);
    setItemForm({ sessionId: item.sessionId, framework: item.framework, clauseRef: item.clauseRef, clauseTitle: item.clauseTitle, requirement: item.requirement, status: item.status, notes: item.notes, evidence: item.evidence });
    setItemModal(true);
  }

  function handleClauseSelect(clauseRef: string) {
    const clause = ALL_CLAUSES.find(c => c.clauseRef === clauseRef);
    if (clause) {
      setItemForm(f => ({ ...f, clauseRef: clause.clauseRef, clauseTitle: clause.clauseTitle, requirement: clause.requirement }));
    } else {
      setItemForm(f => ({ ...f, clauseRef }));
    }
  }

  function handleItemSubmit(e: React.FormEvent) {
    e.preventDefault();
    const now = new Date().toISOString();
    if (editItem) {
      saveChecklistItem({ ...editItem, ...itemForm, updatedAt: now });
    } else {
      saveChecklistItem({ id: uid(), createdAt: now, updatedAt: now, ...itemForm });
    }
    setItemModal(false);
    reload();
  }

  function quickUpdateStatus(item: ChecklistItem, status: FindingStatus) {
    const now = new Date().toISOString();
    saveChecklistItem({ ...item, status, updatedAt: now });
    reload();
  }

  // CA management
  function openAddCA(item: ChecklistItem) {
    setCaTarget(item);
    setEditCA(null);
    setCaForm(emptyCA(item));
    setCaModal(true);
  }

  function openEditCA(ca: CorrectiveAction, item: ChecklistItem) {
    setCaTarget(item);
    setEditCA(ca);
    setCaForm({ checklistItemId: ca.checklistItemId, sessionId: ca.sessionId, clauseRef: ca.clauseRef, description: ca.description, rootCause: ca.rootCause, owner: ca.owner, dueDate: ca.dueDate, status: ca.status, closureNotes: ca.closureNotes });
    setCaModal(true);
  }

  function handleCASubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!caForm) return;
    const now = new Date().toISOString();
    if (editCA) {
      saveCorrectiveAction({ ...editCA, ...caForm, updatedAt: now });
    } else {
      saveCorrectiveAction({ id: uid(), createdAt: now, updatedAt: now, ...caForm });
    }
    setCaModal(false);
    reload();
  }

  const availableClauses = useMemo(() => {
    if (!currentSession) return ALL_CLAUSES;
    return ALL_CLAUSES.filter(c => c.framework === currentSession.framework);
  }, [currentSession]);

  const statusCounts = useMemo(() => {
    const sessionItems = items.filter(i => i.sessionId === selectedSession);
    const counts: Record<string, number> = {};
    for (const s of FINDING_STATUSES) counts[s] = 0;
    for (const i of sessionItems) counts[i.status] = (counts[i.status] ?? 0) + 1;
    return counts;
  }, [items, selectedSession]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Checklist</h1>
          <p className="text-slate-500 text-sm mt-1">Review controls and record findings</p>
        </div>
        <button
          onClick={openCreateItem}
          disabled={!selectedSession}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Item
        </button>
      </div>

      {/* Session selector + filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Session</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedSession}
              onChange={e => { setSelectedSession(e.target.value); setFilterClause(''); setFilterStatus(''); }}
            >
              {sessions.length === 0 && <option value="">No sessions</option>}
              {sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Clause Group</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={filterClause}
              onChange={e => setFilterClause(e.target.value)}
            >
              <option value="">All Clauses</option>
              {clauseGroups.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
            >
              <option value="">All Statuses</option>
              {FINDING_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
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

        {/* Status summary pills */}
        {selectedSession && (
          <div className="flex flex-wrap gap-2 pt-1">
            {FINDING_STATUSES.map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
                className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${filterStatus === s ? 'ring-2 ring-blue-500' : ''}`}
              >
                <StatusBadge status={s} size="sm" /> ×{statusCounts[s] ?? 0}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Checklist table */}
      {sessions.length === 0 ? (
        <div className="text-center py-16 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
          <p className="text-slate-500">Create an audit session first</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
          <p className="text-slate-500">No checklist items match your filters</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(item => {
            const cas = caMap[item.id] ?? [];
            const expanded = expandedItem === item.id;
            return (
              <div key={item.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    onClick={() => setExpandedItem(expanded ? null : item.id)}
                    className="text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
                  >
                    <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>

                  <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded flex-shrink-0">
                    {item.clauseRef}
                  </span>

                  <span className="text-sm font-medium text-slate-800 flex-1 min-w-0 truncate">
                    {item.clauseTitle}
                  </span>

                  {cas.length > 0 && (
                    <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full flex-shrink-0">
                      {cas.length} CA
                    </span>
                  )}

                  <div className="flex-shrink-0">
                    <select
                      className="text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      value={item.status}
                      onChange={e => quickUpdateStatus(item, e.target.value as FindingStatus)}
                    >
                      {FINDING_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>

                  <button
                    onClick={() => openEditItem(item)}
                    className="text-xs text-slate-500 hover:text-blue-600 flex-shrink-0 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => { deleteChecklistItem(item.id); reload(); }}
                    className="text-xs text-slate-500 hover:text-red-600 flex-shrink-0 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                  >
                    ✕
                  </button>
                </div>

                {expanded && (
                  <div className="border-t border-slate-100 px-4 py-4 space-y-4 bg-slate-50">
                    {item.requirement && (
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Requirement</p>
                        <p className="text-sm text-slate-700">{item.requirement}</p>
                      </div>
                    )}
                    {item.notes && (
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Notes / Findings</p>
                        <p className="text-sm text-slate-700 whitespace-pre-wrap">{item.notes}</p>
                      </div>
                    )}
                    {item.evidence && (
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Evidence</p>
                        <p className="text-sm text-slate-700 whitespace-pre-wrap">{item.evidence}</p>
                      </div>
                    )}

                    {/* Corrective Actions */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Corrective Actions</p>
                        <button
                          onClick={() => openAddCA(item)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          + Add CA
                        </button>
                      </div>
                      {cas.length === 0 ? (
                        <p className="text-xs text-slate-400">No corrective actions</p>
                      ) : (
                        <div className="space-y-2">
                          {cas.map(ca => (
                            <div key={ca.id} className="bg-white rounded-lg border border-slate-200 p-3 flex items-start gap-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-slate-800">{ca.description}</p>
                                <div className="flex gap-3 text-xs text-slate-500 mt-1">
                                  {ca.owner && <span>👤 {ca.owner}</span>}
                                  {ca.dueDate && <span>📅 {ca.dueDate}</span>}
                                </div>
                              </div>
                              <StatusBadge status={ca.status} type="ca" size="sm" />
                              <button onClick={() => openEditCA(ca, item)} className="text-xs text-slate-400 hover:text-blue-600">Edit</button>
                              <button onClick={() => { deleteCorrectiveAction(ca.id); reload(); }} className="text-xs text-slate-400 hover:text-red-600">✕</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Item Modal */}
      <Modal
        open={itemModal}
        onClose={() => setItemModal(false)}
        title={editItem ? 'Edit Checklist Item' : 'Add Checklist Item'}
        size="xl"
      >
        <form onSubmit={handleItemSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Clause Reference</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={itemForm.clauseRef}
              onChange={e => handleClauseSelect(e.target.value)}
              required
            >
              <option value="">Select clause...</option>
              {availableClauses.map(c => (
                <option key={c.clauseRef} value={c.clauseRef}>
                  {c.clauseRef} — {c.clauseTitle}
                </option>
              ))}
            </select>
          </div>

          {itemForm.requirement && (
            <div className="bg-blue-50 rounded-lg p-3">
              <p className="text-xs font-semibold text-blue-700 mb-1">Standard Requirement</p>
              <p className="text-xs text-blue-800">{itemForm.requirement}</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={itemForm.status}
              onChange={e => setItemForm(f => ({ ...f, status: e.target.value as FindingStatus }))}
            >
              {FINDING_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes / Findings</label>
            <textarea
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={4}
              placeholder="Describe what was found during audit..."
              value={itemForm.notes}
              onChange={e => setItemForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Evidence</label>
            <textarea
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={3}
              placeholder="Document references, screenshots, interviews..."
              value={itemForm.evidence}
              onChange={e => setItemForm(f => ({ ...f, evidence: e.target.value }))}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setItemModal(false)} className="flex-1 border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition-colors">
              {editItem ? 'Save Changes' : 'Add Item'}
            </button>
          </div>
        </form>
      </Modal>

      {/* CA Modal */}
      <Modal
        open={caModal}
        onClose={() => setCaModal(false)}
        title={editCA ? 'Edit Corrective Action' : `Add Corrective Action — ${caTarget?.clauseRef}`}
        size="lg"
      >
        {caForm && (
          <form onSubmit={handleCASubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
              <textarea
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                rows={3}
                required
                placeholder="Describe the corrective action required..."
                value={caForm.description}
                onChange={e => setCaForm(f => f ? { ...f, description: e.target.value } : f)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Root Cause</label>
              <textarea
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                rows={2}
                placeholder="Identified root cause..."
                value={caForm.rootCause}
                onChange={e => setCaForm(f => f ? { ...f, rootCause: e.target.value } : f)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Owner</label>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Responsible person"
                  value={caForm.owner}
                  onChange={e => setCaForm(f => f ? { ...f, owner: e.target.value } : f)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Due Date</label>
                <input
                  type="date"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={caForm.dueDate}
                  onChange={e => setCaForm(f => f ? { ...f, dueDate: e.target.value } : f)}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
              <select
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={caForm.status}
                onChange={e => setCaForm(f => f ? { ...f, status: e.target.value as CorrectiveActionStatus } : f)}
              >
                {CA_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {caForm.status === 'Closed' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Closure Notes</label>
                <textarea
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  rows={2}
                  placeholder="How was this resolved?"
                  value={caForm.closureNotes}
                  onChange={e => setCaForm(f => f ? { ...f, closureNotes: e.target.value } : f)}
                />
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setCaModal(false)} className="flex-1 border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition-colors">
                {editCA ? 'Save Changes' : 'Add CA'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
