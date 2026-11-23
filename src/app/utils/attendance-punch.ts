export type PunchKind = 'in' | 'lunchOut' | 'lunchIn' | 'out' | 'done';

export interface PunchTimes {
  timeIn: string;
  lunchOut?: string;
  lunchIn?: string;
  timeOut: string;
}

/** A day is punched in order; a scan fills the first empty slot. */
export function nextPunch(record?: PunchTimes | null): PunchKind {
  if (!record || !record.timeIn) return 'in';
  // A final out closes the day even on rows saved before lunch punch fields existed.
  if (record.timeOut) return 'done';
  if (!record.lunchOut) return 'lunchOut';
  if (!record.lunchIn) return 'lunchIn';
  return 'out';
}

export function punchField(kind: PunchKind): 'timeIn' | 'lunchOut' | 'lunchIn' | 'timeOut' | null {
  if (kind === 'in') return 'timeIn';
  if (kind === 'out') return 'timeOut';
  return kind === 'done' ? null : kind;
}
