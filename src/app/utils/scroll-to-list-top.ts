const SCROLLABLE_Y = /auto|scroll/;

/** ":scope" is not available on every engine this app runs in, so the children are scanned. */
function hasGridChild(el: Element): boolean {
  return Array.from(el.children).some(child => child.classList.contains('grid'));
}

function verticalScroller(el: Element | null): HTMLElement | null {
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    if (node instanceof HTMLElement && SCROLLABLE_Y.test(getComputedStyle(node).overflowY) &&
        node.scrollHeight > node.clientHeight + 4) {
      return node;
    }
    node = node.parentElement;
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
}

/**
 * Called after a page change so the first rows of the new page are on screen instead of
 * the scroll position left over from the previous page.
 */
export function scrollToListTop(fromEl: Element | null): void {
  if (!fromEl) return;

  let card: Element | null = fromEl.parentElement;
  while (card && !card.matches('main') && !card.querySelector('table') && !hasGridChild(card)) {
    card = card.parentElement;
  }

  const target = card ?? fromEl;
  const scroller = verticalScroller(target);
  if (!scroller) return;

  if (target === scroller) {
    scroller.scrollTop = 0;
    return;
  }

  const pageLevel = scroller === document.scrollingElement;
  const scrollerTop = pageLevel ? 0 : scroller.getBoundingClientRect().top;
  const currentTop = pageLevel ? window.scrollY : scroller.scrollTop;
  scroller.scrollTop = Math.max(0, currentTop + target.getBoundingClientRect().top - scrollerTop - 8);
}

/**
 * The new page is only laid out after change detection, so measuring in the click handler
 * would use the previous page's heights.
 */
export function scrollToListTopAfterRender(fromEl: Element | null): void {
  setTimeout(() => scrollToListTop(fromEl), 0);
}
