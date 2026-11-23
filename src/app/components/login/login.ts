import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { SessionService } from '../../services/session';
import { PreferencesService } from '../../services/preferences';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule],
  template: `
    <div class="min-h-dvh w-full flex flex-col lg:flex-row bg-slate-100 dark:bg-slate-950">

      <!-- Brand Panel -->
      <div class="relative lg:w-1/2 bg-slate-950 text-white p-6 sm:p-10 flex flex-col justify-between overflow-hidden">
        <div class="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-teal-600/20 blur-3xl"></div>
        <div class="absolute bottom-0 -left-16 w-64 h-64 rounded-full bg-emerald-500/10 blur-3xl"></div>

        <div class="relative flex items-center gap-3">
          <div class="w-11 h-11 rounded-xl bg-teal-600 flex items-center justify-center font-black text-lg shadow-lg">SM</div>
          <div>
            <h1 class="font-extrabold tracking-wide text-lg bg-gradient-to-r from-teal-200 to-teal-400 bg-clip-text text-transparent">
              {{ prefs.t('app.name') }}
            </h1>
            <p class="text-[11px] text-slate-400">{{ prefs.t('app.tagline') }}</p>
          </div>
        </div>

        <div class="relative my-8 lg:my-0 space-y-4">
          <h2 class="text-2xl sm:text-3xl font-black leading-snug">
            {{ prefs.txt('বিক্রয়, স্টক, লেজার ও হিসাব —', 'Sales, stock, ledger and accounts —') }} <span class="text-teal-400">{{ prefs.txt('এক জায়গায়', 'all in one place') }}</span>
          </h2>
          <ul class="space-y-2 text-xs text-slate-300">
            <li class="flex items-center gap-2"><mat-icon class="text-xs text-teal-400">check_circle</mat-icon> {{ prefs.txt('কাস্টমার / সাপ্লায়ার লেজার ও ডিউ কালেকশন', 'Customer / supplier ledger and due collection') }}</li>
            <li class="flex items-center gap-2"><mat-icon class="text-xs text-teal-400">check_circle</mat-icon> {{ prefs.txt('ভূমিকা অনুযায়ী পারমিশন ও অডিট লগ', 'Role-based permissions and audit log') }}</li>
            <li class="flex items-center gap-2"><mat-icon class="text-xs text-teal-400">check_circle</mat-icon> {{ prefs.txt('দৈনিক ক্যাশ ক্লোজিং ও লাভ-ক্ষতি রিপোর্ট', 'Daily cash closing and profit-loss reports') }}</li>
          </ul>
        </div>

        <div class="relative flex items-center gap-2 text-[11px] text-slate-500">
          <mat-icon class="text-xs">verified_user</mat-icon>
          <span>Fulbarigate-9203, Khulna, Bangladesh</span>
        </div>
      </div>

      <!-- Login Form -->
      <div class="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div class="w-full max-w-sm space-y-5">

          <div class="flex justify-end gap-2">
            <button (click)="prefs.toggleLanguage()"
              class="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-900 cursor-pointer">
              {{ prefs.language() === 'bn' ? 'EN' : 'বাংলা' }}
            </button>
            <button (click)="prefs.toggleDark()"
              class="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-900 cursor-pointer">
              <mat-icon class="text-xs">{{ prefs.dark() ? 'light_mode' : 'dark_mode' }}</mat-icon>
            </button>
          </div>

          <div>
            <h2 class="text-2xl font-black text-slate-900 dark:text-white">{{ prefs.t('login.title') }}</h2>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">{{ prefs.t('login.subtitle') }}</p>
          </div>

          <form (ngSubmit)="submit()" class="bg-white dark:bg-slate-900 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div>
              <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-300 text-xs">{{ prefs.t('login.username') }}</label>
              <div class="relative">
                <mat-icon class="absolute left-2.5 top-2.5 text-slate-400 text-base">person</mat-icon>
                <input name="username" type="text" [(ngModel)]="username" autocomplete="username"
                  class="w-full border border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-white rounded-lg pl-9 pr-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500">
              </div>
            </div>

            <div>
              <label class="block font-semibold mb-1 text-slate-700 dark:text-slate-300 text-xs">{{ prefs.txt('পাসওয়ার্ড', 'Password') }}</label>
              <div class="relative">
                <mat-icon class="absolute left-2.5 top-2.5 text-slate-400 text-base">lock</mat-icon>
                <input name="pin" type="password" [(ngModel)]="pin" autocomplete="current-password"
                  (keyup.enter)="submit()"
                  class="w-full border border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-white rounded-lg pl-9 pr-3 py-2.5 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-teal-500">
              </div>
            </div>

            @if (error()) {
              <div class="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 rounded-lg px-3 py-2 text-xs font-semibold flex items-center gap-2">
                <mat-icon class="text-xs">error</mat-icon>
                @switch (error()) {
                  @case ('inactive') { {{ prefs.t('login.inactive') }} }
                  @case ('short') { {{ prefs.txt('পাসওয়ার্ড অন্তত ৬ অক্ষরের হতে হবে।', 'Password must be at least 6 characters.') }} }
                  @case ('exists') { {{ prefs.txt('এই দোকানে অ্যাকাউন্ট আগেই তৈরি হয়েছে — ওই পাসওয়ার্ড দিয়েই লগইন করুন।', 'This shop is already set up — sign in with the same password.') }} }
                  @case ('cloud') { {{ prefs.txt('ক্লাউডে সংযোগ করা যায়নি — ইন্টারনেট দেখে আবার চেষ্টা করুন।', 'Could not reach the cloud — check the internet and try again.') }} }
                  @case ('required') { {{ prefs.txt('ইউজারনেম ও পাসওয়ার্ড দুটোই দিন।', 'Enter both the username and password.') }} }
                  @default { {{ prefs.t('login.error') }} }
                }
              </div>
            }

            <button type="submit" [disabled]="busy()"
              class="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-2.5 rounded-lg text-sm transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-wait">
              <mat-icon class="text-base">{{ busy() ? 'hourglass_top' : 'login' }}</mat-icon>
              @if (busy()) {
                {{ prefs.txt('সংযোগ করা হচ্ছে…', 'Connecting…') }}
              } @else {
                {{ prefs.t('login.button') }}
              }
            </button>
          </form>

        </div>
      </div>
    </div>
  `
})
export class Login {
  session = inject(SessionService);
  prefs = inject(PreferencesService);

  username = '';
  pin = '';
  error = signal<string>('');
  busy = signal(false);

  async submit() {
    if (this.busy()) return;
    if (!this.username.trim() || !this.pin.trim()) {
      this.error.set('required');
      return;
    }
    this.busy.set(true);
    try {
      const result = await this.session.login(this.username, this.pin);
      if (!result.ok) {
        this.error.set(result.error || 'invalid');
        return;
      }
      this.error.set('');
      this.pin = '';
    } finally {
      this.busy.set(false);
    }
  }
}
