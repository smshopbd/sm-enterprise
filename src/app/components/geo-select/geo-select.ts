import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PreferencesService } from '../../services/preferences';
import { BD_DIVISIONS, GeoDistrict, GeoOption, geoDistricts, geoUpazilas } from '../../utils/bd-geo';

/**
 * বিভাগ → জেলা → উপজেলা ক্যাসকেডিং ড্রপডাউন। তিনটি ফর্মেই (Add New Party, POS,
 * ব্যাটারি নতুন কাস্টমার) একই কম্পোনেন্ট ব্যবহার হয়, তাই ডেটাও একই থাকে।
 */
@Component({
  selector: 'app-geo-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label class="block">
        <span class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">{{ prefs.txt('বিভাগ', 'Division') }}</span>
        <select
          [ngModel]="division"
          (ngModelChange)="onDivision($event)"
          class="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-2 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-teal-500"
        >
          <option value="">{{ prefs.txt('বিভাগ নির্বাচন করুন', 'Select division') }}</option>
          @for (d of divisions; track d.en) {
            <option [value]="d.en">{{ prefs.language() === 'en' ? d.en : d.bn }}</option>
          }
        </select>
      </label>

      <label class="block">
        <span class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">{{ prefs.txt('জেলা', 'District') }}</span>
        <select
          [ngModel]="district"
          (ngModelChange)="onDistrict($event)"
          [disabled]="!division"
          class="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-2 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-teal-500 disabled:opacity-60"
        >
          <option value="">{{ division ? prefs.txt('জেলা নির্বাচন করুন', 'Select district') : prefs.txt('আগে বিভাগ নির্বাচন করুন', 'Select division first') }}</option>
          @for (d of districts(); track d.en) {
            <option [value]="d.en">{{ prefs.language() === 'en' ? d.en : d.bn }}</option>
          }
        </select>
      </label>

      <label class="block sm:col-span-2">
        <span class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">{{ prefs.txt('উপজেলা', 'Upazila') }}</span>
        <select
          [ngModel]="upazila"
          (ngModelChange)="onUpazila($event)"
          [disabled]="!district"
          class="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-2 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-teal-500 disabled:opacity-60"
        >
          <option value="">{{ district ? prefs.txt('উপজেলা নির্বাচন করুন', 'Select upazila') : prefs.txt('আগে জেলা নির্বাচন করুন', 'Select district first') }}</option>
          @for (u of upazilas(); track u.en) {
            <option [value]="u.en">{{ prefs.language() === 'en' ? u.en : u.bn }}</option>
          }
        </select>
      </label>
    </div>
  `
})
export class GeoSelect {
  prefs = inject(PreferencesService);

  @Input() division = '';
  @Input() district = '';
  @Input() upazila = '';
  @Output() divisionChange = new EventEmitter<string>();
  @Output() districtChange = new EventEmitter<string>();
  @Output() upazilaChange = new EventEmitter<string>();

  readonly divisions = BD_DIVISIONS;
  readonly districts = (): GeoDistrict[] => {
    const list = geoDistricts(this.division);
    // Keep legacy free-text values selectable until the user picks a dataset district.
    if (this.district && list.length && !list.some(d => d.en === this.district)) {
      return [{ en: this.district, bn: this.district, upazilas: [] }, ...list];
    }
    return list;
  };
  readonly upazilas = (): GeoOption[] => {
    const list = geoUpazilas(this.division, this.district);
    if (this.upazila && !list.some(u => u.en === this.upazila)) {
      return [{ en: this.upazila, bn: this.upazila }, ...list];
    }
    return list;
  };

  onDivision(value: string): void {
    this.division = value;
    this.divisionChange.emit(value);
    if (this.district) {
      this.district = '';
      this.districtChange.emit('');
    }
    if (this.upazila) {
      this.upazila = '';
      this.upazilaChange.emit('');
    }
  }

  onDistrict(value: string): void {
    this.district = value;
    this.districtChange.emit(value);
    if (this.upazila) {
      this.upazila = '';
      this.upazilaChange.emit('');
    }
  }

  onUpazila(value: string): void {
    this.upazila = value;
    this.upazilaChange.emit(value);
  }
}
