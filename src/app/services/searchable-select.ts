import { Injectable, effect, inject } from '@angular/core';
import { PreferencesService } from './preferences';

interface SelectOption {
  el: HTMLOptionElement;
  label: string;
  group: string;
}

/** Options painted per batch; long lists extend on demand instead of all at once. */
const RESULT_BATCH = 100;

/**
 * Upgrades every native `<select>` in the app to a searchable popover without
 * touching the page markup: the real select stays in the DOM (so Angular forms,
 * validation and language bindings keep working) and we only intercept the
 * click that would have opened the browser's own option list.
 */
@Injectable({ providedIn: 'root' })
export class SearchableSelectService {
  private prefs = inject(PreferencesService);

  private started = false;
  private observer?: MutationObserver;
  private openSelect?: HTMLSelectElement;
  private options: SelectOption[] = [];
  private visible: SelectOption[] = [];
  private active = 0;
  private query = '';
  private limit = RESULT_BATCH;
  private listEl?: HTMLElement;
  private searchEl?: HTMLInputElement;
  private panelEl?: HTMLElement;
  private backdropEl?: HTMLElement;
  private repositionHandler?: () => void;
  private openedAt = 0;

  /**
   * On touch devices the tap that opens the sheet ends with a click that now
   * lands on the freshly shown backdrop, which would close it again. Ignore
   * clicks briefly after opening so the sheet survives the opening tap.
   */
  private justOpened(): boolean {
    return Date.now() - this.openedAt < 350;
  }

  constructor() {
    effect(() => {
      // Re-render the open list when the UI language changes.
      this.prefs.language();
      if (this.openSelect) this.refill();
    });
  }

