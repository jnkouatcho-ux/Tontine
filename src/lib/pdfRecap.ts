import { formatCurrency, formatDate } from './utils';
import type { Tontine, TontineMember, Profile, Category, Contribution, CashWithdrawal, Loan, LoanSource, LoanRepayment, Payout, InterestDistribution, FineApplication } from '../types/database';

interface RecapData {
  tontine: Tontine;
  members: (TontineMember & { profile: Profile })[];
  categories: Category[];
  contributions: Contribution[];
  withdrawals: CashWithdrawal[];
  loans: (Loan & { profile?: Profile; loan_sources?: LoanSource[] })[];
  repayments: LoanRepayment[];
  payouts: Payout[];
  interestDistributions: InterestDistribution[];
  fineApplications: FineApplication[];
  periodDate: string;
  payoutAmount: number;
  recipientProfile?: Profile;
}

function getCategoryAvailable(
  catId: string,
  categories: Category[],
  contributions: Contribution[],
  withdrawals: CashWithdrawal[],
  loans: (Loan & { loan_sources?: LoanSource[] })[],
  interestDistributions: InterestDistribution[],
  memberCount: number,
): number {
  const cat = categories.find((c) => c.id === catId);
  if (!cat || !cat.is_in_cash_box) return 0;

  const totalIn = contributions
    .filter((c) => c.category_id === catId)
    .reduce((sum, c) => sum + Number(c.amount), 0);

  const totalInterest = interestDistributions
    .filter((d) => d.category_id === catId)
    .reduce((sum, d) => sum + Number(d.per_member_amount) * memberCount, 0);

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
}

function getMemberCategoryNet(
  memberId: string,
  catId: string,
  contributions: Contribution[],
  withdrawals: CashWithdrawal[],
): number {
  const contribTotal = contributions
    .filter((c) => c.member_id === memberId && c.category_id === catId)
    .reduce((sum, c) => sum + Number(c.amount), 0);
  const withdrawTotal = withdrawals
    .filter((w) => w.member_id === memberId && w.category_id === catId)
    .reduce((sum, w) => sum + Number(w.amount), 0);
  return contribTotal - withdrawTotal;
}

