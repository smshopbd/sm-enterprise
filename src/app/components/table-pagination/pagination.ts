import { Signal, WritableSignal, computed, signal } from '@angular/core';
import { persistedSignal } from '../../utils/persisted-signal';

export const PAGE_SIZE_OPTIONS = [10, 25, 40, 50, 100, 250, 500, 1000];
export const DEFAULT_PAGE_SIZE = 40;
const PAGE_SIZE_KEY = 'sm_page_size_v1';

/* One preference shared by every table, read once from cache so each list opens
   with the row count the user last chose. */
const sharedPageSize = persistedSignal<number>(PAGE_SIZE_KEY, DEFAULT_PAGE_SIZE, value => normalizePageSize(Number(value)));

export interface Pager<T> {
  page: WritableSignal<number>;
  pageSize: WritableSignal<number>;
  total: Signal<number>;
  totalPages: Signal<number>;
  currentPage: Signal<number>;
  offset: Signal<number>;
  paged: Signal<T[]>;
  from: Signal<number>;
  to: Signal<number>;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
}

export function createPager<T>(source: () => T[]): Pager<T> {
  const page = signal(1);
  const pageSize = sharedPageSize;

  const total = computed(() => source().length);
  const totalPages = computed(() => Math.max(1, Math.ceil(total() / pageSize())));
  const currentPage = computed(() => Math.min(Math.max(1, page()), totalPages()));
  const offset = computed(() => (currentPage() - 1) * pageSize());
  const paged = computed(() => {
    const start = offset();
    return source().slice(start, start + pageSize());
  });
  const from = computed(() => (total() === 0 ? 0 : offset() + 1));
  const to = computed(() => Math.min(offset() + pageSize(), total()));

  const setPage = (value: number) => {
    page.set(Math.min(Math.max(1, Math.floor(value) || 1), totalPages()));
  };

  const setPageSize = (value: number) => {
    pageSize.set(normalizePageSize(value));
    page.set(1);
  };

  return { page, pageSize, total, totalPages, currentPage, offset, paged, from, to, setPage, setPageSize };
}

function normalizePageSize(value: number): number {
  if (PAGE_SIZE_OPTIONS.includes(value)) return value;
  if (value > PAGE_SIZE_OPTIONS[PAGE_SIZE_OPTIONS.length - 1]) return PAGE_SIZE_OPTIONS[PAGE_SIZE_OPTIONS.length - 1];
  return DEFAULT_PAGE_SIZE;
}
