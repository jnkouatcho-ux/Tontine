import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { formatCurrency, formatDate, generateScheduleDates, getPeriodicityLabel } from '../lib/utils';
import type { EatingSchedule, TontineMember, Profile, Contribution, Category, Tontine, Payout, CashWithdrawal, Loan, LoanSource, LoanRepayment, InterestDistribution, FineApplication } from '../types/database';
import { Wallet, CheckCircle, ArrowUpCircle, Calendar, ChevronDown, ChevronRight, FileText, ArrowRightLeft } from 'lucide-react';
import { generateRecapPDF } from '../lib/pdfRecap';

const EF_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tontine-data`;

interface PayoutsPageProps {
  tontineId: string;
  isAdmin: boolean;
  onNavigate: (page: string) => void;
}

interface PeriodContribution {
  periodDate: string;
  label: string;
  memberTotals: Record<string, number>;
  total: number;
  isPaidOut: boolean;
}

export default function PayoutsPage({ tontineId, isAdmin, onNavigate }: PayoutsPageProps) {
  const { profile, session } = useAuth();
  const [schedule, setSchedule] = useState<(EatingSchedule & { profile?: Profile })[]>([]);
  const [members, setMembers] = useState<(TontineMember & { profile: Profile })[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [tontine, setTontine] = useState<Tontine | null>(null);
  const [withdrawals, setWithdrawals] = useState<CashWithdrawal[]>([]);
  const [loans, setLoans] = useState<(Loan & { profile?: Profile; loan_sources?: LoanSource[] })[]>([]);
  const [repayments, setRepayments] = useState<LoanRepayment[]>([]);
  const [interestDistributions, setInterestDistributions] = useState<InterestDistribution[]>([]);
  const [fineApplications, setFineApplications] = useState<FineApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [expandedPeriods, setExpandedPeriods] = useState<Set<string>>(new Set());

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
      if (data.schedule) setSchedule(data.schedule);
      if (data.members) setMembers(data.members);
      if (data.categories) setCategories(data.categories);
      if (data.contributions) setContributions(data.contributions);
      if (data.tontine) setTontine(data.tontine);
      if (data.withdrawals) setWithdrawals(data.withdrawals);
      if (data.loans) setLoans(data.loans);
      if (data.interestDistributions) setInterestDistributions(data.interestDistributions);
    } catch {
      // silent
    }

    const [payoutRes, repayRes, fineRes] = await Promise.all([
      supabase.from('payouts').select('*').eq('tontine_id', tontineId),
      supabase.from('loan_repayments').select('*'),
      supabase.from('fine_applications').select('*').eq('tontine_id', tontineId),
    ]);
    if (payoutRes.data) setPayouts(payoutRes.data);
    if (repayRes.data) setRepayments(repayRes.data);
    if (fineRes.data) setFineApplications(fineRes.data);

    setLoading(false);
  }, [tontineId, session]);

  useEffect(() => { loadData(); }, [loadData]);

  const contributionCategoryIds = useMemo(
    () => categories.filter((c) => c.is_contribution || c.can_withdraw_anytime).map((c) => c.id),
    [categories]
  );

  const expectedPerMember = useMemo(
    () => categories
      .filter((c) => c.is_contribution || c.can_withdraw_anytime)
      .reduce((sum, c) => sum + Number(c.amount), 0),
    [categories]
  );

  const periodContributions = useMemo((): PeriodContribution[] => {
    if (contributionCategoryIds.length === 0 || !tontine) return [];

    const allPeriodDates = generateScheduleDates(
      tontine.start_date,
      tontine.end_date,
      tontine.periodicity_type,
      tontine.periodicity_detail
    );

    const paidPeriodDates = new Set(payouts.map((p) => (p as any).period_date).filter(Boolean));

    return allPeriodDates.map((pd) => {
      const memberTotals: Record<string, number> = {};
      members.forEach((m) => { memberTotals[m.id] = 0; });

      contributions
        .filter((c) => contributionCategoryIds.includes(c.category_id) && c.period_date === pd)
        .forEach((c) => {
          memberTotals[c.member_id] = (memberTotals[c.member_id] || 0) + Number(c.amount);
        });

      const total = Object.values(memberTotals).reduce((sum, v) => sum + v, 0);

      return {
        periodDate: pd,
        label: `Cotisation du ${formatDate(pd)}`,
        memberTotals,
        total,
        isPaidOut: paidPeriodDates.has(pd),
      };
    });
  }, [contributions, contributionCategoryIds, members, tontine, payouts]);

  useEffect(() => {
    if (periodContributions.length > 0 && expandedPeriods.size === 0) {
      const firstUnpaid = periodContributions.find((p) => !p.isPaidOut);
      if (firstUnpaid) setExpandedPeriods(new Set([firstUnpaid.periodDate]));
    }
  }, [periodContributions, expandedPeriods.size]);

  const togglePeriod = (periodDate: string) => {
    setExpandedPeriods((prev) => {
      const next = new Set(prev);
      if (next.has(periodDate)) next.delete(periodDate);
      else next.add(periodDate);
      return next;
    });
  };

  const handlePayout = async (periodDate: string) => {
    if (!profile || !tontine || contributionCategoryIds.length === 0) return;

    const period = periodContributions.find((p) => p.periodDate === periodDate);
    if (!period || period.total <= 0) return;

    const nextPending = schedule.find((s) => s.status === 'pending');
    if (!nextPending) return;

    setProcessingId(periodDate);

    const { error: payoutErr } = await supabase.from('payouts').insert({
      tontine_id: tontineId,
      eating_schedule_id: nextPending.id,
      recipient_member_id: nextPending.member_id,
      total_amount: period.total,
      period_date: periodDate,
      recorded_by: profile.id,
    });

    if (!payoutErr) {
      await supabase.from('eating_schedule').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      }).eq('id', nextPending.id);
    }

    setProcessingId(null);
    loadData();
  };

  const handleGenerateRecap = (periodDate: string) => {
    if (!tontine) return;
    const period = periodContributions.find((p) => p.periodDate === periodDate);
    if (!period) return;

    let recipientProfile: Profile | undefined;
    const payout = payouts.find((p) => (p as any).period_date === periodDate);
    if (payout) {
      const recipientMember = members.find((m) => m.id === payout.recipient_member_id);
      recipientProfile = recipientMember?.profile;
    } else {
      const nextPending = schedule.find((s) => s.status === 'pending');
      recipientProfile = (nextPending as any)?.profile as Profile | undefined;
    }

    generateRecapPDF({
      tontine,
      members,
      categories,
      contributions,
      withdrawals,
      loans,
      repayments,
      payouts,
      interestDistributions,
      fineApplications,
      periodDate,
      payoutAmount: period.total,
      recipientProfile,
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const nextPending = schedule.find((s) => s.status === 'pending');
  const allCompleted = schedule.length > 0 && schedule.every((s) => s.status === 'completed');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Versements & Tours</h1>
        <p className="text-slate-500 mt-1">
          {tontine ? getPeriodicityLabel(tontine.periodicity_type, tontine.periodicity_detail) : ''}
        </p>
      </div>

      {/* Transfer option when all tours completed */}
      {allCompleted && isAdmin && (
        <div className="bg-gradient-to-r from-blue-500 to-indigo-600 rounded-2xl p-6 text-white shadow-lg">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="text-blue-100 text-sm font-medium">Tous les tours ont ete verses!</p>
              <p className="text-xl font-bold mt-1">La tontine est terminee</p>
              <p className="text-blue-100 text-sm mt-2">Transferez les fonds vers une nouvelle tontine</p>
            </div>
            <button
              onClick={() => onNavigate('transfer-tontine')}
              className="px-6 py-3 bg-white text-blue-600 hover:bg-blue-50 font-medium rounded-xl transition-all shadow-md flex items-center gap-2"
            >
              <ArrowRightLeft className="w-5 h-5" />
              Transferer vers une nouvelle tontine
            </button>
          </div>
        </div>
      )}

      {/* Next tour highlight */}
      {nextPending && (
        <div className="bg-gradient-to-r from-emerald-500 to-teal-600 rounded-2xl p-6 text-white shadow-lg">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="text-emerald-100 text-sm font-medium">Prochain tour</p>
              <p className="text-xl font-bold mt-1">
                Tour #{nextPending.order_number} - {(nextPending as any).profile?.first_name} {(nextPending as any).profile?.last_name}
              </p>
              <p className="text-emerald-100 text-sm mt-2">
                Montant par tour: {formatCurrency(expectedPerMember)} x {members.length} membres = {formatCurrency(expectedPerMember * members.length)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Period-based contribution caisse */}
      {contributionCategoryIds.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Wallet className="w-5 h-5 text-amber-600" />
            Caisse cotisation par date
          </h2>

          {periodContributions.length === 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
              Aucune cotisation enregistree
            </div>
          )}

          {periodContributions.map((period) => {
            const isExpanded = expandedPeriods.has(period.periodDate);
            const allMembersPaid = members.every((m) =>
              (period.memberTotals[m.id] || 0) >= expectedPerMember
            );
            const canPayout = allMembersPaid && period.total > 0 && !period.isPaidOut && nextPending;

            return (
              <div key={period.periodDate} className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all ${
                period.isPaidOut ? 'border-emerald-200 opacity-70' : 'border-slate-200'
              }`}>
                {/* Period header */}
                <button
                  onClick={() => togglePeriod(period.periodDate)}
                  className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-25 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      period.isPaidOut ? 'bg-emerald-100' : 'bg-amber-100'
                    }`}>
                      <Calendar className={`w-5 h-5 ${period.isPaidOut ? 'text-emerald-600' : 'text-amber-600'}`} />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-semibold text-slate-900">{period.label}</p>
                      <p className="text-xs text-slate-500">
                        {members.filter((m) => (period.memberTotals[m.id] || 0) >= expectedPerMember).length}/{members.length} membres ont paye
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {period.isPaidOut ? (
                      <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">Verse</span>
                    ) : allMembersPaid ? (
                      <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">Pret a verser</span>
                    ) : null}
                    <span className="text-lg font-bold text-slate-900 font-mono">{formatCurrency(period.total)}</span>
                    {isExpanded ? (
                      <ChevronDown className="w-5 h-5 text-slate-400" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                </button>

                {/* Expanded: member details + payout button */}
                {isExpanded && (
                  <div className="border-t border-slate-100 px-5 py-4 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {members.map((m) => {
                        const total = period.memberTotals[m.id] || 0;
                        const expected = expectedPerMember;
                        const isPaid = total >= expected;
                        return (
                          <div key={m.id} className={`p-3 rounded-xl border ${
                            isPaid ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'
                          }`}>
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-slate-800">
                                {m.profile.first_name} {m.profile.last_name}
                              </span>
                              {isPaid && <CheckCircle className="w-4 h-4 text-emerald-500" />}
                            </div>
                            <p className="text-sm font-mono text-slate-600 mt-1">
                              {formatCurrency(total)} / {formatCurrency(expected)}
                            </p>
                          </div>
                        );
                      })}
                    </div>

                    {/* Payout action */}
                    {!period.isPaidOut && (
                      <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                        <div>
                          {nextPending ? (
                            <p className="text-sm text-slate-600">
                              Verser a <strong>{(nextPending as any).profile?.first_name} {(nextPending as any).profile?.last_name}</strong> (Tour #{nextPending.order_number})
                            </p>
                          ) : (
                            <p className="text-sm text-slate-500">Tous les tours ont ete verses</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleGenerateRecap(period.periodDate)}
                            className="px-4 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm font-medium rounded-xl transition-all flex items-center gap-2"
                          >
                            <FileText className="w-4 h-4" />
                            Recapitulatif PDF
                          </button>
                          {canPayout && isAdmin && (
                            <button
                              onClick={() => handlePayout(period.periodDate)}
                              disabled={processingId === period.periodDate}
                              className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-xl transition-all flex items-center gap-2 disabled:opacity-50 shadow-sm"
                            >
                              <ArrowUpCircle className="w-4 h-4" />
                              {processingId === period.periodDate ? 'Versement...' : 'Verser'}
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {period.isPaidOut && (
                      <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                        <div className="flex items-center gap-2 text-sm text-emerald-600">
                          <CheckCircle className="w-4 h-4" />
                          Versement effectue - {formatCurrency(period.total)}
                        </div>
                        <button
                          onClick={() => handleGenerateRecap(period.periodDate)}
                          className="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm font-medium rounded-xl transition-all flex items-center gap-2"
                        >
                          <FileText className="w-4 h-4" />
                          Recapitulatif PDF
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Full schedule */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-900">Calendrier complet des tours</h3>
        </div>
        <div className="divide-y divide-slate-50">
          {schedule.map((s) => {
            const schedProfile = (s as any).profile as Profile | undefined;
            return (
              <div key={s.id} className="px-5 py-4 flex items-center justify-between hover:bg-slate-25 transition-colors">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${
                    s.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {s.order_number}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {schedProfile ? `${schedProfile.first_name} ${schedProfile.last_name}` : 'Membre'}
                    </p>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                      <Calendar className="w-3 h-3" />
                      {formatDate(s.scheduled_date)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-mono text-slate-600">
                    {formatCurrency(expectedPerMember * members.length)}
                  </span>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                    s.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {s.status === 'completed' ? 'Verse' : 'En attente'}
                  </span>
                </div>
              </div>
            );
          })}
          {schedule.length === 0 && (
            <div className="px-5 py-8 text-center text-slate-400 text-sm">Aucun tour programme</div>
          )}
        </div>
      </div>
    </div>
  );
}
