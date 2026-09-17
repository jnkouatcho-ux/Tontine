import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { formatCurrency, formatDate, getPeriodicityLabel, generateScheduleDates } from '../lib/utils';
import type { Category, Contribution, TontineMember, Profile, Tontine } from '../types/database';
import { HandCoins, Plus, Check, AlertCircle, ChevronDown, ChevronRight, Calendar, Pencil, X, ArrowRightLeft } from 'lucide-react';

const EF_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tontine-data`;

interface ContributionsPageProps {
  tontineId: string;
  isAdmin: boolean;
}

interface PeriodGroup {
  periodDate: string;
  label: string;
  contributions: (Contribution & { profile?: Profile; category?: Category })[];
  memberTotals: Record<string, number>;
  categoryTotals: Record<string, number>;
  total: number;
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export default function ContributionsPage({ tontineId, isAdmin }: ContributionsPageProps) {
  const { profile, session } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [contributions, setContributions] = useState<(Contribution & { profile?: Profile; category?: Category })[]>([]);
  const [members, setMembers] = useState<(TontineMember & { profile: Profile })[]>([]);
  const [tontine, setTontine] = useState<Tontine | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedMember, setSelectedMember] = useState<string>('');
  const [periodDate, setPeriodDate] = useState<string>('');
  const [categoryAmounts, setCategoryAmounts] = useState<Record<string, number>>({});
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [expandedPeriods, setExpandedPeriods] = useState<Set<string>>(new Set());

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState<number>(0);
  const [editError, setEditError] = useState('');

  // Late contribution as loan
  const [asLoan, setAsLoan] = useState(false);
  const [loanSourceCategory, setLoanSourceCategory] = useState<string>('');

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
      if (data.categories) {
        setCategories(data.categories);
        const defaults: Record<string, number> = {};
        data.categories.forEach((cat: Category) => {
          defaults[cat.id] = cat.amount;
        });
        setCategoryAmounts(defaults);
      }
      if (data.contributions) setContributions(data.contributions);
      if (data.members) setMembers(data.members);
      if (data.tontine) setTontine(data.tontine);
    } catch {
      // silent
    }
    setLoading(false);
  }, [tontineId, session]);

  useEffect(() => { loadData(); }, [loadData]);

  const availablePeriodDates = useMemo(() => {
    if (!tontine) return [];
    return generateScheduleDates(
      tontine.start_date,
      tontine.end_date,
      tontine.periodicity_type,
      tontine.periodicity_detail
    );
  }, [tontine]);

  // Members who have NOT yet cotised for the selected period date (for the contribution category)
  const availableMembers = useMemo(() => {
    if (!periodDate) return members;
    const contributionCatIds = categories.filter((c) => c.is_contribution || c.can_withdraw_anytime).map((c) => c.id);
    if (contributionCatIds.length === 0) return members;
    const alreadyPaid = new Set(
      contributions
        .filter((c) => c.period_date === periodDate && contributionCatIds.includes(c.category_id))
        .map((c) => c.member_id)
    );
    return members.filter((m) => !alreadyPaid.has(m.id));
  }, [periodDate, members, contributions, categories]);

  // How many members have paid for the selected period
  const periodPaymentStatus = useMemo(() => {
    if (!periodDate) return { paid: 0, total: members.length };
    const contributionCatIds = categories.filter((c) => c.is_contribution || c.can_withdraw_anytime).map((c) => c.id);
    if (contributionCatIds.length === 0) return { paid: 0, total: members.length };
    const paid = new Set(
      contributions
        .filter((c) => c.period_date === periodDate && contributionCatIds.includes(c.category_id))
        .map((c) => c.member_id)
    ).size;
    return { paid, total: members.length };
  }, [periodDate, members, contributions, categories]);

  const periodGroups = useMemo(() => {
    const groups: Record<string, (Contribution & { profile?: Profile; category?: Category })[]> = {};
    contributions.forEach((c) => {
      const key = c.period_date;
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });

    const result: PeriodGroup[] = Object.entries(groups)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([periodDate, contribs]) => {
        const memberTotals: Record<string, number> = {};
        const categoryTotals: Record<string, number> = {};
        let total = 0;
        contribs.forEach((c) => {
          memberTotals[c.member_id] = (memberTotals[c.member_id] || 0) + Number(c.amount);
          categoryTotals[c.category_id] = (categoryTotals[c.category_id] || 0) + Number(c.amount);
          total += Number(c.amount);
        });
        return {
          periodDate,
          label: `Cotisation du ${formatDate(periodDate)}`,
          contributions: contribs,
          memberTotals,
          categoryTotals,
          total,
        };
      });

    return result;
  }, [contributions]);

  useEffect(() => {
    if (periodGroups.length > 0 && expandedPeriods.size === 0) {
      setExpandedPeriods(new Set([periodGroups[0].periodDate]));
    }
  }, [periodGroups, expandedPeriods.size]);


  const togglePeriod = (periodDate: string) => {
    setExpandedPeriods((prev) => {
      const next = new Set(prev);
      if (next.has(periodDate)) next.delete(periodDate);
      else next.add(periodDate);
      return next;
    });
  };

  const canEditContribution = (c: Contribution): boolean => {
    if (!isAdmin) return false;
    const cat = categories.find((cat) => cat.id === c.category_id);
    if (cat?.is_contribution || cat?.can_withdraw_anytime) return false;
    const paidAt = new Date(c.paid_at).getTime();
    const now = Date.now();
    return (now - paidAt) <= ONE_WEEK_MS;
  };

  const startEdit = (c: Contribution) => {
    setEditingId(c.id);
    setEditAmount(Number(c.amount));
    setEditError('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditAmount(0);
    setEditError('');
  };

  const handleEditSave = async (contributionId: string, categoryId: string) => {
    if (!profile) return;
    setEditError('');

    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return;

    if (cat.amount_type === 'fixed' && editAmount !== cat.amount) {
      setEditError(`Le montant pour "${cat.name}" doit etre ${formatCurrency(cat.amount)}`);
      return;
    }
    if (cat.amount_type === 'minimum' && editAmount < cat.amount) {
      setEditError(`Le montant minimum pour "${cat.name}" est ${formatCurrency(cat.amount)}`);
      return;
    }
    if (editAmount <= 0) {
      setEditError('Le montant doit etre superieur a 0');
      return;
    }

    const { error } = await supabase
      .from('contributions')
      .update({ amount: editAmount })
      .eq('id', contributionId);

    if (error) {
      setEditError(error.message);
    } else {
      setEditingId(null);
      setEditAmount(0);
      loadData();
    }
  };

  const handleAddContribution = async () => {
    if (!profile || !selectedMember) return;
    setSaveError('');
    setSaveSuccess('');

    for (const cat of categories) {
      const amount = categoryAmounts[cat.id] || 0;
      if (amount <= 0) continue;
      if (cat.is_contribution && amount !== cat.amount) {
        setSaveError(`Le montant pour "${cat.name}" doit etre ${formatCurrency(cat.amount)}`);
        return;
      }
      if (cat.can_withdraw_anytime && cat.amount_type === 'fixed' && amount !== cat.amount) {
        setSaveError(`Le montant pour "${cat.name}" doit etre ${formatCurrency(cat.amount)}`);
        return;
      }
      if (cat.can_withdraw_anytime && cat.amount_type === 'minimum' && amount < cat.amount) {
        setSaveError(`Le montant minimum pour "${cat.name}" est ${formatCurrency(cat.amount)}`);
        return;
      }
      if (!cat.is_contribution && !cat.can_withdraw_anytime && cat.amount_type === 'fixed' && amount !== cat.amount) {
        setSaveError(`Le montant pour "${cat.name}" doit etre ${formatCurrency(cat.amount)}`);
        return;
      }
      if (!cat.is_contribution && !cat.can_withdraw_anytime && cat.amount_type === 'minimum' && amount < cat.amount) {
        setSaveError(`Le montant minimum pour "${cat.name}" est ${formatCurrency(cat.amount)}`);
        return;
      }
    }

    if (!periodDate) {
      setSaveError('Veuillez selectionner la date de cotisation');
      return;
    }

    const records = categories
      .filter((cat) => (categoryAmounts[cat.id] || 0) > 0)
      .map((cat) => ({
        tontine_id: tontineId,
        member_id: selectedMember,
        category_id: cat.id,
        amount: categoryAmounts[cat.id],
        period_date: periodDate,
        recorded_by: profile.id,
      }));

    if (records.length === 0) {
      setSaveError('Aucun montant a enregistrer');
      return;
    }

    if (asLoan) {
      if (!loanSourceCategory) {
        setSaveError('Veuillez selectionner la categorie source du pret');
        return;
      }
      const totalAmount = records.reduce((sum, r) => sum + r.amount, 0);
      const rate = Number(tontine?.late_contribution_loan_rate || 0);
      const ratePeriod = tontine?.late_contribution_loan_period || 'monthly';
      const { data: loan, error: loanErr } = await supabase.from('loans').insert({
        tontine_id: tontineId,
        member_id: selectedMember,
        amount: totalAmount,
        interest_rate: rate,
        interest_rate_period: ratePeriod,
        duration_months: 1,
        status: 'active',
        approved_by: profile.id,
        approved_at: new Date().toISOString(),
      }).select().single();
      if (loanErr || !loan) {
        setSaveError(loanErr?.message || 'Erreur lors de la creation du pret');
        return;
      }
      await supabase.from('loan_sources').insert({
        loan_id: loan.id,
        category_id: loanSourceCategory,
        amount: totalAmount,
      });
      const { error: contribErr } = await supabase.from('contributions').insert(records);
      if (contribErr) {
        setSaveError(contribErr.message);
        return;
      }
      setSaveSuccess('Cotisation enregistree et prelee sur forme de pret');
    } else {
      const { error } = await supabase.from('contributions').insert(records);
      if (error) {
        setSaveError(error.message);
        return;
      }
      setSaveSuccess('Cotisations enregistrees avec succes');
    }
    setShowAdd(false);
    setSelectedMember('');
    setPeriodDate('');
    setAsLoan(false);
    setLoanSourceCategory('');
    const defaults: Record<string, number> = {};
    categories.forEach((cat) => {
      defaults[cat.id] = (cat.is_contribution || cat.can_withdraw_anytime || cat.amount_type === 'fixed') ? cat.amount : cat.amount;
    });
    setCategoryAmounts(defaults);
    loadData();
  };

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
          <h1 className="text-2xl font-bold text-slate-900">Cotisations</h1>
          <p className="text-slate-500 mt-1">
            {tontine ? getPeriodicityLabel(tontine.periodicity_type, tontine.periodicity_detail) : ''}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-xl transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Enregistrer
          </button>
        )}
      </div>

      {/* Add contribution form */}
      {showAdd && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
          <h3 className="font-semibold text-slate-900">Enregistrer les cotisations d'un membre</h3>
          <p className="text-sm text-slate-500">Remplissez les montants pour chaque categorie. Les montants fixes sont pre-remplis et ne peuvent pas etre modifies.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Date de cotisation</label>
              <select
                value={periodDate}
                onChange={(e) => { setPeriodDate(e.target.value); setSelectedMember(''); }}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              >
                <option value="">Choisir la date</option>
                {availablePeriodDates.map((d) => (
                  <option key={d} value={d}>Cotisation du {formatDate(d)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Membre
                {periodDate && (
                  <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                    periodPaymentStatus.paid === periodPaymentStatus.total
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}>
                    {periodPaymentStatus.paid}/{periodPaymentStatus.total} ont cotise
                  </span>
                )}
              </label>
              {periodDate && availableMembers.length === 0 ? (
                <div className="w-full px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 flex items-center gap-2">
                  <Check className="w-4 h-4" />
                  Tous les membres ont cotise pour cette date
                </div>
              ) : (
                <select
                  value={selectedMember}
                  onChange={(e) => setSelectedMember(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                >
                  <option value="">Selectionner un membre</option>
                  {availableMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.profile.first_name} {m.profile.last_name} (@{m.profile.username})
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-medium text-slate-700">Montants par categorie</h4>
            {categories.map((cat) => {
              const isLocked = cat.is_contribution || cat.can_withdraw_anytime || cat.amount_type === 'fixed';
              const amount = categoryAmounts[cat.id] || 0;
              return (
                <div key={cat.id} className={`flex items-center gap-3 p-3 rounded-xl border ${
                  (cat.is_contribution || cat.can_withdraw_anytime) ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'
                }`}>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800">{cat.name}</span>
                      {(cat.is_contribution || cat.can_withdraw_anytime) && (
                        <span className="text-xs bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded">Cotisation</span>
                      )}
                      {isLocked && !cat.is_contribution && !cat.can_withdraw_anytime && (
                        <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">Fixe</span>
                      )}
                      {!isLocked && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Min: {formatCurrency(cat.amount)}</span>
                      )}
                    </div>
                  </div>
                  <div className="w-36">
                    {isLocked ? (
                      <div className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-500 font-mono text-right">
                        {formatCurrency(cat.amount)}
                      </div>
                    ) : (
                      <input
                        type="number"
                        value={amount || ''}
                        onChange={(e) => {
                          setCategoryAmounts({ ...categoryAmounts, [cat.id]: Number(e.target.value) });
                        }}
                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-right font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                        placeholder="0"
                        min={cat.amount}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between px-3 py-2.5 bg-emerald-50 rounded-xl border border-emerald-200">
            <span className="text-sm font-medium text-emerald-800">Total</span>
            <span className="text-lg font-bold text-emerald-900 font-mono">
              {formatCurrency(categories.reduce((sum, cat) => sum + (categoryAmounts[cat.id] || 0), 0))}
            </span>
          </div>

          {tontine && Number(tontine.late_contribution_loan_rate || 0) >= 0 && (
            <div className="p-4 rounded-xl border border-blue-200 bg-blue-50 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={asLoan}
                  onChange={(e) => setAsLoan(e.target.checked)}
                  className="rounded border-slate-300 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-blue-800 flex items-center gap-1.5">
                  <ArrowRightLeft className="w-4 h-4" />
                  Prelever sur forme de pret
                </span>
              </label>
              {asLoan && (
                <div>
                  <label className="block text-xs text-slate-600 mb-1">Categorie source (ou prelever les fonds)</label>
                  <select
                    value={loanSourceCategory}
                    onChange={(e) => setLoanSourceCategory(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  >
                    <option value="">Selectionner</option>
                    {categories.filter((c) => c.is_in_cash_box && !c.is_contribution).map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500 mt-1.5">
                    Taux: {Number(tontine.late_contribution_loan_rate || 0)}% {tontine.late_contribution_loan_period === 'monthly' ? 'par mois' : 'par 3 mois'}. Le montant total sera enregistre comme pret actif pour ce membre.
                  </p>
                </div>
              )}
            </div>
          )}

          {saveError && <p className="text-sm text-red-600 flex items-center gap-1"><AlertCircle className="w-4 h-4" />{saveError}</p>}
          {saveSuccess && <p className="text-sm text-emerald-600 flex items-center gap-1"><Check className="w-4 h-4" />{saveSuccess}</p>}
          <div className="flex justify-end gap-3">
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-xl">Annuler</button>
            <button
              onClick={handleAddContribution}
              disabled={!selectedMember || !periodDate}
              className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all"
            >
              Enregistrer toutes les cotisations
            </button>
          </div>
        </div>
      )}

      {/* Period-grouped contribution tables */}
      {periodGroups.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <HandCoins className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">Aucune cotisation enregistree</p>
        </div>
      ) : (
        <div className="space-y-3">
          {periodGroups.map((group) => {
            const isExpanded = expandedPeriods.has(group.periodDate);
            return (
              <div key={group.periodDate} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <button
                  onClick={() => togglePeriod(group.periodDate)}
                  className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-25 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                      <Calendar className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-semibold text-slate-900">{group.label}</p>
                      <p className="text-xs text-slate-500">{group.contributions.length} entree(s)</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-lg font-bold text-slate-900 font-mono">{formatCurrency(group.total)}</span>
                    {isExpanded ? (
                      <ChevronDown className="w-5 h-5 text-slate-400" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-100">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="text-left px-5 py-2.5 font-semibold text-slate-700 whitespace-nowrap">Membre</th>
                            {categories.map((cat) => (
                              <th key={cat.id} className="text-right px-3 py-2.5 font-semibold text-slate-700 whitespace-nowrap">
                                <div className="flex flex-col items-end">
                                  <span className="text-xs">{cat.name}</span>
                                </div>
                              </th>
                            ))}
                            <th className="text-right px-3 py-2.5 font-semibold text-slate-700 whitespace-nowrap text-xs">Total</th>
                            {isAdmin && <th className="px-3 py-2.5 w-10"></th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {members.map((m) => {
                            const memberContribs = group.contributions.filter((c) => c.member_id === m.id);
                            const memberTotal = group.memberTotals[m.id] || 0;
                            if (memberContribs.length === 0 && memberTotal === 0) return null;
                            return (
                              <tr key={m.id} className="hover:bg-slate-25 transition-colors">
                                <td className="px-5 py-2.5 font-medium text-slate-800 whitespace-nowrap text-sm">
                                  {m.profile.first_name} {m.profile.last_name}
                                  {!m.profile.first_name && !m.profile.last_name && `@${m.profile.username}`}
                                </td>
                                {categories.map((cat) => {
                                  const contrib = memberContribs.find((c) => c.category_id === cat.id);
                                  const catAmount = contrib ? Number(contrib.amount) : 0;
                                  const isEditing = editingId === contrib?.id;
                                  const canEdit = contrib ? canEditContribution(contrib) : false;

                                  return (
                                    <td key={cat.id} className={`text-right px-3 py-2.5 font-mono text-xs ${
                                      (cat.is_contribution || cat.can_withdraw_anytime) ? 'text-amber-700' : 'text-slate-700'
                                    }`}>
                                      {isEditing ? (
                                        <div className="flex items-center justify-end gap-1">
                                          <input
                                            type="number"
                                            value={editAmount || ''}
                                            onChange={(e) => setEditAmount(Number(e.target.value))}
                                            className="w-20 px-2 py-1 border border-emerald-300 rounded-lg text-xs text-right font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                            min={0}
                                          />
                                          <button
                                            onClick={() => handleEditSave(contrib!.id, cat.id)}
                                            className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                                          >
                                            <Check className="w-3.5 h-3.5" />
                                          </button>
                                          <button
                                            onClick={cancelEdit}
                                            className="p-1 text-slate-400 hover:bg-slate-50 rounded"
                                          >
                                            <X className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      ) : (
                                        <div className="flex items-center justify-end gap-1">
                                          <span>{catAmount > 0 ? formatCurrency(catAmount) : '-'}</span>
                                          {canEdit && !editingId && (
                                            <button
                                              onClick={() => startEdit(contrib!)}
                                              className="p-0.5 text-slate-400 hover:text-emerald-600 rounded opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity"
                                              title="Modifier (disponible 1 semaine)"
                                            >
                                              <Pencil className="w-3 h-3" />
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </td>
                                  );
                                })}
                                <td className="text-right px-3 py-2.5 font-semibold text-slate-900 font-mono text-xs">
                                  {memberTotal > 0 ? formatCurrency(memberTotal) : '-'}
                                </td>
                                {isAdmin && <td className="px-3 py-2.5"></td>}
                              </tr>
                            );
                          })}
                          <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold">
                            <td className="px-5 py-2.5 text-slate-800 text-sm">Total</td>
                            {categories.map((cat) => (
                              <td key={cat.id} className={`text-right px-3 py-2.5 font-mono text-xs ${
                                cat.is_contribution ? 'text-amber-700' : 'text-slate-900'
                              }`}>
                                {formatCurrency(group.categoryTotals[cat.id] || 0)}
                              </td>
                            ))}
                            <td className="text-right px-3 py-2.5 font-mono text-xs text-slate-900">
                              {formatCurrency(group.total)}
                            </td>
                            {isAdmin && <td className="px-3 py-2.5"></td>}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    {editError && (
                      <div className="px-5 py-2 text-xs text-red-600 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />{editError}
                      </div>
                    )}
                    {isAdmin && (
                      <div className="px-5 py-2 border-t border-slate-50 text-xs text-slate-400">
                        Modification possible dans les 7 jours suivant la saisie
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
