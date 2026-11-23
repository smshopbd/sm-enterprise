import { localDateIso } from './local-date';

export type DateRangeKind = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom';

export interface DateRange {
  from: string;
  to: string;
}

export interface DateRangePreset {
  kind: Exclude<DateRangeKind, 'custom'>;
  bn: string;
  en: string;
}

/** Presets shared by every list page so the same words mean the same range (week starts Saturday). */
export const DATE_RANGE_PRESETS: DateRangePreset[] = [
  { kind: 'today', bn: 'আজ', en: 'Today' },
  { kind: 'week', bn: 'এই সপ্তাহ', en: 'This week' },
  { kind: 'month', bn: 'এই মাস', en: 'This month' },
  { kind: 'year', bn: 'এই বছর', en: 'This year' },
  { kind: 'all', bn: 'সব সময়', en: 'All time' }
];

/** Stored dates are dd-mm-yyyy, dd/mm/yyyy or ISO; every comparison runs on yyyy-mm-dd. */
export function toIsoDate(value: string | null | undefined): string {
  const text = (value || '').trim();
  if (!text) return '';

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(text);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${dmy[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return '';
  }

  const stamp = Date.parse(text);
  return Number.isNaN(stamp) ? '' : localDateIso(new Date(stamp));
}

export function inDateRange(value: string | null | undefined, from: string, to: string): boolean {
  if (!from && !to) return true;
  const iso = toIsoDate(value);
  if (!iso) return false;
  return (!from || iso >= from) && (!to || iso <= to);
}

export function resolveDateRange(kind: DateRangeKind, today: string = localDateIso()): DateRange {
  if (kind === 'all') return { from: '', to: '' };
  if (kind === 'today') return { from: today, to: today };

  const [year, month, day] = today.split('-').map(Number);

  if (kind === 'week') {
    const start = new Date(year, month - 1, day);
    // Bangladesh weeks run Saturday → Friday.
    start.setDate(start.getDate() - ((start.getDay() + 1) % 7));
    return { from: localDateIso(start), to: today };
  }

  if (kind === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };

  return { from: `${today.slice(0, 4)}-01-01`, to: today };
}

export function activeDateRangeKind(from: string, to: string, today: string = localDateIso()): DateRangeKind {
  for (const preset of DATE_RANGE_PRESETS) {
    const range = resolveDateRange(preset.kind, today);
    if (range.from === from && range.to === to) return preset.kind;
  }
  return 'custom';
}

/** Equal-length window immediately before `from` (used for trend comparisons). */
export function previousDateRange(from: string, to: string): DateRange {
  if (!from || !to) return { from: '', to: '' };
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { from: '', to: '' };

  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const previousEnd = new Date(start);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - (days - 1));
  return { from: localDateIso(previousStart), to: localDateIso(previousEnd) };
}

export function rangeDayCount(from: string, to: string): number {
  if (!from || !to) return 0;
  const start = Date.parse(`${from}T00:00:00`);
  const end = Date.parse(`${to}T00:00:00`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}