export function generateRecapPDF(data: RecapData): void {
  const { tontine, members, categories, contributions, withdrawals, loans, repayments, payouts, interestDistributions, fineApplications, periodDate, payoutAmount, recipientProfile } = data;

  const nonContribCategories = categories.filter((c) => !c.is_contribution && !c.can_withdraw_anytime);
  const contribCategories = categories.filter((c) => c.is_contribution || c.can_withdraw_anytime);
  const activeLoans = loans.filter((l) => l.status === 'active');
  const completedPayouts = payouts.filter((p) => (p as any).period_date);

  // Fines paid during this period (between previous period date and this one)
  const periodFines = fineApplications.filter((f) => f.status === 'paid' && f.paid_at);
  const fineRows = periodFines.length > 0 ? periodFines.map((f) => {
    const member = members.find((m) => m.id === f.member_id);
    const destCat = categories.find((c) => c.id === f.destination_category_id);
    return `<tr>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;">${member?.profile.first_name || ''} ${member?.profile.last_name || ''}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;">${f.reason || 'Amende'}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;">${destCat?.name || '-'}</td>
      <td style="text-align:right;padding:6px 10px;border:1px solid #e2e8f0;font-family:monospace;font-weight:700;color:#dc2626;">${formatCurrency(Number(f.amount))}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="4" style="padding:10px;text-align:center;color:#94a3b8;">Aucune amende pour cette periode</td></tr>';

  // Withdrawals for this period
  const periodWithdrawals = withdrawals.filter((w) => w.period_date === periodDate);
  const withdrawalRows = periodWithdrawals.length > 0 ? periodWithdrawals.map((w) => {
    const cat = categories.find((c) => c.id === w.category_id);
    const member = members.find((m) => m.id === w.member_id);
    return `<tr>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;">${cat?.name || ''}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;">${member?.profile.first_name || ''} ${member?.profile.last_name || ''}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;">${w.reason || ''}</td>
      <td style="text-align:right;padding:6px 10px;border:1px solid #e2e8f0;font-family:monospace;font-weight:700;color:#dc2626;">-${formatCurrency(Number(w.amount))}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="4" style="padding:10px;text-align:center;color:#94a3b8;">Aucun retrait pour cette periode</td></tr>';

  // Interest distributions for this period
  const periodInterest = interestDistributions.filter((d) => {
    return contributions.some((c) => c.category_id === d.category_id && c.amount > 0 && c.period_date === periodDate);
  });
  const interestRows = periodInterest.length > 0 ? periodInterest.map((d) => {
    const cat = categories.find((c) => c.id === d.category_id);
    const loan = loans.find((l) => l.id === d.loan_id);
    const borrower = loan ? members.find((m) => m.id === loan.member_id) : null;
    return `<tr>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;">${borrower?.profile.first_name || ''} ${borrower?.profile.last_name || ''}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;">${cat?.name || ''}</td>
      <td style="text-align:right;padding:6px 10px;border:1px solid #e2e8f0;font-family:monospace;font-weight:700;color:#059669;">+${formatCurrency(Number(d.total_interest))}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="3" style="padding:10px;text-align:center;color:#94a3b8;">Aucun interet verse pour cette periode</td></tr>';

  const memberRows = members.map((m) => {
    const cells = nonContribCategories.map((cat) => {
      const net = getMemberCategoryNet(m.id, cat.id, contributions, withdrawals);
      return `<td style="text-align:right;padding:6px 10px;border:1px solid #e2e8f0;font-family:monospace;">${formatCurrency(net)}</td>`;
    }).join('');
    const totalNet = nonContribCategories.reduce((sum, cat) => sum + getMemberCategoryNet(m.id, cat.id, contributions, withdrawals), 0);
    return `<tr style="border-bottom:1px solid #f1f5f9;">
      <td style="padding:6px 10px;border:1px solid #e2e8f0;font-weight:500;">${m.profile.first_name} ${m.profile.last_name}</td>
      ${cells}
      <td style="text-align:right;padding:6px 10px;border:1px solid #e2e8f0;font-weight:700;font-family:monospace;">${formatCurrency(totalNet)}</td>
    </tr>`;
  }).join('');

  const categoryAvailableRows = nonContribCategories.map((cat) => {
    const available = getCategoryAvailable(cat.id, categories, contributions, withdrawals, loans, interestDistributions, members.length);
    return `<tr>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;font-weight:500;">${cat.name}</td>
      <td style="text-align:right;padding:6px 10px;border:1px solid #e2e8f0;font-family:monospace;font-weight:700;">${formatCurrency(available)}</td>
    </tr>`;
  }).join('');

  const loanRows = activeLoans.length > 0 ? activeLoans.map((l) => {
    const principalRepaid = repayments.filter((r) => r.loan_id === l.id).reduce((sum, r) => sum + Number(r.amount), 0);
    const remaining = Math.max(0, Number(l.amount) - principalRepaid);
    return `<tr>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;">${l.profile?.first_name || ''} ${l.profile?.last_name || ''}</td>
      <td style="text-align:right;padding:6px 10px;border:1px solid #e2e8f0;font-family:monospace;">${formatCurrency(Number(l.amount))}</td>
      <td style="text-align:right;padding:6px 10px;border:1px solid #e2e8f0;font-family:monospace;">${formatCurrency(remaining)}</td>
      <td style="text-align:center;padding:6px 10px;border:1px solid #e2e8f0;">${l.duration_months} mois</td>
      <td style="text-align:center;padding:6px 10px;border:1px solid #e2e8f0;">${l.interest_rate}%</td>
    </tr>`;
  }).join('') : '<tr><td colspan="5" style="padding:10px;text-align:center;color:#94a3b8;">Aucun pret en cours</td></tr>';

  const payoutRows = completedPayouts.length > 0 ? completedPayouts.map((p) => {
    const recipient = members.find((m) => m.id === p.recipient_member_id);
    return `<tr>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;">${formatDate((p as any).period_date || p.paid_at)}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;">${recipient?.profile.first_name || ''} ${recipient?.profile.last_name || ''}</td>
      <td style="text-align:right;padding:6px 10px;border:1px solid #e2e8f0;font-family:monospace;font-weight:700;">${formatCurrency(Number(p.total_amount))}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="3" style="padding:10px;text-align:center;color:#94a3b8;">Aucun versement</td></tr>';

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Recapitulatif - ${tontine.name} - ${formatDate(periodDate)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; padding: 40px; background: #fff; }
  .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 3px solid #10b981; }
  .header h1 { font-size: 28px; font-weight: 800; color: #0f172a; margin-bottom: 6px; }
  .header .subtitle { font-size: 16px; color: #64748b; }
  .header .date { font-size: 14px; color: #10b981; font-weight: 600; margin-top: 4px; }
  .section { margin-bottom: 28px; }
  .section h2 { font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #f8fafc; padding: 8px 10px; border: 1px solid #e2e8f0; font-weight: 600; color: #475569; text-align: left; font-size: 12px; }
  .payout-highlight { background: #ecfdf5; border: 2px solid #10b981; border-radius: 12px; padding: 20px; margin-bottom: 28px; text-align: center; }
  .payout-highlight .label { font-size: 14px; color: #047857; font-weight: 600; }
  .payout-highlight .amount { font-size: 32px; font-weight: 800; color: #065f46; font-family: monospace; margin: 6px 0; }
  .payout-highlight .recipient { font-size: 16px; color: #047857; }
  .payout-highlight .breakdown-line { display: flex; justify-content: space-between; font-size: 14px; color: #047857; padding: 2px 20%; font-family: monospace; }
  .payout-highlight .breakdown-total { display: flex; justify-content: space-between; font-size: 15px; font-weight: 700; color: #065f46; padding: 4px 20% 0; margin-top: 4px; border-top: 1px solid #10b981; font-family: monospace; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 11px; color: #94a3b8; }
  @media print { body { padding: 20px; } .no-print { display: none; } }
</style>
</head>
<body>
  <div class="header">
    <h1>${tontine.name}</h1>
    <div class="subtitle">Recapitulatif de la caisse</div>
    <div class="date">Reunion du ${formatDate(periodDate)}</div>
  </div>

  <div class="payout-highlight">
    <div class="label">Montant verse a ${recipientProfile?.first_name || ''} ${recipientProfile?.last_name || ''}</div>
    <div class="amount">${formatCurrency(payoutAmount)}</div>
    ${contribCategories.map((c) => {
      const catTotal = contributions
        .filter((con) => con.category_id === c.id && con.period_date === periodDate)
        .reduce((sum, con) => sum + Number(con.amount), 0);
      return `<div class="breakdown-line"><span>${c.name}</span><span>${formatCurrency(catTotal)}</span></div>`;
    }).join('')}
    <div class="breakdown-total"><span>Total</span><span>${formatCurrency(payoutAmount)}</span></div>
    <div class="recipient">Beneficiaire du tour</div>
  </div>

  <div class="section">
    <h2>Situation de la caisse par categorie</h2>
    <table>
      <thead>
        <tr>
          <th>Categorie</th>
          <th style="text-align:right;">Disponible</th>
        </tr>
      </thead>
      <tbody>
        ${categoryAvailableRows}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Recapitulatif par membre</h2>
    <table>
      <thead>
        <tr>
          <th>Membre</th>
          ${nonContribCategories.map((c) => `<th style="text-align:right;">${c.name}</th>`).join('')}
          <th style="text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${memberRows}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Retraits de la periode</h2>
    <table>
      <thead>
        <tr>
          <th>Categorie</th>
          <th>Membre</th>
          <th>Motif</th>
          <th style="text-align:right">Montant</th>
        </tr>
      </thead>
      <tbody>
        ${withdrawalRows}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Amendes de la periode</h2>
    <table>
      <thead>
        <tr>
          <th>Membre</th>
          <th>Motif</th>
          <th>Categorie</th>
          <th style="text-align:right">Montant</th>
        </tr>
      </thead>
      <tbody>
        ${fineRows}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Interets verses pour cette periode</h2>
    <table>
      <thead>
        <tr>
          <th>Emprunteur</th>
          <th>Categorie</th>
          <th style="text-align:right">Montant</th>
        </tr>
      </thead>
      <tbody>
        ${interestRows}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Prets en cours</h2>
    <table>
      <thead>
        <tr>
          <th>Emprunteur</th>
          <th style="text-align:right">Montant</th>
          <th style="text-align:right">Restant</th>
          <th style="text-align:center">Duree</th>
          <th style="text-align:center">Taux</th>
        </tr>
      </thead>
      <tbody>
        ${loanRows}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Historique des versements</h2>
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Beneficiaire</th>
          <th style="text-align:right">Montant verse</th>
        </tr>
      </thead>
      <tbody>
        ${payoutRows}
      </tbody>
    </table>
  </div>

  <div class="footer">
    Document genere le ${new Date().toLocaleString('fr-FR')} - TontineApp
  </div>

  <div class="no-print" style="text-align:center;margin-top:20px;">
    <button onclick="window.print()" style="padding:10px 24px;background:#10b981;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">Imprimer / Enregistrer en PDF</button>
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);
  const printWindow = window.open(blobUrl, '_blank');
  if (printWindow) {
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.focus();
        printWindow.print();
      }, 300);
    };
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
  } else {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `recapitulatif-${formatDate(periodDate)}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
  }
}
