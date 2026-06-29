import { useState, type ReactNode } from 'react';
import {
  LayoutDashboard, ListTodo, Users, Building2, Package, Settings,
  LogOut, Trophy, ClipboardCheck, ShoppingBag, ChevronRight, Menu, X,
  Layers, User, Clapperboard
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { Role } from '../lib/types';

interface NavItem {
  label: string;
  route: string;
  icon: ReactNode;
  roles: Role[];
}

const NAV_ITEMS: NavItem[] = [
  { label: 'My Queue',         route: '/queue',           icon: <ListTodo size={18} />,       roles: ['scriptwriter', 'lander_builder', 'ai_creator', 'editor'] },
  { label: 'Command Center',   route: '/command',         icon: <LayoutDashboard size={18} />, roles: ['manager', 'admin'] },
  { label: 'All Batches',      route: '/batches',         icon: <Layers size={18} />,          roles: ['manager', 'admin'] },
  { label: 'QC Queue',         route: '/qc',              icon: <ClipboardCheck size={18} />,  roles: ['qc', 'manager', 'admin'] },
  { label: 'Testing',          route: '/testing',         icon: <ShoppingBag size={18} />,     roles: ['media_buyer', 'manager', 'admin'] },
  { label: 'Leaderboard',      route: '/leaderboard',     icon: <Trophy size={18} />,          roles: ['scriptwriter', 'lander_builder', 'ai_creator', 'editor', 'qc', 'media_buyer', 'manager', 'admin'] },
  { label: 'My Profile',       route: '/profile',         icon: <User size={18} />,            roles: ['scriptwriter', 'lander_builder', 'ai_creator', 'editor', 'qc', 'media_buyer', 'manager', 'admin'] },
  { label: 'People',           route: '/admin/people',    icon: <Users size={18} />,           roles: ['manager', 'admin'] },
  { label: 'Clients',          route: '/admin/clients',   icon: <Building2 size={18} />,       roles: ['manager', 'admin'] },
  { label: 'Products',         route: '/admin/products',  icon: <Package size={18} />,         roles: ['manager', 'admin'] },
  { label: 'Config',           route: '/admin/config',    icon: <Settings size={18} />,        roles: ['admin'] },
];

const SECTION_LABELS: Partial<Record<string, string>> = {
  '/queue':          'Work',
  '/command':        'Work',
  '/batches':        'Work',
  '/qc':             'Work',
  '/testing':        'Work',
  '/leaderboard':    'Me',
  '/profile':        'Me',
  '/admin/people':   'Admin',
  '/admin/clients':  'Admin',
  '/admin/products': 'Admin',
  '/admin/config':   'Admin',
};

function groupNavItems(items: NavItem[]) {
  const groups: { label: string; items: NavItem[] }[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const section = SECTION_LABELS[item.route] || 'Other';
    if (!seen.has(section)) {
      seen.add(section);
      groups.push({ label: section, items: [] });
    }
    groups[groups.length - 1].items.push(item);
  }
  return groups;
}

interface Props {
  route: string;
  navigate: (to: string) => void;
  children: ReactNode;
}

export default function Layout({ route, navigate, children }: Props) {
  const { person, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const roles: Role[] = person?.roles?.length ? person.roles : person?.role ? [person.role as Role] : [];
  const visibleItems = NAV_ITEMS.filter(item => roles.some(r => item.roles.includes(r)));
  const groups = groupNavItems(visibleItems);

  function NavContent() {
    return (
      <div className="flex flex-col h-full">
        {/* Logo */}
        <div className="px-6 py-5 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Clapperboard size={22} className="text-blue-400" />
            <span className="text-lg font-bold tracking-tight text-white">KAIA</span>
            <span className="text-xs text-slate-500 font-normal ml-1">Ops</span>
          </div>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {groups.map(group => (
            <div key={group.label}>
              <p className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-widest text-slate-600">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map(item => {
                  const active = route === item.route || route.startsWith(item.route + '/');
                  return (
                    <button
                      key={item.route}
                      onClick={() => { navigate(item.route); setMobileOpen(false); }}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        active
                          ? 'bg-blue-600/20 text-blue-300 shadow-sm'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                      {active && <ChevronRight size={14} className="ml-auto" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User footer */}
        <div className="border-t border-slate-800 px-3 py-4">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg mb-1">
            <div className="w-8 h-8 rounded-full bg-blue-600/30 border border-blue-500/30 flex items-center justify-center text-blue-300 text-sm font-semibold">
              {person?.name?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-200 truncate">{person?.name}</p>
              <p className="text-xs text-slate-500 truncate capitalize">{person?.role?.replace('_', ' ')}</p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-950 overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-60 flex-shrink-0 bg-slate-900 border-r border-slate-800 flex-col">
        <NavContent />
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-slate-900 border-r border-slate-800">
            <NavContent />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Clapperboard size={20} className="text-blue-400" />
            <span className="text-base font-bold text-white">KAIA</span>
          </div>
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="text-slate-400 hover:text-white transition-colors"
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
