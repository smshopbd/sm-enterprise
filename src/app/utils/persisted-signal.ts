import { WritableSignal, signal } from '@angular/core';

function readStored<T>(key: string, fallback: T, normalize?: (value: unknown) => T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    return normalize ? normalize(parsed) : (parsed as T);
  } catch {
    return fallback;
  }
}

function persist(key: string, value: unknown): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota / private mode — the setting simply starts from its default next time
  }
}

/**
 * Page-level UI choices (view mode, page size, …) normally live in memory only, so a
 * refresh forgets them. This keeps the latest value in localStorage and restores it
 * on the next visit. `normalize` guards against stale or hand-edited stored values.
 */
export function persistedSignal<T>(key: string, initial: T, normalize?: (value: unknown) => T): WritableSignal<T> {
  const state = signal<T>(readStored(key, initial, normalize));
  const write = state.set.bind(state);
  const update = state.update.bind(state);

  state.set = (value: T) => {
    write(value);
    persist(key, value);
  };
  state.update = (fn: (value: T) => T) => {
    update(fn);
    persist(key, state());
  };

  return state;
}
