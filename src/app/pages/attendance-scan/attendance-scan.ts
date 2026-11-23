import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, ViewChild,
  computed, inject, signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute } from '@angular/router';
import { CloudService } from '../../services/cloud';
import { PreferencesService } from '../../services/preferences';
import { localDateIso } from '../../utils/local-date';
import { nextPunch, PunchKind } from '../../utils/attendance-punch';

interface ScanStaff {
  id: number;
  code: string;
  name: string;
  status: 'Active' | 'On Leave' | 'Inactive';
  photo?: string;
  designation?: string;
}

interface ScanRecord {
  id: number;
  staffId: number;
  staffCode: string;
  staffName: string;
  date: string;
  timeIn: string;
  lunchOut?: string;
  lunchIn?: string;
  timeOut: string;
  method: 'QR' | 'Face' | 'Manual';
  status: 'Present' | 'Late' | 'Absent' | 'Leave';
  photo?: string;
  note: string;
  createdAt: string;
}

interface StationSettings {
  id: string;
  token: string;
  shopName?: string;
  officeStart?: string;
}

/** Public-safe employee snapshot published together with the station QR. */
interface StationStaffRow {
  id: string;
  staff?: ScanStaff[];
}

interface StaffCache {
  savedAt: string;
  shopName: string;
  officeStart: string;
  station: string;
  staff: ScanStaff[];
}

const STAFF_COLLECTION = 'sm_hrm_staff_v1';
const ATTENDANCE_COLLECTION = 'sm_attendance_v1';
const STATION_COLLECTION = 'sm_attendance_settings_v1';
const CACHE_KEY = 'sm_scan_cache_v1';
const QUEUE_KEY = 'sm_scan_queue_v1';

