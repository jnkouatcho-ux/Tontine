import type { PeriodicityDetail } from '../types/database';

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount) + ' FCFA';
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(date));
}

export function formatDateShort(date: string | Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(date));
}

const DAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

export function getDayName(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek] || '';
}

export function getPeriodicityLabel(type: string, detail: PeriodicityDetail): string {
  if (type === 'monthly') {
    const d = detail as { weekNumber: number };
    const weekLabels: Record<number, string> = {
      1: '1er',
      2: '2eme',
      3: '3eme',
      4: '4eme',
      5: 'dernier',
    };
    return `Chaque ${weekLabels[d.weekNumber] || ''} dimanche du mois`;
  }
  if (type === 'weekly') {
    const d = detail as { dayOfWeek: number };
    return `Chaque ${getDayName(d.dayOfWeek)}`;
  }
  if (type === 'biweekly') {
    const d = detail as { dayOfWeek: number };
    return `Toutes les 2 semaines, ${getDayName(d.dayOfWeek)}`;
  }
  return '';
}

export function generateScheduleDates(
  startDate: string,
  endDate: string,
  periodicityType: string,
  periodicityDetail: PeriodicityDetail
): string[] {
  const dates: string[] = [];
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');

  if (periodicityType === 'monthly') {
    const d = periodicityDetail as { weekNumber: number };
    const current = new Date(start.getFullYear(), start.getMonth(), 1);
    while (current <= end) {
      const nthSunday = getNthSundayOfMonth(current.getFullYear(), current.getMonth(), d.weekNumber);
      if (nthSunday && nthSunday >= start && nthSunday <= end) {
        dates.push(toLocalDateStr(nthSunday));
      }
      current.setMonth(current.getMonth() + 1);
    }
  } else if (periodicityType === 'weekly') {
    const d = periodicityDetail as { dayOfWeek: number };
    const current = new Date(start);
    while (current.getDay() !== d.dayOfWeek) {
      current.setDate(current.getDate() + 1);
    }
    while (current <= end) {
      dates.push(toLocalDateStr(current));
      current.setDate(current.getDate() + 7);
    }
  } else if (periodicityType === 'biweekly') {
    const d = periodicityDetail as { dayOfWeek: number };
    const current = new Date(start);
    while (current.getDay() !== d.dayOfWeek) {
      current.setDate(current.getDate() + 1);
    }
    while (current <= end) {
      dates.push(toLocalDateStr(current));
      current.setDate(current.getDate() + 14);
    }
  }

  return dates;
}

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getNthSundayOfMonth(year: number, month: number, weekNumber: number): Date | null {
  const firstDay = new Date(year, month, 1);
  const firstDayOfWeek = firstDay.getDay();
  const firstSunday = 1 + ((7 - firstDayOfWeek) % 7);

  if (weekNumber === 5) {
    // Last sunday of the month
    const lastDay = new Date(year, month + 1, 0).getDate();
    const lastDayDate = new Date(year, month, lastDay);
    const lastDayOfWeek = lastDayDate.getDay();
    // Days back to the most recent Sunday (0=Sun). If last day IS Sunday, offset=0.
    const offset = lastDayOfWeek % 7;
    const lastSunday = lastDay - offset;
    return new Date(year, month, lastSunday);
  }

  const targetSunday = firstSunday + (weekNumber - 1) * 7;
  const lastDay = new Date(year, month + 1, 0).getDate();
  if (targetSunday > lastDay) return null;
  return new Date(year, month, targetSunday);
}

export function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}
