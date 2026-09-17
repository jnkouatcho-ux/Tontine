import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { formatCurrency, generateScheduleDates } from '../lib/utils';
import type {
  Tontine, TontineMember, Profile, Category, Contribution,
  CashWithdrawal, Loan, LoanSource, InterestDistribution,
} from '../types/database';
import { Plus, X, Check, AlertCircle, Search, ChevronUp, ChevronDown, Save } from 'lucide-react';

const EF_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tontine-data`;

interface TransferTontinePageProps {
  tontineId: string;
  onNavigate: (page: string) => void;
}

interface NewCategoryInput {
  name: string;
  amount: number;
  is_in_cash_box: boolean;
}

interface UserSearchResult {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
}

interface MemberItem {
  userId: string;
  username: string;
  displayName: string;
}

export default function TransferTontinePage({ tontineId, onNavigate }: TransferTontinePageProps) {
  const { profile, session } = useAuth();
  const [tontine, setTontine] = useState<Tontine | null>(null);
  const [members, setMembers] = useState<(TontineMember & { profile: Profile })[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [withdrawals, setWithdrawals] = useState<CashWithdrawal[]>([]);
  const [loans, setLoans] = useState<(Loan & { loan_sources?: LoanSource[] })[]>([]);
  const [interestDistributions, setInterestDistributions] = useState<InterestDistribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const [newName, setNewName] = useState('');
  const [newStartDate, setNewStartDate] = useState('');
  const [newEndDate, setNewEndDate] = useState('');
  const [periodicityType, setPeriodicityType] = useState<'monthly' | 'weekly' | 'biweekly'>('monthly');
  const [weekNumber, setWeekNumber] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [dayOfWeek, setDayOfWeek] = useState(0);
  const [newContributionAmount, setNewContributionAmount] = useState(0);

  const [categoryDecisions, setCategoryDecisions] = useState<Record<string, 'transfer' | 'reset' | 'none'>>({});
  const [newCategories, setNewCategories] = useState<NewCategoryInput[]>([]);

  const [newMembers, setNewMembers] = useState<MemberItem[]>([]);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [memberSearchResults, setMemberSearchResults] = useState<UserSearchResult[]>([]);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (data.tontine) setTontine(data.tontine);
      if (data.members) setMembers(data.members);
      if (data.categories) {
        setCategories(data.categories);
        const decisions: Record<string, 'transfer' | 'reset' | 'none'> = {};
        data.categories.forEach((cat: Category) => {
          if (!cat.is_contribution && !cat.can_withdraw_anytime && cat.is_in_cash_box) {
            decisions[cat.id] = 'transfer';
          } else {
            decisions[cat.id] = 'none';
          }
        });
        setCategoryDecisions(decisions);
      }
      if (data.contributions) setContributions(data.contributions);
      if (data.withdrawals) setWithdrawals(data.withdrawals);
      if (data.loans) setLoans(data.loans);
      if (data.interestDistributions) setInterestDistributions(data.interestDistributions);
    } catch {
      // silent
    }
    setLoading(false);
  }, [tontineId, session]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (tontine && profile) {
      setNewName(`${tontine.name} (Suite)`);
      setNewContributionAmount(tontine.contribution_amount);
      if (newMembers.length === 0) {
        setNewMembers([{
          userId: profile.id,
          username: profile.username || '',
          displayName: `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || profile.username || '',
        }]);
      }
    }
  }, [tontine, profile, newMembers.length]);

  const getCategoryAvailable = useCallback((catId: string) => {
    const cat = categories.find((c) => c.id === catId);
    if (!cat || !cat.is_in_cash_box) return 0;

    const totalIn = contributions
      .filter((c) => c.category_id === catId)
      .reduce((sum, c) => sum + Number(c.amount), 0);

    const totalInterest = interestDistributions
      .filter((d) => d.category_id === catId)
      .reduce((sum, d) => sum + Number(d.per_member_amount) * members.length, 0);

    const totalWithdrawn = withdrawals
      .filter((w) => w.category_id === catId)
      .reduce((sum, w) => sum + Number(w.amount), 0);

    const totalLoaned = loans
      .filter((l) => l.status === 'active' || l.status === 'approved')
      .reduce((sum, l) => {
        const sources = l.loan_sources?.filter((s) => s.category_id === catId) || [];
        return sum + sources.reduce((s, src) => s + Number(src.amount), 0);
      }, 0);

    return (totalIn + totalInterest) - totalWithdrawn - totalLoaned;
  }, [categories, contributions, interestDistributions, members, withdrawals, loans]);

  const transferableCategories = useMemo(() => {
    return categories.filter((c) => !c.is_contribution && !c.can_withdraw_anytime && c.is_in_cash_box);
  }, [categories]);

  const totalTransferAmount = useMemo(() => {
    return transferableCategories
      .filter((c) => categoryDecisions[c.id] === 'transfer')
      .reduce((sum, c) => sum + getCategoryAvailable(c.id), 0);
  }, [transferableCategories, categoryDecisions, getCategoryAvailable]);

  const tourCount = newStartDate && newEndDate
    ? generateScheduleDates(
        newStartDate, newEndDate, periodicityType,
        periodicityType === 'monthly' ? { weekNumber } : { dayOfWeek },
      ).length
    : 0;
  const validMemberCount = newMembers.filter((m) => m.userId.trim() !== '').length;

  const searchUsers = async (query: string) => {
    if (!session || query.length < 2) { setMemberSearchResults([]); return; }
    try {
      const res = await fetch(`${EF_URL}?action=search-users&q=${encodeURIComponent(query)}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
      });
      const data = await res.json();
      const existingIds = newMembers.map((m) => m.userId);
      setMemberSearchResults((data.users || []).filter((u: UserSearchResult) => !existingIds.includes(u.id)));
    } catch {
      setMemberSearchResults([]);
    }
  };

  const handleMemberSearch = (value: string) => {
    setMemberSearchQuery(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => searchUsers(value), 300);
  };

  const selectMember = (user: UserSearchResult) => {
    const displayName = `${user.first_name} ${user.last_name}`.trim() || user.username;
    setNewMembers([...newMembers, { userId: user.id, username: user.username, displayName }]);
    setMemberSearchQuery('');
    setMemberSearchResults([]);
  };

  const removeMember = (index: number) => {
    if (index === 0) return;
    setNewMembers(newMembers.filter((_, i) => i !== index));
  };

  const moveMember = (from: number, to: number) => {
    const newOrder = [...newMembers];
    const [item] = newOrder.splice(from, 1);
    newOrder.splice(to, 0, item);
    setNewMembers(newOrder);
  };

  const addNewCategory = () => {
    setNewCategories([...newCategories, { name: '', amount: 0, is_in_cash_box: true }]);
  };

  const updateNewCategory = (index: number, updates: Partial<NewCategoryInput>) => {
    const newCats = [...newCategories];
    newCats[index] = { ...newCats[index], ...updates };
    setNewCategories(newCats);
  };

  const removeNewCategory = (index: number) => {
    setNewCategories(newCategories.filter((_, i) => i !== index));
  };

  const canProceed = (): boolean => {
    return newName.trim() !== '' && newStartDate !== '' && newEndDate !== ''
      && newContributionAmount > 0 && validMemberCount >= 2
      && validMemberCount === tourCount;
  };

  const handleTransfer = async () => {
    if (!profile || !tontine) return;
    setSaving(true);
    setError('');

    try {
      const periodicityDetail = periodicityType === 'monthly' ? { weekNumber } : { dayOfWeek };

      const { data: newTontine, error: tontineErr } = await supabase
        .from('tontines')
        .insert({
          name: newName,
          start_date: newStartDate,
          end_date: newEndDate,
          periodicity_type: periodicityType,
          periodicity_detail: periodicityDetail,
          contribution_amount: newContributionAmount,
          eating_amount: newContributionAmount * validMemberCount,
          previous_tontine_id: tontineId,
          transferred_cash: totalTransferAmount,
          created_by: profile.id,
          status: 'active',
        })
        .select()
        .single();

      if (tontineErr || !newTontine) throw tontineErr || new Error('Failed to create tontine');

      const creatorIdx = newMembers.findIndex((m) => m.userId === profile.id);
      const creatorEatingOrder = creatorIdx >= 0 ? creatorIdx + 1 : 1;

      const { data: creatorMember, error: memberErr } = await supabase
        .from('tontine_members')
        .insert({
          tontine_id: newTontine.id,
          user_id: profile.id,
          role: 'admin',
          eating_order: creatorEatingOrder,
        })
        .select()
        .single();

      if (memberErr || !creatorMember) throw memberErr || new Error('Failed to create member');

      const tourDates = generateScheduleDates(newStartDate, newEndDate, periodicityType, periodicityDetail);
      const creatorScheduledDate = tourDates[creatorIdx >= 0 ? creatorIdx : 0];
      if (creatorScheduledDate) {
        await supabase.from('eating_schedule').insert({
          tontine_id: newTontine.id,
          member_id: creatorMember.id,
          user_id: profile.id,
          order_number: creatorEatingOrder,
          scheduled_date: creatorScheduledDate,
          status: 'pending',
        });
      }

      const today = new Date().toISOString().split('T')[0];
      const newCatRecords: any[] = [];

      for (const cat of transferableCategories) {
        if (categoryDecisions[cat.id] === 'transfer') {
          newCatRecords.push({
            tontine_id: newTontine.id,
            name: cat.name,
            amount_type: cat.amount_type,
            amount: cat.amount,
            is_contribution: false,
            is_in_cash_box: cat.is_in_cash_box,
            can_withdraw_anytime: cat.can_withdraw_anytime,
            withdraw_at_end_only: cat.withdraw_at_end_only,
            loan_order: cat.loan_order,
            initial_amount: getCategoryAvailable(cat.id),
          });
        } else if (categoryDecisions[cat.id] === 'reset') {
          newCatRecords.push({
            tontine_id: newTontine.id,
            name: cat.name,
            amount_type: cat.amount_type,
            amount: cat.amount,
            is_contribution: false,
            is_in_cash_box: cat.is_in_cash_box,
            can_withdraw_anytime: cat.can_withdraw_anytime,
            withdraw_at_end_only: cat.withdraw_at_end_only,
            loan_order: cat.loan_order,
            initial_amount: 0,
          });
        }
      }

      newCatRecords.push({
        tontine_id: newTontine.id,
        name: 'Cotisation',
        amount_type: 'fixed',
        amount: newContributionAmount,
        is_contribution: true,
        is_in_cash_box: false,
        can_withdraw_anytime: false,
        withdraw_at_end_only: false,
        loan_order: null,
        initial_amount: 0,
      });

      for (const nc of newCategories) {
        if (nc.name.trim()) {
          newCatRecords.push({
            tontine_id: newTontine.id,
            name: nc.name,
            amount_type: 'minimum',
            amount: nc.amount,
            is_contribution: false,
            is_in_cash_box: nc.is_in_cash_box,
            can_withdraw_anytime: false,
            withdraw_at_end_only: false,
            loan_order: null,
            initial_amount: 0,
          });
        }
      }

      const { data: insertedCats, error: catErr } = await supabase
        .from('categories')
        .insert(newCatRecords)
        .select();

      if (catErr) throw catErr;

      if (insertedCats) {
        const initialContribs = (insertedCats as any[])
          .filter((c) => Number(c.initial_amount) > 0)
          .map((c) => ({
            tontine_id: newTontine.id,
            member_id: creatorMember.id,
            category_id: c.id,
            amount: c.initial_amount,
            period_date: today,
            recorded_by: profile.id,
          }));
        if (initialContribs.length > 0) {
          await supabase.from('contributions').insert(initialContribs);
        }
      }

      const otherMembers = newMembers.filter((m) => m.userId !== profile.id && m.userId.trim() !== '');
      if (otherMembers.length > 0) {
        const invitations = otherMembers.map((m) => {
          const memberIdx = newMembers.findIndex((mm) => mm.userId === m.userId);
          return {
            tontine_id: newTontine.id,
            inviter_id: profile.id,
            invitee_username: m.username,
            invitee_user_id: m.userId,
            status: 'pending',
            expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
            eating_order: memberIdx >= 0 ? memberIdx + 1 : null,
          };
        });
        await supabase.from('tontine_invitations').insert(invitations);
      }

      await supabase.from('tontines').update({ status: 'completed' }).eq('id', tontineId);

      setSuccess(true);
      setTimeout(() => onNavigate('dashboard'), 2000);
    } catch (err: any) {
      setError(err.message || 'Erreur lors du transfert');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Transferer vers une nouvelle tontine</h1>
        <p className="text-slate-500 mt-1">Transferez les fonds et creez une nouvelle tontine</p>
      </div>

      {success && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-emerald-700 text-sm flex items-center gap-2">
          <Check className="w-4 h-4" /> Tontine transferee avec succes! Redirection...
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* New tontine info */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <h3 className="font-semibold text-slate-900">Informations de la nouvelle tontine</h3>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Nom</label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            placeholder="Nom de la nouvelle tontine"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Date de debut</label>
            <input
              type="date"
              value={newStartDate}
              onChange={(e) => setNewStartDate(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Date de fin</label>
            <input
              type="date"
              value={newEndDate}
              onChange={(e) => setNewEndDate(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-3">Periodicite</label>
          <div className="grid grid-cols-3 gap-2">
            {(['monthly', 'weekly', 'biweekly'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setPeriodicityType(type)}
                className={`p-3 rounded-xl border-2 text-center transition-all ${
                  periodicityType === type
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 hover:border-slate-300 text-slate-600'
                }`}
              >
                <p className="font-medium text-sm">
                  {type === 'monthly' ? 'Mensuel' : type === 'weekly' ? 'Hebdo.' : 'Bi-hebdo.'}
                </p>
              </button>
            ))}
          </div>
        </div>
        {periodicityType === 'monthly' && (
          <div className="grid grid-cols-5 gap-2">
            {[
              { value: 1, label: '1er' }, { value: 2, label: '2e' },
              { value: 3, label: '3e' }, { value: 4, label: '4e' }, { value: 5, label: 'Dernier' },
            ].map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setWeekNumber(value as 1 | 2 | 3 | 4 | 5)}
                className={`p-2.5 rounded-xl border-2 text-center text-sm transition-all ${
                  weekNumber === value ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {periodicityType !== 'monthly' && (
          <div className="grid grid-cols-7 gap-2">
            {['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'].map((day, i) => (
              <button
                key={i}
                onClick={() => setDayOfWeek(i)}
                className={`p-2.5 rounded-xl border-2 text-center text-xs transition-all ${
                  dayOfWeek === i ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600'
                }`}
              >
                {day}
              </button>
            ))}
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Montant de la cotisation</label>
          <input
            type="number"
            value={newContributionAmount || ''}
            onChange={(e) => setNewContributionAmount(Number(e.target.value))}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            min={0}
          />
        </div>
        {tourCount > 0 && (
          <div className={`rounded-xl p-3 border text-sm ${
            validMemberCount === tourCount
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}>
            Membres: {validMemberCount} | Tours: {tourCount}
            {validMemberCount !== tourCount && ' (doivent etre egaux)'}
          </div>
        )}
      </div>

      {/* Category transfer decisions */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <h3 className="font-semibold text-slate-900">Categories - Transfert / Reinitialisation</h3>
        <p className="text-sm text-slate-500">Choisissez quoi faire avec chaque categorie de la caisse.</p>

        {transferableCategories.length === 0 && (
          <p className="text-sm text-slate-400">Aucune categorie transferable.</p>
        )}

        {transferableCategories.map((cat) => {
          const available = getCategoryAvailable(cat.id);
          const decision = categoryDecisions[cat.id] || 'none';
          return (
            <div key={cat.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-200">
              <div>
                <p className="text-sm font-medium text-slate-800">{cat.name}</p>
                <p className="text-xs text-slate-500">Disponible: {formatCurrency(available)}</p>
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setCategoryDecisions({ ...categoryDecisions, [cat.id]: 'transfer' })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    decision === 'transfer'
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Transferer
                </button>
                <button
                  onClick={() => setCategoryDecisions({ ...categoryDecisions, [cat.id]: 'reset' })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    decision === 'reset'
                      ? 'bg-amber-500 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Reinitialiser
                </button>
                <button
                  onClick={() => setCategoryDecisions({ ...categoryDecisions, [cat.id]: 'none' })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    decision === 'none'
                      ? 'bg-slate-500 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Ignorer
                </button>
              </div>
            </div>
          );
        })}

        {totalTransferAmount > 0 && (
          <div className="flex items-center justify-between px-3 py-2.5 bg-emerald-50 rounded-xl border border-emerald-200">
            <span className="text-sm font-medium text-emerald-800">Total a transferer</span>
            <span className="text-lg font-bold text-emerald-900 font-mono">{formatCurrency(totalTransferAmount)}</span>
          </div>
        )}
      </div>

      {/* New categories */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">Nouvelles categories</h3>
          <button
            onClick={addNewCategory}
            className="flex items-center gap-1.5 text-sm text-emerald-600 hover:text-emerald-700 font-medium"
          >
            <Plus className="w-4 h-4" /> Ajouter
          </button>
        </div>
        {newCategories.length === 0 && (
          <p className="text-sm text-slate-400">Aucune nouvelle categorie.</p>
        )}
        {newCategories.map((nc, i) => (
          <div key={i} className="flex items-center gap-3">
            <input
              type="text"
              value={nc.name}
              onChange={(e) => updateNewCategory(i, { name: e.target.value })}
              className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              placeholder="Nom"
            />
            <input
              type="number"
              value={nc.amount || ''}
              onChange={(e) => updateNewCategory(i, { amount: Number(e.target.value) })}
              className="w-28 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              placeholder="Min."
              min={0}
            />
            <button
              onClick={() => removeNewCategory(i)}
              className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-500"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Members */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <h3 className="font-semibold text-slate-900">Membres de la nouvelle tontine</h3>
        <div className="space-y-2">
          {newMembers.map((member, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-7 h-7 bg-slate-100 rounded-lg flex items-center justify-center text-xs font-bold text-slate-600">
                {i + 1}
              </div>
              {i > 0 && (
                <button onClick={() => moveMember(i, i - 1)} className="p-1 hover:bg-slate-100 rounded text-slate-400">
                  <ChevronUp className="w-4 h-4" />
                </button>
              )}
              {i < newMembers.length - 1 && (
                <button onClick={() => moveMember(i, i + 1)} className="p-1 hover:bg-slate-100 rounded text-slate-400">
                  <ChevronDown className="w-4 h-4" />
                </button>
              )}
              <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg">
                <span className="text-sm font-medium text-slate-800">{member.displayName}</span>
                <span className="text-xs text-slate-400">@{member.username}</span>
              </div>
              {i > 0 && (
                <button onClick={() => removeMember(i)} className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-500">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={memberSearchQuery}
            onChange={(e) => handleMemberSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            placeholder="Rechercher un utilisateur..."
            autoComplete="off"
          />
          {memberSearchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 max-h-60 overflow-y-auto">
              {memberSearchResults.map((user) => (
                <button
                  key={user.id}
                  onClick={() => selectMember(user)}
                  className="w-full text-left px-4 py-3 hover:bg-emerald-50 flex items-center gap-3 border-b border-slate-50 last:border-0"
                >
                  <span className="text-sm font-medium text-slate-800">
                    {user.first_name} {user.last_name}
                  </span>
                  <span className="text-xs text-slate-500">@{user.username}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => onNavigate('payouts')}
          className="px-5 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-50 rounded-xl transition-all"
        >
          Annuler
        </button>
        <button
          onClick={handleTransfer}
          disabled={saving || !canProceed()}
          className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all shadow-sm flex items-center gap-2"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Transfert...' : 'Transferer et creer'}
        </button>
      </div>
    </div>
  );
}