@Component({
  selector: 'app-attendance-scan',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule],
  template: `
    <div class="min-h-dvh bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-200 flex flex-col">
      <!-- Header -->
      <header class="bg-gradient-to-r from-teal-800 via-teal-700 to-teal-600 text-white shadow-lg">
        <div class="max-w-md mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-9 h-9 rounded-xl bg-white/15 border border-white/25 flex items-center justify-center shrink-0">
              <mat-icon class="text-xl">fact_check</mat-icon>
            </span>
            <div class="min-w-0">
              <p class="font-black text-sm leading-tight truncate">{{ shopName() }}</p>
              <p class="text-[10px] text-teal-50/90 font-semibold">{{ prefs.txt('ফেস হাজিরা স্টেশন', 'Face Attendance Station') }}</p>
            </div>
          </div>
          <button type="button" (click)="prefs.toggleLanguage()"
            class="shrink-0 w-10 h-9 rounded-lg bg-white/15 hover:bg-white/25 border border-white/25 text-[11px] font-black cursor-pointer transition-colors"
            [attr.aria-label]="prefs.txt('ভাষা বদলান', 'Switch language')">
            {{ prefs.language() === 'bn' ? 'EN' : 'বাং' }}
          </button>
        </div>
        <div class="max-w-md mx-auto px-4 pb-3 flex items-center justify-between gap-2 text-[11px] font-semibold text-teal-50/95">
          <span class="inline-flex items-center gap-1"><mat-icon class="text-[14px]">calendar_today</mat-icon>{{ displayDate(today) }}</span>
          <span class="inline-flex items-center gap-1 font-mono text-sm font-black"><mat-icon class="text-[14px]">schedule</mat-icon>{{ clock() }}</span>
          <span class="inline-flex items-center gap-1"><mat-icon class="text-[14px]">pin_drop</mat-icon>{{ station() || '—' }}</span>
        </div>
      </header>

      <main class="flex-1 w-full max-w-md mx-auto px-3 py-4 space-y-3">
        @if (stage() === 'loading') {
          <div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-10 text-center shadow-sm">
            <span class="inline-block w-8 h-8 rounded-full border-[3px] border-slate-200 border-t-teal-600 animate-spin"></span>
            <p class="mt-3 text-xs font-bold text-slate-500 dark:text-slate-400">{{ prefs.txt('স্টেশন প্রস্তুত হচ্ছে…', 'Preparing station…') }}</p>
          </div>
        } @else if (stage() === 'fatal') {
          <div class="bg-white dark:bg-slate-900 rounded-2xl border border-rose-200 dark:border-rose-900/60 p-6 text-center shadow-sm space-y-3">
            <span class="inline-flex w-14 h-14 rounded-full bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 items-center justify-center">
              <mat-icon class="text-3xl">qr_code_2</mat-icon>
            </span>
            <p class="font-black text-base text-slate-900 dark:text-white">{{ prefs.txt('QR কোডটি ব্যবহার করা যাচ্ছে না', 'This QR code cannot be used') }}</p>
            <p class="text-xs font-semibold text-slate-500 dark:text-slate-400 leading-relaxed">{{ fatalMessage() }}</p>
            <div class="flex items-center justify-center gap-2 pt-1">
              <button type="button" (click)="boot()" class="inline-flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold px-4 py-2.5 rounded-xl cursor-pointer">
                <mat-icon class="text-base">refresh</mat-icon> {{ prefs.txt('আবার চেষ্টা করুন', 'Try again') }}
              </button>
              <button type="button" (click)="prefs.toggleLanguage()" class="inline-flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold px-4 py-2.5 rounded-xl cursor-pointer">
                <mat-icon class="text-base">translate</mat-icon> {{ prefs.language() === 'bn' ? 'English' : 'বাংলা' }}
              </button>
            </div>
            <p class="text-[10px] text-slate-400 pt-1">{{ prefs.txt('সমস্যা থাকলে দোকানের অ্যাডমিনকে জানান।', 'Tell the shop admin if this keeps happening.') }}</p>
          </div>
        } @else if (saved()) {
          <!-- Success -->
          <div class="bg-white dark:bg-slate-900 rounded-2xl border border-emerald-200 dark:border-emerald-900/60 shadow-sm overflow-hidden">
            <div class="bg-gradient-to-r from-teal-700 to-teal-600 text-white px-4 py-3 flex items-center gap-2">
              <mat-icon>verified</mat-icon>
              <div>
                <p class="font-black text-sm">{{ savedTitle() }}</p>
                <p class="text-[10px] text-emerald-50/90 font-semibold">{{ saved()!.record.staffName }} · {{ saved()!.record.staffCode }}</p>
              </div>
            </div>
            <div class="p-4 flex flex-col items-center gap-3">
              @if (saved()!.record.photo) {
                <img [src]="saved()!.record.photo" alt="attendance" class="w-32 h-32 rounded-2xl object-cover border-4 border-white dark:border-slate-800 shadow-md -mt-8 bg-slate-200" loading="lazy" decoding="async">
              } @else {
                <span class="w-24 h-24 rounded-2xl bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 flex items-center justify-center text-3xl font-black -mt-8 border-4 border-white dark:border-slate-800">{{ initial(saved()!.record.staffName) }}</span>
              }
              <div class="w-full grid grid-cols-3 gap-2 text-center">
                <div class="rounded-xl bg-slate-50 dark:bg-slate-800/60 px-2 py-2">
                  <p class="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase">{{ prefs.txt('সময়', 'Time') }}</p>
                  <p class="text-sm font-black font-mono">{{ savedTime() }}</p>
                </div>
                <div class="rounded-xl bg-slate-50 dark:bg-slate-800/60 px-2 py-2">
                  <p class="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase">{{ prefs.txt('স্ট্যাটাস', 'Status') }}</p>
                  <p class="text-sm font-black" [class]="saved()!.record.status === 'Late' ? 'text-amber-600' : 'text-emerald-600'">{{ statusLabel(saved()!.record.status) }}</p>
                </div>
                <div class="rounded-xl bg-slate-50 dark:bg-slate-800/60 px-2 py-2">
                  <p class="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase">{{ prefs.txt('তারিখ', 'Date') }}</p>
                  <p class="text-sm font-black font-mono">{{ displayDate(saved()!.record.date) }}</p>
                </div>
              </div>
              @if (saved()!.queued) {
                <p class="w-full text-[11px] font-semibold text-amber-800 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2 text-center">
                  {{ prefs.txt('ইন্টারনেট নেই — হাজিরা ফোনে সংরক্ষিত আছে, অনলাইন হলে নিজেই সেভ হবে।', 'Offline — attendance saved on this phone and will sync when online.') }}
                </p>
              }
              <button type="button" (click)="reset()" class="w-full inline-flex items-center justify-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-bold px-4 py-3 rounded-xl cursor-pointer">
                <mat-icon class="text-base">groups</mat-icon> {{ prefs.txt('আরেকজনের হাজিরা', 'Next employee') }}
              </button>
            </div>
          </div>
        } @else {
          @if (offline()) {
            <p class="text-[11px] font-semibold text-amber-800 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2 flex items-center gap-1.5">
              <mat-icon class="text-sm">cloud_off</mat-icon>{{ prefs.txt('ইন্টারনেট নেই — শেষবারের তথ্য দেখানো হচ্ছে; হাজিরা ফোনে জমা হবে।', 'Offline — showing last loaded data; attendance will be queued.') }}
            </p>
          }

          <!-- Camera -->
          <div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div class="relative bg-slate-900 aspect-[4/3] overflow-hidden">
              <video #cam class="w-full h-full object-cover" [class.-scale-x-100]="facingMode() === 'user'" autoplay muted playsinline></video>
              <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div class="w-40 h-52 border-2 border-dashed border-emerald-300/70 rounded-[50%]"></div>
              </div>
              @if (!cameraReady()) {
                <div class="absolute inset-0 bg-slate-900/85 flex flex-col items-center justify-center gap-2 p-6 text-center">
                  @if (cameraError()) {
                    <mat-icon class="text-3xl text-rose-300">videocam_off</mat-icon>
                    <p class="text-[11px] font-semibold text-rose-100">{{ cameraError() }}</p>
                  } @else {
                    <mat-icon class="text-3xl text-teal-300">photo_camera</mat-icon>
                    <p class="text-[11px] font-semibold text-white/90">{{ prefs.txt('ক্যামেরা চালু করুন — মুখ দেখিয়ে হাজিরা দিন।', 'Turn on the camera to mark attendance with your face.') }}</p>
                  }
                  <button type="button" (click)="startCamera()" class="mt-1 inline-flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold px-4 py-2 rounded-lg cursor-pointer">
                    <mat-icon class="text-sm">photo_camera</mat-icon>
                    {{ cameraError() ? prefs.txt('আবার চেষ্টা করুন', 'Try again') : prefs.txt('ক্যামেরা চালু করুন', 'Turn on camera') }}
                  </button>
                </div>
              }
              <div class="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2">
                <span class="inline-flex items-center gap-1 bg-black/45 text-white text-[10px] font-bold px-2 py-1 rounded-md backdrop-blur-xs">
                  <mat-icon class="text-[12px]">face</mat-icon>{{ prefs.txt('ফেস হাজিরা', 'Face attendance') }}
                </span>
                @if (cameraReady()) {
                  <button type="button" (click)="switchCamera()" class="inline-flex items-center gap-1 bg-black/45 hover:bg-black/60 text-white text-[10px] font-bold px-2 py-1 rounded-md cursor-pointer">
                    <mat-icon class="text-[12px]">flip_camera_ios</mat-icon>{{ prefs.txt('ক্যামেরা বদল', 'Flip') }}
                  </button>
                }
              </div>
            </div>

            <div class="p-3 space-y-3">
              <label class="block">
                <span class="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">{{ prefs.txt('নিজের নাম বেছে নিন', 'Select your name') }}</span>
                <select [ngModel]="selectedId()" (ngModelChange)="selectStaff($event)"
                  class="w-full border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded-xl px-3 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-teal-400">
                  <option [ngValue]="null">{{ prefs.txt('কর্মচারী নির্বাচন করুন', 'Choose an employee') }}</option>
                  @for (s of staff(); track s.id) {
                    <option [ngValue]="s.id">{{ s.name }} ({{ s.code }})</option>
                  }
                </select>
              </label>

              @if (selectedStaff(); as staff) {
                <p class="text-[11px] font-semibold rounded-xl px-3 py-2 flex items-center gap-1.5" [class]="statusHint().tone">
                  <mat-icon class="text-sm">{{ statusIcon() }}</mat-icon>
                  {{ statusHint().text }}
                </p>
                @if (staffDesignation(staff)) {
                  <p class="text-[10px] text-slate-500 dark:text-slate-400 -mt-1 px-1">{{ staffDesignation(staff) }}</p>
                }
              }

              <button type="button" (click)="capture()" [disabled]="!selectedId() || !cameraReady() || busy() || alreadyDone()"
                class="w-full inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm px-4 py-3 rounded-xl cursor-pointer transition-colors">
                @if (busy()) {
                  <span class="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin"></span>
                  {{ prefs.txt('সেভ হচ্ছে…', 'Saving…') }}
                } @else {
                  <mat-icon class="text-lg">photo_camera</mat-icon>
                  {{ punchAction() }}
                }
              </button>
              <p class="text-center text-[10px] text-slate-400">{{ prefs.txt('ছবিটি হাজিরার প্রমাণ হিসেবে সংরক্ষিত হবে।', 'The photo is stored as attendance proof.') }}</p>
            </div>
          </div>

          @if (notice()) {
            <p class="text-[11px] font-semibold rounded-xl px-3 py-2 flex items-center gap-1.5"
              [class]="notice()!.kind === 'error' ? 'bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900' : 'bg-sky-50 text-sky-800 border border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900'">
              <mat-icon class="text-sm">{{ notice()!.kind === 'error' ? 'error' : 'info' }}</mat-icon>{{ notice()!.text }}
            </p>
          }
        }
      </main>

      <footer class="pb-4 text-center text-[10px] text-slate-400">
        {{ prefs.txt('এই পেজটি দোকানের হাজিরা স্টেশনের জন্য — লগইন লাগবে না।', 'This page is for the shop attendance station — no login needed.') }}
      </footer>
    </div>
  `
})
export class AttendanceScan implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private cloud = inject(CloudService);
  prefs = inject(PreferencesService);

  @ViewChild('cam') private camRef?: ElementRef<HTMLVideoElement>;

  readonly today = localDateIso();
  readonly stage = signal<'loading' | 'ready' | 'fatal'>('loading');
  readonly fatalMessage = signal('');
  readonly shopName = signal('SM Enterprise');
  readonly station = signal('');
  readonly staff = signal<ScanStaff[]>([]);
  readonly records = signal<ScanRecord[]>([]);
  readonly selectedId = signal<number | null>(null);
  readonly offline = signal(false);
  readonly cameraReady = signal(false);
  readonly cameraError = signal('');
  readonly facingMode = signal<'user' | 'environment'>('user');
  readonly busy = signal(false);
  readonly notice = signal<{ kind: 'error' | 'info'; text: string } | null>(null);
  readonly saved = signal<{ record: ScanRecord; kind: Exclude<PunchKind, 'done'>; queued: boolean } | null>(null);
  readonly clock = signal(this.nowText());

  readonly selectedStaff = computed(() => this.staff().find(s => s.id === this.selectedId()) ?? null);
  readonly selectedRecord = computed(() => this.records().find(r => String(r.staffId) === String(this.selectedId())) ?? null);
  readonly alreadyDone = computed(() => !!this.selectedRecord()?.timeOut);
  /** An approved leave writes a placeholder row; work on that day still wins. */
  readonly onLeaveToday = computed(() => {
    const record = this.selectedRecord();
    return !!record && record.status === 'Leave' && !record.timeIn;
  });
  readonly statusHint = computed(() => {
    const record = this.selectedRecord();
    const kind = nextPunch(record);
    const amber = 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900';
    if (kind === 'done' && record) {
      return {
        tone: 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
        text: this.prefs.txt(
          `আজকের চার ধাপ সম্পন্ন (${record.timeIn} → ${record.lunchOut} → ${record.lunchIn} → ${record.timeOut})`,
          `All four steps done today (${record.timeIn} → ${record.lunchOut} → ${record.lunchIn} → ${record.timeOut})`
        )
      };
    }
    if (kind === 'in' && this.onLeaveToday()) {
      return {
        tone: 'bg-sky-50 text-sky-800 border border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900',
        text: this.prefs.txt('আজ ছুটি অনুমোদিত — তবুও কাজে এলে হাজিরা দিন, ছুটির বদলে উপস্থিতি গণ্য হবে', 'Approved leave today — checking in still works and will count as present')
      };
    }
    if (kind === 'lunchOut' && record) {
      return { tone: amber, text: this.prefs.txt(`চেক-ইন হয়েছে ${record.timeIn} — খাবার আউট হওয়ার সময় স্ক্যান করুন`, `Checked in at ${record.timeIn} — scan when you leave for lunch`) };
    }
    if (kind === 'lunchIn' && record) {
      return { tone: amber, text: this.prefs.txt(`খাবার আউট ${record.lunchOut} — ফিরে এসে আবার স্ক্যান করুন`, `Lunch out at ${record.lunchOut} — scan again when you are back`) };
    }
    if (kind === 'out' && record) {
      return { tone: amber, text: this.prefs.txt(`খাবার শেষে ফিরেছেন ${record.lunchIn} — বাড়ি যাওয়ার সময় স্ক্যান করুন`, `Back from lunch at ${record.lunchIn} — scan when you leave for the day`) };
    }
    return {
      tone: 'bg-sky-50 text-sky-800 border border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900',
      text: this.prefs.txt('আজ এখনো হাজিরা দেননি', 'Not checked in today')
    };
  });
  readonly statusIcon = computed(() => ({
    in: 'schedule', lunchOut: 'lunch_dining', lunchIn: 'directions_walk', out: 'logout', done: 'task_alt'
  }[nextPunch(this.selectedRecord())]));
  readonly punchAction = computed(() => ({
    in: this.prefs.txt('ছবি তুলে হাজিরা দিন', 'Take photo & check in'),
    lunchOut: this.prefs.txt('ছবি তুলে খাবার আউট হন', 'Take photo & lunch out'),
    lunchIn: this.prefs.txt('ছবি তুলে ফেরা নিশ্চিত করুন', 'Take photo & confirm back'),
    out: this.prefs.txt('ছবি তুলে চেক-আউট করুন', 'Take photo & check out'),
    done: this.prefs.txt('আজকের হাজিরা সম্পন্ন', 'Attendance complete today')
  }[nextPunch(this.selectedRecord())]));
  readonly savedTitle = computed(() => {
    const kind = this.saved()?.kind;
    return kind === 'in' ? this.prefs.txt('চেক-ইন সফল হয়েছে', 'Checked in successfully')
      : kind === 'lunchOut' ? this.prefs.txt('খাবার আউট রেকর্ড হয়েছে', 'Lunch out recorded')
      : kind === 'lunchIn' ? this.prefs.txt('ফেরা রেকর্ড হয়েছে', 'Back from lunch recorded')
      : this.prefs.txt('চেক-আউট সফল হয়েছে', 'Checked out successfully');
  });
  readonly savedTime = computed(() => {
    const saved = this.saved();
    if (!saved) return '';
    const record = saved.record;
    return ({
      in: record.timeIn, lunchOut: record.lunchOut, lunchIn: record.lunchIn, out: record.timeOut
    } as Record<string, string | undefined>)[saved.kind] || '';
  });

  private stream?: MediaStream;
  private clockTimer?: ReturnType<typeof setInterval>;
  private officeStart = '09:15';
  private savedKind: Exclude<PunchKind, 'done'> = 'in';

  ngOnInit(): void {
    this.clockTimer = setInterval(() => this.clock.set(this.nowText()), 1000);
    window.addEventListener('online', this.flushQueue);
    void this.boot();
  }

  ngOnDestroy(): void {
    if (this.clockTimer) clearInterval(this.clockTimer);
    window.removeEventListener('online', this.flushQueue);
    this.stopCamera();
  }

  async boot(): Promise<void> {
    const token = (this.route.snapshot.queryParamMap.get('station') || '').trim().toUpperCase();
    this.station.set(token);
    if (!/^[A-Z0-9][A-Z0-9_-]{3,39}$/.test(token)) {
      this.stage.set('fatal');
      this.fatalMessage.set(this.prefs.txt('লিংকটি সঠিক নয় — দোকানের নতুন স্টেশন QR কোড স্ক্যান করুন।', 'This link is invalid — scan the shop’s current station QR code.'));
      return;
    }
    this.stage.set('loading');
    const cache = this.readCache();
    // A phone that once stored another shop's config must still reach the
    // backend this QR was printed from.
    this.cloud.useDeploymentBackend();
    try {
      const [stationRows, staffRows, records] = await Promise.all([
        this.cloud.fetchPublicRows<StationSettings | StationStaffRow>(STATION_COLLECTION),
        this.cloud.fetchPublicRows<ScanStaff>(STAFF_COLLECTION).catch(() => [] as ScanStaff[]),
        this.cloud.fetchPublicRows<ScanRecord>(ATTENDANCE_COLLECTION, { column: 'data->>date', value: this.today })
          .catch(() => [] as ScanRecord[])
      ]);
      const settings = stationRows.find((row): row is StationSettings =>
        String((row as StationSettings).token || '').toUpperCase() === token)
        ?? stationRows.find((row): row is StationSettings => !!(row as StationSettings).token);
      if (!settings?.token) {
        this.fail(this.prefs.txt(
          'স্টেশনটি এখনো চালু হয়নি — দোকানের অ্যাডমিনকে HRM → হাজিরা পেজ একবার খুলতে বলুন।',
          'This station is not activated yet — ask the shop admin to open HRM → Attendance once.'
        ));
        return;
      }
      if (String(settings.token).toUpperCase() !== token) {
        this.fail(this.prefs.txt(
          'এই QR কোডটি পুরোনো বা নিষ্ক্রিয় হয়েছে — দোকানে টানানো নতুন QR কোড স্ক্যান করুন।',
          'This QR code is old or disabled — scan the new QR code posted in the shop.'
        ));
        return;
      }
      const snapshot = stationRows.find((row): row is StationStaffRow => row?.id === 'staff');
      const active = this.publicStaff(snapshot?.staff ?? [], staffRows);
      if (!active.length) {
        this.fail(this.prefs.txt(
          'কোনো সক্রিয় কর্মচারী পাওয়া যায়নি — অ্যাডমিনকে HRM → স্টাফ পেজে কর্মচারী যোগ করে হাজিরা পেজ একবার খুলতে বলুন।',
          'No active employees found — ask the admin to add staff in HRM → Staff, then open the attendance page once.'
        ));
        return;
      }
      this.applyData(
        settings.shopName || cache?.shopName || 'SM Enterprise',
        settings.officeStart || cache?.officeStart || '09:15',
        active,
        records
      );
      this.writeCache();
      this.offline.set(false);
      this.stage.set('ready');
      void this.flushQueue();
      this.scheduleCamera();
    } catch {
      if (cache && String(cache.station).toUpperCase() === token && cache.staff?.length) {
        this.applyData(cache.shopName || 'SM Enterprise', cache.officeStart || '09:15', cache.staff, this.queuedRecords());
        this.offline.set(true);
        this.stage.set('ready');
        this.scheduleCamera();
        return;
      }
      this.fail(this.prefs.txt(
        'ইন্টারনেট বা সার্ভারে পৌঁছানো যাচ্ছে না। মোবাইল ডেটা চালু করে আবার চেষ্টা করুন।',
        'Cannot reach the internet or server. Turn on mobile data and try again.'
      ));
    }
  }

  /** Prefer the public snapshot; fall back to the staff collection for old stations. */
  private publicStaff(snapshot: ScanStaff[], fallback: ScanStaff[]): ScanStaff[] {
    const source = (snapshot.length ? snapshot : fallback)
      .filter(s => s && s.status !== 'Inactive' && (s.name || '').trim())
      .map(s => ({
        id: s.id,
        code: s.code || '',
        name: (s.name || '').trim(),
        status: s.status || 'Active',
        designation: s.designation || ''
      }));
    const unique = new Map<number, ScanStaff>();
    for (const staff of source) if (!unique.has(staff.id)) unique.set(staff.id, staff);
    return [...unique.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  /** Render the video element first, then attach the stream to it. */
  private scheduleCamera(): void {
    setTimeout(() => {
      if (this.stage() === 'ready' && !this.saved() && !this.cameraReady()) void this.startCamera();
    }, 80);
  }

  private applyData(shopName: string, officeStart: string, staff: ScanStaff[], records: ScanRecord[]): void {
    this.shopName.set(shopName || 'SM Enterprise');
    this.officeStart = officeStart || '09:15';
    this.staff.set(staff);
    const queued = this.queuedRecords();
    const merged = [...records];
    for (const item of queued) {
      const index = merged.findIndex(r => r.id === item.id || (String(r.staffId) === String(item.staffId) && r.date === item.date));
      if (index >= 0) merged[index] = item;
      else merged.push(item);
    }
    this.records.set(this.dedupeRecords(merged));
    const current = this.selectedId();
    this.selectedId.set(staff.some(s => s.id === current) ? current : (staff.length === 1 ? staff[0].id : null));
  }

  /** One row per employee per day, even if an older device created a duplicate. */
  private dedupeRecords(records: ScanRecord[]): ScanRecord[] {
    const byStaff = new Map<string, ScanRecord>();
    for (const record of records) {
      if (!record || record.date !== this.today || record.staffId === undefined || record.staffId === null) continue;
      const key = String(record.staffId);
      const previous = byStaff.get(key);
      byStaff.set(key, previous ? this.preferredRecord(previous, record) : record);
    }
    return [...byStaff.values()]
      .sort((a, b) => (b.timeIn || '').localeCompare(a.timeIn || ''));
  }

  private preferredRecord(a: ScanRecord, b: ScanRecord): ScanRecord {
    if (!!a.timeOut !== !!b.timeOut) return a.timeOut ? a : b;
    if ((a.timeIn || '') !== (b.timeIn || '')) return (a.timeIn || '') < (b.timeIn || '') ? a : b;
    return a.id <= b.id ? a : b;
  }

  private fail(message: string): void {
    this.fatalMessage.set(message);
    this.stage.set('fatal');
  }

  selectStaff(value: number | null): void {
    this.selectedId.set(value ?? null);
    this.notice.set(null);
  }

  staffDesignation(staff: ScanStaff): string {
    return (staff.designation || '').trim();
  }

  initial(name: string): string {
    return (name || '?').trim().charAt(0).toUpperCase();
  }

  displayDate(value: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : (value || '—');
  }

  statusLabel(status: ScanRecord['status']): string {
    return {
      Present: this.prefs.txt('উপস্থিত', 'Present'),
      Late: this.prefs.txt('দেরি', 'Late'),
      Leave: this.prefs.txt('ছুটি', 'Leave'),
      Absent: this.prefs.txt('অনুপস্থিত', 'Absent')
    }[status] || status;
  }

  async startCamera(): Promise<void> {
    this.cameraError.set('');
    this.stopCamera();
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: this.facingMode() }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false
      });
      const video = this.camRef?.nativeElement;
      if (!video) throw new Error('no video element');
      video.srcObject = this.stream;
      await video.play();
      if (!video.videoWidth) {
        await new Promise<void>(resolve => {
          const done = () => { video.removeEventListener('loadedmetadata', done); resolve(); };
          video.addEventListener('loadedmetadata', done);
          setTimeout(done, 1500);
        });
      }
      this.cameraReady.set(true);
    } catch {
      this.cameraReady.set(false);
      this.cameraError.set(this.prefs.txt(
        'ক্যামেরা চালু করা যায়নি। ব্রাউজারে ক্যামেরার অনুমতি দিন, তারপর আবার চেষ্টা করুন।',
        'Camera could not start. Allow camera permission in the browser and try again.'
      ));
    }
  }

  async switchCamera(): Promise<void> {
    this.facingMode.set(this.facingMode() === 'user' ? 'environment' : 'user');
    await this.startCamera();
  }

  private stopCamera(): void {
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined;
    this.cameraReady.set(false);
  }

  async capture(): Promise<void> {
    if (this.busy()) return;
    const staff = this.selectedStaff();
    if (!staff) {
      this.notice.set({ kind: 'error', text: this.prefs.txt('আগে নিজের নাম বেছে নিন।', 'Select your name first.') });
      return;
    }
    if (this.alreadyDone()) {
      this.notice.set({ kind: 'info', text: this.prefs.txt('আজকের হাজিরা ইতিমধ্যে সম্পন্ন হয়েছে।', 'Your attendance for today is already complete.') });
      return;
    }
    const video = this.camRef?.nativeElement;
    if (!video || !video.videoWidth) {
      this.notice.set({ kind: 'error', text: this.prefs.txt('ক্যামেরা প্রস্তুত নয় — আবার চেষ্টা করুন।', 'Camera is not ready — please try again.') });
      return;
    }
    this.busy.set(true);
    this.notice.set(null);
    try {
      // Another phone or kiosk may have marked this employee since this page
      // loaded — check the server before creating a second row for the day.
      await this.refreshTodayRecord(staff);
      if (this.selectedRecord()?.timeOut) {
        this.notice.set({ kind: 'info', text: this.prefs.txt('আজকের হাজিরা ইতিমধ্যে সম্পন্ন হয়েছে।', 'Your attendance for today is already complete.') });
        return;
      }
      const faceVisible = await this.detectFace(video);
      if (faceVisible === false) {
        this.notice.set({ kind: 'error', text: this.prefs.txt('ছবিতে মুখ শনাক্ত হয়নি — ক্যামেরার দিকে তাকিয়ে আবার চেষ্টা করুন।', 'No face detected — look at the camera and try again.') });
        return;
      }
      const photo = this.snapshot(video, 480, 0.7);
      if (!photo) {
        this.notice.set({ kind: 'error', text: this.prefs.txt('ছবি নেওয়া যায়নি — আবার চেষ্টা করুন।', 'The photo could not be captured — please try again.') });
        return;
      }
      // The full image goes to Cloudinary; the small thumbnail is the fallback
      // proof so a public row never carries a full-size base64 photo.
      const thumbnail = this.snapshot(video, 240, 0.55);
      const record = await this.buildRecord(staff, thumbnail || photo);
      if (!record) {
        this.notice.set({ kind: 'info', text: this.prefs.txt('আজকের হাজিরা ইতিমধ্যে সম্পন্ন হয়েছে।', 'Your attendance for today is already complete.') });
        return;
      }
      const photoUrl = await this.uploadPhoto(photo);
      record.photo = photoUrl || thumbnail || photo;
      const saved = await this.cloud.upsertPublicRow(ATTENDANCE_COLLECTION, String(record.id), record as unknown as Record<string, unknown>);
      if (saved) {
        this.finish(record, this.savedKind, false);
      } else {
        this.queueRecord(record);
        this.offline.set(true);
        this.finish(record, this.savedKind, true);
      }
    } finally {
      this.busy.set(false);
    }
  }

  /** Re-read this employee's row for today so two devices cannot double-mark. */
  private async refreshTodayRecord(staff: ScanStaff): Promise<void> {
    let rows: ScanRecord[];
    try {
      rows = await this.cloud.fetchPublicRows<ScanRecord>(ATTENDANCE_COLLECTION, [
        { column: 'data->>date', value: this.today },
        { column: 'data->>staffId', value: String(staff.id) }
      ]);
    } catch {
      return;
    }
    const match = rows
      .filter(r => r && String(r.staffId) === String(staff.id) && r.date === this.today)
      .reduce<ScanRecord | null>((best, r) => best ? this.preferredRecord(best, r) : r, null);
    if (!match) return;
    this.records.update(list => this.dedupeRecords([
      ...list.filter(r => String(r.staffId) !== String(staff.id) || r.date !== this.today),
      match
    ]));
  }

  private async buildRecord(staff: ScanStaff, photo: string): Promise<ScanRecord | null> {
    const existing = this.selectedRecord();
    const time = this.nowTime();
    const kind = nextPunch(existing);
    if (kind === 'done') return null;
    if (kind !== 'in' && existing) {
      this.savedKind = kind;
      if (kind === 'lunchOut') return { ...existing, lunchOut: time, method: 'Face', photo };
      if (kind === 'lunchIn') return { ...existing, lunchIn: time, method: 'Face', photo };
      return { ...existing, timeOut: time, method: 'Face', photo };
    }
    // A leave/absent placeholder already owns today's id; reuse it so the day
    // never ends up with two rows for the same employee.
    if (kind === 'in' && existing) {
      this.savedKind = 'in';
      return {
        ...existing,
        timeIn: time,
        method: 'Face',
        photo,
        status: time > this.officeStart ? 'Late' : 'Present',
        note: existing.note || 'Station QR · Face'
      };
    }
    this.savedKind = 'in';
    const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    return {
      id,
      staffId: staff.id,
      staffCode: staff.code,
      staffName: staff.name,
      date: this.today,
      timeIn: time,
      lunchOut: '',
      lunchIn: '',
      timeOut: '',
      method: 'Face',
      status: time > this.officeStart ? 'Late' : 'Present',
      photo,
      note: 'Station QR · Face',
      createdAt: new Date().toISOString()
    };
  }

  private finish(record: ScanRecord, kind: Exclude<PunchKind, 'done'>, queued: boolean): void {
    this.records.update(list => this.dedupeRecords([
      record,
      ...list.filter(r => r.id !== record.id && !(String(r.staffId) === String(record.staffId) && r.date === record.date))
    ]));
    this.saved.set({ record, kind, queued });
    this.notice.set(null);
  }

  reset(): void {
    this.saved.set(null);
    this.selectedId.set(this.staff().length === 1 ? this.staff()[0].id : null);
    this.notice.set(null);
    this.cameraError.set('');
    // The video element is re-created when the success card disappears; give
    // Angular one frame before attaching the stream again.
    setTimeout(() => void this.startCamera(), 80);
  }

  private async detectFace(video: HTMLVideoElement): Promise<boolean | null> {
    const Detector = (window as any).FaceDetector;
    if (!Detector) return null;
    try {
      const faces = await new Detector({ fastMode: true }).detect(video);
      return (faces?.length || 0) > 0;
    } catch {
      return null;
    }
  }

  private snapshot(video: HTMLVideoElement, maxWidth = 480, quality = 0.7): string {
    const width = Math.max(1, Math.min(maxWidth, video.videoWidth || maxWidth));
    const height = Math.round(width * ((video.videoHeight || 360) / (video.videoWidth || 480)));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    // The preview is mirrored like a selfie; match it so the saved proof looks
    // exactly like what the employee saw on screen.
    if (this.facingMode() === 'user') {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  }

  private async uploadPhoto(dataUrl: string): Promise<string> {
    const config = this.cloud.config().cloudinary;
    if (!config.enabled || !config.cloudName || !config.uploadPreset) return '';
    try {
      const [head, body = ''] = dataUrl.split(',');
      const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg';
      const binary = atob(body);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: mime }), `face-${Date.now()}.jpg`);
      form.append('upload_preset', config.uploadPreset);
      if (config.folder) form.append('folder', config.folder);
      const response = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`, {
        method: 'POST', body: form, signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) return '';
      const result = await response.json() as { secure_url?: string };
      return result.secure_url || '';
    } catch {
      return '';
    }
  }

  private queueRecord(record: ScanRecord): void {
    try {
      const queue = this.readQueue().filter(item => !(item.id === record.id || (String(item.staffId) === String(record.staffId) && item.date === record.date)));
      queue.push(record);
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-30)));
    } catch {
      /* private mode: the record still stays in memory for this visit */
    }
  }

  private readQueue(): ScanRecord[] {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private queuedRecords(): ScanRecord[] {
    return this.readQueue().filter(item => item.date === this.today);
  }

  private flushQueue = async (): Promise<void> => {
    const queue = this.readQueue();
    if (!queue.length) return;
    const remaining: ScanRecord[] = [];
    for (const record of queue) {
      const ok = await this.cloud.upsertPublicRow(ATTENDANCE_COLLECTION, String(record.id), record as unknown as Record<string, unknown>);
      if (!ok) remaining.push(record);
    }
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
    } catch {
      /* ignore */
    }
    if (remaining.length < queue.length && !remaining.length) this.offline.set(false);
  };

  private readCache(): StaffCache | null {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const cache = JSON.parse(raw) as StaffCache;
      if (!cache?.staff?.length) return null;
      if (Date.now() - Date.parse(cache.savedAt) > 7 * 24 * 60 * 60 * 1000) return null;
      return cache;
    } catch {
      return null;
    }
  }

  private writeCache(): void {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        shopName: this.shopName(),
        officeStart: this.officeStart,
        station: this.station(),
        staff: this.staff()
      } satisfies StaffCache));
    } catch {
      /* ignore */
    }
  }

  private nowTime(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  private nowText(): string {
    return new Date().toLocaleTimeString(this.prefs.language() === 'en' ? 'en-GB' : 'bn-BD', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
  }
}
