import { Injectable, signal } from '@angular/core';

export type NotifyKind = 'success' | 'error' | 'warning' | 'info';
export type DialogKind = 'alert' | 'confirm' | 'prompt';

export interface ToastItem {
  id: number;
  message: string;
  title?: string;
  kind: NotifyKind;
  duration: number;
}

export interface NotifyOptions {
  title?: string;
  kind?: NotifyKind;
  confirmText?: string;
  cancelText?: string;
}

export interface PromptOptions extends NotifyOptions {
  inputLabel?: string;
  placeholder?: string;
}

export interface DialogState {
  id: number;
  kind: DialogKind;
  tone: NotifyKind;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  inputLabel?: string;
  placeholder?: string;
  resolve: (value: unknown) => void;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  readonly toasts = signal<ToastItem[]>([]);
  readonly dialog = signal<DialogState | null>(null);
  readonly dialogInput = signal('');

  private seq = 0;
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  toast(message: string, kind: NotifyKind = 'success', options: { title?: string; duration?: number } = {}) {
    const id = ++this.seq;
    const duration = options.duration ?? (kind === 'error' || kind === 'warning' ? 4600 : 3400);
    const item: ToastItem = { id, message, kind, duration, title: options.title };
    this.toasts.update(items => [...items.slice(-3), item]);
    const timer = setTimeout(() => this.dismiss(id), duration);
    this.timers.set(id, timer);
    return id;
  }

  success(message: string, title?: string) {
    return this.toast(message, 'success', { title });
  }

  error(message: string, title?: string) {
    return this.toast(message, 'error', { title });
  }

  warning(message: string, title?: string) {
    return this.toast(message, 'warning', { title });
  }

  info(message: string, title?: string) {
    return this.toast(message, 'info', { title });
  }

  dismiss(id: number) {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.toasts.update(items => items.filter(item => item.id !== id));
  }

  alert(message: string, options: NotifyOptions = {}): Promise<void> {
    return new Promise<void>(resolve => {
      this.open({
        kind: 'alert',
        tone: options.kind ?? 'info',
        title: options.title ?? 'Notice',
        message,
        confirmText: options.confirmText ?? 'OK',
        cancelText: '',
        resolve: () => resolve()
      });
    });
  }

  confirm(message: string, options: NotifyOptions = {}): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      this.open({
        kind: 'confirm',
        tone: options.kind ?? 'warning',
        title: options.title ?? 'Are you sure?',
        message,
        confirmText: options.confirmText ?? 'Confirm',
        cancelText: options.cancelText ?? 'Cancel',
        resolve: value => resolve(value === true)
      });
    });
  }

  prompt(message: string, value = '', options: PromptOptions = {}): Promise<string | null> {
    return new Promise<string | null>(resolve => {
      this.dialogInput.set(value);
      this.open({
        kind: 'prompt',
        tone: options.kind ?? 'info',
        title: options.title ?? 'Enter value',
        message,
        confirmText: options.confirmText ?? 'Save',
        cancelText: options.cancelText ?? 'Cancel',
        inputLabel: options.inputLabel,
        placeholder: options.placeholder,
        resolve: result => resolve(typeof result === 'string' ? result.trim() : null)
      });
    });
  }

  close(result: unknown = false) {
    const current = this.dialog();
    if (!current) return;
    this.dialog.set(null);
    current.resolve(result);
  }

  private open(state: Omit<DialogState, 'id'>) {
    const previous = this.dialog();
    if (previous) {
      this.dialog.set(null);
      previous.resolve(previous.kind === 'confirm' ? false : previous.kind === 'prompt' ? null : undefined);
    }
    this.dialog.set({ id: ++this.seq, ...state });
  }
}
