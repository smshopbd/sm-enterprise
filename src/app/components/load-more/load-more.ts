import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, input, output, signal } from '@angular/core';
import { PreferencesService } from '../../services/preferences';

/** Emits `load` as soon as it scrolls into view (nearest scroll container or the viewport), so long lists fill in chunks. */
@Component({
  selector: 'app-load-more',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (remaining() > 0) {
      <button
        type="button"
        (click)="trigger()"
        class="w-full rounded-xl border-2 border-dashed border-teal-300 bg-white/70 py-2.5 text-[11px] font-black uppercase tracking-wide text-teal-700 transition-colors hover:bg-teal-50 active:bg-teal-100 dark:border-teal-800 dark:bg-slate-900/70 dark:text-teal-300 dark:hover:bg-teal-950/50"
      >
        {{ label() || prefs.txt('আরও দেখুন', 'Load more') }} ({{ remaining() }})
      </button>
    }
  `,
})
export class LoadMore implements AfterViewInit {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly prefs = inject(PreferencesService);

  readonly remaining = input<number>(0);
  readonly label = input<string>('');
  readonly load = output<void>();

  private readonly busy = signal(false);
  private observer?: IntersectionObserver;
  private release?: number;

  ngAfterViewInit() {
    this.observe();
    this.destroyRef.onDestroy(() => {
      this.observer?.disconnect();
      if (this.release) window.clearTimeout(this.release);
    });
  }

  protected trigger() {
    if (this.busy() || this.remaining() <= 0) return;
    this.busy.set(true);
    this.load.emit();
    this.release = window.setTimeout(() => this.busy.set(false), 200);
  }

  private observe() {
    if (typeof IntersectionObserver === 'undefined') return;
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) this.trigger();
      },
      { root: this.findScrollParent(), rootMargin: '240px 0px' },
    );
    this.observer.observe(this.host.nativeElement);
  }

  private findScrollParent(): Element | null {
    let el = this.host.nativeElement.parentElement;
    while (el && el !== document.body) {
      const style = getComputedStyle(el);
      if (/(auto|scroll|overlay)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) return el;
      el = el.parentElement;
    }
    return null;
  }
}
