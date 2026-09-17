import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { formatCurrency, formatDate } from '../lib/utils';
import type { Loan, Category, TontineMember, Profile, Contribution, LoanSource, LoanRepayment, CashWithdrawal, InterestDistribution } from '../types/database';
import { ArrowRightLeft, Plus, Check, AlertCircle, Wallet, Info } from 'lucide-react';

const EF_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tontine-data`;

interface LoansPageProps {
  tontineId: string;
  isAdmin: boolean;
}

// Calculate total interest for a loan
function calcTotalInterest(principal: number, ratePercent: number, durationMonths: number, period: 'monthly' | '3months'): number {
  if (ratePercent <= 0) return 0;
  const rate = ratePercent / 100;
  const periods = period === 'monthly' ? durationMonths : Math.ceil(durationMonths / 3);
  return Math.round(principal * rate * periods);
}

export default function LoansPage({ tontineId, isAdmin }: LoansPageProps) {
  const { profile, session } = useAuth();
  const [loans, setLoans] = useState<(Loan & { profile?: Profile; loan_sources?: LoanSource[] })[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<(TontineMember & { profile: Profile })[]>([]);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [repayments, setRepayments] = useState<LoanRepayment[]>([]);
  const [withdrawals, setWithdrawals] = useState<CashWithdrawal[]>([]);
  const [interestDistributions, setInterestDistributions] = useState<InterestDistribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showRepay, setShowRepay] = useState<string | null>(null);

  const [selectedMember, setSelectedMember] = useState('');
  const [loanAmount, setLoanAmount] = useState(0);
  const [loanDuration, setLoanDuration] = useState(1);
  const [loanInterestRate, setLoanInterestRate] = useState(0);
  const [loanInterestPeriod, setLoanInterestPeriod] = useState<'monthly' | '3months'>('monthly');
  // Repayment: single amount input (auto-split principal/interest)
  const [repayTotal, setRepayTotal] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

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
      if (data.loans) setLoans(data.loans);
      if (data.categories) setCategories(data.categories);
      if (data.members) setMembers(data.members);
      if (data.contributions) setContributions(data.contributions);
      if (data.withdrawals) setWithdrawals(data.withdrawals);
      if (data.interestDistributions) setInterestDistributions(data.interestDistributions);
    } catch {
      // silent
    }
    const { data: repayData } = await supabase.from('loan_repayments').select('*');
    if (repayData) setRepayments(repayData);
    setLoading(false);
  }, [tontineId, session]);

  useEffect(() => { loadData(); }, [loadData]);

  const loanCategories = useMemo(() => {
    return categories
      .filter((c) => c.is_in_cash_box && c.loan_order !== null)
      .sort((a, b) => (a.loan_order || 0) - (b.loan_order || 0));
  }, [categories]);

  const repaymentCategories = useMemo(() => [...loanCategories].reverse(), [loanCategories]);

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

  const totalAvailableForLoans = useMemo(() => {
    return loanCategories.reduce((sum, cat) => sum + getCategoryAvailable(cat.id), 0);
  }, [loanCategories, getCategoryAvailable]);

  const allocateLoanSources = useCallback((amount: number) => {
    const sources: { categoryId: string; amount: number }[] = [];
    let remaining = amount;
    for (const cat of loanCategories) {
      if (remaining <= 0) break;
      const available = getCategoryAvailable(cat.id);
      if (available > 0) {
        const take = Math.min(remaining, available);
        sources.push({ categoryId: cat.id, amount: take });
        remaining -= take;
      }
    }
    return sources;
  }, [loanCategories, getCategoryAvailable]);

  // Get loan totals from repayments
  const getLoanRepaymentTotals = useCallback((loanId: string) => {
    const loanRepays = repayments.filter((r) => r.loan_id === loanId);
    const totalPrincipalPaid = loanRepays.reduce((sum, r) => sum + Number(r.amount), 0);
    const totalInterestPaid = loanRepays.reduce((sum, r) => sum + Number(r.interest_amount), 0);
    return { totalPrincipalPaid, totalInterestPaid };
  }, [repayments]);

  // Member balance in a category (contributions + interest already redistributed into that category)
  const getMemberCategoryBalance = useCallback((memberId: string, catId: string) => {
    return contributions
      .filter((c) => c.member_id === memberId && c.category_id === catId)
      .reduce((sum, c) => sum + Number(c.amount), 0);
  }, [contributions]);

  // Distribute interest proportionally to members based on their balance in destCatId
  const distributeInterest = useCallback(async (loanId: string, interestAmount: number, destCatId: string) => {
    if (!profile || interestAmount <= 0) return;

    const memberBalances: Record<string, number> = {};
    let totalBalance = 0;
    members.forEach((m) => {
      const bal = getMemberCategoryBalance(m.id, destCatId);
      memberBalances[m.id] = bal;
      totalBalance += bal;
    });

    if (totalBalance <= 0) {
      // Equal distribution — largest-remainder ensures exact total
      const base = Math.floor(interestAmount / members.length);
      const extra = interestAmount - base * members.length;
      const equalShares = members.map((_, i) => base + (i < extra ? 1 : 0));
      const interestContribs = members.map((m, i) => ({
        tontine_id: tontineId,
        member_id: m.id,
        category_id: destCatId,
        amount: equalShares[i],
        period_date: new Date().toISOString().split('T')[0],
        recorded_by: profile.id,
      })).filter((c) => c.amount > 0);

      if (interestContribs.length > 0) {
        await supabase.from('contributions').insert(interestContribs);
      }
      await supabase.from('interest_distributions').insert({
        tontine_id: tontineId,
        loan_id: loanId,
        total_interest: interestAmount,
        per_member_amount: base,
        category_id: destCatId,
      });
      return;
    }

    // Largest-remainder method: guarantees shares sum exactly to interestAmount
    const rawShares = members.map((m) => ((memberBalances[m.id] || 0) / totalBalance) * interestAmount);
    const floorShares = rawShares.map((s) => Math.floor(s));
    const floorTotal = floorShares.reduce((a, b) => a + b, 0);
    const remainder = interestAmount - floorTotal;
    const sortedByRemainder = rawShares
      .map((s, i) => ({ i, r: s - floorShares[i] }))
      .sort((a, b) => b.r - a.r);
    for (let k = 0; k < remainder; k++) {
      floorShares[sortedByRemainder[k].i] += 1;
    }

    const interestContribs = members.map((m, idx) => ({
      tontine_id: tontineId,
      member_id: m.id,
      category_id: destCatId,
      amount: floorShares[idx],
      period_date: new Date().toISOString().split('T')[0],
      recorded_by: profile.id,
    })).filter((c) => c.amount > 0);

    if (interestContribs.length > 0) {
      await supabase.from('contributions').insert(interestContribs);
    }
    await supabase.from('interest_distributions').insert({
      tontine_id: tontineId,
      loan_id: loanId,
      total_interest: interestAmount,
      per_member_amount: totalBalance > 0 ? interestAmount / members.length : 0,
      category_id: destCatId,
    });
  }, [profile, members, getMemberCategoryBalance, tontineId]);

  const handleCreateLoan = async () => {
    if (!profile || !selectedMember || loanAmount <= 0) return;
    setError('');
    setSuccess('');

    if (loanAmount > totalAvailableForLoans) {
      setError(`Montant disponible insuffisant. Disponible: ${formatCurrency(totalAvailableForLoans)}`);
      return;
    }

    const sources = allocateLoanSources(loanAmount);
    if (sources.length === 0 || sources.reduce((s, src) => s + src.amount, 0) < loanAmount) {
      setError('Montant disponible insuffisant dans les categories de pret');
      return;
    }

    const totalInterest = calcTotalInterest(loanAmount, loanInterestRate, loanDuration, loanInterestPeriod);
    const dueDate = new Date();
    dueDate.setMonth(dueDate.getMonth() + loanDuration);

    const { data: loan, error: loanErr } = await supabase.from('loans').insert({
      tontine_id: tontineId,
      member_id: selectedMember,
      amount: loanAmount,
      interest_rate: loanInterestRate,
      interest_rate_period: loanInterestPeriod,
      duration_months: loanDuration,
      status: 'approved',
      approved_by: profile.id,
      approved_at: new Date().toISOString(),
      due_date: dueDate.toISOString().split('T')[0],
    }).select().single();

    if (loanErr || !loan) { setError(loanErr?.message || 'Erreur'); return; }

    await supabase.from('loan_sources').insert(sources.map((s) => ({
      loan_id: loan.id,
      category_id: s.categoryId,
      amount: s.amount,
    })));
    await supabase.from('loans').update({ status: 'active' }).eq('id', loan.id);

    setSuccess(`Pret approuve. Total a rembourser: ${formatCurrency(loanAmount + totalInterest)} (dont ${formatCurrency(totalInterest)} d'interets)`);
    setShowCreate(false);
    setSelectedMember('');
    setLoanAmount(0);
    setLoanDuration(1);
    setLoanInterestRate(0);
    loadData();
  };

  const handleRepay = async (loanId: string) => {
    if (!profile || repayTotal <= 0) return;
    setError('');

    const loan = loans.find((l) => l.id === loanId);
    if (!loan) return;

    const totalInterestForLoan = calcTotalInterest(
      Number(loan.amount),
      Number(loan.interest_rate),
      Number(loan.duration_months),
      loan.interest_rate_period,
    );
    const { totalPrincipalPaid, totalInterestPaid } = getLoanRepaymentTotals(loanId);

    const principalRemaining = Math.max(0, Number(loan.amount) - totalPrincipalPaid);
    const interestRemaining = Math.max(0, totalInterestForLoan - totalInterestPaid);
    const totalRemaining = principalRemaining + interestRemaining;

    // Cap repayment at remaining total
    const paymentAmount = Math.min(repayTotal, totalRemaining);

    // Split payment: first cover principal, then interest
    const principalPayment = Math.min(paymentAmount, principalRemaining);
    const interestPayment = paymentAmount - principalPayment;

    const { error: repayErr } = await supabase.from('loan_repayments').insert({
      loan_id: loanId,
      amount: principalPayment,
      interest_amount: interestPayment,
      recorded_by: profile.id,
    });

    if (repayErr) { setError(repayErr.message); return; }

    // Distribute interest to members proportionally
    if (interestPayment > 0) {
      // The destination category for interest is set on the contribution category of this tontine
      const destCatId = categories.find((c) => c.is_contribution)?.interest_destination_category_id;
      if (destCatId) {
        await distributeInterest(loanId, interestPayment, destCatId);
      }
    }

    // Mark loan as repaid if fully paid
    const newPrincipalPaid = totalPrincipalPaid + principalPayment;
    const newInterestPaid = totalInterestPaid + interestPayment;
    if (newPrincipalPaid >= Number(loan.amount) && newInterestPaid >= totalInterestForLoan) {
      await supabase.from('loans').update({ status: 'repaid' }).eq('id', loanId);
    }

    setShowRepay(null);
    setRepayTotal(0);
    loadData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Preview for create form
  const previewInterest = calcTotalInterest(loanAmount, loanInterestRate, loanDuration, loanInterestPeriod);
  const previewTotal = loanAmount + previewInterest;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Prets</h1>
          <p className="text-slate-500 mt-1">Gestion des prets et interets</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-xl transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Nouveau pret
          </button>
        )}
      </div>

      {/* Available funds */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
          <Wallet className="w-5 h-5 text-emerald-600" />
          Fonds disponibles par categorie
        </h3>
        <div className="space-y-2">
          {loanCategories.length === 0 && (
            <p className="text-sm text-slate-500">Aucune categorie eligible pour les prets.</p>
          )}
          {loanCategories.map((cat) => {
            const available = getCategoryAvailable(cat.id);
            return (
              <div key={cat.id} className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 bg-emerald-100 text-emerald-700 rounded-lg flex items-center justify-center text-xs font-bold">{cat.loan_order}</span>
                  <span className="text-sm text-slate-700">{cat.name}</span>
                </div>
                <span className={`text-sm font-mono font-semibold ${available > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
                  {formatCurrency(available)}
                </span>
              </div>
            );
          })}
          {loanCategories.length > 0 && (
            <div className="pt-2 border-t border-slate-100 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">Total disponible</span>
                <span className="text-lg font-bold text-emerald-700 font-mono">{formatCurrency(totalAvailableForLoans)}</span>
              </div>
              <p className="text-xs text-slate-400">Prelevement: {loanCategories.map((c) => c.name).join(' => ')} | Remboursement: {repaymentCategories.map((c) => c.name).join(' => ')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Create loan form */}
      {showCreate && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
          <h3 className="font-semibold text-slate-900">Creer un pret</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Membre</label>
              <select value={selectedMember} onChange={(e) => setSelectedMember(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50">
                <option value="">Selectionner</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.profile.first_name} {m.profile.last_name} (@{m.profile.username})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Montant du pret</label>
              <input type="number" value={loanAmount || ''} onChange={(e) => setLoanAmount(Number(e.target.value))}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                placeholder="Ex: 10000" min={0} max={totalAvailableForLoans} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Duree (mois)</label>
              <input type="number" value={loanDuration} onChange={(e) => setLoanDuration(Math.max(1, Number(e.target.value)))}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50" min={1} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Taux d'interet (%)</label>
              <input type="number" value={loanInterestRate || ''} onChange={(e) => setLoanInterestRate(Number(e.target.value))}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                placeholder="Ex: 10" min={0} step={0.5} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Periode du taux</label>
              <select value={loanInterestPeriod} onChange={(e) => setLoanInterestPeriod(e.target.value as 'monthly' | '3months')}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50">
                <option value="monthly">Par mois</option>
                <option value="3months">Par 3 mois</option>
              </select>
            </div>
          </div>

          {/* Interest preview */}
          {loanAmount > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2 text-blue-800 text-sm font-medium">
                <Info className="w-4 h-4" />
                Recapitulatif du pret
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="bg-white rounded-lg p-3 border border-blue-100">
                  <p className="text-xs text-slate-500 mb-1">Capital</p>
                  <p className="font-bold text-slate-900 font-mono">{formatCurrency(loanAmount)}</p>
                </div>
                <div className="bg-white rounded-lg p-3 border border-blue-100">
                  <p className="text-xs text-slate-500 mb-1">Interets ({loanInterestRate}% x {loanInterestPeriod === 'monthly' ? loanDuration + ' mois' : Math.ceil(loanDuration / 3) + ' trim.'})</p>
                  <p className="font-bold text-amber-700 font-mono">{formatCurrency(previewInterest)}</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200">
                  <p className="text-xs text-slate-500 mb-1">Total a rembourser</p>
                  <p className="font-bold text-emerald-800 font-mono text-base">{formatCurrency(previewTotal)}</p>
                </div>
              </div>
              {/* Allocation */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-blue-700">Allocation:</p>
                {allocateLoanSources(loanAmount).map((s) => {
                  const cat = categories.find((c) => c.id === s.categoryId);
                  return (
                    <div key={s.categoryId} className="flex justify-between text-xs text-slate-600">
                      <span>{cat?.name}</span>
                      <span className="font-mono">{formatCurrency(s.amount)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600 flex items-center gap-1"><AlertCircle className="w-4 h-4" />{error}</p>}
          {success && <p className="text-sm text-emerald-600 flex items-center gap-1"><Check className="w-4 h-4" />{success}</p>}
          <div className="flex justify-end gap-3">
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-xl">Annuler</button>
            <button
              onClick={handleCreateLoan}
              disabled={!selectedMember || loanAmount <= 0 || loanAmount > totalAvailableForLoans}
              className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all"
            >
              Approuver le pret
            </button>
          </div>
        </div>
      )}

      {/* Loans list */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-900">Liste des prets</h3>
        </div>
        <div className="divide-y divide-slate-50">
          {loans.length === 0 && (
            <div className="px-5 py-8 text-center text-slate-400 text-sm">Aucun pret</div>
          )}
          {loans.map((l) => {
            const { totalPrincipalPaid, totalInterestPaid } = getLoanRepaymentTotals(l.id);
            const totalInterestForLoan = calcTotalInterest(
              Number(l.amount),
              Number(l.interest_rate),
              Number(l.duration_months),
              l.interest_rate_period,
            );
            const totalToRepay = Number(l.amount) + totalInterestForLoan;
            const totalPaid = totalPrincipalPaid + totalInterestPaid;
            const totalRemaining = Math.max(0, totalToRepay - totalPaid);
            const progress = totalToRepay > 0 ? (totalPaid / totalToRepay) * 100 : 0;

            // Compute what this repayTotal would split into
            const interestRemaining = Math.max(0, totalInterestForLoan - totalInterestPaid);
            const previewRepayPrincipal = showRepay === l.id ? Math.min(repayTotal, principalRemaining) : 0;
            const previewRepayInterest = showRepay === l.id ? Math.max(0, repayTotal - previewRepayPrincipal) : 0;

            return (
              <div key={l.id} className="px-5 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      l.status === 'active' ? 'bg-blue-100' : l.status === 'repaid' ? 'bg-emerald-100' : 'bg-slate-100'
                    }`}>
                      <ArrowRightLeft className={`w-5 h-5 ${
                        l.status === 'active' ? 'text-blue-600' : l.status === 'repaid' ? 'text-emerald-600' : 'text-slate-600'
                      }`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        {l.profile?.first_name} {l.profile?.last_name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatDate(l.created_at)} | {l.duration_months} mois | {l.interest_rate}% {l.interest_rate_period === 'monthly' ? '/mois' : '/3 mois'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-900 font-mono">{formatCurrency(Number(l.amount))}</p>
                    {totalInterestForLoan > 0 && (
                      <p className="text-xs text-amber-600 font-mono">+{formatCurrency(totalInterestForLoan)} int.</p>
                    )}
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                      l.status === 'active' ? 'bg-blue-100 text-blue-700' :
                      l.status === 'repaid' ? 'bg-emerald-100 text-emerald-700' :
                      'bg-slate-100 text-slate-600'
                    }`}>
                      {l.status === 'active' ? 'En cours' : l.status === 'repaid' ? 'Rembourse' : l.status}
                    </span>
                  </div>
                </div>

                {l.status === 'active' && (
                  <div className="mt-3 space-y-2">
                    {/* Total to repay summary */}
                    <div className="flex items-center gap-4 text-xs bg-slate-50 rounded-lg px-3 py-2">
                      <span className="text-slate-500">Total a rembourser: <span className="font-semibold text-slate-800 font-mono">{formatCurrency(totalToRepay)}</span></span>
                      <span className="text-slate-500">Deja paye: <span className="font-semibold text-emerald-700 font-mono">{formatCurrency(totalPaid)}</span></span>
                      <span className="text-slate-500">Restant: <span className="font-semibold text-red-600 font-mono">{formatCurrency(totalRemaining)}</span></span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div className="bg-emerald-500 h-2 rounded-full transition-all" style={{ width: `${Math.min(progress, 100)}%` }} />
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <span>Capital: {formatCurrency(totalPrincipalPaid)}/{formatCurrency(Number(l.amount))}</span>
                      <span>Interets: {formatCurrency(totalInterestPaid)}/{formatCurrency(totalInterestForLoan)}</span>
                    </div>

                    {isAdmin && (
                      <div>
                        {showRepay === l.id ? (
                          <div className="space-y-2 mt-1">
                            <div className="flex items-center gap-2">
                              <div className="flex-1">
                                <label className="text-xs text-slate-500 mb-1 block">Montant verse (max: {formatCurrency(totalRemaining)})</label>
                                <input
                                  type="number"
                                  value={repayTotal || ''}
                                  onChange={(e) => setRepayTotal(Math.min(Number(e.target.value), totalRemaining))}
                                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                  placeholder="Montant verse"
                                  min={0}
                                  max={totalRemaining}
                                />
                              </div>
                              <button onClick={() => handleRepay(l.id)} disabled={repayTotal <= 0}
                                className="mt-5 px-3 py-1.5 bg-emerald-500 text-white text-xs font-medium rounded-lg disabled:opacity-50">Valider</button>
                              <button onClick={() => { setShowRepay(null); setRepayTotal(0); }}
                                className="mt-5 px-3 py-1.5 text-slate-500 text-xs hover:bg-slate-50 rounded-lg">Annuler</button>
                            </div>
                            {repayTotal > 0 && (
                              <div className="bg-blue-50 rounded-lg p-2 text-xs space-y-1">
                                <p className="font-medium text-blue-700">Repartition automatique:</p>
                                <div className="flex justify-between text-slate-600">
                                  <span>Interets</span>
                                  <span className="font-mono text-amber-700">{formatCurrency(previewRepayInterest)}</span>
                                </div>
                                <div className="flex justify-between text-slate-600">
                                  <span>Capital</span>
                                  <span className="font-mono">{formatCurrency(previewRepayPrincipal)}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <button onClick={() => { setShowRepay(l.id); setRepayTotal(0); }}
                            className="text-xs text-emerald-600 hover:text-emerald-700 font-medium mt-1">
                            Enregistrer un remboursement
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {l.loan_sources && l.loan_sources.length > 0 && (
                  <div className="mt-2 text-xs text-slate-400">
                    Sources: {l.loan_sources.map((s) => {
                      const cat = categories.find((c) => c.id === s.category_id);
                      return `${cat?.name || '?'}: ${formatCurrency(Number(s.amount))}`;
                    }).join(', ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
