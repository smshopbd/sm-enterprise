import { moveItemInArray } from '@angular/cdk/drag-drop';

/**
 * Applies a drag from one rendered row to another while rows hidden by search,
 * filter or paging keep their original slots.
 */
export function reorderInView<T>(
  master: T[],
  view: T[],
  previousIndex: number,
  currentIndex: number,
  idOf: (item: T) => number | string
): T[] {
  if (previousIndex === currentIndex || previousIndex < 0 || currentIndex >= view.length) return master;
  const slots = view.map(item => master.findIndex(row => idOf(row) === idOf(item)));
  if (slots.some(index => index < 0)) return master;

  const moved = [...view];
  moveItemInArray(moved, previousIndex, currentIndex);

  const next = [...master];
  slots.forEach((masterIndex, viewIndex) => { next[masterIndex] = moved[viewIndex]; });
  return next;
}
