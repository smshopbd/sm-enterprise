const SEPARATOR = '|';

export function parseVariationValues(raw: string | null | undefined): string[] {
  const text = (raw || '').trim();
  if (!text) return [];

  // Legacy rows store values as whitespace-separated tokens; new rows use "|"
  // so a single value can contain spaces.
  const parts = text.includes(SEPARATOR) ? text.split(SEPARATOR) : text.split(/\s+/);
  return parts.map(v => v.trim()).filter(Boolean);
}

export function serializeVariationValues(values: string[]): string {
  return values
    .map(v => v.replace(/\|/g, '/').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(SEPARATOR);
}

export function formatVariationValues(raw: string | null | undefined): string {
  return parseVariationValues(raw).join(', ');
}
