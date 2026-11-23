export interface ColumnSpec {
  key: string;
  label: string;
  align: 'left' | 'right' | 'center';
  width: number;
  min: number;
  max?: number;
  hidden?: boolean;
}

export interface ColumnLayout {
  order: string[];
  widths: Record<string, number>;
  visible: Record<string, boolean>;
}

export interface ResolvedColumn extends ColumnSpec {
  width: number;
}

const MAX_WIDTH = 720;

function clampWidth(spec: ColumnSpec, width: number): number {
  const max = spec.max ?? MAX_WIDTH;
  if (!Number.isFinite(width)) return spec.width;
  return Math.min(max, Math.max(spec.min, Math.round(width)));
}

export function defaultColumnLayout(specs: ColumnSpec[]): ColumnLayout {
  const widths: Record<string, number> = {};
  const visible: Record<string, boolean> = {};
  for (const spec of specs) {
    widths[spec.key] = spec.width;
    visible[spec.key] = !spec.hidden;
  }
  return { order: specs.map(spec => spec.key), widths, visible };
}

/** Merges stored preferences with the current column set so new or renamed columns never disappear. */
export function loadColumnLayout(storageKey: string, specs: ColumnSpec[]): ColumnLayout {
  const base = defaultColumnLayout(specs);
  let saved: Partial<ColumnLayout> | null = null;

  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(storageKey);
      if (raw) saved = JSON.parse(raw) as Partial<ColumnLayout>;
    }
  } catch {
    return base;
  }
  if (!saved) return base;

  const known = new Set(specs.map(spec => spec.key));
  const ordered = (Array.isArray(saved.order) ? saved.order : []).filter(key => known.has(key));
  for (const spec of specs) {
    if (!ordered.includes(spec.key)) ordered.push(spec.key);
  }

  const widths: Record<string, number> = {};
  const visible: Record<string, boolean> = {};
  for (const spec of specs) {
    const savedWidth = saved.widths?.[spec.key];
    widths[spec.key] = clampWidth(spec, typeof savedWidth === 'number' ? savedWidth : spec.width);
    visible[spec.key] = spec.key in (saved.visible || {}) ? !!saved.visible![spec.key] : !spec.hidden;
  }

  return { order: ordered, widths, visible };
}

export function saveColumnLayout(storageKey: string, layout: ColumnLayout) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(storageKey, JSON.stringify(layout));
    }
  } catch {
    // ignore quota / private mode
  }
}

export function clampLayoutWidth(spec: ColumnSpec, width: number): number {
  return clampWidth(spec, width);
}
