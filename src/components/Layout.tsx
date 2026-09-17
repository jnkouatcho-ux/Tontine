import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  LayoutDashboard,
  Users,
  PlusCircle,
  HandCoins,
  Wallet,
  ArrowRightLeft,
  Scale,
  LogOut,
  Menu,
  X,
  ChevronDown,
  Bell,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { Profile } from '../types/database';

interface TontineInfo {
  id: string;
  name: string;
  role: 'admin' | 'member';
}

interface LayoutProps {
  children: ReactNode;
  tontines: TontineInfo[];
  activeTontine: string | null;
  onSelectTontine: (id: string) => void;
  currentPage: string;
  onNavigate: (page: string) => void;
  invitations: number;
}

export default function Layout({
  children,
  tontines,
  activeTontine,
  onSelectTontine,
  currentPage,
  onNavigate,
  invitations,
}: LayoutProps) {
  const { profile, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tontineDropdown, setTontineDropdown] = useState(false);

  const navItems = [
    { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
    { id: 'members', label: 'Membres', icon: Users },
    { id: 'contributions', label: 'Cotisations', icon: HandCoins },
    { id: 'payouts', label: 'Versements', icon: Wallet },
    { id: 'loans', label: 'Prêts', icon: ArrowRightLeft },
    { id: 'fines', label: 'Amendes', icon: Scale },
  ];

  const activeTontineName = tontines.find((t) => t.id === activeTontine)?.name;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <header className="fixed top-0 left-0 right-0 h-16 bg-white border-b border-slate-200 z-40 flex items-center px-4 lg:px-6">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="lg:hidden p-2 hover:bg-slate-100 rounded-xl transition-colors"
        >
          {sidebarOpen ? <X className="w-5 h-5 text-slate-600" /> : <Menu className="w-5 h-5 text-slate-600" />}
        </button>

        <div className="flex-1 flex items-center justify-between ml-2">
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center justify-center w-9 h-9 bg-emerald-50 rounded-xl">
              <Users className="w-5 h-5 text-emerald-600" />
            </div>
            <div className="relative">
              <button
                onClick={() => setTontineDropdown(!tontineDropdown)}
                className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 rounded-xl transition-colors"
              >
                <span className="font-semibold text-slate-800 text-sm">
                  {activeTontineName || 'Selectionner une tontine'}
                </span>
                <ChevronDown className="w-4 h-4 text-slate-400" />
              </button>
              {tontineDropdown && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-xl py-2 z-50">
                  {tontines.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => { onSelectTontine(t.id); setTontineDropdown(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center justify-between transition-colors ${
                        t.id === activeTontine ? 'bg-emerald-50 text-emerald-700' : 'text-slate-700'
                      }`}
                    >
                      <span>{t.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        t.role === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {t.role === 'admin' ? 'Admin' : 'Membre'}
                      </span>
                    </button>
                  ))}
                  <div className="border-t border-slate-100 mt-2 pt-2">
                    <button
                      onClick={() => { onNavigate('create-tontine'); setTontineDropdown(false); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-emerald-600 hover:bg-emerald-50 flex items-center gap-2 transition-colors"
                    >
                      <PlusCircle className="w-4 h-4" />
                      Creer une tontine
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {invitations > 0 && (
              <button
                onClick={() => onNavigate('invitations')}
                className="relative p-2 hover:bg-slate-100 rounded-xl transition-colors"
              >
                <Bell className="w-5 h-5 text-slate-600" />
                <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                  {invitations}
                </span>
              </button>
            )}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-xl">
              <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <span className="text-emerald-700 font-semibold text-sm">
                  {(profile as Profile | null)?.first_name?.[0] || (profile as Profile | null)?.username?.[0] || 'U'}
                </span>
              </div>
              <span className="text-sm font-medium text-slate-700 max-w-[140px] truncate">
                {(profile as Profile | null)?.first_name
                  ? `${(profile as Profile | null)?.first_name} ${(profile as Profile | null)?.last_name || ''}`.trim()
                  : (profile as Profile | null)?.username || 'Utilisateur'}
              </span>
            </div>
            <button
              onClick={signOut}
              className="p-2 hover:bg-red-50 rounded-xl transition-colors group"
              title="Deconnexion"
            >
              <LogOut className="w-5 h-5 text-slate-400 group-hover:text-red-500" />
            </button>
          </div>
        </div>
      </header>

      {/* Sidebar */}
      <aside
        className={`fixed top-16 left-0 bottom-0 w-64 bg-white border-r border-slate-200 z-30 transform transition-transform duration-200 lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <nav className="p-4 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => { onNavigate(item.id); setSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                currentPage === item.id
                  ? 'bg-emerald-50 text-emerald-700 shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </button>
          ))}
          <div className="border-t border-slate-100 my-3" />
          <button
            onClick={() => { onNavigate('create-tontine'); setSidebarOpen(false); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-emerald-600 hover:bg-emerald-50 transition-all"
          >
            <PlusCircle className="w-5 h-5" />
            Nouvelle tontine
          </button>
          <button
            onClick={() => { onNavigate('invitations'); setSidebarOpen(false); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition-all"
          >
            <Bell className="w-5 h-5" />
            Invitations
            {invitations > 0 && (
              <span className="ml-auto w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                {invitations}
              </span>
            )}
          </button>
        </nav>
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/20 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main content */}
      <main className="lg:ml-64 pt-16 min-h-screen">
        <div className="p-4 lg:p-6 max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
