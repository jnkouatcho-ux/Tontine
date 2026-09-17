import { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { supabase } from './lib/supabase';
import LoginPage from './pages/LoginPage';
import Layout from './components/Layout';
import DashboardPage from './pages/DashboardPage';
import CreateTontinePage from './pages/CreateTontinePage';
import MembersPage from './pages/MembersPage';
import ContributionsPage from './pages/ContributionsPage';
import PayoutsPage from './pages/PayoutsPage';
import LoansPage from './pages/LoansPage';
import FinesPage from './pages/FinesPage';
import InvitationsPage from './pages/InvitationsPage';
import TransferTontinePage from './pages/TransferTontinePage';

interface TontineInfo {
  id: string;
  name: string;
  role: 'admin' | 'member';
}

const EF_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tontine-data`;

function AppContent() {
  const { user, session, loading } = useAuth();
  const [tontines, setTontines] = useState<TontineInfo[]>([]);
  const [activeTontine, setActiveTontine] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [pendingInvitations, setPendingInvitations] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);

  const loadTontines = useCallback(async () => {
    if (!user || !session) return;
    try {
      const res = await fetch(`${EF_URL}?action=my-tontines`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
      });
      const data = await res.json();
      if (data.tontines) {
        const tontineList = data.tontines.map((t: any) => ({
          id: t.id,
          name: t.name || 'Tontine',
          role: t.role as 'admin' | 'member',
        }));
        setTontines(tontineList);
        if (!activeTontine && tontineList.length > 0) {
          setActiveTontine(tontineList[0].id);
        }
      }
    } catch {
      // fallback: try direct query (works for creators)
      const { data } = await supabase
        .from('tontines')
        .select('id, name')
        .eq('created_by', user.id);
      if (data) {
        setTontines(data.map((t: any) => ({ id: t.id, name: t.name, role: 'admin' as const })));
        if (!activeTontine && data.length > 0) setActiveTontine(data[0].id);
      }
    }
  }, [user, session, activeTontine]);

  const loadInvitations = useCallback(async () => {
    if (!user || !session) return;
    try {
      const res = await fetch(`${EF_URL}?action=pending-invitations`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
      });
      const data = await res.json();
      setPendingInvitations(data.count || 0);
    } catch {
      setPendingInvitations(0);
    }
  }, [user, session]);

  useEffect(() => {
    loadTontines();
    loadInvitations();
  }, [loadTontines, loadInvitations]);

  useEffect(() => {
    if (activeTontine) {
      const t = tontines.find((t) => t.id === activeTontine);
      setIsAdmin(t?.role === 'admin');
    }
  }, [activeTontine, tontines]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const handleNavigate = (page: string) => {
    setCurrentPage(page);
  };

  const handleTontineCreated = (tontineId: string) => {
    setActiveTontine(tontineId);
    setCurrentPage('dashboard');
    loadTontines();
  };

  const renderPage = () => {
    if (!activeTontine && currentPage !== 'create-tontine' && currentPage !== 'invitations') {
      return (
        <div className="text-center py-20">
          <div className="w-20 h-20 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Bienvenue sur TontineApp</h2>
          <p className="text-slate-500 mb-6">Creez votre premiere tontine ou attendez une invitation</p>
          <button
            onClick={() => setCurrentPage('create-tontine')}
            className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-medium rounded-xl transition-all shadow-lg shadow-emerald-500/25"
          >
            Creer une tontine
          </button>
        </div>
      );
    }

    switch (currentPage) {
      case 'dashboard':
        return activeTontine ? <DashboardPage tontineId={activeTontine} onNavigate={handleNavigate} /> : null;
      case 'create-tontine':
        return <CreateTontinePage onCreated={handleTontineCreated} onNavigate={handleNavigate} />;
      case 'members':
        return activeTontine ? <MembersPage tontineId={activeTontine} isAdmin={isAdmin} /> : null;
      case 'contributions':
        return activeTontine ? <ContributionsPage tontineId={activeTontine} isAdmin={isAdmin} /> : null;
      case 'payouts':
        return activeTontine ? <PayoutsPage tontineId={activeTontine} isAdmin={isAdmin} onNavigate={handleNavigate} /> : null;
      case 'loans':
        return activeTontine ? <LoansPage tontineId={activeTontine} isAdmin={isAdmin} /> : null;
      case 'fines':
        return activeTontine ? <FinesPage tontineId={activeTontine} isAdmin={isAdmin} /> : null;
      case 'invitations':
        return <InvitationsPage />;
      case 'transfer-tontine':
        return activeTontine ? <TransferTontinePage tontineId={activeTontine} onNavigate={handleNavigate} /> : null;
      default:
        return activeTontine ? <DashboardPage tontineId={activeTontine} onNavigate={handleNavigate} /> : null;
    }
  };

  return (
    <Layout
      tontines={tontines}
      activeTontine={activeTontine}
      onSelectTontine={setActiveTontine}
      currentPage={currentPage}
      onNavigate={handleNavigate}
      invitations={pendingInvitations}
    >
      {renderPage()}
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
