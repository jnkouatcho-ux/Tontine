import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { formatCurrency } from '../lib/utils';
import type { TontineMember, Profile, TontineInvitation, Category, Contribution, CashWithdrawal } from '../types/database';
import { UserPlus, Shield, ShieldAlert, ShieldCheck, Search, Send, Clock, AlertTriangle } from 'lucide-react';

const EF_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tontine-data`;

interface SearchResult {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
}

interface MembersPageProps {
  tontineId: string;
  isAdmin: boolean;
}

const FORTY_DAYS_MS = 40 * 24 * 60 * 60 * 1000;

export default function MembersPage({ tontineId, isAdmin }: MembersPageProps) {
  const { profile, session } = useAuth();
  const [members, setMembers] = useState<(TontineMember & { profile: Profile })[]>([]);
  const [invitations, setInvitations] = useState<TontineInvitation[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [withdrawals, setWithdrawals] = useState<CashWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedUser, setSelectedUser] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const res = await fetch(`${EF_URL}?action=tontine-data&tontine_id=${tontineId}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
      });
      const data = await res.json();
      if (data.members) setMembers(data.members);
      if (data.invitations) setInvitations(data.invitations);
      if (data.categories) setCategories(data.categories);
      if (data.contributions) setContributions(data.contributions);
      if (data.withdrawals) setWithdrawals(data.withdrawals);
    } catch {
      // silent
    }
    setLoading(false);
  }, [tontineId, session]);

  useEffect(() => { loadData(); }, [loadData]);

  // Check for auto-promotion of secondary admin
  useEffect(() => {
    const checkAutoPromotion = async () => {
      const primaryAdmin = members.find((m) => m.role === 'admin');
      const secondaryAdmin = members.find((m) => m.role === 'secondary_admin');

      if (primaryAdmin && secondaryAdmin && primaryAdmin.last_active_at) {
        const lastActive = new Date(primaryAdmin.last_active_at).getTime();
        const now = Date.now();
        if ((now - lastActive) > FORTY_DAYS_MS) {
          // Auto-promote secondary admin to primary
          await supabase.from('tontine_members').update({ role: 'admin' }).eq('id', secondaryAdmin.id);
          await supabase.from('tontine_members').update({ role: 'member' }).eq('id', primaryAdmin.id);
          loadData();
        }
      }
    };
    if (members.length > 0) checkAutoPromotion();
  }, [members, loadData]);

  // Update admin's last_active_at on activity
  useEffect(() => {
    if (profile && isAdmin) {
      const myMember = members.find((m) => m.user_id === profile.id);
      if (myMember) {
        supabase.from('tontine_members').update({ last_active_at: new Date().toISOString() }).eq('id', myMember.id);
      }
    }
  }, [profile, isAdmin, members]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSearchResults([]);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const searchUsers = async (query: string) => {
    if (!session || query.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`${EF_URL}?action=search-users&q=${encodeURIComponent(query)}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
      });
      const data = await res.json();
      const memberUserIds = members.map((m) => m.user_id);
      const filtered = (data.users || []).filter((u: SearchResult) => !memberUserIds.includes(u.id));
      setSearchResults(filtered);
    } catch {
      setSearchResults([]);
    }
    setSearching(false);
  };

  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    setSelectedUser(null);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => searchUsers(value), 300);
  };

  const selectUser = (user: SearchResult) => {
    setSelectedUser(user);
    setSearchQuery(`${user.first_name} ${user.last_name} (@${user.username})`.trim());
    setSearchResults([]);
  };

  const handleInvite = async () => {
    if (!profile || !selectedUser) return;
    setInviteError('');
    setInviteSuccess('');

    if (members.some((m) => m.user_id === selectedUser.id)) {
      setInviteError('Cet utilisateur est deja membre');
      return;
    }

    if (invitations.some((inv) => inv.invitee_user_id === selectedUser.id && inv.status === 'pending')) {
      setInviteError('Une invitation est deja en attente pour cet utilisateur');
      return;
    }

    const { error } = await supabase.from('tontine_invitations').insert({
      tontine_id: tontineId,
      inviter_id: profile.id,
      invitee_username: selectedUser.username,
      invitee_user_id: selectedUser.id,
      status: 'pending',
      expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    });

    if (error) {
      setInviteError(error.message);
    } else {
      setInviteSuccess(`Invitation envoyee a @${selectedUser.username}`);
      setSelectedUser(null);
      setSearchQuery('');
      loadData();
    }
  };

  const handleNominateSecondary = async (memberId: string) => {
    if (!isAdmin) return;
    const existingSecondary = members.find((m) => m.role === 'secondary_admin');
    if (existingSecondary) {
      // Demote existing secondary admin first
      await supabase.from('tontine_members').update({ role: 'member' }).eq('id', existingSecondary.id);
    }
    await supabase.from('tontine_members').update({ role: 'secondary_admin' }).eq('id', memberId);
    loadData();
  };

  const handleRemoveSecondary = async (memberId: string) => {
    await supabase.from('tontine_members').update({ role: 'member' }).eq('id', memberId);
    loadData();
  };

  const handleNominateAdmin = async (memberId: string) => {
    if (!isAdmin) return;
    const currentAdmin = members.find((m) => m.role === 'admin');
    if (currentAdmin && currentAdmin.id !== memberId) {
      // Promote new admin first (while we still have admin rights), then demote current
      await supabase.from('tontine_members').update({ role: 'admin' }).eq('id', memberId);
      await supabase.from('tontine_members').update({ role: 'member' }).eq('id', currentAdmin.id);
    }
    loadData();
  };

  const filteredMembers = members.filter((m) => {
    const p = m.profile;
    const term = memberSearch.toLowerCase();
    return !term || p.username.toLowerCase().includes(term) ||
      p.first_name.toLowerCase().includes(term) ||
      p.last_name.toLowerCase().includes(term);
  });

  const primaryAdmin = members.find((m) => m.role === 'admin');
  const secondaryAdmin = members.find((m) => m.role === 'secondary_admin');
  const daysSinceActive = primaryAdmin?.last_active_at
    ? Math.floor((Date.now() - new Date(primaryAdmin.last_active_at).getTime()) / (24 * 60 * 60 * 1000))
    : 0;

  const memberCategoryNet = useMemo(() => {
    const net: Record<string, Record<string, number>> = {};
    members.forEach((m) => {
      net[m.id] = {};
      categories.forEach((cat) => {
        const contribTotal = contributions
          .filter((c) => c.member_id === m.id && c.category_id === cat.id)
          .reduce((sum, c) => sum + Number(c.amount), 0);
        const withdrawTotal = withdrawals
          .filter((w) => w.member_id === m.id && w.category_id === cat.id)
          .reduce((sum, w) => sum + Number(w.amount), 0);
        net[m.id][cat.id] = contribTotal - withdrawTotal;
      });
    });
    return net;
  }, [members, categories, contributions, withdrawals]);

  const overallMemberNetTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    members.forEach((m) => {
      totals[m.id] = categories
        .filter((cat) => !cat.is_contribution && !cat.can_withdraw_anytime)
        .reduce((sum, cat) => sum + (memberCategoryNet[m.id]?.[cat.id] || 0), 0);
    });
    return totals;
  }, [members, categories, memberCategoryNet]);

  const overallCategoryNetTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    categories.forEach((cat) => {
      const contribTotal = contributions
        .filter((c) => c.category_id === cat.id)
        .reduce((sum, c) => sum + Number(c.amount), 0);
      const withdrawTotal = withdrawals
        .filter((w) => w.category_id === cat.id)
        .reduce((sum, w) => sum + Number(w.amount), 0);
      totals[cat.id] = contribTotal - withdrawTotal;
    });
    return totals;
  }, [categories, contributions, withdrawals]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Membres</h1>
          <p className="text-slate-500 mt-1">{members.length} membres dans la tontine</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowInvite(!showInvite)}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-xl transition-all shadow-sm"
          >
            <UserPlus className="w-4 h-4" />
            Inviter
          </button>
        )}
      </div>

      {/* Admin status warning */}
      {primaryAdmin && daysSinceActive > 20 && (
        <div className={`rounded-2xl p-5 border ${
          daysSinceActive >= 40 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
        }`}>
          <div className="flex items-start gap-3">
            <AlertTriangle className={`w-5 h-5 mt-0.5 ${
              daysSinceActive >= 40 ? 'text-red-600' : 'text-amber-600'
            }`} />
            <div>
              <p className={`text-sm font-medium ${
                daysSinceActive >= 40 ? 'text-red-800' : 'text-amber-800'
              }`}>
                {daysSinceActive >= 40
                  ? 'L\'administrateur principal est absent depuis 40 jours ou plus'
                  : `L'administrateur principal est absent depuis ${daysSinceActive} jours`}
              </p>
              <p className={`text-xs mt-1 ${
                daysSinceActive >= 40 ? 'text-red-600' : 'text-amber-600'
              }`}>
                {secondaryAdmin
                  ? daysSinceActive >= 40
                    ? 'L\'administrateur secondaire a ete automatiquement promu administrateur principal.'
                    : `L'administrateur secondaire sera automatiquement promu dans ${40 - daysSinceActive} jour(s).`
                  : 'Nominez un administrateur secondaire pour assurer la continuite en cas d\'absence prolongee.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Invite form */}
      {showInvite && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
          <h3 className="font-semibold text-slate-900">Inviter un membre</h3>
          <p className="text-sm text-slate-500">Recherchez un utilisateur par nom, prenom ou nom d'utilisateur</p>

          <div className="relative" ref={dropdownRef}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchInput(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
              placeholder="Tapez un nom ou username (min. 2 caracteres)..."
              autoComplete="off"
            />

            {selectedUser && (
              <div className="mt-2 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5">
                <div className="w-8 h-8 bg-emerald-200 rounded-lg flex items-center justify-center">
                  <span className="text-emerald-700 font-semibold text-sm">
                    {selectedUser.first_name?.[0] || selectedUser.username[0]}
                  </span>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-emerald-800">
                    {selectedUser.first_name} {selectedUser.last_name}
                  </p>
                  <p className="text-xs text-emerald-600">@{selectedUser.username} - {selectedUser.email}</p>
                </div>
                <button
                  onClick={() => { setSelectedUser(null); setSearchQuery(''); }}
                  className="text-emerald-600 hover:text-emerald-800 text-sm font-medium"
                >
                  Changer
                </button>
              </div>
            )}

            {searchResults.length > 0 && !selectedUser && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 max-h-60 overflow-y-auto">
                {searchResults.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => selectUser(user)}
                    className="w-full text-left px-4 py-3 hover:bg-emerald-50 flex items-center gap-3 transition-colors border-b border-slate-50 last:border-0"
                  >
                    <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <span className="text-slate-600 font-semibold text-sm">
                        {user.first_name?.[0] || user.username[0]}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {user.first_name} {user.last_name}
                      </p>
                      <p className="text-xs text-slate-500 truncate">@{user.username} - {user.email}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {searching && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-4 text-center">
                <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs text-slate-500 mt-2">Recherche en cours...</p>
              </div>
            )}

            {searchQuery.length >= 2 && searchResults.length === 0 && !searching && !selectedUser && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-4 text-center">
                <p className="text-sm text-slate-500">Aucun utilisateur trouve</p>
              </div>
            )}
          </div>

          {inviteError && <p className="text-sm text-red-600">{inviteError}</p>}
          {inviteSuccess && <p className="text-sm text-emerald-600">{inviteSuccess}</p>}

          <div className="flex justify-end gap-3">
            <button onClick={() => { setShowInvite(false); setSelectedUser(null); setSearchQuery(''); setInviteError(''); }} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-xl">
              Annuler
            </button>
            <button
              onClick={handleInvite}
              disabled={!selectedUser}
              className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              Envoyer l'invitation
            </button>
          </div>
        </div>
      )}

      {/* Member search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={memberSearch}
          onChange={(e) => setMemberSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
          placeholder="Rechercher un membre..."
        />
      </div>

      {/* Members list */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="divide-y divide-slate-50">
          {filteredMembers.map((m) => {
            const isMe = m.user_id === profile?.id;
            const isPrimaryAdmin = m.role === 'admin';
            const isSecondaryAdmin = m.role === 'secondary_admin';
            const isRegularMember = m.role === 'member';

            return (
              <div key={m.id} className="px-5 py-4 flex items-center justify-between hover:bg-slate-25 transition-colors">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    isPrimaryAdmin ? 'bg-amber-100' : isSecondaryAdmin ? 'bg-blue-100' : 'bg-emerald-100'
                  }`}>
                    <span className={`font-semibold text-sm ${
                      isPrimaryAdmin ? 'text-amber-700' : isSecondaryAdmin ? 'text-blue-700' : 'text-emerald-700'
                    }`}>
                      {m.profile.first_name?.[0] || m.profile.username[0]}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {m.profile.first_name} {m.profile.last_name}
                      {m.profile.first_name && m.profile.last_name && (
                        <span className="text-slate-400 ml-1">(@{m.profile.username})</span>
                      )}
                      {!m.profile.first_name && !m.profile.last_name && (
                        <span>@{m.profile.username}</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">Tour #{m.eating_order}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                    isPrimaryAdmin ? 'bg-amber-100 text-amber-700' :
                    isSecondaryAdmin ? 'bg-blue-100 text-blue-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>
                    {isPrimaryAdmin ? 'Admin principal' : isSecondaryAdmin ? 'Admin secondaire' : 'Membre'}
                  </span>
                  {isAdmin && !isMe && isRegularMember && (
                    <button
                      onClick={() => handleNominateSecondary(m.id)}
                      className="p-1.5 hover:bg-blue-50 rounded-lg text-slate-400 hover:text-blue-600 transition-colors"
                      title={secondaryAdmin ? 'Remplacer l\'admin secondaire' : 'Nommer admin secondaire'}
                    >
                      <ShieldAlert className="w-4 h-4" />
                    </button>
                  )}
                  {isAdmin && !isMe && isRegularMember && (
                    <button
                      onClick={() => handleNominateAdmin(m.id)}
                      className="p-1.5 hover:bg-amber-50 rounded-lg text-slate-400 hover:text-amber-600 transition-colors"
                      title="Nommer administrateur"
                    >
                      <ShieldCheck className="w-4 h-4" />
                    </button>
                  )}
                  {isAdmin && isSecondaryAdmin && (
                    <button
                      onClick={() => handleRemoveSecondary(m.id)}
                      className="p-1.5 hover:bg-red-50 rounded-lg text-blue-400 hover:text-red-500 transition-colors"
                      title="Retirer le role d'admin secondaire"
                    >
                      <Shield className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Resume global */}
      {categories.length > 0 && members.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-900">Resume global</h3>
            <p className="text-xs text-slate-400 mt-0.5">Solde net par membre (hors cotisations)</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-5 py-3 font-semibold text-slate-700 whitespace-nowrap">Membre</th>
                  {categories.filter((cat) => !cat.is_contribution && !cat.can_withdraw_anytime).map((cat) => (
                    <th key={cat.id} className="text-right px-4 py-3 font-semibold text-slate-700 whitespace-nowrap">
                      {cat.name}
                    </th>
                  ))}
                  <th className="text-right px-4 py-3 font-semibold text-slate-700 whitespace-nowrap">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {members.map((m) => {
                  const memberNetTotal = overallMemberNetTotals[m.id] || 0;
                  return (
                    <tr key={m.id} className="hover:bg-slate-25 transition-colors">
                      <td className="px-5 py-3 font-medium text-slate-800 whitespace-nowrap">
                        {m.profile.first_name} {m.profile.last_name}
                        {!m.profile.first_name && !m.profile.last_name && `@${m.profile.username}`}
                      </td>
                      {categories.filter((cat) => !cat.is_contribution && !cat.can_withdraw_anytime).map((cat) => {
                        const catNet = memberCategoryNet[m.id]?.[cat.id] || 0;
                        return (
                          <td key={cat.id} className="text-right px-4 py-3 font-mono text-sm text-slate-700">
                            {formatCurrency(catNet)}
                          </td>
                        );
                      })}
                      <td className="text-right px-4 py-3 font-semibold text-slate-900 font-mono">
                        {formatCurrency(memberNetTotal)}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold">
                  <td className="px-5 py-3 text-slate-800">Total</td>
                  {categories.filter((cat) => !cat.is_contribution && !cat.can_withdraw_anytime).map((cat) => (
                    <td key={cat.id} className="text-right px-4 py-3 font-mono text-slate-900">
                      {formatCurrency(overallCategoryNetTotals[cat.id] || 0)}
                    </td>
                  ))}
                  <td className="text-right px-4 py-3 font-mono text-slate-900">
                    {formatCurrency(
                      categories.filter((cat) => !cat.is_contribution && !cat.can_withdraw_anytime)
                        .reduce((sum, cat) => sum + (overallCategoryNetTotals[cat.id] || 0), 0)
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Admin rules info */}
      {isAdmin && (
        <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-900 mb-2 flex items-center gap-2">
            <Shield className="w-5 h-5 text-slate-600" />
            Regles d'administration
          </h3>
          <ul className="text-sm text-slate-600 space-y-1.5">
            <li>L'administrateur principal peut nommer un administrateur secondaire.</li>
            <li>L'administrateur principal peut nommer un autre membre comme administrateur principal (transfert de role).</li>
            <li>En cas d'absence de l'admin principal pendant 40 jours, l'admin secondaire est automatiquement promu.</li>
            <li>Un seul administrateur secondaire peut etre nomme a la fois.</li>
          </ul>
        </div>
      )}

      {/* Pending invitations */}
      {invitations.filter((i) => i.status === 'pending').length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-900">Invitations en attente</h3>
          </div>
          <div className="divide-y divide-slate-50">
            {invitations.filter((i) => i.status === 'pending').map((inv) => (
              <div key={inv.id} className="px-5 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Clock className="w-4 h-4 text-amber-500" />
                  <div>
                    <p className="text-sm font-medium text-slate-800">@{inv.invitee_username}</p>
                    <p className="text-xs text-slate-500">Expire le {new Date(inv.expires_at).toLocaleDateString('fr-FR')}</p>
                  </div>
                </div>
                <span className="text-xs bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full font-medium">En attente</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
