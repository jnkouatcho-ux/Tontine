import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { formatCurrency, formatDate, getPeriodicityLabel } from '../lib/utils';
import type {
  Tontine, TontineMember, Category, Contribution, EatingSchedule, Profile,
  Payout, Loan, LoanSource, LoanRepayment, CashWithdrawal,
} from '../types/database';
import {
  Wallet,
  HandCoins,
  Users,
  Calendar,
  TrendingUp,
  ChevronRight,
  CircleDollarSign,
} from 'lucide-react';

const EF_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tontine-data`;

interface DashboardPageProps {
  tontineId: string;
  onNavigate: (page: string) => void;
}

export default function DashboardPage({ tontineId, onNavigate }: DashboardPageProps) {
  const { profile, session } = useAuth();
  const [tontine, setTontine] = useState<Tontine | null>(null);
  const [members, setMembers] = useState<(TontineMember & { profile: Profile })[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [schedule, setSchedule] = useState<(EatingSchedule & { profile?: Profile })[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loans, setLoans] = useState<(Loan & { loan_sources?: LoanSource[] })[]>([]);
  const [repayments, setRepayments] = useState<LoanRepayment[]>([]);
  const [withdrawals, setWithdrawals] = useState<CashWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);

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
      if (data.categories) setCategories(data.categories);
      if (data.contributions) setContributions(data.contributions);
      if (data.schedule) setSchedule(data.schedule);
      if (data.loans) setLoans(data.loans);
      if (data.withdrawals) setWithdrawals(data.withdrawals);
    } catch {
      // silent
    }

    const [payoutRes, repayRes] = await Promise.all([
      supabase.from('payouts').select('*').eq('tontine_id', tontineId),
      supabase.from('loan_repayments').select('*'),
    ]);
    if (payoutRes.data) setPayouts(payoutRes.data);
    if (repayRes.data) setRepayments(repayRes.data);

    setLoading(false);
  }, [tontineId, session]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading || !tontine) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const memberCount = members.length;
  const contributionCategoryIds = categories.filter((c) => c.is_contribution || c.can_withdraw_anytime).map((c) => c.id);
  const expectedPerMember = categories
    .filter((c) => c.is_contribution || c.can_withdraw_anytime)
    .reduce((sum, c) => sum + Number(c.amount), 0);

  // Total contributions collected per category (all time) — used for display only
  const categoryContribTotals: Record<string, number> = {};
  categories.forEach((cat) => { categoryContribTotals[cat.id] = 0; });
  contributions.forEach((c) => {
    categoryContribTotals[c.category_id] = (categoryContribTotals[c.category_id] || 0) + Number(c.amount);
  });

  // Per-member per-category contribution totals
  const memberCatContribs: Record<string, Record<string, number>> = {};
  contributions.forEach((c) => {
    if (!memberCatContribs[c.member_id]) memberCatContribs[c.member_id] = {};
    memberCatContribs[c.member_id][c.category_id] = (memberCatContribs[c.member_id][c.category_id] || 0) + Number(c.amount);
  });

  // Per-member per-category withdrawal totals
  const memberCatWithdrawals: Record<string, Record<string, number>> = {};
  withdrawals.forEach((w) => {
    if (!w.member_id) return;
    if (!memberCatWithdrawals[w.member_id]) memberCatWithdrawals[w.member_id] = {};
    memberCatWithdrawals[w.member_id][w.category_id] = (memberCatWithdrawals[w.member_id][w.category_id] || 0) + Number(w.amount);
  });

  // Active loans: amount still outstanding per source category
  const categoryLoansOutstanding: Record<string, number> = {};
  loans
    .filter((l) => l.status === 'active' || l.status === 'approved')
    .forEach((l) => {
      const principalRepaid = repayments
        .filter((r) => r.loan_id === l.id)
        .reduce((sum, r) => sum + Number(r.amount), 0);
      const outstanding = Math.max(0, Number(l.amount) - principalRepaid);
      if (!l.loan_sources || outstanding <= 0) return;
      const totalSources = l.loan_sources.reduce((s, src) => s + Number(src.amount), 0);
      l.loan_sources.forEach((src) => {
        const srcShare = totalSources > 0 ? (Number(src.amount) / totalSources) * outstanding : 0;
        categoryLoansOutstanding[src.category_id] = (categoryLoansOutstanding[src.category_id] || 0) + srcShare;
      });
    });

  // Available per category = sum of individual member nets (each clamped at 0) minus loans.
  // Using per-member approach so that a single member's negative balance (e.g. fine deducted
  // beyond their savings) doesn't falsely reduce the collective caisse.
  const getCategoryAvailable = (catId: string) => {
    const memberNetSum = members.reduce((sum, m) => {
      const contribs = memberCatContribs[m.id]?.[catId] || 0;
      const wds = memberCatWithdrawals[m.id]?.[catId] || 0;
      return sum + Math.max(0, contribs - wds);
    }, 0);
    const outLoans = categoryLoansOutstanding[catId] || 0;
    return Math.max(0, memberNetSum - outLoans);
  };

  // Caisse card: sum of all cash-box non-contribution categories + transferred cash
  const cashBoxAvailable = categories
    .filter((c) => c.is_in_cash_box && !c.is_contribution && !c.can_withdraw_anytime)
    .reduce((sum, cat) => sum + getCategoryAvailable(cat.id), 0) + Number(tontine.transferred_cash || 0);

  // Contribution card: unpaid periods only
  const paidOutPeriods = new Set(payouts.map((p) => (p as any).period_date).filter(Boolean));
  const unpaidContribsByPeriod: Record<string, number> = {};
  if (contributionCategoryIds.length > 0) {
    contributions
      .filter((c) => contributionCategoryIds.includes(c.category_id))
      .forEach((c) => {
        if (!paidOutPeriods.has(c.period_date)) {
          unpaidContribsByPeriod[c.period_date] = (unpaidContribsByPeriod[c.period_date] || 0) + Number(c.amount);
        }
      });
  }
  const contributionPending = Object.values(unpaidContribsByPeriod).reduce((sum, v) => sum + v, 0);
  const totalPaidOut = payouts.reduce((sum, p) => sum + Number(p.total_amount), 0);

  // Current period = latest unpaid period with contributions
  const currentPeriodDate = Object.keys(unpaidContribsByPeriod).sort().reverse()[0] || null;
  const currentPeriodCollected = currentPeriodDate ? (unpaidContribsByPeriod[currentPeriodDate] || 0) : 0;
  const currentPeriodPaidCount = currentPeriodDate && contributionCategoryIds.length > 0
    ? new Set(contributions.filter((c) => contributionCategoryIds.includes(c.category_id) && c.period_date === currentPeriodDate).map((c) => c.member_id)).size
    : 0;

  const myMemberId = members.find((m) => m.user_id === profile?.id)?.id;

  // My net balance per category (reuses already-computed per-member lookups)
  const getMyCategoryNet = (catId: string) => {
    if (!myMemberId) return 0;
    const contribs = memberCatContribs[myMemberId]?.[catId] || 0;
    const wds = memberCatWithdrawals[myMemberId]?.[catId] || 0;
    return contribs - wds;
  };

  const myCashTotal = categories
    .filter((c) => c.is_in_cash_box && !c.is_contribution && !c.can_withdraw_anytime)
    .reduce((sum, cat) => sum + getMyCategoryNet(cat.id), 0);

  const nextEating = schedule.find((s) => s.status === 'pending');
  const completedEating = schedule.filter((s) => s.status === 'completed').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{tontine.name}</h1>
        <p className="text-slate-500 mt-1">
          {getPeriodicityLabel(tontine.periodicity_type, tontine.periodicity_detail)} | {formatDate(tontine.start_date)} - {formatDate(tontine.end_date)}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
              <Users className="w-5 h-5 text-emerald-600" />
            </div>
            <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">Membres</span>
          </div>
          <p className="text-2xl font-bold text-slate-900">{memberCount}</p>
          <p className="text-sm text-slate-500 mt-1">{completedEating}/{schedule.length} tours completes</p>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
              <Wallet className="w-5 h-5 text-blue-600" />
            </div>
            <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded-lg">Caisse</span>
          </div>
          <p className="text-2xl font-bold text-slate-900">{formatCurrency(cashBoxAvailable)}</p>
          <p className="text-sm text-slate-500 mt-1">Disponible (hors prets actifs)</p>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
              <HandCoins className="w-5 h-5 text-amber-600" />
            </div>
            <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-1 rounded-lg">Cotisation</span>
          </div>
          <p className="text-2xl font-bold text-slate-900">{formatCurrency(contributionPending)}</p>
          <div className="mt-1 space-y-0.5">
            <p className="text-sm text-slate-500">
              {currentPeriodDate
                ? `${currentPeriodPaidCount}/${memberCount} membres — ${formatCurrency(currentPeriodCollected)}`
                : 'Aucune cotisation en cours'}
            </p>
            {totalPaidOut > 0 && (
              <p className="text-xs text-emerald-600 font-medium">{formatCurrency(totalPaidOut)} deja verse</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-teal-50 rounded-xl flex items-center justify-center">
              <CircleDollarSign className="w-5 h-5 text-teal-600" />
            </div>
            <span className="text-xs font-medium text-teal-600 bg-teal-50 px-2 py-1 rounded-lg">Mon total</span>
          </div>
          <p className="text-2xl font-bold text-slate-900">{formatCurrency(myCashTotal)}</p>
          <p className="text-sm text-slate-500 mt-1">Mes contributions en caisse</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Disponible par categorie</h2>
            <button onClick={() => onNavigate('contributions')} className="text-sm text-emerald-600 hover:text-emerald-700 flex items-center gap-1">
              Voir tout <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="divide-y divide-slate-50">
            {categories.map((cat) => {
              const available = (cat.is_contribution || cat.can_withdraw_anytime)
                ? contributionPending
                : getCategoryAvailable(cat.id);
              const collected = categoryContribTotals[cat.id] || 0;
              const loansOut = categoryLoansOutstanding[cat.id] || 0;
              const myTotal = getMyCategoryNet(cat.id);
              return (
                <div key={cat.id} className="px-6 py-3.5 flex items-center justify-between hover:bg-slate-25 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${(cat.is_contribution || cat.can_withdraw_anytime) ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                    <div>
                      <span className="text-sm font-medium text-slate-800">{cat.name}</span>
                      {(cat.is_contribution || cat.can_withdraw_anytime) && (
                        <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Cotisation</span>
                      )}
                      {!cat.is_in_cash_box && (
                        <span className="ml-2 text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">Hors caisse</span>
                      )}
                      {loansOut > 0 && (
                        <span className="ml-2 text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">
                          -{formatCurrency(loansOut)} prete
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-900">{formatCurrency(available)}</p>
                    <p className="text-xs text-slate-400">
                      {(cat.is_contribution || cat.can_withdraw_anytime) ? `verse: ${formatCurrency(totalPaidOut)}` : `total: ${formatCurrency(collected)}`}
                    </p>
                    <p className="text-xs text-slate-500">Moi: {formatCurrency(myTotal)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Calendrier des tours</h2>
            <button onClick={() => onNavigate('payouts')} className="text-sm text-emerald-600 hover:text-emerald-700 flex items-center gap-1">
              Voir tout <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="divide-y divide-slate-50 max-h-80 overflow-y-auto">
            {schedule.length === 0 && (
              <div className="px-6 py-8 text-center text-slate-400 text-sm">Aucun tour programme</div>
            )}
            {schedule.map((s) => {
              const schedProfile = (s as any).profile as Profile | undefined;
              return (
                <div key={s.id} className="px-6 py-3.5 flex items-center justify-between hover:bg-slate-25 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                      s.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {s.order_number}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        {schedProfile ? `${schedProfile.first_name} ${schedProfile.last_name}`.trim() || schedProfile.username : 'Membre'}
                      </p>
                      <p className="text-xs text-slate-500">{formatDate(s.scheduled_date)}</p>
                    </div>
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                    s.status === 'completed'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}>
                    {s.status === 'completed' ? 'Verse' : 'En attente'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {nextEating && (
        <div className="bg-gradient-to-r from-emerald-500 to-teal-600 rounded-2xl p-6 text-white shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-emerald-100 text-sm font-medium">Prochain tour</p>
              <p className="text-xl font-bold mt-1">
                Tour #{nextEating.order_number} - {formatDate(nextEating.scheduled_date)}
              </p>
              <p className="text-emerald-100 text-sm mt-2">
                Montant a verser: {formatCurrency(expectedPerMember * memberCount)}
              </p>
            </div>
            <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center">
              <Calendar className="w-7 h-7" />
            </div>
          </div>
        </div>
      )}

      {tontine.transferred_cash > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-center gap-3">
          <TrendingUp className="w-5 h-5 text-blue-600" />
          <div>
            <p className="text-sm font-medium text-blue-800">Transfert de tontine precedente</p>
            <p className="text-sm text-blue-600">{formatCurrency(tontine.transferred_cash)} transferes</p>
          </div>
        </div>
      )}
    </div>
  );
}
