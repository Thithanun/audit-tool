'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { clearMustChangePassword } from './actions';

export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [error, setError]         = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);
  const [checking, setChecking]   = useState(true);

  // Redirect to login if there's no active session
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.replace('/login');
      } else {
        setChecking(false);
      }
    });
  }, [router]);

  if (checking) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    // 1. Update the password in Supabase Auth
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    // 2. Clear the must_change_password flag via server action (uses service role)
    const { error: flagError } = await clearMustChangePassword();
    if (flagError) {
      setError('Password updated but could not clear flag: ' + flagError);
      setLoading(false);
      return;
    }

    // 3. Go to the app — AuthContext will re-fetch profile and see flag = false
    router.push('/');
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 w-full max-w-md">

        {/* Brand */}
        <div className="flex items-center gap-3 mb-7">
          <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center text-sm font-bold text-white">
            A
          </div>
          <div>
            <p className="font-bold text-slate-900 leading-tight">Audit Tool</p>
            <p className="text-xs text-slate-500">ISO 27001:2022 · NIST CSF 2.0</p>
          </div>
        </div>

        <h1 className="text-xl font-semibold text-slate-900 mb-1">Set your password</h1>
        <p className="text-sm text-slate-500 mb-6">
          You must set a new password before continuing.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              New password <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              required
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Minimum 8 characters"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Confirm password <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat your password"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? 'Saving…' : 'Set password & continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
