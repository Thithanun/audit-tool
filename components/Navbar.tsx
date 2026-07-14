'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export default function Navbar() {
  const pathname = usePathname();
  const { loading, isAdmin, canSeeChecklist } = useAuth();

  // Fail-open during auth load: show all tabs briefly so admin/auditor users
  // never see menus flicker away. Once loading resolves, role-based rules apply.
  //
  // Visibility matrix:
  //   Viewer  → Audit Plan · Dashboard
  //   Auditor → Audit Plan · Checklist · Dashboard
  //   Admin   → Audit Plan · Checklist · Dashboard · Users
  const NAV_LINKS = [
    { href: '/audit-plan', label: 'Audit Plan', visible: true },
    { href: '/checklist',  label: 'Checklist',  visible: loading || canSeeChecklist },
    { href: '/dashboard',  label: 'Dashboard',  visible: true },
    { href: '/report',     label: 'Report',     visible: true },
  ];

  if (pathname === '/login' || pathname.startsWith('/auth/')) return null;

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
              ISO 27001 · NIST CSF
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

          {/* Placeholder to keep layout balanced */}
          <div />

        </div>
      </div>
    </nav>
  );
}
