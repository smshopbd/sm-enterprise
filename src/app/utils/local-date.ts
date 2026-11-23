/**
 * The shop's own calendar day. `toISOString()` reports the UTC date, which is the previous
 * day for every local time before 06:00 in Bangladesh (UTC+6).
 */
export function localDateIso(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** '2026-11-08' → '08/11/2026' (the format every form shows). */
export function dmyFromIso(value: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** '08/11/2026' → '2026-11-08'; empty string when the text is not a valid date. */
export function isoFromDmy(text: string | null | undefined): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((text || '').trim());
  if (!m) return '';
  const d = +m[1], mo = +m[2], y = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