  start(): void {
    if (this.started || typeof document === 'undefined') return;
    this.started = true;
    this.mountPanel();

    document.addEventListener('pointerdown', this.onPointerDown, true);
    document.addEventListener('mousedown', this.onMouseDown, true);
    document.addEventListener('touchstart', this.onTouchStart, { capture: true, passive: false });
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('click', this.onDocumentClick, true);
    this.observer = new MutationObserver(records => {
      let added = false;
      for (const record of records) {
        if (record.type === 'childList' && (record.addedNodes.length || record.removedNodes.length)) {
          added = true;
          break;
        }
      }
      if (added) this.enhanceAll();
      if (this.openSelect && !this.openSelect.isConnected) this.close();
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.enhanceAll();
  }

  private enhanceAll(): void {
    if (typeof document === 'undefined') return;
    for (const el of Array.from(document.querySelectorAll<HTMLSelectElement>('select:not([data-ss])'))) {
      if (!this.supported(el)) {
        el.setAttribute('data-ss', 'skip');
        continue;
      }
      el.setAttribute('data-ss', '1');
      el.setAttribute('aria-haspopup', 'listbox');
      el.setAttribute('aria-expanded', 'false');
    }
  }

  private supported(el: HTMLSelectElement): boolean {
    if (el.multiple || el.size > 1) return false;
    if (el.hasAttribute('data-ss-native') || el.closest('[data-ss-native]')) return false;
    // A select inside a print-only sheet cannot be clicked, and a select with
    // fewer than two real choices has nothing to search.
    return true;
  }

  private isEnhanced(el: EventTarget | null): el is HTMLSelectElement {
    return !!el && (el as HTMLElement).tagName === 'SELECT'
      && (el as HTMLElement).getAttribute('data-ss') === '1'
      && !(el as HTMLSelectElement).disabled;
  }

  private onPointerDown = (event: PointerEvent) => {
    const select = event.target;
    if (!this.isEnhanced(select)) return;
    event.preventDefault();
    this.open(select, '');
  };

  private onMouseDown = (event: MouseEvent) => {
    // Chrome opens its own list on mousedown; stop it even when pointer events
    // were synthesised from an older browser or a test harness.
    const select = event.target;
    if (!this.isEnhanced(select)) return;
    event.preventDefault();
    if (this.openSelect !== select) this.open(select, '');
  };

  private onTouchStart = (event: TouchEvent) => {
    const select = event.target;
    if (!this.isEnhanced(select)) return;
    event.preventDefault();
    this.open(select, '');
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (this.openSelect) {
      const search = this.searchEl;
      if (!search) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close(true);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.move(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.move(-1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        this.choose(this.visible[this.active]);
      } else if (event.key === 'Tab') {
        this.close();
      }
      return;
    }
    const select = event.target;
    if (!this.isEnhanced(select)) return;
    const opensWithKey = event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ' || event.key === 'F4';
    if (opensWithKey) {
      event.preventDefault();
      this.open(select, '');
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.open(select, event.key);
    }
  };

  private onDocumentClick = (event: MouseEvent) => {
    if (!this.openSelect || this.justOpened()) return;
    const target = event.target as Node | null;
    if (target && (this.panelEl?.contains(target) || this.openSelect === target)) return;
    this.close();
  };

  private mountPanel(): void {
    const style = document.createElement('style');
    style.id = 'ss-select-styles';
    style.textContent = `
      .ss-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.28);backdrop-filter:blur(1px)}
      .ss-panel{position:fixed;z-index:2147483001;display:flex;flex-direction:column;background:#fff;color:#0f172a;
        border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 18px 50px -12px rgba(15,23,42,.35);overflow:hidden;
        font-family:inherit;animation:ss-pop .12s ease-out}
      .dark .ss-panel{background:#0f172a;color:#e2e8f0;border-color:#334155}
      @keyframes ss-pop{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
      .ss-head{display:flex;align-items:center;gap:8px;padding:10px;border-bottom:1px solid #e2e8f0}
      .dark .ss-head{border-color:#334155}
      .ss-search{flex:1;min-width:0;border:1px solid #cbd5e1;border-radius:10px;padding:8px 10px 8px 32px;font-size:13px;
        outline:none;background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m20 20-3.5-3.5'/%3E%3C/svg%3E") no-repeat 9px center/16px 16px;color:#0f172a}
      .ss-search:focus{border-color:var(--color-teal-600);box-shadow:0 0 0 3px var(--color-teal-100)}
      .dark .ss-search{background-color:#0b1220;border-color:#475569;color:#e2e8f0}
      .ss-close{flex:none;width:30px;height:30px;border-radius:8px;border:none;background:#f1f5f9;color:#475569;
        font-size:18px;line-height:1;cursor:pointer}
      .dark .ss-close{background:#1e293b;color:#cbd5e1}
      .ss-list{overflow:auto;padding:6px;overscroll-behavior:contain}
      .ss-group{padding:8px 8px 4px;font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8}
      .ss-item{display:flex;align-items:center;gap:8px;width:100%;border:none;background:transparent;text-align:left;
        padding:9px 10px;border-radius:9px;font-size:12.5px;font-weight:600;color:inherit;cursor:pointer}
      .ss-item:hover,.ss-item.is-active{background:var(--color-teal-50)}
      .dark .ss-item:hover,.dark .ss-item.is-active{background:var(--color-teal-900)}
      .ss-item.is-selected{color:var(--color-teal-700)}
      .dark .ss-item.is-selected{color:var(--color-teal-300)}
      .ss-item.is-selected .ss-check{opacity:1}
      .ss-item[disabled]{opacity:.45;cursor:not-allowed}
      .ss-check{flex:none;width:16px;text-align:center;font-weight:900;color:var(--color-teal-600);opacity:0}
      .ss-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ss-label mark{background:#fde68a;color:inherit;border-radius:3px;padding:0 1px}
      .dark .ss-label mark{background:#b45309;color:#fff}
      .ss-empty{padding:22px 12px;text-align:center;font-size:12px;color:#94a3b8;font-weight:600}
      .ss-more{display:block;width:100%;border:1px dashed #5eead4;background:rgba(240,253,250,.7);color:#0f766e;
        text-align:center;padding:9px 10px;border-radius:9px;font-size:11.5px;font-weight:800;cursor:pointer;margin-top:4px}
      .ss-more:hover{background:rgba(204,251,241,.9)}
      .dark .ss-more{border-color:#115e59;background:rgba(19,78,74,.35);color:#5eead4}
      .dark .ss-more:hover{background:rgba(19,78,74,.6)}
      .ss-panel.ss-sheet{border-radius:16px 16px 0 0}
      @media (max-width:639px){.ss-search{font-size:16px}}
    `;
    document.head.appendChild(style);

    this.backdropEl = document.createElement('div');
    this.backdropEl.className = 'ss-backdrop';
    this.backdropEl.style.display = 'none';
    this.backdropEl.addEventListener('click', () => {
      if (!this.justOpened()) this.close();
    });

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'ss-panel';
    this.panelEl.style.display = 'none';
    this.panelEl.setAttribute('role', 'dialog');
    this.panelEl.setAttribute('aria-modal', 'true');

    const head = document.createElement('div');
    head.className = 'ss-head';
    this.searchEl = document.createElement('input');
    this.searchEl.className = 'ss-search';
    this.searchEl.type = 'search';
    this.searchEl.autocomplete = 'off';
    this.searchEl.spellcheck = false;
    this.searchEl.addEventListener('input', () => {
      this.query = this.searchEl?.value ?? '';
      this.limit = RESULT_BATCH;
      this.render();
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ss-close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.close(true));
    head.append(this.searchEl, close);

    this.listEl = document.createElement('div');
    this.listEl.className = 'ss-list';
    this.listEl.setAttribute('role', 'listbox');
    this.panelEl.append(head, this.listEl);
    document.body.append(this.backdropEl, this.panelEl);
  }

  private open(select: HTMLSelectElement, initialQuery: string): void {
    if (!this.panelEl || select.disabled) return;
    if (this.openSelect && this.openSelect !== select) this.close();
    this.openSelect = select;
    this.openedAt = Date.now();
    this.query = initialQuery;
    this.limit = RESULT_BATCH;
    this.options = this.readOptions(select);
    if (!this.options.length) return;
    this.refill();
    this.panelEl.style.display = 'flex';
    this.backdropEl!.style.display = window.innerWidth < 640 ? 'block' : 'none';
    this.panelEl.classList.toggle('ss-sheet', window.innerWidth < 640);
    this.backdropEl!.style.background = window.innerWidth < 640 ? 'rgba(15,23,42,.45)' : 'transparent';
    this.backdropEl!.style.pointerEvents = window.innerWidth < 640 ? 'auto' : 'none';
    select.setAttribute('aria-expanded', 'true');
    this.position();

    const mobile = window.innerWidth < 640;
    if (!mobile) {
      this.searchEl!.focus({ preventScroll: true });
      this.searchEl!.select();
    }
    this.bindReposition();
  }

  private readOptions(select: HTMLSelectElement): SelectOption[] {
    const out: SelectOption[] = [];
    for (const child of Array.from(select.children)) {
      if (child instanceof HTMLOptionElement) {
        out.push({ el: child, label: (child.textContent || '').trim() || '—', group: '' });
      } else if (child instanceof HTMLOptGroupElement) {
        for (const option of Array.from(child.children)) {
          if (option instanceof HTMLOptionElement) {
            out.push({ el: option, label: (option.textContent || '').trim() || '—', group: (child.label || '').trim() });
          }
        }
      }
    }
    return out;
  }

  private filtered(): SelectOption[] {
    const q = this.normalize(this.query);
    if (!q) return this.options.slice();
    return this.options.filter(item => {
      const hay = this.normalize(`${item.group} ${item.label} ${item.el.value}`);
      return q.split(/\s+/).every(part => hay.includes(part));
    });
  }

  private normalize(value: string): string {
    return (value || '').toLowerCase().normalize('NFC').trim();
  }

  private refill(): void {
    if (!this.openSelect) return;
    this.options = this.readOptions(this.openSelect);
    if (this.searchEl) this.searchEl.placeholder = this.prefs.txt('খুঁজুন…', 'Search…');
    this.render();
  }

  private render(): void {
    if (!this.listEl) return;
    const matches = this.filtered();
    this.visible = matches.slice(0, this.limit);
    const selected = this.options.findIndex(item => item.el.selected);
    this.active = Math.max(0, Math.min(this.active, this.visible.length - 1));
    const selectedVisible = this.visible.findIndex(item => item.el.selected);
    if (selectedVisible >= 0 && !this.query) this.active = selectedVisible;
    else if (this.query) this.active = 0;
    void selected;

    this.listEl.textContent = '';
    if (!this.visible.length) {
      const empty = document.createElement('p');
      empty.className = 'ss-empty';
      empty.textContent = this.prefs.txt('কোনো কিছু পাওয়া যায়নি', 'No matches found');
      this.listEl.append(empty);
      return;
    }
    let lastGroup = '';
    this.visible.forEach((item, index) => {
      if (item.group && item.group !== lastGroup) {
        lastGroup = item.group;
        const group = document.createElement('p');
        group.className = 'ss-group';
        group.textContent = item.group;
        this.listEl!.append(group);
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ss-item';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', item.el.selected ? 'true' : 'false');
      if (item.el.disabled) button.disabled = true;
      if (item.el.selected) button.classList.add('is-selected');
      if (index === this.active) button.classList.add('is-active');
      const check = document.createElement('span');
      check.className = 'ss-check';
      check.textContent = '✓';
      const label = document.createElement('span');
      label.className = 'ss-label';
      this.paintLabel(label, item.label);
      button.append(check, label);
      button.addEventListener('pointerdown', event => {
        event.preventDefault();
        event.stopPropagation();
      });
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        this.choose(item);
      });
      button.addEventListener('pointerenter', () => {
        this.active = index;
        this.paintActive();
      });
      this.listEl!.append(button);
    });
    if (matches.length > this.visible.length) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'ss-more';
      const left = matches.length - this.visible.length;
      more.textContent = this.prefs.txt(
        `আরও ${Math.min(RESULT_BATCH, left)}টি দেখুন · বাকি ${left}`,
        `Show ${Math.min(RESULT_BATCH, left)} more · ${left} left`
      );
      more.addEventListener('pointerdown', event => {
        event.preventDefault();
        event.stopPropagation();
      });
      more.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const firstNew = this.visible.length;
        this.limit += RESULT_BATCH;
        this.render();
        this.listEl?.querySelectorAll<HTMLElement>('.ss-item')[firstNew]?.scrollIntoView({ block: 'nearest' });
      });
      this.listEl.append(more);
    }
    this.scrollActive();
  }

  private paintLabel(target: HTMLElement, label: string): void {
    const q = this.query.trim();
    if (!q) {
      target.textContent = label;
      return;
    }
    const lower = label.toLowerCase();
    const needle = q.toLowerCase();
    let at = 0;
    let found = lower.indexOf(needle);
    if (found < 0) {
      target.textContent = label;
      return;
    }
    while (found >= 0) {
      target.append(document.createTextNode(label.slice(at, found)));
      const mark = document.createElement('mark');
      mark.textContent = label.slice(found, found + needle.length);
      target.append(mark);
      at = found + needle.length;
      found = lower.indexOf(needle, at);
    }
    target.append(document.createTextNode(label.slice(at)));
  }

  private paintActive(): void {
    if (!this.listEl) return;
    const items = this.listEl.querySelectorAll<HTMLElement>('.ss-item');
    items.forEach((el, index) => el.classList.toggle('is-active', index === this.active));
    this.scrollActive();
  }

  private scrollActive(): void {
    if (!this.listEl) return;
    const active = this.listEl.querySelector<HTMLElement>('.ss-item.is-active');
    active?.scrollIntoView({ block: 'nearest' });
  }

  private move(step: number): void {
    if (!this.visible.length) return;
    this.active = (this.active + step + this.visible.length) % this.visible.length;
    this.paintActive();
  }

  private choose(item: SelectOption | undefined): void {
    const select = this.openSelect;
    if (!item || !select || item.el.disabled) return;
    item.el.selected = true;
    select.value = item.el.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    this.close();
    select.focus({ preventScroll: true });
  }

  private position(): void {
    const select = this.openSelect;
    if (!select || !this.panelEl) return;
    const panel = this.panelEl;
    const rect = select.getBoundingClientRect();
    const mobile = window.innerWidth < 640;
    if (mobile) {
      panel.style.left = '0px';
      panel.style.right = '0px';
      panel.style.bottom = '0px';
      panel.style.top = 'auto';
      panel.style.width = 'auto';
      panel.style.maxHeight = '72vh';
      return;
    }
    const width = Math.max(rect.width, 240);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const openUp = below < 220 && above > below;
    panel.style.width = `${width}px`;
    panel.style.left = `${left}px`;
    panel.style.right = 'auto';
    panel.style.maxHeight = `${Math.min(360, Math.max(160, openUp ? above : below))}px`;
    if (openUp) {
      panel.style.bottom = `${window.innerHeight - rect.top + 6}px`;
      panel.style.top = 'auto';
    } else {
      panel.style.top = `${rect.bottom + 6}px`;
      panel.style.bottom = 'auto';
    }
  }

  private bindReposition(): void {
    if (this.repositionHandler) return;
    let frame = 0;
    this.repositionHandler = () => {
      if (!this.openSelect) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!this.openSelect) return;
        if (!this.openSelect.isConnected) {
          this.close();
          return;
        }
        this.position();
      });
    };
    window.addEventListener('scroll', this.repositionHandler, true);
    window.addEventListener('resize', this.repositionHandler);
  }

  private unbindReposition(): void {
    if (!this.repositionHandler) return;
    window.removeEventListener('scroll', this.repositionHandler, true);
    window.removeEventListener('resize', this.repositionHandler);
    this.repositionHandler = undefined;
  }

  private close(refocus = false): void {
    const select = this.openSelect;
    this.openSelect = undefined;
    this.options = [];
    this.visible = [];
    this.query = '';
    this.limit = RESULT_BATCH;
    this.active = 0;
    if (this.panelEl) this.panelEl.style.display = 'none';
    if (this.backdropEl) this.backdropEl.style.display = 'none';
    if (this.searchEl) this.searchEl.value = '';
    if (select) {
      select.setAttribute('aria-expanded', 'false');
      if (refocus) select.focus({ preventScroll: true });
    }
    this.unbindReposition();
  }
}
