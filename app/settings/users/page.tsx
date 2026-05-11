'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, type UserProfile, type UserRole } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { inviteUser, updateUserRole, removeUser } from './actions';
import Modal from '@/components/Modal';

const ROLES: UserRole[] = ['admin', 'auditor', 'viewer'];

const ROLE_BADGE: Record<UserRole, string> = {
  admin:   'bg-purple-100 text-purple-700 border-purple-200',
  auditor: 'bg-blue-100 text-blue-700 border-blue-200',
  viewer:  'bg-slate-100 text-slate-600 border-slate-200',
};

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function UsersPage() {
  const router = useRouter();
  const { isAdmin, loading: authLoading } = useAuth();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [inviteModal, setInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('auditor');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('profiles')
      .select('id, email, name, role')
      .order('email');
    if (err) {
      setError(err.message);
    } else {
      setUsers((data ?? []) as UserProfile[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) { router.replace('/'); return; }
    reload();
  }, [authLoading, isAdmin, router, reload]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteError(null);
    setInviteSuccess(false);
    const { error } = await inviteUser(inviteEmail, inviteName, inviteRole);
    if (error) {
      setInviteError(error);
    } else {
      setInviteSuccess(true);
      setInviteEmail('');
      setInviteName('');
      setInviteRole('auditor');
      await reload();
    }
    setInviting(false);
  }

  async function handleRoleChange(userId: string, role: UserRole) {
    const { error } = await updateUserRole(userId, role);
    if (error) {
      alert('Role update failed: ' + error);
    } else {
      setUsers(us => us.map(u => u.id === userId ? { ...u, role } : u));
    }
  }

  async function handleRemove() {
    if (!deleteId) return;
    setDeleting(true);
    const { error } = await removeUser(deleteId);
    if (error) {
      alert('Remove failed: ' + error);
    } else {
      setDeleteId(null);
      await reload();
    }
    setDeleting(false);
  }

  if (authLoading || loading) return <Spinner />;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
          <p className="text-slate-500 text-sm mt-1">Invite team members and manage roles</p>
        </div>
        <button
          onClick={() => { setInviteModal(true); setInviteSuccess(false); setInviteError(null); }}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Invite User
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 mb-6">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left text-xs font-semibold text-slate-500 px-5 py-3">User</th>
              <th className="text-left text-xs font-semibold text-slate-500 px-5 py-3 w-36">Role</th>
              <th className="w-16"></th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-5 py-12 text-center text-slate-400 text-sm">
                  No users yet — invite someone to get started
                </td>
              </tr>
            ) : (
              users.map(u => (
                <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center text-xs font-semibold text-slate-600 shrink-0">
                        {(u.name || u.email).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-slate-800">
                          {u.name || <span className="text-slate-400 italic">No name</span>}
                        </p>
                        <p className="text-xs text-slate-400">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <select
                      value={u.role}
                      onChange={e => handleRoleChange(u.id, e.target.value as UserRole)}
                      className="text-xs border border-slate-200 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      {ROLES.map(r => (
                        <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <button
                      onClick={() => setDeleteId(u.id)}
                      className="text-slate-400 hover:text-red-500 text-xs transition-colors"
                      title="Remove user"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Role legend */}
      <div className="mt-4 flex gap-3 text-xs text-slate-500">
        {ROLES.map(r => (
          <span key={r} className={`px-2 py-0.5 rounded-full border capitalize ${ROLE_BADGE[r]}`}>
            {r}
          </span>
        ))}
        <span className="text-slate-400">— Admin: full access · Auditor: create/edit · Viewer: read-only</span>
      </div>

      {/* Invite Modal */}
      <Modal open={inviteModal} onClose={() => setInviteModal(false)} title="Invite User" size="md">
        {inviteSuccess ? (
          <div className="text-center py-4">
            <p className="text-green-600 font-medium mb-1">Invitation sent!</p>
            <p className="text-sm text-slate-500 mb-4">
              An invite email has been sent. The user will set their password on first login.
            </p>
            <button
              onClick={() => setInviteModal(false)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleInvite} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="user@company.com"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
              <input
                type="text"
                value={inviteName}
                onChange={e => setInviteName(e.target.value)}
                placeholder="Jane Smith"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value as UserRole)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {ROLES.map(r => (
                  <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                ))}
              </select>
            </div>

            {inviteError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {inviteError}
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setInviteModal(false)}
                className="flex-1 border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={inviting}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white py-2 rounded-lg text-sm font-medium transition-colors"
              >
                {inviting ? 'Sending…' : 'Send Invite'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Remove Confirm */}
      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="Remove User" size="md">
        <p className="text-slate-600 text-sm mb-4">
          Permanently remove this user? They will lose all access immediately.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setDeleteId(null)}
            className="flex-1 border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleRemove}
            disabled={deleting}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {deleting ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
