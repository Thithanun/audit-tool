'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export default function Navbar() {
  const pathname = usePathname();
  const { profile, loading, isAdmin, canSeeChecklist, signOut } = useAuth();

  // While auth is resolving, show all tabs (fail-open) so they never flicker
  // away for non-viewers.  For viewers the tab disappears once loading finishes.
  const NAV_LINKS = [
    { href: '/audit-plan', label: 'Audit Plan', visible: true },
    { href: '/checklist',  label: 'Checklist',  visible: loading || canSeeChecklist },
    { href: '/dashboard',  label: 'Dashboard',  visible: true },
  ];

  if (pathname === '/login') return null;

  return (
    <nav className="bg-white border-b border-slate-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">

          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-sm font-bold text-white">
              A
            </div>
            <span className="font-semibold text-lg tracking-tight text-slate-900">
              Audit Tool
            </span>
            <span className="text-slate-500 text-xs px-2 py-0.5 bg-slate-100 rounded-full border border-slate-200 hidden sm:inline">
              ISO 27001:2022 · NIST CSF 2.0
            </span>
          </div>

          {/* Nav links */}
          <div className="flex items-center gap-1">
            {NAV_LINKS.filter(l => l.visible).map(link => {
              const active = pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    active
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}

            {isAdmin && (
              <Link
                href="/settings/users"
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  pathname.startsWith('/settings')
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                Users
              </Link>
            )}
          </div>

          {/* User info + logout */}
          <div className="flex items-center gap-3">
            {profile && (
              <div className="flex items-center gap-2">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-medium text-slate-800 leading-tight">
                    {profile.name || profile.email}
                  </p>
                  <p className="text-xs text-slate-400 capitalize">{profile.role}</p>
                </div>
                <div className="w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center text-xs font-semibold text-slate-600">
                  {(profile.name || profile.email).charAt(0).toUpperCase()}
                </div>
              </div>
            )}
            <button
              onClick={signOut}
              className="text-sm text-slate-500 hover:text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-md transition-colors font-medium"
            >
              Sign out
            </button>
          </div>

        </div>
      </div>
    </nav>
  );
}
