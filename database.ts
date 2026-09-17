export interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  username: string;
  created_at: string;
}

export interface Tontine {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  periodicity_type: 'monthly' | 'weekly' | 'biweekly';
  periodicity_detail: PeriodicityDetail;
  contribution_amount: number;
  eating_amount: number;
  previous_tontine_id: string | null;
  transferred_cash: number;
  created_by: string;
  status: 'active' | 'completed' | 'cancelled';
  created_at: string;
  late_contribution_loan_rate: number;
  late_contribution_loan_period: 'monthly' | '3months';
}

export interface MonthlyDetail {
  weekNumber: 1 | 2 | 3 | 4 | 5; // 5 = last sunday
}

export interface WeeklyDetail {
  dayOfWeek: number; // 0=Sunday, 1=Monday, etc.
}

export interface BiweeklyDetail {
  dayOfWeek: number;
}

export type PeriodicityDetail = MonthlyDetail | WeeklyDetail | BiweeklyDetail;

export interface TontineMember {
  id: string;
  tontine_id: string;
  user_id: string;
  role: 'admin' | 'secondary_admin' | 'member';
  eating_order: number;
  joined_at: string;
  last_active_at: string | null;
  profile?: Profile;
}

export interface TontineInvitation {
  id: string;
  tontine_id: string;
  inviter_id: string;
  invitee_username: string;
  invitee_user_id: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  expires_at: string;
  created_at: string;
  tontine?: Tontine;
}

export interface Category {
  id: string;
  tontine_id: string;
  name: string;
  amount_type: 'fixed' | 'minimum';
  amount: number;
  is_contribution: boolean;
  is_in_cash_box: boolean;
  can_withdraw_anytime: boolean;
  withdraw_at_end_only: boolean;
  loan_order: number | null;
  interest_destination_category_id: string | null;
  initial_amount: number;
  created_at: string;
}

export interface EatingSchedule {
  id: string;
  tontine_id: string;
  member_id: string;
  user_id: string;
  order_number: number;
  scheduled_date: string;
  status: 'pending' | 'completed';
  completed_at: string | null;
  profile?: Profile;
  member?: TontineMember;
}

export interface Contribution {
  id: string;
  tontine_id: string;
  member_id: string;
  category_id: string;
  amount: number;
  period_date: string;
  paid_at: string;
  recorded_by: string;
  category?: Category;
  member?: TontineMember;
  profile?: Profile;
}

export interface Payout {
  id: string;
  tontine_id: string;
  eating_schedule_id: string;
  recipient_member_id: string;
  total_amount: number;
  period_date: string;
  paid_at: string;
  recorded_by: string;
  eating_schedule?: EatingSchedule;
  recipient?: TontineMember;
  recipientProfile?: Profile;
}

export interface Loan {
  id: string;
  tontine_id: string;
  member_id: string;
  amount: number;
  interest_rate: number;
  interest_rate_period: 'monthly' | '3months';
  duration_months: number;
  status: 'pending' | 'approved' | 'active' | 'repaid' | 'defaulted';
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  due_date: string | null;
  member?: TontineMember;
  profile?: Profile;
  loan_sources?: LoanSource[];
}

export interface LoanRepayment {
  id: string;
  loan_id: string;
  amount: number;
  interest_amount: number;
  paid_at: string;
  recorded_by: string;
}

export interface LoanSource {
  id: string;
  loan_id: string;
  category_id: string;
  amount: number;
  category?: Category;
}

export interface CashWithdrawal {
  id: string;
  tontine_id: string;
  category_id: string;
  member_id: string | null;
  amount: number;
  reason: string;
  withdrawn_at: string;
  recorded_by: string;
  category?: Category;
}

export interface FineType {
  id: string;
  tontine_id: string;
  name: string;
  amount: number;
  deduction_type: 'cash' | 'account';
  source_category_id: string | null;
  destination_category_id: string | null;
  created_at: string;
}

export interface FineApplication {
  id: string;
  tontine_id: string;
  fine_type_id: string;
  member_id: string;
  amount: number;
  reason: string | null;
  payment_method: 'cash' | 'account';
  source_category_id: string | null;
  destination_category_id: string | null;
  recorded_by: string;
  applied_at: string;
  paid_at: string | null;
  status: 'pending' | 'paid';
}

export interface InterestDistribution {
  id: string;
  tontine_id: string;
  loan_id: string;
  total_interest: number;
  per_member_amount: number;
  distributed_at: string;
  category_id: string;
}
