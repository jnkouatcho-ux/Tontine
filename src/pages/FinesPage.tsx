import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { formatCurrency, formatDate } from '../lib/utils';
import type { TontineMember, Profile, Category, FineType, FineApplication, Contribution, CashWithdrawal } from '../types/database';
import { Scale, Plus, Check, AlertCircle, Clock, CheckCircle, ChevronDown, ChevronRight, Wallet, Banknote } from 'lucide-react';

const EF_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tontine-data`;

interface FinesPageProps {
  tontineId: string;
  isAdmin: boolean;
}

export default function FinesPage({ tontineId, isAdmin }: FinesPageProps) {
  const { profile, session } = useAuth();
  const [fineTypes, setFineTypes] = useState<FineType[]>([]);
  const [applications, setApplications] = useState<FineApplication[]>([]);
  const [members, setMembers] = useState<(TontineMember & { profile: Profile })[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [withdrawals, setWithdrawals] = useState<CashWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showApply, setShowApply] = useState(false);
  const [applyMember, setApplyMember] = useState('');
  const [applyFineType, setApplyFineType] = useState('');
  const [applyAmount, setApplyAmount] = useState(0);
  const [applyReason, setApplyReason] = useState('');
  const [applyPaymentMethod, setApplyPaymentMethod] = useState<'cash' | 'account'>('cash');
  const [applySourceCategory, setApplySourceCategory] = useState('');
  const [applyDestCategory, setApplyDestCategory] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

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
      if (data.categories) setCategories(data.categories);
      if (data.contributions) setContributions(data.contributions);
      if (data.withdrawals) setWithdrawals(data.withdrawals);
    } catch {
      // silent
    }

    const [ftRes, faRes] = await Promise.all([
      supabase.from('fine_types').select('*').eq('tontine_id', tontineId).order('created_at'),
      supabase.from('fine_applications').select('*').eq('tontine_id', tontineId).order('applied_at', { ascending: false }),
    ]);
    if (ftRes.data) setFineTypes(ftRes.data);
    if (faRes.data) setApplications(faRes.data);

    setLoading(false);
  }, [tontineId, session]);

  useEffect(() => { loadData(); }, [loadData]);

  const selectedFineType = fineTypes.find((f) => f.id === applyFineType);

  useEffect(() => {
    if (selectedFineType) {
      setApplyAmount(selectedFineType.amount);
      setApplyPaymentMethod(selectedFineType.deduction_type);
      setApplySourceCategory(selectedFineType.source_category_id || '');
      setApplyDestCategory(selectedFineType.destination_category_id || '');
    }
  }, [selectedFineType]);

  // Calculate member balance per category (contributions - withdrawals)
  const memberCategoryBalance = useMemo(() => {
    const balances: Record<string, Record<string, number>> = {};
    members.forEach((m) => {
      balances[m.id] = {};
      categories.forEach((c) => {
        const contribTotal = contributions
          .filter((cn) => cn.member_id === m.id && cn.category_id === c.id)
          .reduce((sum, cn) => sum + Number(cn.amount), 0);
        const withdrawTotal = withdrawals
          .filter((w) => w.member_id === m.id && w.category_id === c.id)
          .reduce((sum, w) => sum + Number(w.amount), 0);
        balances[m.id][c.id] = contribTotal - withdrawTotal;
      });
    });
    return balances;
  }, [members, categories, contributions, withdrawals]);

  const handleApply = async () => {
    if (!profile || !applyMember || !applyFineType || applyAmount <= 0) return;
    if (applyPaymentMethod === 'account' && !applySourceCategory) {
      setError('Veuillez sélectionner le compte à débiter');
      return;
    }
    if (applyPaymentMethod === 'cash' && !applyDestCategory) {
      setError('Veuillez sélectionner le compte où reverser l\'amende');
      return;
    }
    setError('');
    setSuccess('');

    const { error: err } = await supabase.from('fine_applications').insert({
      tontine_id: tontineId,
      fine_type_id: applyFineType,
      member_id: applyMember,
      amount: applyAmount,
      reason: applyReason.trim() || null,
      payment_method: applyPaymentMethod,
      source_category_id: applyPaymentMethod === 'account' ? applySourceCategory : null,
      destination_category_id: applyPaymentMethod === 'cash' ? applyDestCategory : null,
      recorded_by: profile.id,
      status: 'pending',
    });

    if (err) { setError(err.message); return; }

    setSuccess('Amende appliquée avec succès');
    setShowApply(false);
    setApplyMember('');
    setApplyFineType('');
    setApplyAmount(0);
    setApplyReason('');
    setApplyPaymentMethod('cash');
    setApplySourceCategory('');
    setApplyDestCategory('');
    loadData();
  };

  const handleMarkPaid = async (appId: string) => {
    if (!profile) return;
    setProcessingId(appId);
    setError('');

    const app = applications.find((a) => a.id === appId);
    if (!app) { setProcessingId(null); return; }

    const fineType = fineTypes.find((f) => f.id === app.fine_type_id);

    // Mark as paid
    const { error: payErr } = await supabase
      .from('fine_applications')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', appId);

    if (payErr) { setError(payErr.message); setProcessingId(null); return; }

    // Use the application's payment_method and source_category_id (not the fine type's defaults)
    const paymentMethod = app.payment_method;
    const sourceCategoryId = app.source_category_id;
    const fineAmount = Number(app.amount);

    if (paymentMethod === 'account' && sourceCategoryId) {
      const memberBalance = memberCategoryBalance[app.member_id]?.[sourceCategoryId] || 0;

      if (memberBalance >= fineAmount) {
        // Full amount from account
        await supabase.from('cash_withdrawals').insert({
          tontine_id: tontineId,
          category_id: sourceCategoryId,
          member_id: app.member_id,
          amount: fineAmount,
          reason: `Amende: ${fineType?.name || ''}${app.reason ? ' - ' + app.reason : ''}`,
          recorded_by: profile.id,
        });
      } else if (memberBalance > 0) {
        // Partial from account, rest in cash
        await supabase.from('cash_withdrawals').insert({
          tontine_id: tontineId,
          category_id: sourceCategoryId,
          member_id: app.member_id,
          amount: memberBalance,
          reason: `Amende (débit partiel): ${fineType?.name || ''}${app.reason ? ' - ' + app.reason : ''}`,
          recorded_by: profile.id,
        });
      }
      // If no balance at all, the full amount is considered paid in cash (no withdrawal needed)
    }

    // Credit the fine amount into the destination category:
    // For cash payment: use the application's destination_category_id (mandatory)
    // For account deduction: use the fine type's destination_category_id (optional)
    const destCategoryId = paymentMethod === 'cash'
      ? (app.destination_category_id || fineType?.destination_category_id)
      : fineType?.destination_category_id;

    if (destCategoryId) {
      const n = members.length;
      if (n > 0) {
        const base = Math.floor(fineAmount / n);
        const extra = fineAmount - base * n;
        const today = new Date().toISOString().split('T')[0];
        const contribs = members.map((m, i) => ({
          tontine_id: tontineId,
          member_id: m.id,
          category_id: destCategoryId,
          amount: base + (i < extra ? 1 : 0),
          period_date: today,
          recorded_by: profile.id,
        })).filter((c) => c.amount > 0);
        if (contribs.length > 0) {
          await supabase.from('contributions').insert(contribs);
        }
      }
    }

    setProcessingId(null);
    loadData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const pendingApps = applications.filter((a) => a.status === 'pending');
  const paidApps = applications.filter((a) => a.status === 'paid');
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Amendes</h1>
          <p className="text-slate-500 mt-1">Gestion des amendes et pénalités</p>
        </div>
        {isAdmin && fineTypes.length > 0 && (
          <button
            onClick={() => { setShowApply(!showApply); setError(''); setSuccess(''); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-xl transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Appliquer une amende
          </button>
        )}
      </div>

      {/* Fine types summary */}
      {fineTypes.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
          <Scale className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">Aucun type d'amende configuré</p>
          <p className="text-sm text-slate-400 mt-1">Configurez les amendes lors de la création ou modification de la tontine.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-900">Types d'amendes configurés</h3>
          </div>
          <div className="divide-y divide-slate-50">
            {fineTypes.map((ft) => {
              const srcCat = categories.find((c) => c.id === ft.source_category_id);
              const dstCat = categories.find((c) => c.id === ft.destination_category_id);
              return (
                <div key={ft.id} className="px-5 py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center">
                      <Scale className="w-4 h-4 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-800">{ft.name}</p>
                      <p className="text-xs text-slate-500">
                        Par défaut: {ft.deduction_type === 'cash' ? 'Espèces' : `Compte — ${srcCat?.name || '?'}`}
                        {dstCat && <span className="ml-2 text-emerald-600">→ {dstCat.name}</span>}
                      </p>
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-slate-900 font-mono">{formatCurrency(ft.amount)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Apply fine form */}
      {showApply && isAdmin && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
          <h3 className="font-semibold text-slate-900">Appliquer une amende</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Membre</label>
              <select
                value={applyMember}
                onChange={(e) => setApplyMember(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              >
                <option value="">Sélectionner un membre</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.profile.first_name} {m.profile.last_name} (@{m.profile.username})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Type d'amende</label>
              <select
                value={applyFineType}
                onChange={(e) => setApplyFineType(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              >
                <option value="">Sélectionner</option>
                {fineTypes.map((ft) => (
                  <option key={ft.id} value={ft.id}>{ft.name} — {formatCurrency(ft.amount)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Montant</label>
              <input
                type="number"
                value={applyAmount || ''}
                onChange={(e) => setApplyAmount(Number(e.target.value))}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                min={0}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Motif (optionnel)</label>
              <input
                type="text"
                value={applyReason}
                onChange={(e) => setApplyReason(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                placeholder="Ex: Séance du 28 juin"
              />
            </div>
          </div>

          {/* Payment method selection */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-slate-700">Mode de paiement</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => { setApplyPaymentMethod('cash'); setApplySourceCategory(''); }}
                className={`flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all ${
                  applyPaymentMethod === 'cash'
                    ? 'border-emerald-500 bg-emerald-50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                  applyPaymentMethod === 'cash' ? 'bg-emerald-500' : 'bg-slate-100'
                }`}>
                  <Banknote className={`w-4 h-4 ${applyPaymentMethod === 'cash' ? 'text-white' : 'text-slate-500'}`} />
                </div>
                <div className="text-left">
                  <p className={`text-sm font-medium ${applyPaymentMethod === 'cash' ? 'text-emerald-800' : 'text-slate-700'}`}>En espèces</p>
                  <p className="text-xs text-slate-500">Paiement direct en cash</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setApplyPaymentMethod('account')}
                className={`flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all ${
                  applyPaymentMethod === 'account'
                    ? 'border-emerald-500 bg-emerald-50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                  applyPaymentMethod === 'account' ? 'bg-emerald-500' : 'bg-slate-100'
                }`}>
                  <Wallet className={`w-4 h-4 ${applyPaymentMethod === 'account' ? 'text-white' : 'text-slate-500'}`} />
                </div>
                <div className="text-left">
                  <p className={`text-sm font-medium ${applyPaymentMethod === 'account' ? 'text-emerald-800' : 'text-slate-700'}`}>Prélèvement compte</p>
                  <p className="text-xs text-slate-500">Débiter le compte épargne</p>
                </div>
              </button>
            </div>

            {applyPaymentMethod === 'account' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Compte à débiter</label>
                <select
                  value={applySourceCategory}
                  onChange={(e) => setApplySourceCategory(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                >
                  <option value="">Sélectionner le compte</option>
                  {categories.filter((c) => !c.is_contribution && !c.can_withdraw_anytime && c.is_in_cash_box).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {applyMember && applySourceCategory && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    Solde disponible: {formatCurrency(memberCategoryBalance[applyMember]?.[applySourceCategory] || 0)}
                  </p>
                )}
              </div>
            )}

            {applyPaymentMethod === 'cash' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Reverser dans le compte <span className="text-red-500">*</span>
                </label>
                <select
                  value={applyDestCategory}
                  onChange={(e) => setApplyDestCategory(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                >
                  <option value="">Sélectionner le compte de destination</option>
                  {categories.filter((c) => !c.is_contribution && !c.can_withdraw_anytime && c.is_in_cash_box).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-slate-400">
                  Le montant sera réparti en parts égales entre tous les membres dans ce compte.
                </p>
              </div>
            )}
          </div>

          {selectedFineType && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm">
              <p className="font-medium text-amber-800 mb-1">{selectedFineType.name}</p>
              <p className="text-amber-700 text-xs">
                Mode de paiement: {applyPaymentMethod === 'cash'
                  ? `Espèces → reversé dans « ${categories.find(c => c.id === applyDestCategory)?.name || '...'} »`
                  : `Débit du compte « ${categories.find(c => c.id === applySourceCategory)?.name || '...'} »`
                }
              </p>
              {applyPaymentMethod === 'cash' && applyDestCategory && (
                <p className="text-amber-700 text-xs mt-0.5">
                  Le montant sera réparti en parts égales entre les {members.length} membres.
                </p>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-600 flex items-center gap-1"><AlertCircle className="w-4 h-4" />{error}</p>}
          {success && <p className="text-sm text-emerald-600 flex items-center gap-1"><Check className="w-4 h-4" />{success}</p>}

          <div className="flex justify-end gap-3">
            <button onClick={() => setShowApply(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-xl">Annuler</button>
            <button
              onClick={handleApply}
              disabled={!applyMember || !applyFineType || applyAmount <= 0}
              className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all"
            >
              Appliquer
            </button>
          </div>
        </div>
      )}

      {/* Pending fines */}
      {pendingApps.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              En attente de paiement ({pendingApps.length})
            </h3>
          </div>
          <div className="divide-y divide-slate-50">
            {pendingApps.map((app) => {
              const ft = fineTypes.find((f) => f.id === app.fine_type_id);
              const member = members.find((m) => m.id === app.member_id);
              // Show balance info for account deduction fines
              const memberBalance = app.payment_method === 'account' && app.source_category_id
                ? (memberCategoryBalance[app.member_id]?.[app.source_category_id] || 0)
                : null;
              const fineAmount = Number(app.amount);
              const willBeCash = memberBalance !== null && memberBalance < fineAmount;
              const cashAmount = memberBalance !== null ? Math.max(0, fineAmount - memberBalance) : 0;

              return (
                <div key={app.id} className="px-5 py-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Scale className="w-4 h-4 text-amber-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {member?.profile.first_name} {member?.profile.last_name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {ft?.name}{app.reason ? ` — ${app.reason}` : ''} · {formatDate(app.applied_at)}
                      </p>
                      {app.payment_method === 'cash' && app.destination_category_id && (
                        <div className="flex items-center gap-1 mt-1">
                          <Banknote className="w-3 h-3 text-slate-400" />
                          <span className="text-xs text-slate-500">
                            Espèces → {categories.find(c => c.id === app.destination_category_id)?.name || '?'}
                          </span>
                        </div>
                      )}
                      {app.payment_method === 'account' && app.source_category_id && (
                        <div className="flex items-center gap-1 mt-1">
                          <Wallet className="w-3 h-3 text-slate-400" />
                          <span className={`text-xs ${memberBalance !== null && memberBalance >= app.amount ? 'text-emerald-600' : 'text-amber-600'}`}>
                            Solde compte ({categories.find(c => c.id === app.source_category_id)?.name || '?'}): {formatCurrency(memberBalance || 0)}
                            {willBeCash && (
                              <span className="text-red-500 ml-1">(dont {formatCurrency(cashAmount)} en espèces)</span>
                            )}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-sm font-semibold text-slate-900 font-mono">{formatCurrency(app.amount)}</span>
                    {isAdmin && (
                      <button
                        onClick={() => handleMarkPaid(app.id)}
                        disabled={processingId === app.id}
                        className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium rounded-lg transition-all disabled:opacity-50 flex items-center gap-1"
                      >
                        <Check className="w-3 h-3" />
                        {processingId === app.id ? '...' : 'Marquer payée'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Paid fines history */}
      {paidApps.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full px-5 py-4 border-b border-slate-100 flex items-center justify-between hover:bg-slate-25 transition-colors"
          >
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              Historique payées ({paidApps.length})
            </h3>
            {expanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
          </button>
          {expanded && (
            <div className="divide-y divide-slate-50">
              {paidApps.map((app) => {
                const ft = fineTypes.find((f) => f.id === app.fine_type_id);
                const member = members.find((m) => m.id === app.member_id);
                const srcCat = app.source_category_id ? categories.find((c) => c.id === app.source_category_id) : null;
                const destCatId = app.destination_category_id || ft?.destination_category_id;
                const destCat = destCatId ? categories.find((c) => c.id === destCatId) : null;
                return (
                  <div key={app.id} className="px-5 py-3.5 flex items-center justify-between gap-4 opacity-70">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <CheckCircle className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">
                          {member?.profile.first_name} {member?.profile.last_name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {ft?.name}{app.reason ? ` — ${app.reason}` : ''}
                          {' · '}
                          {app.payment_method === 'account' && srcCat
                            ? <span className="text-blue-600">Débit {srcCat.name}</span>
                            : <span className="text-slate-400">Espèces</span>
                          }
                          {destCat && <span className="ml-1 text-emerald-600">→ {destCat.name}</span>}
                          {' · '}{formatDate(app.applied_at)}
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-emerald-700 font-mono flex-shrink-0">{formatCurrency(app.amount)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {applications.length === 0 && fineTypes.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
          <Scale className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">Aucune amende appliquée pour le moment</p>
        </div>
      )}
    </div>
  );
}
