import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { formatCurrency, generateScheduleDates } from '../lib/utils';
import type { Tontine } from '../types/database';
import {
  Plus,
  Trash2,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Check,
  Save,
  GripVertical,
  Search,
  X,
} from 'lucide-react';

const EF_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tontine-data`;

interface MemberItem {
  userId: string;
  username: string;
  displayName: string;
}

interface UserSearchResult {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
}

interface CreateTontinePageProps {
  onCreated: (tontineId: string) => void;
  onNavigate: (page: string) => void;
}

type Step = 'basic' | 'periodicity' | 'eating-order' | 'categories' | 'loan-config' | 'fines' | 'review';

interface CategoryInput {
  name: string;
  amount_type: 'fixed' | 'minimum';
  amount: number;
  is_contribution: boolean;
  is_in_cash_box: boolean;
  can_withdraw_anytime: boolean;
  withdraw_at_end_only: boolean;
  loan_order: number | null;
  initial_amounts_per_member: Record<string, number>;
}

interface FineInput {
  name: string;
  amount: number;
  deduction_type: 'cash' | 'account';
  source_category_name: string;
  destination_category_name: string;
}

const STEPS: { id: Step; label: string }[] = [
  { id: 'basic', label: 'Informations' },
  { id: 'periodicity', label: 'Périodicité' },
  { id: 'eating-order', label: 'Membres & Tours' },
  { id: 'categories', label: 'Catégories' },
  { id: 'loan-config', label: 'Prêts' },
  { id: 'fines', label: 'Amendes' },
  { id: 'review', label: 'Récapitulatif' },
];

export default function CreateTontinePage({ onCreated, onNavigate }: CreateTontinePageProps) {
  const { profile, user, session } = useAuth();
  const [step, setStep] = useState<Step>('basic');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Basic info
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [previousTontineId, setPreviousTontineId] = useState<string | null>(null);
  const [previousTontines, setPreviousTontines] = useState<Tontine[]>([]);

  // Periodicity
  const [periodicityType, setPeriodicityType] = useState<'monthly' | 'weekly' | 'biweekly'>('monthly');
  const [weekNumber, setWeekNumber] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [dayOfWeek, setDayOfWeek] = useState(0);

  // Categories
  const [categories, setCategories] = useState<CategoryInput[]>([
    { name: 'Cotisation', amount_type: 'fixed', amount: 0, is_contribution: true, is_in_cash_box: false, can_withdraw_anytime: false, withdraw_at_end_only: false, loan_order: null, initial_amounts_per_member: {} },
  ]);
  const [showInitialPerMember, setShowInitialPerMember] = useState<Record<number, boolean>>({});
  const [prevTontineCategories, setPrevTontineCategories] = useState<{ id: string; name: string; available: number }[]>([]);
  const [contributionAmount, setContributionAmount] = useState(0);

  // Eating order - members with search
  const [members, setMembers] = useState<MemberItem[]>([
    { userId: profile?.id || '', username: profile?.username || '', displayName: `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || profile?.username || '' },
  ]);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [memberSearchResults, setMemberSearchResults] = useState<UserSearchResult[]>([]);
  const [memberSearching, setMemberSearching] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState<number | null>(null);
  const memberSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const memberDropdownRef = useRef<HTMLDivElement>(null);

  // Loan config
  const [loanCategories, setLoanCategories] = useState<string[]>([]);
  const [interestRate, setInterestRate] = useState(0);
  const [interestPeriod, setInterestPeriod] = useState<'monthly' | '3months'>('monthly');
  const [interestDestinationCategory, setInterestDestinationCategory] = useState<string>('');
  const [lateLoanRate, setLateLoanRate] = useState(0);
  const [lateLoanPeriod, setLateLoanPeriod] = useState<'monthly' | '3months'>('monthly');

  // Fines
  const [fines, setFines] = useState<FineInput[]>([]);

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  useEffect(() => {
    async function loadPreviousTontines() {
      if (!user) return;
      const { data } = await supabase
        .from('tontine_members')
        .select('tontine_id, tontines(*)')
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .in('tontines.status', ['completed', 'active']);
      if (data) {
        const tontines = data.map((d: any) => d.tontines).filter(Boolean) as Tontine[];
        setPreviousTontines(tontines);
      }
    }
    loadPreviousTontines();
  }, [user]);

  const addCategory = () => {
    setCategories([...categories, {
      name: '',
      amount_type: 'fixed',
      amount: 0,
      is_contribution: false,
      is_in_cash_box: true,
      can_withdraw_anytime: false,
      withdraw_at_end_only: false,
      loan_order: null,
      initial_amounts_per_member: {},
    }]);
  };

  const removeCategory = (index: number) => {
    if (categories[index].is_contribution) return;
    setCategories(categories.filter((_, i) => i !== index));
  };

  const updateCategory = (index: number, updates: Partial<CategoryInput>) => {
    const newCats = [...categories];
    newCats[index] = { ...newCats[index], ...updates };
    setCategories(newCats);
  };

  useEffect(() => {
    async function loadPrevTontineCategories() {
      if (!previousTontineId || !session) { setPrevTontineCategories([]); return; }
      try {
        const res = await fetch(`${EF_URL}?action=tontine-data&tontine_id=${previousTontineId}`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
        });
        const data = await res.json();
        if (data.categories && data.contributions && data.withdrawals && data.members) {
          const memberCount = (data.members as any[]).length;
          const allLoans = (data.loans || []) as any[];
          const allInterest = (data.interestDistributions || []) as any[];
          const cats: { id: string; name: string; available: number }[] = [];
          for (const cat of data.categories as any[]) {
            if (cat.is_contribution || !cat.is_in_cash_box) continue;
            const totalIn = (data.contributions as any[])
              .filter((c: any) => c.category_id === cat.id)
              .reduce((sum: number, c: any) => sum + Number(c.amount), 0);
            const totalInterest = allInterest
              .filter((d: any) => d.category_id === cat.id)
              .reduce((sum: number, d: any) => sum + Number(d.per_member_amount) * memberCount, 0);
            const totalOut = (data.withdrawals as any[])
              .filter((w: any) => w.category_id === cat.id)
              .reduce((sum: number, w: any) => sum + Number(w.amount), 0);
            const totalLoaned = allLoans
              .filter((l: any) => l.status === 'active' || l.status === 'approved')
              .reduce((sum: number, l: any) => {
                const sources = (l.loan_sources || []).filter((s: any) => s.category_id === cat.id);
                return sum + sources.reduce((s: number, src: any) => s + Number(src.amount), 0);
              }, 0);
            const available = totalIn + totalInterest - totalOut - totalLoaned;
            cats.push({ id: cat.id, name: cat.name, available });
          }
          setPrevTontineCategories(cats);
        }
      } catch (err) {
        console.error('Failed to load prev tontine categories:', err);
        setPrevTontineCategories([]);
      }
    }
    loadPrevTontineCategories();
  }, [previousTontineId, session]);

  const removeMember = (index: number) => {
    if (index === 0) return;
    setMembers(members.filter((_, i) => i !== index));
  };

  const moveMember = (from: number, to: number) => {
    const newOrder = [...members];
    const [item] = newOrder.splice(from, 1);
    newOrder.splice(to, 0, item);
    setMembers(newOrder);
  };

  const searchUsers = async (query: string) => {
    if (!profile || query.length < 2) {
      setMemberSearchResults([]);
      return;
    }
    setMemberSearching(true);
    try {
      const res = await fetch(`${EF_URL}?action=search-users&q=${encodeURIComponent(query)}`, {
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
      });
      const data = await res.json();
      const existingIds = members.map((m) => m.userId);
      const filtered = (data.users || []).filter((u: UserSearchResult) => !existingIds.includes(u.id));
      setMemberSearchResults(filtered);
    } catch {
      setMemberSearchResults([]);
    }
    setMemberSearching(false);
  };

  const handleMemberSearchInput = (value: string) => {
    setMemberSearchQuery(value);
    if (memberSearchTimeout.current) clearTimeout(memberSearchTimeout.current);
    memberSearchTimeout.current = setTimeout(() => searchUsers(value), 300);
  };

  const selectMember = (user: UserSearchResult) => {
    const displayName = `${user.first_name} ${user.last_name}`.trim() || user.username;
    const newMembers = [...members];
    if (activeSearchIndex !== null && activeSearchIndex < newMembers.length) {
      newMembers[activeSearchIndex] = { userId: user.id, username: user.username, displayName };
    } else {
      newMembers.push({ userId: user.id, username: user.username, displayName });
    }
    setMembers(newMembers);
    setMemberSearchQuery('');
    setMemberSearchResults([]);
    setActiveSearchIndex(null);
  };

  const toggleLoanCategory = (catName: string) => {
    if (loanCategories.includes(catName)) {
      setLoanCategories(loanCategories.filter((c) => c !== catName));
    } else {
      setLoanCategories([...loanCategories, catName]);
    }
  };

  const moveLoanCategory = (from: number, to: number) => {
    const newOrder = [...loanCategories];
    const [item] = newOrder.splice(from, 1);
    newOrder.splice(to, 0, item);
    setLoanCategories(newOrder);
  };

  const canProceed = (): boolean => {
    if (step === 'basic') return name.trim() !== '' && startDate !== '' && endDate !== '';
    if (step === 'periodicity') return true;
    if (step === 'eating-order') {
      const validMembers = members.filter((m) => m.userId.trim() !== '').length;
      if (validMembers < 2) return false;
      if (startDate && endDate) {
        const periodicityDetail = periodicityType === 'monthly'
          ? { weekNumber }
          : { dayOfWeek };
        const tourDates = generateScheduleDates(startDate, endDate, periodicityType, periodicityDetail);
        if (validMembers !== tourDates.length) return false;
      }
      return true;
    }
    if (step === 'categories') {
      const hasContribution = categories.some((c) => c.is_contribution);
      const allNamed = categories.every((c) => c.name.trim() !== '');
      const contributionCat = categories.find((c) => c.is_contribution);
      return hasContribution && allNamed && (contributionCat?.amount || 0) > 0;
    }
    return true;
  };

  // Calculate number of tours for display
  const tourCount = startDate && endDate
    ? generateScheduleDates(
        startDate,
        endDate,
        periodicityType,
        periodicityType === 'monthly' ? { weekNumber } : { dayOfWeek }
      ).length
    : 0;
  const validMemberCount = members.filter((m) => m.userId.trim() !== '').length;
  const memberCount = validMemberCount;

  const handleSave = async () => {
    if (!user || !profile) return;
    setSaving(true);
    setError('');

    try {
      // 1. Create tontine
      const periodicityDetail = periodicityType === 'monthly'
        ? { weekNumber }
        : { dayOfWeek };

      const { data: tontine, error: tontineErr } = await supabase
        .from('tontines')
        .insert({
          name,
          start_date: startDate,
          end_date: endDate,
          periodicity_type: periodicityType,
          periodicity_detail: periodicityDetail,
          contribution_amount: contributionAmount,
          eating_amount: contributionAmount * members.filter((m) => m.userId.trim()).length,
          previous_tontine_id: previousTontineId || null,
          transferred_cash: 0,
          created_by: profile.id,
          status: 'active',
          late_contribution_loan_rate: lateLoanRate,
          late_contribution_loan_period: lateLoanPeriod,
        })
        .select()
        .single();

      if (tontineErr || !tontine) throw tontineErr || new Error('Failed to create tontine');

      // 2. Add creator as admin with correct eating_order based on position in members array
      const creatorIdx = members.findIndex((m) => m.userId === profile.id);
      const creatorEatingOrder = creatorIdx >= 0 ? creatorIdx + 1 : 1;

      const { data: creatorMember, error: memberErr } = await supabase
        .from('tontine_members')
        .insert({
          tontine_id: tontine.id,
          user_id: profile.id,
          role: 'admin',
          eating_order: creatorEatingOrder,
        })
        .select()
        .single();

      if (memberErr || !creatorMember) throw memberErr || new Error('Failed to create member');

      // Create eating schedule entry for creator
      const periodicityDetailForSched = periodicityType === 'monthly' ? { weekNumber } : { dayOfWeek };
      const tourDates = generateScheduleDates(startDate, endDate, periodicityType, periodicityDetailForSched);
      const creatorScheduledDate = tourDates[creatorIdx >= 0 ? creatorIdx : 0];
      if (creatorScheduledDate) {
        await supabase.from('eating_schedule').insert({
          tontine_id: tontine.id,
          member_id: creatorMember.id,
          user_id: profile.id,
          order_number: creatorEatingOrder,
          scheduled_date: creatorScheduledDate,
          status: 'pending',
        });
      }

      // 3. Create categories (apply loan_order from loan config step)
      const catRecords = categories.map((c) => {
        const loanIdx = loanCategories.indexOf(c.name);
        return {
          tontine_id: tontine.id,
          name: c.name,
          amount_type: c.amount_type,
          amount: c.is_contribution ? contributionAmount : c.amount,
          is_contribution: c.is_contribution,
          is_in_cash_box: c.is_in_cash_box,
          can_withdraw_anytime: c.can_withdraw_anytime,
          withdraw_at_end_only: c.withdraw_at_end_only,
          loan_order: loanIdx >= 0 ? loanIdx + 1 : null,
          initial_amount: Object.values(c.initial_amounts_per_member || {}).reduce((s, v) => s + (v || 0), 0),
        };
      });

      const { data: insertedCategories, error: catErr } = await supabase
        .from('categories')
        .insert(catRecords)
        .select();

      if (catErr) throw catErr;

      // 4. Update interest destination
      if (interestDestinationCategory && insertedCategories) {
        const destCat = insertedCategories.find((c: { name: string }) => c.name === interestDestinationCategory);
        if (destCat) {
          const contributionCat = insertedCategories.find((c: { is_contribution: boolean }) => c.is_contribution);
          if (contributionCat) {
            await supabase
              .from('categories')
              .update({ interest_destination_category_id: destCat.id })
              .eq('id', contributionCat.id);
          }
        }
      }

      // 4b. Insert initial amounts as contributions for the creator (per-member amount)
      if (insertedCategories) {
        const today = new Date().toISOString().split('T')[0];
        const catInputMap = new Map(categories.map((c) => [c.name, c]));
        const initialContribs: { tontine_id: string; member_id: string; category_id: string; amount: number; period_date: string; recorded_by: string }[] = [];
        for (const insertedCat of insertedCategories as any[]) {
          const catInput = catInputMap.get(insertedCat.name);
          if (!catInput) continue;
          const creatorAmount = catInput.initial_amounts_per_member?.[profile.id] || 0;
          if (creatorAmount > 0) {
            initialContribs.push({
              tontine_id: tontine.id,
              member_id: creatorMember.id,
              category_id: insertedCat.id,
              amount: creatorAmount,
              period_date: today,
              recorded_by: profile.id,
            });
          }
        }
        if (initialContribs.length > 0) {
          await supabase.from('contributions').insert(initialContribs);
        }
      }

      // 5. Insert fine types
      if (fines.length > 0 && insertedCategories) {
        const catNameToId = Object.fromEntries((insertedCategories as any[]).map((c) => [c.name, c.id]));
        const fineRecords = fines
          .filter((f) => f.name.trim())
          .map((f) => ({
            tontine_id: tontine.id,
            name: f.name,
            amount: f.amount,
            deduction_type: f.deduction_type,
            source_category_id: f.deduction_type === 'account' && f.source_category_name ? (catNameToId[f.source_category_name] || null) : null,
            destination_category_id: f.destination_category_name ? (catNameToId[f.destination_category_name] || null) : null,
          }));
        if (fineRecords.length > 0) {
          await supabase.from('fine_types').insert(fineRecords);
        }
      }

      // 6. Send invitations to other members with per-member initial amounts and eating order
      const otherMembers = members.filter((m) => m.userId !== profile.id && m.userId.trim() !== '');
      if (otherMembers.length > 0 && insertedCategories) {
        const catNameToId = Object.fromEntries((insertedCategories as any[]).map((c) => [c.name, c.id]));
        const invitations = otherMembers.map((m) => {
          const memberIdx = members.findIndex((mm) => mm.userId === m.userId);
          const initialAmounts: Record<string, number> = {};
          for (const cat of categories) {
            const catId = catNameToId[cat.name];
            if (!catId) continue;
            const amt = cat.initial_amounts_per_member?.[m.userId] || 0;
            if (amt > 0) initialAmounts[catId] = amt;
          }
          return {
            tontine_id: tontine.id,
            inviter_id: profile.id,
            invitee_username: m.username,
            invitee_user_id: m.userId,
            status: 'pending',
            expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
            initial_amounts: initialAmounts,
            eating_order: memberIdx >= 0 ? memberIdx + 1 : null,
          };
        });
        await supabase.from('tontine_invitations').insert(invitations);
      }

      onCreated(tontine.id);
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la creation');
    } finally {
      setSaving(false);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 'basic':
        return (
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Nom de la tontine</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                placeholder="Ex: Tontine Famille 2027"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Date de debut</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Date de fin</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                />
              </div>
            </div>
            {previousTontines.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Transferer la caisse d'une tontine precedente (terminee ou active)</label>
                <select
                  value={previousTontineId || ''}
                  onChange={(e) => setPreviousTontineId(e.target.value || null)}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                >
                  <option value="">Aucune</option>
                  {previousTontines.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        );

      case 'periodicity':
        return (
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-3">Type de periodicite</label>
              <div className="grid grid-cols-3 gap-3">
                {(['monthly', 'weekly', 'biweekly'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setPeriodicityType(type)}
                    className={`p-4 rounded-xl border-2 text-center transition-all ${
                      periodicityType === type
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 hover:border-slate-300 text-slate-600'
                    }`}
                  >
                    <p className="font-medium text-sm">
                      {type === 'monthly' ? 'Mensuel' : type === 'weekly' ? 'Hebdomadaire' : 'Bi-hebdomadaire'}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {periodicityType === 'monthly' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-3">Quel dimanche du mois ?</label>
                <div className="grid grid-cols-5 gap-2">
                  {[
                    { value: 1, label: '1er' },
                    { value: 2, label: '2eme' },
                    { value: 3, label: '3eme' },
                    { value: 4, label: '4eme' },
                    { value: 5, label: 'Dernier' },
                  ].map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => setWeekNumber(value as 1 | 2 | 3 | 4 | 5)}
                      className={`p-3 rounded-xl border-2 text-center transition-all ${
                        weekNumber === value
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 hover:border-slate-300 text-slate-600'
                      }`}
                    >
                      <p className="font-medium text-sm">{label}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(periodicityType === 'weekly' || periodicityType === 'biweekly') && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-3">Jour de la semaine</label>
                <div className="grid grid-cols-7 gap-2">
                  {['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'].map((day, i) => (
                    <button
                      key={i}
                      onClick={() => setDayOfWeek(i)}
                      className={`p-3 rounded-xl border-2 text-center transition-all ${
                        dayOfWeek === i
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 hover:border-slate-300 text-slate-600'
                      }`}
                    >
                      <p className="font-medium text-xs">{day}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );

      case 'categories':
        return (
          <div className="space-y-5">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm text-amber-800">
                La categorie <strong>Cotisation</strong> est obligatoire. Son montant est fixe et sera reverse a celui qui recoit le tour.
                Ce montant ne figure pas dans la caisse.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Montant de la cotisation (fixe)</label>
              <input
                type="number"
                value={contributionAmount || ''}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setContributionAmount(val);
                  setCategories(categories.map((c) =>
                    c.is_contribution ? { ...c, amount: val } : c
                  ));
                }}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                placeholder="Ex: 10000"
                min={0}
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">Categories supplementaires</label>
                <button
                  onClick={addCategory}
                  className="flex items-center gap-1.5 text-sm text-emerald-600 hover:text-emerald-700 font-medium"
                >
                  <Plus className="w-4 h-4" /> Ajouter
                </button>
              </div>

              {categories.map((cat, i) => (
                <div key={i} className={`p-4 rounded-xl border-2 transition-all ${
                  cat.is_contribution ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200'
                }`}>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-3">
                        <input
                          type="text"
                          value={cat.name}
                          onChange={(e) => updateCategory(i, { name: e.target.value })}
                          className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                          placeholder="Nom de la categorie"
                          disabled={cat.is_contribution}
                        />
                        {cat.is_contribution && (
                          <span className="text-xs bg-amber-200 text-amber-800 px-2 py-1 rounded-lg font-medium">Obligatoire</span>
                        )}
                        {!cat.is_contribution && (
                          <button onClick={() => removeCategory(i)} className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-500 transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      {!cat.is_contribution && (
                        <>
                          <div className="flex items-center gap-3">
                            <select
                              value={cat.amount_type}
                              onChange={(e) => updateCategory(i, { amount_type: e.target.value as 'fixed' | 'minimum' })}
                              className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            >
                              <option value="fixed">Montant fixe</option>
                              <option value="minimum">Montant minimum</option>
                            </select>
                            <input
                              type="number"
                              value={cat.amount || ''}
                              onChange={(e) => updateCategory(i, { amount: Number(e.target.value) })}
                              className="w-32 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                              placeholder="Montant"
                              min={0}
                            />
                          </div>
                          {cat.is_in_cash_box && (
                            <div className="space-y-3 bg-blue-50 border border-blue-200 rounded-lg p-3">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-blue-700 font-medium">Montant initial par membre</span>
                                <div className="flex items-center gap-2">
                                  {prevTontineCategories.length > 0 && (
                                    <select
                                      value=""
                                      onChange={(e) => {
                                        const prevCat = prevTontineCategories.find((pc) => pc.id === e.target.value);
                                        if (prevCat) {
                                          const perMember = memberCount > 0 ? Math.floor(prevCat.available / memberCount) : 0;
                                          const amountsMap: Record<string, number> = {};
                                          members.forEach((m) => { if (m.userId.trim()) amountsMap[m.userId] = perMember; });
                                          updateCategory(i, { initial_amounts_per_member: amountsMap });
                                        }
                                      }}
                                      className="px-2 py-1 border border-blue-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                    >
                                      <option value="">Depuis tontine precedente...</option>
                                      {prevTontineCategories.map((pc) => (
                                        <option key={pc.id} value={pc.id}>{pc.name} ({formatCurrency(pc.available)})</option>
                                      ))}
                                    </select>
                                  )}
                                  <button
                                    onClick={() => {
                                      const hasAmounts = Object.values(cat.initial_amounts_per_member || {}).some((v) => v > 0);
                                      if (hasAmounts) {
                                        updateCategory(i, { initial_amounts_per_member: {} });
                                        setShowInitialPerMember({ ...showInitialPerMember, [i]: false });
                                      } else {
                                        setShowInitialPerMember({ ...showInitialPerMember, [i]: true });
                                      }
                                    }}
                                    className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                                  >
                                    {Object.values(cat.initial_amounts_per_member || {}).some((v) => v > 0) || showInitialPerMember[i]
                                      ? 'Effacer' : 'Definir les montants'}
                                  </button>
                                </div>
                              </div>
                              {(Object.values(cat.initial_amounts_per_member || {}).some((v) => v > 0) || showInitialPerMember[i]) && (
                                <>
                                  <div className="space-y-1.5">
                                    {members.filter((m) => m.userId.trim()).map((m) => (
                                      <div key={m.userId} className="flex items-center gap-2">
                                        <div className="w-6 h-6 bg-blue-100 rounded flex items-center justify-center flex-shrink-0">
                                          <span className="text-blue-700 font-semibold text-[10px]">{m.displayName[0]}</span>
                                        </div>
                                        <span className="text-xs text-slate-700 flex-1 truncate">{m.displayName}</span>
                                        <input
                                          type="number"
                                          value={cat.initial_amounts_per_member?.[m.userId] || ''}
                                          onChange={(e) => {
                                            const val = Number(e.target.value);
                                            const newMap = { ...cat.initial_amounts_per_member, [m.userId]: val };
                                            updateCategory(i, { initial_amounts_per_member: newMap });
                                          }}
                                          className="w-28 px-2 py-1 border border-blue-200 rounded-lg text-xs text-right font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                          placeholder="0"
                                          min={0}
                                        />
                                      </div>
                                    ))}
                                  </div>
                                  {(() => {
                                    const total = Object.values(cat.initial_amounts_per_member || {}).reduce((s, v) => s + (v || 0), 0);
                                    return total > 0 ? (
                                      <p className="text-xs text-blue-700 font-medium pt-1 border-t border-blue-200">
                                        Total: {formatCurrency(total)}
                                      </p>
                                    ) : null;
                                  })()}
                                </>
                              )}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <label className={`flex items-center gap-1.5 text-xs ${cat.can_withdraw_anytime ? 'text-slate-300 cursor-not-allowed' : 'text-slate-600'}`}>
                              <input
                                type="checkbox"
                                checked={cat.is_in_cash_box}
                                disabled={cat.can_withdraw_anytime}
                                onChange={(e) => updateCategory(i, { is_in_cash_box: e.target.checked })}
                                className="rounded border-slate-300 text-emerald-500 focus:ring-emerald-500"
                              />
                              Dans la caisse
                            </label>
                            <label className="flex items-center gap-1.5 text-xs text-slate-600">
                              <input
                                type="checkbox"
                                checked={cat.can_withdraw_anytime}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  updateCategory(i, {
                                    can_withdraw_anytime: checked,
                                    is_in_cash_box: checked ? false : cat.is_in_cash_box,
                                    withdraw_at_end_only: checked ? false : cat.withdraw_at_end_only,
                                  });
                                }}
                                className="rounded border-slate-300 text-emerald-500 focus:ring-emerald-500"
                              />
                              Cotisation
                            </label>
                            <label className={`flex items-center gap-1.5 text-xs ${cat.can_withdraw_anytime ? 'text-slate-300 cursor-not-allowed' : 'text-slate-600'}`}>
                              <input
                                type="checkbox"
                                checked={cat.withdraw_at_end_only}
                                disabled={cat.can_withdraw_anytime}
                                onChange={(e) => updateCategory(i, { withdraw_at_end_only: e.target.checked })}
                                className="rounded border-slate-300 text-emerald-500 focus:ring-emerald-500"
                              />
                              Retrait en fin uniquement
                            </label>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case 'eating-order':
        return (
          <div className="space-y-5">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-sm text-blue-800">
                Recherchez et ajoutez les membres de la tontine. L'ordre determine qui recoit le tour en premier, deuxieme, etc.
                Vous (admin) etes automatiquement inclus en position 1.
              </p>
            </div>

            {/* Member count vs tour count validation */}
            {tourCount > 0 && (
              <div className={`rounded-xl p-4 border ${
                validMemberCount === tourCount
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-red-50 border-red-200'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`text-sm font-medium ${
                      validMemberCount === tourCount ? 'text-emerald-800' : 'text-red-800'
                    }`}>
                      {validMemberCount === tourCount
                        ? 'Le nombre de membres correspond au nombre de tours'
                        : 'Le nombre de membres doit etre egal au nombre de tours'}
                    </p>
                    <p className={`text-xs mt-1 ${
                      validMemberCount === tourCount ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                      Membres: {validMemberCount} | Tours: {tourCount}
                    </p>
                  </div>
                  {validMemberCount === tourCount && (
                    <Check className="w-5 h-5 text-emerald-600" />
                  )}
                </div>
              </div>
            )}

            <div className="space-y-3">
              {members.map((member, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-sm font-bold text-slate-600">
                    {i + 1}
                  </div>
                  {i > 0 && (
                    <button
                      onClick={() => moveMember(i, i - 1)}
                      className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                  )}
                  {i < members.length - 1 && (
                    <button
                      onClick={() => moveMember(i, i + 1)}
                      className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  )}
                  {i === 0 ? (
                    <div className="flex-1 flex items-center gap-2 px-3 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
                      <div className="w-7 h-7 bg-emerald-200 rounded-lg flex items-center justify-center">
                        <span className="text-emerald-700 font-semibold text-xs">{member.displayName[0]}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-emerald-800">{member.displayName}</p>
                        <p className="text-xs text-emerald-600">@{member.username} (Admin)</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center gap-2 px-3 py-2.5 bg-white border border-slate-200 rounded-lg">
                      <div className="w-7 h-7 bg-slate-100 rounded-lg flex items-center justify-center">
                        <span className="text-slate-600 font-semibold text-xs">{member.displayName[0]}</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-800">{member.displayName}</p>
                        <p className="text-xs text-slate-500">@{member.username}</p>
                      </div>
                      <button
                        onClick={() => removeMember(i)}
                        className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-500 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Search input for adding new members */}
            <div className="relative" ref={memberDropdownRef}>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={memberSearchQuery}
                onChange={(e) => handleMemberSearchInput(e.target.value)}
                onFocus={() => setActiveSearchIndex(members.length)}
                className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
                placeholder="Rechercher un utilisateur par nom ou username..."
                autoComplete="off"
              />

              {memberSearchResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 max-h-60 overflow-y-auto">
                  {memberSearchResults.map((user) => {
                    const displayName = `${user.first_name} ${user.last_name}`.trim() || user.username;
                    return (
                      <button
                        key={user.id}
                        onClick={() => selectMember(user)}
                        className="w-full text-left px-4 py-3 hover:bg-emerald-50 flex items-center gap-3 transition-colors border-b border-slate-50 last:border-0"
                      >
                        <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <span className="text-slate-600 font-semibold text-sm">{displayName[0]}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{displayName}</p>
                          <p className="text-xs text-slate-500 truncate">@{user.username} - {user.email}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {memberSearching && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-4 text-center">
                  <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-xs text-slate-500 mt-2">Recherche en cours...</p>
                </div>
              )}

              {memberSearchQuery.length >= 2 && memberSearchResults.length === 0 && !memberSearching && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-4 text-center">
                  <p className="text-sm text-slate-500">Aucun utilisateur trouve</p>
                </div>
              )}
            </div>

            <div className="bg-slate-50 rounded-xl p-4">
              <p className="text-sm text-slate-600">
                Montant par tour: <strong>{formatCurrency(contributionAmount * members.filter((m) => m.userId.trim()).length)}</strong>
                ({members.filter((m) => m.userId.trim()).length} membres x {formatCurrency(contributionAmount)})
              </p>
            </div>
          </div>
        );

      case 'loan-config':
        return (
          <div className="space-y-5">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-sm text-blue-800">
                Configurez les prets: choisissez les categories qui financent les prets et leur ordre de prelevement.
                Definissez aussi le taux d'interet et la categorie qui recevra les interets.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-3">Categories source de pret (ordre de prelevement)</label>
              <div className="space-y-2">
                {categories.filter((c) => !c.is_contribution).map((cat) => (
                  <label key={cat.name} className="flex items-center gap-3 p-3 border border-slate-200 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={loanCategories.includes(cat.name)}
                      onChange={() => toggleLoanCategory(cat.name)}
                      className="rounded border-slate-300 text-emerald-500 focus:ring-emerald-500"
                    />
                    <span className="text-sm text-slate-700">{cat.name}</span>
                  </label>
                ))}
              </div>
              {loanCategories.length > 0 && (
                <div className="mt-3 space-y-1">
                  <p className="text-xs text-slate-500 font-medium">Ordre de prelevement (glissez pour reordonner):</p>
                  {loanCategories.map((cat, i) => (
                    <div key={cat} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg">
                      <GripVertical className="w-4 h-4 text-slate-400" />
                      <span className="text-sm font-medium text-slate-700">{i + 1}. {cat}</span>
                      <div className="ml-auto flex items-center gap-0.5">
                        {i > 0 && (
                          <button onClick={() => moveLoanCategory(i, i - 1)} className="p-1 hover:bg-slate-200 rounded">
                            <ChevronUp className="w-3 h-3" />
                          </button>
                        )}
                        {i < loanCategories.length - 1 && (
                          <button onClick={() => moveLoanCategory(i, i + 1)} className="p-1 hover:bg-slate-200 rounded">
                            <ChevronDown className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Taux d'interet (%)</label>
                <input
                  type="number"
                  value={interestRate || ''}
                  onChange={(e) => setInterestRate(Number(e.target.value))}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                  placeholder="Ex: 5"
                  min={0}
                  step={0.5}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Période d'intérêt</label>
                <select
                  value={interestPeriod}
                  onChange={(e) => setInterestPeriod(e.target.value as 'monthly' | '3months')}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                >
                  <option value="monthly">Par mois</option>
                  <option value="3months">Par 3 mois</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Categorie de destination des interets</label>
              <select
                value={interestDestinationCategory}
                onChange={(e) => setInterestDestinationCategory(e.target.value)}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
              >
                <option value="">Selectionner</option>
                {categories.filter((c) => !c.is_contribution && c.is_in_cash_box).map((cat) => (
                  <option key={cat.name} value={cat.name}>{cat.name}</option>
                ))}
              </select>
            </div>

            <div className="border-t border-slate-200 pt-4 mt-2">
              <h4 className="text-sm font-semibold text-slate-800 mb-1">Pret sur cotisation en retard</h4>
              <p className="text-xs text-slate-500 mb-3">Configurez un taux d'interet specifique applique lorsqu'un retard de cotisation est preleve sur forme de pret. Ce taux ne s'applique qu'a ce type de pret.</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Taux d'interet (%)</label>
                  <input
                    type="number"
                    value={lateLoanRate || ''}
                    onChange={(e) => setLateLoanRate(Number(e.target.value))}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                    placeholder="Ex: 5"
                    min={0}
                    step={0.5}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Periode d'interet</label>
                  <select
                    value={lateLoanPeriod}
                    onChange={(e) => setLateLoanPeriod(e.target.value as 'monthly' | '3months')}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                  >
                    <option value="monthly">Par mois</option>
                    <option value="3months">Par 3 mois</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        );

      case 'fines':
        return (
          <div className="space-y-5">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm text-amber-800">
                Définissez les types d'amendes applicables dans cette tontine. L'administrateur pourra les appliquer aux membres.
                Cette étape est optionnelle.
              </p>
            </div>

            <div className="space-y-3">
              {fines.map((fine, i) => {
                const nonContribCats = categories.filter((c) => !c.is_contribution && c.is_in_cash_box);
                return (
                  <div key={i} className="p-4 rounded-xl border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700">Amende {i + 1}</span>
                      <button
                        onClick={() => setFines(fines.filter((_, j) => j !== i))}
                        className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Nom</label>
                        <input
                          type="text"
                          value={fine.name}
                          onChange={(e) => setFines(fines.map((f, j) => j === i ? { ...f, name: e.target.value } : f))}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                          placeholder="Ex: Retard, Absence..."
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Montant (FCFA)</label>
                        <input
                          type="number"
                          value={fine.amount || ''}
                          onChange={(e) => setFines(fines.map((f, j) => j === i ? { ...f, amount: Number(e.target.value) } : f))}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                          placeholder="Ex: 1000"
                          min={0}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Mode de prélèvement</label>
                        <select
                          value={fine.deduction_type}
                          onChange={(e) => setFines(fines.map((f, j) => j === i ? { ...f, deduction_type: e.target.value as 'cash' | 'account', source_category_name: '' } : f))}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                        >
                          <option value="cash">En espèces</option>
                          <option value="account">Sur le compte du membre</option>
                        </select>
                      </div>
                      {fine.deduction_type === 'account' && (
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">Catégorie source (du membre)</label>
                          <select
                            value={fine.source_category_name}
                            onChange={(e) => setFines(fines.map((f, j) => j === i ? { ...f, source_category_name: e.target.value } : f))}
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                          >
                            <option value="">Sélectionner</option>
                            {nonContribCats.map((c) => (
                              <option key={c.name} value={c.name}>{c.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Catégorie de destination (redistribution)</label>
                      <select
                        value={fine.destination_category_name}
                        onChange={(e) => setFines(fines.map((f, j) => j === i ? { ...f, destination_category_name: e.target.value } : f))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                      >
                        <option value="">Aucune redistribution</option>
                        {nonContribCats.map((c) => (
                          <option key={c.name} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                      {fine.destination_category_name && (
                        <p className="text-xs text-slate-400 mt-1">
                          Le montant sera redistribué en parts égales dans « {fine.destination_category_name} » de tous les membres.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
              <button
                onClick={() => setFines([...fines, { name: '', amount: 0, deduction_type: 'cash', source_category_name: '', destination_category_name: '' }])}
                className="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-sm text-slate-500 hover:border-emerald-300 hover:text-emerald-600 transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Ajouter un type d'amende
              </button>
            </div>
          </div>
        );

      case 'review':
        return (
          <div className="space-y-5">
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <h3 className="font-semibold text-slate-900">Informations generales</h3>
              <div className="grid grid-cols-2 gap-y-2 text-sm">
                <span className="text-slate-500">Nom:</span>
                <span className="font-medium text-slate-800">{name}</span>
                <span className="text-slate-500">Debut:</span>
                <span className="font-medium text-slate-800">{startDate}</span>
                <span className="text-slate-500">Fin:</span>
                <span className="font-medium text-slate-800">{endDate}</span>
                <span className="text-slate-500">Periodicite:</span>
                <span className="font-medium text-slate-800">
                  {periodicityType === 'monthly' ? `Mensuel (${weekNumber === 5 ? 'dernier' : weekNumber + 'e'} dimanche)` :
                   periodicityType === 'weekly' ? 'Hebdomadaire' : 'Bi-hebdomadaire'}
                </span>
                <span className="text-slate-500">Cotisation:</span>
                <span className="font-medium text-slate-800">{formatCurrency(contributionAmount)}</span>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
              <h3 className="font-semibold text-slate-900">Categories</h3>
              {categories.map((cat, i) => (
                <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b border-slate-50 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">{cat.name}</span>
                    {cat.is_contribution && <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Cotisation</span>}
                    {cat.can_withdraw_anytime && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Cotisation</span>}
                    {cat.withdraw_at_end_only && <span className="text-xs bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded">Fin uniquement</span>}
                    {(() => {
                      const total = Object.values(cat.initial_amounts_per_member || {}).reduce((s, v) => s + (v || 0), 0);
                      return total > 0 ? <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Initial: {formatCurrency(total)}</span> : null;
                    })()}
                  </div>
                  <span className="font-medium text-slate-800">{formatCurrency(cat.is_contribution ? contributionAmount : cat.amount)}</span>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
              <h3 className="font-semibold text-slate-900">Ordre des tours ({members.filter((m) => m.userId.trim()).length} membres)</h3>
              {members.filter((m) => m.userId.trim()).map((member, i) => (
                <div key={i} className="flex items-center gap-3 text-sm py-1">
                  <span className="w-6 h-6 bg-emerald-100 text-emerald-700 rounded-lg flex items-center justify-center text-xs font-bold">{i + 1}</span>
                  <span className="font-medium text-slate-800">{member.displayName}</span>
                  <span className="text-xs text-slate-400">@{member.username}</span>
                </div>
              ))}
            </div>

            {loanCategories.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
                <h3 className="font-semibold text-slate-900">Configuration des prêts</h3>
                <div className="text-sm">
                  <p className="text-slate-500">Ordre de prélèvement: {loanCategories.join(' => ')}</p>
                  <p className="text-slate-500 mt-1">Taux: {interestRate}% {interestPeriod === 'monthly' ? 'par mois' : 'par 3 mois'}</p>
                  {interestDestinationCategory && (
                    <p className="text-slate-500 mt-1">Interets verses dans: {interestDestinationCategory}</p>
                  )}
                  {lateLoanRate > 0 && (
                    <p className="text-slate-500 mt-1">Pret sur retard: {lateLoanRate}% {lateLoanPeriod === 'monthly' ? 'par mois' : 'par 3 mois'}</p>
                  )}
                </div>
              </div>
            )}

            {fines.filter((f) => f.name.trim()).length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
                <h3 className="font-semibold text-slate-900">Amendes ({fines.filter((f) => f.name.trim()).length})</h3>
                {fines.filter((f) => f.name.trim()).map((f, i) => (
                  <div key={i} className="flex items-center justify-between text-sm py-1 border-b border-slate-50 last:border-0">
                    <span className="font-medium text-slate-800">{f.name}</span>
                    <div className="text-right">
                      <span className="font-medium text-slate-800">{f.amount.toLocaleString('fr-FR')} FCFA</span>
                      <span className="ml-2 text-xs text-slate-400">{f.deduction_type === 'cash' ? 'Espèces' : `Compte (${f.source_category_name})`}</span>
                      {f.destination_category_name && <span className="ml-2 text-xs text-emerald-600">→ {f.destination_category_name}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Creer une tontine</h1>
        <p className="text-slate-500 mt-1">Suivez les etapes pour configurer votre tontine</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-8 overflow-x-auto pb-2">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center">
            <button
              onClick={() => i <= stepIndex && setStep(s.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                s.id === step
                  ? 'bg-emerald-100 text-emerald-700'
                  : i < stepIndex
                  ? 'bg-slate-100 text-slate-600'
                  : 'text-slate-400'
              }`}
            >
              {i < stepIndex && <Check className="w-3 h-3" />}
              {s.label}
            </button>
            {i < STEPS.length - 1 && <ChevronRight className="w-4 h-4 text-slate-300 mx-1 flex-shrink-0" />}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        {renderStep()}

        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm">
            {error}
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-100">
          <button
            onClick={() => {
              const prev = STEPS[stepIndex - 1];
              if (prev) setStep(prev.id);
              else onNavigate('dashboard');
            }}
            className="px-5 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-50 rounded-xl transition-all"
          >
            {stepIndex === 0 ? 'Annuler' : 'Précédent'}
          </button>

          {stepIndex < STEPS.length - 1 ? (
            <button
              onClick={() => setStep(STEPS[stepIndex + 1].id)}
              disabled={!canProceed()}
              className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all shadow-sm"
            >
              Suivant
            </button>
          ) : (
            <button
              onClick={handleSave}
              disabled={saving || !canProceed()}
              className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all shadow-sm flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Creation...' : 'Creer la tontine'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
