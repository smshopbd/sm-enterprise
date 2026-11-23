import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

interface GuideItem {
  id: string;
  title: string;
  icon: string;
  route?: string;
  summary: string;
  steps: string[];
  note?: string;
  tag?: string;
}

interface GuideGroup {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  tint: string;
  items: GuideItem[];
}

const SHORTCUTS = [
  { label: 'ড্যাশবোর্ড', icon: 'grid_view', route: '/dashboard' },
  { label: 'নতুন বিক্রয়', icon: 'add_shopping_cart', route: '/sales/add' },
  { label: 'পেমেন্ট ইন', icon: 'price_check', route: '/sales/payment-in' },
  { label: 'পেমেন্ট আউট', icon: 'request_quote', route: '/purchases/payment-out' },
  { label: 'স্টক', icon: 'inventory', route: '/stock' },
  { label: 'রিপোর্ট', icon: 'analytics', route: '/reports' }
];

const GROUPS: GuideGroup[] = [
  {
    id: 'start',
    title: 'শুরু করা ও নেভিগেশন',
    subtitle: 'লগইন, মেনু, ড্যাশবোর্ড ও ওয়ালেট',
    icon: 'rocket_launch',
    tint: 'bg-teal-50 text-teal-600 dark:bg-teal-950/60 dark:text-teal-300',
    items: [
      {
        id: 'login',
        title: 'লগইন ও ইউজার অ্যাকাউন্ট',
        icon: 'login',
        summary: 'ইউজারনেম ও পিন দিয়ে প্রবেশ — রোল অনুযায়ী মেনু নিয়ন্ত্রিত',
        steps: [
          'লগইন পেজে আপনার ইউজারনেম ও পিন লিখে “প্রবেশ করুন” চাপুন।',
          'Admin সব মেনু দেখেন; Salesman শুধু বিক্রয়-সংশ্লিষ্ট মেনু এবং Accountant হিসাব/রিপোর্ট দেখেন।',
          'যে পেজে ঢোকার অনুমতি নেই, সেটি মেনুতে দেখানো হয় না — সরাসরি লিংকে গেলেও ফেরত পাঠানো হয়।',
          'উপরের ডান কোণে প্রোফাইল থেকে ইউজার বদলানো বা লগআউট করা যায়।'
        ]
      },
      {
        id: 'menu',
        title: 'সাইডবার ও মেনু খোঁজা',
        icon: 'menu',
        summary: 'মেনু সার্চ, গ্রুপিং, কোলাপ্স মোড ও মোবাইল ড্রয়ার',
        steps: [
          'সাইডবারের উপরের সার্চ বক্সে নাম লিখলেই মেনু ফিল্টার হয়ে যায়।',
          'গ্রুপ (যেমন Sales / Purchases)-এ ক্লিক করলে সাব-মেনু খোলে বা বন্ধ হয়।',
          'ডেস্কটপে উপরের “first_page” বাটনে ক্লিক করলে আইকন-অনলি মোড হয়; আইকনে হোভার করলে সাব-মেনু পপওভার দেখা যায়।',
          'মোবাইলে হ্যামবার্গার আইকনে সাইডবার খোলে, কোনো লিংকে ক্লিক করলেই নিজে থেকে বন্ধ হয়।'
        ]
      },
      {
        id: 'dashboard',
        title: 'ড্যাশবোর্ড',
        icon: 'grid_view',
        route: '/dashboard',
        tag: 'প্রতিদিনের সারসংক্ষেপ',
        summary: 'দিনের বিক্রয়, খরচ, বাকি আদায় ও স্টকের এক নজরে চিত্র',
        steps: [
          'উপরের তারিখ-রেঞ্জ বার থেকে আজ / এই মাস / কাস্টম রেঞ্জ বেছে নিন — সব সংখ্যা সেই রেঞ্জ অনুযায়ী বদলায়।',
          'মোট বিক্রয়, নগদ বিক্রয়, বাকি বিক্রয়, বাকি আদায়, মোট খরচ ও মূল ব্যালেন্স — প্রতিটি কার্ডে ক্লিক করলে সংশ্লিষ্ট তালিকা/রিপোর্ট খোলে।',
          'নিচে বিক্রয় চার্ট, ব্যবসার সারসংক্ষেপ, স্টক নজরদারি (কম স্টকের পণ্য), দ্রুত কাজ, নগদ কালেকশন, পেমেন্ট মাধ্যমের ভাগ, সর্বাধিক বিক্রিত পণ্য ও বাকিদার গ্রাহকের তালিকা থাকে।',
          'বাতিল (Cancelled) বিক্রয় কোনো হিসাবেই ধরা হয় না। সাম্প্রতিক বিক্রয়ের সারি থেকে ইনভয়েস দেখা/প্রিন্ট করা যায়।'
        ]
      },
      {
        id: 'wallet',
        title: 'ওয়ালেট',
        icon: 'account_balance_wallet',
        route: '/wallet',
        summary: 'নগদ, বিকাশ, নাগাদ, রকেট ও ব্যাংক অ্যাকাউন্টের লেনদেন',
        steps: [
          'প্রতিটি অ্যাকাউন্ট কার্ডে বর্তমান ব্যালেন্স ও সক্রিয়/নিষ্ক্রিয় অবস্থা দেখা যায়।',
          '“নতুন লেনদেন”-এ অ্যাকাউন্ট, ইন/আউট, টাকা, পার্টি ও নোট দিয়ে এন্ট্রি করুন।',
          '“নতুন অ্যাকাউন্ট” দিয়ে নতুন ব্যাংক/মোবাইল ওয়ালেট যোগ করুন।',
          'তালিকায় সব/ইন/আউট ট্যাব, সার্চ ও তারিখ ফিল্টার আছে; প্রতিটি লেনদেনের TXN নম্বর ধরে হিসাব মেলে।'
        ]
      }
    ]
  },
  {
    id: 'parties',
    title: 'পার্টি, কাস্টমার ও সরবরাহকারী',
    subtitle: 'সবার হিসাব এক জায়গায়',
    icon: 'groups',
    tint: 'bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-300',
    items: [
      {
        id: 'parties',
        title: 'পার্টি তালিকা',
        icon: 'diversity_3',
        route: '/parties',
        summary: 'কাস্টমার, কর্পোরেট, সরবরাহকারী, ডিলার ও স্টাফ — একই পেজে',
        steps: [
          'উপরের ট্যাব থেকে সব / কাস্টমার / কর্পোরেট কাস্টমার / সরবরাহকারী / ডিলার / স্টাফ বেছে নিন।',
          'মোট, পরিশোধিত ও বাকি (সরবরাহকারীর ক্ষেত্রে প্রদেয়) চিপ থেকে দ্রুত ফিল্টার করুন।',
          '“নতুন পার্টি”-তে ২ ধাপের ফর্ম: প্রথমে নাম-মোবাইল-ঠিকানা, পরে একাধিক রোল (কাস্টমার + সরবরাহকারী একসাথে হতে পারে), ক্রেডিট লিমিট, ডকুমেন্ট ও ছবি।',
          'সারিতে ক্লিক করলে প্রোফাইল ও লেনদেনের বিস্তারিত খোলে; Excel ইমপোর্ট/এক্সপোর্ট ও প্রিন্টও আছে।',
          'বিক্রয়, ক্রয় বা পেমেন্ট করলে এই ব্যালেন্স নিজে থেকেই আপডেট হয় — হাতে হিসাব লিখতে হয় না।'
        ]
      }
    ]
  },
  {
    id: 'hrm',
    title: 'এইচআরএম (HRM)',
    subtitle: 'কর্মী, হাজিরা, বেতন, অগ্রিম, ভাড়া ও দৈনিক খরচ',
    icon: 'badge',
    tint: 'bg-violet-50 text-violet-600 dark:bg-violet-950/60 dark:text-violet-300',
    items: [
      {
        id: 'staff',
        title: 'কর্মীর তথ্য',
        icon: 'badge',
        route: '/hrm/staff',
        summary: 'কর্মীর প্রোফাইল, বেতন সেটআপ ও আইডি কার্ড',
        steps: [
          'উপরের ট্যাব বার থেকে হাজিরা / বেতন / দোকানের ভাড়া / দৈনিক খরচে যাওয়া যায়; পাশে মূল ব্যালেন্স দেখা যায়।',
          'নতুন কর্মী যোগ করার সময় পদ, মোবাইল, জয়েনিং তারিখ, মাসিক বেতন ও ছবি দিন।',
          'কর্মীর সারি থেকে CR80 সাইজের আইডি কার্ড (৮৫.৬ × ৫৪ মিমি) QR সহ দেখা, PNG ডাউনলোড বা প্রিন্ট করা যায়।',
          'সারিতে ক্লিক করলে বিস্তারিত প্রোফাইল ড্রয়ার খোলে।'
        ]
      },
      {
        id: 'attendance',
        title: 'হাজিরা',
        icon: 'fact_check',
        route: '/hrm/attendance',
        summary: 'QR, ফেস ও স্টেশন QR — তিন পদ্ধতিতে হাজিরা',
        steps: [
          'QR কোড হাজিরা: কর্মীর কার্ডের QR স্ক্যান করুন (EMP-01 ধরনের আইডি)।',
          'ফেস হাজিরা ও স্টেশন QR: একদিনে চার ধাপ — সকালে ইন, খেতে যাওয়া, ফিরে আসা, বাড়ি যাওয়ার সময় আউট।',
          'অফিস শুরুর সময়ের পরে স্ক্যান হলে দেরি হিসাবে ধরা হয়।',
          'ম্যানুয়াল এন্ট্রি দিয়ে ভুল সংশোধন করা যায়; ডিলিট শুধু অনুমতিপ্রাপ্ত ইউজার করতে পারেন।'
        ]
      },
      {
        id: 'leave',
        title: 'ছুটি',
        icon: 'event_busy',
        route: '/hrm/leave',
        summary: 'ছুটির আবেদন, অনুমোদন ও হাজিরা-বেতনে প্রতিফলন',
        steps: [
          'নৈমিত্তিক / অসুস্থতা / বার্ষিক ছুটি বেতনসহ, অবৈতনিক ছুটি বেতনহীন হিসেবে গণ্য হয়।',
          'তারিখের সীমা দিয়ে আবেদন যোগ করুন, পরে অপেক্ষমাণ তালিকা থেকে অনুমোদন বা প্রত্যাখ্যান দিন।',
          'অনুমোদিত ছুটি হাজিরা শিটে স্বয়ংক্রিয়ভাবে যোগ হয়; হাজিরা থাকা দিনে ছুটি পরিবর্তন করে না।',
          'বাতিল করলে ছুটির দিনগুলো হাজিরা ও বেতন থেকে সরে যায়।'
        ]
      },
      {
        id: 'salary',
        title: 'বেতন',
        icon: 'payments',
        route: '/hrm/salary',
        summary: 'মাসিক শিট থেকে বেতন প্রদান ও অগ্রিম সমন্বয়',
        steps: [
          'মাস সিলেক্ট করলে উপস্থিতি, দেরি, ছুটি, দিন-প্রতি হিসাব ও প্রাপ্য বেতনের শিট তৈরি হয়।',
          '“বেতন দিন”-এ ভাতা, কর্তন, অগ্রিম সমন্বয়, ক্যাশ/ব্যাংক অ্যাকাউন্ট, তারিখ ও নোট দিন।',
          'বেতন প্রদান করলে মূল ব্যালেন্স থেকে টাকা কাটে এবং কর্মীর অগ্রিম হিসাব সমন্বয় হয়।',
          'ভুল হলে “বেতন বাতিল” করলে টাকা ও ব্যালেন্স ফিরে আসে।'
        ]
      },
      {
        id: 'staff-advance',
        title: 'স্টাফ অ্যাডভান্স',
        icon: 'handshake',
        route: '/hrm/staff-advance',
        summary: 'কর্মীকে অগ্রিম দেওয়া ও আদায় — ডাটাবেসের স্টাফ ও অ্যাপের অ্যাকাউন্ট থেকে',
        steps: [
          'স্টাফের নাম ডাটাবেস (HRM → Employee Info) থেকে বেছে নিন; পদ, কোড ও মোবাইল দেখানো হয়।',
          '“যে অ্যাকাউন্ট থেকে দিচ্ছেন” থেকে ক্যাশ/ব্যাংক/মোবাইল ব্যাংকিং অ্যাকাউন্ট বেছে টাকা ও তারিখ দিন — সংরক্ষণে মূল ব্যালেন্স থেকে টাকা কমে।',
          'আদায় (Recover) করলে আংশিক আদায়ও হিসাবে ধরা হয় এবং টাকা সেই অ্যাকাউন্টে ফিরে জমা হয়।',
          'বেতন প্রদানের সময় এই অগ্রিম স্বয়ংক্রিয়ভাবে সমন্বয় হয়।'
        ]
      },
      {
        id: 'rent',
        title: 'দোকানের ভাড়া',
        icon: 'storefront',
        route: '/hrm/rent',
        summary: 'খাত, মাস, টাকা ও স্ট্যাটাসসহ ভাড়ার হিসাব',
        steps: [
          'খাত (দোকান/গোডাউন), বিবরণ, মাস, টাকা, অ্যাকাউন্ট, তারিখ ও নোট দিয়ে এন্ট্রি করুন।',
          'স্ট্যাটাস “Paid” হলে তবেই মূল ব্যালেন্স থেকে টাকা কাটে; বাকি (Due) থাকলে কাটে না।'
        ]
      },
      {
        id: 'expenses',
        title: 'দৈনিক খরচ',
        icon: 'receipt_long',
        route: '/hrm/expenses',
        summary: 'দোকান খরচ, বিদ্যুৎ, পরিবহনসহ নানা খরচ',
        steps: [
          'ক্যাটাগরি বেছে নিন — দোকান খরচ, পরিবহন, বিদ্যুৎ বিল, পানির বিল, মোবাইল বিল, চা-নাস্তা, মেরামত, স্টেশনারি, অন্যান্য।',
          'টাকা, তারিখ, অ্যাকাউন্ট ও নোট দিয়ে এন্ট্রি করলে মূল ব্যালেন্স থেকে খরচ কাটে।'
        ]
      }
    ]
  },
  {
    id: 'product',
    title: 'প্রোডাক্ট ম্যানেজার',
    subtitle: 'ব্র্যান্ড থেকে বারকোড পর্যন্ত',
    icon: 'inventory_2',
    tint: 'bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300',
    items: [
      {
        id: 'masters',
        title: 'ব্র্যান্ড, মডেল, ক্যাটাগরি, সাব ক্যাটাগরি ও ভ্যারিয়েশন',
        icon: 'category',
        route: '/product-manager/brands',
        summary: 'পণ্যের মূল তথ্যভাণ্ডার — ব্যবহারে থাকলে ডিলিট ব্লক',
        steps: [
          'প্রতিটি পেজে তালিকা ও কলাম ভিউ বদলানো, সার্চ, এক্সেল ও নতুন যোগ করার সুবিধা আছে।',
          'সারি টেনে (drag) সাজানোর ক্রম বদলানো যায়।',
          'কোনো ব্র্যান্ড/ক্যাটাগরি পণ্যে ব্যবহৃত হলে ডিলিট ব্লক হয় — আগে পণ্যের তথ্য বদলাতে হবে।'
        ]
      },
      {
        id: 'products',
        title: 'পণ্য',
        icon: 'qr_code_2',
        route: '/product-manager/products',
        summary: 'ইউনিক আইটেম কোড, ভ্যারিয়েশন, বিক্রয় ও পাইকারি রেট',
        steps: [
          'প্রতিটি পণ্যের আইটেম কোড ইউনিক হতে হবে; বারকোড প্রিন্টে এই কোডই ব্যবহার হয়।',
          'ভ্যারিয়েশন (সাইজ/রঙ) চালু করলে অন্তত একটি রো দিতে হবে।',
          '“সার্ভিস” টাইপ পণ্যে স্টক হিসাব হয় না।',
          'ওপেনিং স্টক দিলে বিক্রয়/ক্রয়ের লাভ-ক্ষতির হিসাবে প্রভাব পড়ে না — শুধু প্রারম্ভিক স্টক হিসেবে যোগ হয়।',
          'পণ্যের কার্ডে বিক্রয় ও পাইকারি দুটি রেট আলাদা করে সেট করা যায়।'
        ]
      },
      {
        id: 'warranty',
        title: 'প্রোডাক্ট ওয়ারেন্টি',
        icon: 'verified_user',
        route: '/product-manager/warranty',
        summary: 'ভাউচার থেকে অটো ওয়ারেন্টি রেজিস্টার, ক্লেইম ও মেয়াদ হিসাব',
        steps: [
          'প্রোডাক্ট পেজে প্রতিটি পণ্যের “ওয়ারেন্টি মেয়াদ” (দিন) দিন — মেয়াদ ০ থাকলে ওই পণ্যের বিক্রয়/ক্রয় রেজিস্টারে আসবে না।',
          'সম্পন্ন (Completed) বিক্রয় ও ক্রয় ভাউচার থেকেই ওয়ারেন্টি সারি নিজে থেকে তৈরি হয় — শুরু তারিখ ভাউচারের তারিখ, মেয়াদ শেষ = শুরু + মেয়াদ। আলাদা করে সারি যোগ করতে হয় না।',
          'ক্লেইম এন্ট্রি করুন বিক্রয় ফর্মের “ওয়ারেন্টি পণ্য গ্রহণ” সেকশন থেকে (Add Sale বা POS)— ক্লেইম নম্বর (WR সিরিজ) সিস্টেম নিজেই তৈরি করে; ব্যাটারি এবং পুরাতন সিরিয়াল অথবা মূল ইনভয়েস আবশ্যক। সেভ করলে ক্লেইমটি সরাসরি ওয়ারেন্টি গ্রহণ তালিকা, রেজিস্টার ও স্টকে চলে যায়।',
          'ক্লেইমটি পুরাতন সিরিয়াল (নাহলে মূল ইনভয়েস + ব্যাটারি) দিয়ে বিক্রয়ের সাথে মিলিয়ে দেখানো হয়; মিললে ওই সারির স্টেট “ক্লেইম চলছে/প্রতিস্থাপিত” হয়।',
          '“পরিবর্তন সম্পন্ন” দিলে নতুন সিরিয়াল দিন; নতুন ব্যাটারি পণ্যও বেছে দিলে সেই পরিমাণ স্টক থেকে কাটবে। নতুন ব্যাটারি বিক্রয়ের আইটেম হিসেবে আলাদা লাইন হলে পণ্য খালি রাখুন।',
          'ট্যাব: বিক্রয়, ক্রয়, ওয়ারেন্টি ক্লেইম, সম্পন্ন ও মেয়াদোত্তীর্ণ — মেয়াদ শেষ হলে সারি স্বয়ংক্রিয়ভাবে এক্সপায়ার্ড ট্যাবে যায়।',
          'আগের (অ্যাপের বাইরের) বিক্রয়ের জন্য “ম্যানুয়াল এন্ট্রি” দিয়ে সারি যোগ, এডিট বা ডিলিট করা যায়; শুধু এই ম্যানুয়াল সারিগুলোই স্থায়ীভাবে জমা থাকে।',
          'সার্চে কাস্টমার, ফোন, সিরিয়াল, ইনভয়েস, ক্লেইম/রসিদ/ডেলিভারি নম্বর — সবই খোঁজা যায়; “ভাউচার খুলুন” দিয়ে মূল বিক্রয়টি খোলা যায়।'
        ]
      },
      {
        id: 'barcode',
        title: 'বারকোড প্রিন্ট',
        icon: 'barcode_reader',
        route: '/product-manager/print-barcode',
        summary: 'EAN-13 বারকোড, কপি সংখ্যা ও কাগজ মাপ',
        steps: [
          'পণ্য বেছে নিয়ে প্রতি পণ্যের কপি সংখ্যা দিন — ১, ২, ৩, ৫ বা ১০।',
          'কাগজের মাপ ও ফন্ট সেটিংস বদলানো যায়।',
          'প্রিন্ট প্রিভিউ দেখে বারকোড শিট প্রিন্ট করুন।'
        ]
      }
    ]
  },
  {
    id: 'sales',
    title: 'বিক্রয় (Sales)',
    subtitle: 'বিক্রয়, ফেরত ও জমা',
    icon: 'shopping_cart',
    tint: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300',
    items: [
      {
        id: 'sales-list',
        title: 'বিক্রয় তালিকা',
        icon: 'list_alt',
        route: '/sales',
        summary: 'স্ট্যাটাস ট্যাব, ফিল্টার ও প্রতিটি ইনভয়েসের অ্যাকশন',
        steps: [
          'উপরের স্ট্যাটাস ট্যাব (সম্পন্ন/অর্ডার/বাতিল ইত্যাদি) ও সার্চ দিয়ে ইনভয়েস খুঁজুন — সার্চ শর্টকাট “/”।',
          'মোট বিক্রয়, পরিশোধ ও বাকির যোগফল ট্যাব অনুযায়ী দেখা যায়; কলাম পছন্দমতো দেখানো/লুকানো যায়।',
          'ইনভয়েসের অ্যাকশন মেনু থেকে Edit, View Payments, Add New Payment, POS Invoice, Add Expense, Download, Print ও Delete করা যায়।',
          'যে ইনভয়েসে ওয়ারেন্টি ক্লেইম আছে সেখানে ইনভয়েস নম্বরের নিচে ছোট “ওয়ারেন্টি” ব্যাজ দেখায়।',
          'লক করা অর্ডারে পরিবর্তনের আগে Admin PIN চাইবে।'
        ]
      },
      {
        id: 'add-sale',
        title: 'নতুন বিক্রয়',
        icon: 'add_shopping_cart',
        route: '/sales/add',
        summary: 'গ্রাহক, পণ্য, চার্জ ও পুরাতন ব্যাটারি ক্রেডিটসহ পূর্ণ বিল',
        steps: [
          'গ্রাহক বেছে নিন (Walk In সম্ভব), ভাউচার নম্বর ও তারিখ দিন; প্রয়োজন হলে “পাইকারি” টগল করুন।',
          'পণ্য সার্চ বা বারকোড স্ক্যান করে যোগ করুন — স্টকের বেশি দিলে স্বয়ংক্রিয়ভাবে সীমা বসে।',
          'ডিসকাউন্ট, ভ্যাট/ট্যাক্স, ড্যামেজ, শিপিং, পুরাতন ব্যাটারি ক্রেডিট, ফেরত পণ্য ও ওয়ারেন্টি ব্যাটারি দাবি যোগ করুন।',
          'FINAL ACCOUNT SUMMARY-তে মোট, পরিশোধ, বাকি ও অগ্রিম দেখে সংরক্ষণ করুন।',
          'ভাউচার নম্বর ইউনিক হতে হবে; Walk In গ্রাহকের বাকি রাখা যাবে না; পরিশোধ = নগদ + ব্যাংক।',
          'অসম্পূর্ণ অবস্থায় পেজ ছাড়লে “পরিবর্তন সংরক্ষণ হয়নি” সতর্কতা আসে।'
        ]
      },
      {
        id: 'sales-returns',
        title: 'বিক্রয় ফেরত / ক্রেডিট নোট',
        icon: 'assignment_return',
        route: '/sales/returns',
        summary: 'ফেরত পণ্য, ক্রেডিট নোট ও স্টক ফেরত',
        steps: [
          'ট্যাব থেকে ফেরত তালিকা দেখুন বা নতুন ক্রেডিট নোট তৈরি করুন।',
          'ইনভয়েস বেছে নিয়ে ফেরত পণ্য ও পরিমাণ দিন; ক্রেডিট নোট নম্বর আলাদা করে তৈরি হয়।',
          'স্ট্যাটাস “Posted” হলে তবেই পণ্য স্টকে ফিরে যায়।'
        ]
      },
      {
        id: 'payment-in',
        title: 'পেমেন্ট ইন (নতুন ডিজাইন)',
        icon: 'price_check',
        route: '/sales/payment-in',
        tag: 'নতুন',
        summary: 'গ্রাহকের কাছ থেকে নগদ/ব্যাংক/বিকাশ/নাগাদে জমা',
        steps: [
          '“নতুন জমা” চাপলে পূর্ণ-স্ক্রিন এন্ট্রি ফর্ম খোলে; বাতিল করলে তালিকায় ফিরে আসে।',
          'গ্রাহক সিলেক্ট করুন — মোট বিক্রয়, মোট জমা ও বর্তমান বকেয়া তিনটি স্ট্যাট কার্ডে দেখা যায়।',
          'উপরের বাটন থেকে “সম্পূর্ণ বকেয়া”, “অর্ধেক” বা “কাস্টম” — এক ক্লিকে জমার পরিমাণ বসান।',
          'মাধ্যম (নগদ/ব্যাংক/বিকাশ/নাগাদ) বেছে নিয়ে পরিমাণ ও ডিসকাউন্ট/মাফ লিখুন; ডান পাশে জমার পরের বকেয়া ও অগ্রিম লাইভ আপডেট হয়।',
          'তারিখ ও নোট দিয়ে “জমা করুন” চাপুন — জমা লেজারে যায় ও গ্রাহকের বকেয়া কমে; বেশি দিলে অতিরিক্ত অংশ অগ্রিম থাকে।',
          'তালিকে মাধ্যমভিত্তিক ট্যাব ও সার্চ আছে; ডিলিট করলে লেজার ও বকেয়া আগের অবস্থায় ফিরে যায় (অনুমতি সাপেক্ষে)।'
        ],
        note: 'একটি রসিদে এক মাধ্যমেই জমা হয়। একাধিক মাধ্যমে নিলে আলাদা রসিদ করুন — এতে হিসাব মিলতে সুবিধা হয়।'
      }
    ]
  },
  {
    id: 'purchases',
    title: 'ক্রয় (Purchases)',
    subtitle: 'সাপ্লায়ার, ফেরত, রিকোয়েস্ট ও পরিশোধ',
    icon: 'shopping_bag',
    tint: 'bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-300',
    items: [
      {
        id: 'purchases-list',
        title: 'ক্রয় তালিকা',
        icon: 'format_list_bulleted',
        route: '/purchases',
        summary: 'প্রাপ্ত/পেন্ডিং/অর্ডার/ম্যানুফ্যাকচারিং ট্যাব',
        steps: [
          'স্ট্যাটাস ট্যাব ও সার্চ দিয়ে ক্রয় খুঁজুন; মোট, পরিশোধ ও বাকি উপরে দেখা যায়।',
          'সাপ্লায়ার অনুযায়ী ফিল্টার করে পাওনা মিলিয়ে নিতে পারেন।',
          'প্রতিটি ক্রয়ের অ্যাকশন থেকে বিস্তারিত, পেমেন্ট বা প্রিন্ট করা যায়।'
        ]
      },
      {
        id: 'add-purchase',
        title: 'নতুন ক্রয়',
        icon: 'post_add',
        route: '/purchases/add',
        summary: 'সাপ্লায়ার, পণ্য, স্টক ও পরিশোধের ভ্যালিডেশনসহ',
        steps: [
          'সাপ্লায়ার বেছে নিন, ভাউচার নম্বর ও তারিখ দিন।',
          'পণ্য যোগ করে পরিমাণ ও ক্রয়মূল্য দিন — স্টক ও মোট নিজে থেকেই হিসাব হয়।',
          'পরিশোধের চেয়ে বেশি টাকা দেওয়া যাবে না; ভাউচার নম্বর ইউনিক হতে হবে।',
          'সেভ করলে পণ্য স্টকে যোগ হয় এবং সাপ্লায়ারের পাওনা আপডেট হয়।'
        ]
      },
      {
        id: 'purchase-returns',
        title: 'ক্রয় ফেরত / ডেবিট নোট',
        icon: 'assignment_return',
        route: '/purchases/returns',
        summary: 'সাপ্লায়ারকে পণ্য ফেরত ও সমন্বয়',
        steps: [
          'ফেরত তালিকা দেখুন বা নতুন ডেবিট নোট তৈরি করুন।',
          'ক্রয় বেছে নিয়ে ফেরত পণ্য ও পরিমাণ দিন; স্টক কমে ও সাপ্লায়ারের পাওনা সমন্বয় হয়।'
        ]
      },
      {
        id: 'online-requests',
        title: 'অনলাইন রিকোয়েস্ট',
        icon: 'support_agent',
        route: '/purchases/online-requests',
        summary: 'গ্রাহকের অনলাইন অর্ডার/রিকোয়েস্ট ব্যবস্থাপনা',
        steps: [
          'নতুন / যোগাযোগ হয়েছে / নিশ্চিত / বাতিল — স্ট্যাটাস ট্যাবে রিকোয়েস্ট দেখুন।',
          'রিকোয়েস্ট থেকে ক্রয় বা বিক্রয়ে রূপান্তর করে প্রক্রিয়া শেষ করুন।'
        ]
      },
      {
        id: 'payment-out',
        title: 'পেমেন্ট আউট (নতুন ডিজাইন)',
        icon: 'request_quote',
        route: '/purchases/payment-out',
        tag: 'নতুন',
        summary: 'সাপ্লায়ারকে নগদ/ব্যাংক/বিকাশ/নাগাদে পরিশোধ',
        steps: [
          '“নতুন পরিশোধ” চাপলে পূর্ণ-স্ক্রিন এন্ট্রি ফর্ম খোলে।',
          'সাপ্লায়ার সিলেক্ট করুন — মোট ক্রয়, মোট পরিশোধিত ও বর্তমান পাওনা স্ট্যাট কার্ডে দেখা যায়।',
          '“সম্পূর্ণ পাওনা”, “অর্ধেক” বা “কাস্টম” বাটনে এক ক্লিকে পরিমাণ বসান।',
          'মাধ্যম, টাকা, ডিসকাউন্ট/মাফ, তারিখ ও নোট দিন; ডান পাশের সারসংক্ষেপে পরিশোধের পরের পাওনা ও অগ্রিম লাইভ দেখায়।',
          '“পরিশোধ করুন” চাপলে সাপ্লায়ারের পাওনা কমে; অতিরিক্ত দিলে অগ্রিম হিসেবে থেকে যায়।',
          'তালিকে মাধ্যমভিত্তিক ট্যাব, সার্চ, বাকি/অগ্রিম স্ট্যাট ও Excel/Print আছে; ডিলিট করলে হিসাব আগের অবস্থায় ফেরে।'
        ],
        note: 'বিক্রয়ের মতো এখানেও এক রসিদে এক মাধ্যম। ভাগ করে দিলে আলাদা রসিদ রাখুন।'
      }
    ]
  },
  {
    id: 'battery',
    title: 'পুরাতন ব্যাটারি ম্যানেজমেন্ট',
    subtitle: 'কেজি/পিস হিসাবে ক্রয়-বিক্রয় ও বদল',
    icon: 'recycling',
    tint: 'bg-lime-50 text-lime-600 dark:bg-lime-950/60 dark:text-lime-300',
    items: [
      {
        id: 'battery-views',
        title: 'ব্যাটারি ক্রয়, বিক্রয় ও বদল',
        icon: 'battery_charging_full',
        route: '/battery/purchase',
        summary: 'একই কম্পোনেন্টে এন্ট্রি, ভাউচার ও লেজার ভিউ',
        steps: [
          'এন্ট্রি ভিউতে পার্টি (বা “নতুন কাস্টমার যোগ করুন”), তারিখ, লট/স্টক রেফারেন্স দিন।',
          'প্রতিটি লাইনে ব্যাটারির ধরন, ওজন/পিস, রেট ও পরিমাণ দিন — নিচে স্টক স্ট্রিপে বর্তমান মজুদ দেখায়।',
          'নগদ ও বাকি লিখে ভাউচার সংরক্ষণ করুন।',
          'পণ্য বিক্রয়ের সময় পুরাতন ব্যাটারি নিলে সেখান থেকেই অটো ভাউচার তৈরি হয়।',
          'ভাউচার তালিকা থেকে পুরোনো এন্ট্রি খুঁজুন; লেজার ভিউতে দিনভিত্তিক ইন/আউট ও স্টক ব্যালেন্স দেখা যায়।',
          'স্টকের বেশি বিক্রি করা যাবে না; সম্পাদনা/ডিলিটে Admin PIN লাগে এবং বিক্রয় থেকে তৈরি লাইন শুধু বিক্রয় পেজ থেকেই এডিট হয়।'
        ]
      }
    ]
  },
  {
    id: 'stock',
    title: 'স্টক, ড্যামেজ ও POS',
    subtitle: 'মজুদ, ক্ষতি ও দ্রুত বিক্রয়',
    icon: 'warehouse',
    tint: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-950/60 dark:text-cyan-300',
    items: [
      {
        id: 'stock',
        title: 'স্টক রিপোর্ট',
        icon: 'inventory',
        route: '/stock',
        summary: 'মোট পণ্য, কম স্টক, ভ্যালুয়েশন ও ব্র্যান্ডভিত্তিক তালিকা',
        steps: [
          'উপরে মোট পণ্য, কম স্টক, যথেষ্ট স্টক ও মোট স্টক ভ্যালুয়েশন দেখা যায়।',
          'টেবিলে পণ্যভিত্তিক বর্তমান স্টক ও মূল্য দেখুন; সার্চ ও ব্র্যান্ড ফিল্টার আছে।',
          'Excel এক্সপোর্টে ব্র্যান্ড, ইউনিট, ক্রয়মূল্য, অ্যালার্ট পরিমাণ (ডিফল্ট ৫) ও স্টক স্ট্যাটাস কলাম যায়।'
        ]
      },
      {
        id: 'damage',
        title: 'ড্যামেজ রেকর্ড',
        icon: 'report_problem',
        route: '/damage',
        summary: 'নষ্ট পণ্য লিখে রাখা ও স্টক সমন্বয়',
        steps: [
          'ট্যাব ও চিপস দিয়ে ড্যামেজ রেকর্ড দেখুন।',
          'পণ্য, পরিমাণ, কারণ ও তারিখ দিয়ে নতুন ড্যামেজ এন্ট্রি করুন।',
          '“স্টক থেকে কাটুন” চালু থাকলে স্টক কমে; বন্ধ থাকলে শুধু রেকর্ড থাকে।',
          'এন্ট্রি সম্পাদনা করলে স্টক আবার নতুন করে সমন্বয় হয়।'
        ]
      },
      {
        id: 'pos',
        title: 'POS',
        icon: 'point_of_sale',
        route: '/pos',
        summary: 'দোকানে দ্রুত বিক্রয়ের গ্রিড + কার্ট',
        steps: [
          'মোবাইলে গ্রিড ও কার্ট ট্যাব বদলে ব্যবহার করুন; গ্রাহক সার্চে আগের বকেয়াও দেখা যায়।',
          'শর্টকাট: F2 (সার্চ/ফোকাস), F4 (পরিশোধ), F8 (নতুন সেল), Esc (বন্ধ)।',
          'চেকআউটে পুরাতন ব্যাটারি, ফেরত পণ্য ও ওয়ারেন্টি দাবি যোগ করা যায়।',
          'পেমেন্ট মডালে নগদ গ্রহণ, ফেরত ও বাকি দেখায়; সম্পন্ন হলে রসিদ প্রিন্ট হয়।',
          'স্টক শূন্য পণ্য যোগ করা যায় না, স্টকের বেশি পরিমাণ অটো সীমিত হয়; দাম এডিটের অনুমতি না থাকলে রেট লক থাকে।',
          'কার্টে পণ্য থাকা অবস্থায় পেজ ছাড়লে সতর্কতা আসে।'
        ]
      }
    ]
  },
  {
    id: 'accounts',
    title: 'হিসাব ও রিপোর্ট',
    subtitle: 'লেজার, ক্যাশ ব্যালেন্স ও লাভ-ক্ষতি',
    icon: 'account_balance',
    tint: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300',
    items: [
      {
        id: 'accounts',
        title: 'হিসাব সারসংক্ষেপ',
        icon: 'menu_book',
        route: '/accounts',
        summary: 'কাস্টমার পাওনা, সাপ্লায়ার পাওনা ও লেজার',
        steps: [
          'উপরে কাস্টমারের কাছে পাওনা, সাপ্লায়ারকে পাওনা ও আজকের আদায় দেখা যায়।',
          'ট্যাব থেকে কাস্টমার লেজার / সাপ্লায়ার লেজার / পেমেন্ট হিস্ট্রি দেখুন।',
          'পার্টি বেছে নিলে বিক্রয়, ক্রয়, জমা ও ফেরতের পূর্ণ লেজার হিসাব মেলে।',
          'এই পেজ শুধু হিসাবের অনুমতি থাকা ইউজার দেখতে পারেন।'
        ]
      },
      {
        id: 'cash-bank',
        title: 'ক্যাশ ও ব্যাংক',
        icon: 'savings',
        route: '/cash-bank',
        summary: 'দিনের ক্যাশ গণনা ও ক্লোজিং',
        steps: [
          'দিনের বিক্রয়, খরচ ও জমার ভিত্তিতে প্রত্যাশিত ক্যাশ দেখা যায়।',
          'ক্লোজিং ফর্মে প্রারম্ভিক ক্যাশ, গণনা করা ক্যাশ ও নোট দিন — মিলে গেছে / কম / বেশি স্বয়ংক্রিয়ভাবে দেখায়।',
          'প্রিন্টযোগ্য সারসংক্ষেপ ও আগের দিনগুলোর হিস্ট্রি রাখা যায়।'
        ]
      },
      {
        id: 'reports',
        title: 'রিপোর্ট',
        icon: 'analytics',
        route: '/reports',
        summary: 'লাভ-ক্ষতি, পণ্য, ক্যাটাগরি ও স্টক ভ্যালুয়েশন',
        steps: [
          'তারিখ রেঞ্জ বেছে ট্যাব থেকে লাভ/ক্ষতি, পণ্যভিত্তিক, ক্যাটাগরিভিত্তিক বা স্টক ভ্যালুয়েশন দেখুন।',
          'লাভের হিসাবে বিক্রয়, খরচ ও ক্রয়মূল্য পাশাপাশি দেখায়; নগদ প্রবাহও আলাদা প্যানেলে থাকে।',
          'যে পণ্যের ক্রয়মূল্য অজানা, তার পাশে “*” চিহ্ন থাকে এবং খরচ ০ ধর হয়।'
        ]
      }
    ]
  },
  {
    id: 'settings',
    title: 'সেটিংস ও রক্ষণাবেক্ষণ',
    subtitle: 'ব্যবসার তথ্য, ব্যাকআপ, ইউজার ও রিসাইকেল বিন',
    icon: 'settings',
    tint: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    items: [
      {
        id: 'settings',
        title: 'সেটিংস',
        icon: 'tune',
        route: '/settings',
        summary: 'ব্যবসার তথ্য, ক্লাউড সিঙ্ক, ব্যাকআপ, ইউজার ও অডিট লগ',
        steps: [
          'ব্যবসার তথ্য: নাম, ঠিকানা, মোবাইল, লোগো — ভাউচারে এই তথ্য ছাপা হয়।',
          'ক্লাউড ও ছবি: Supabase সংযোগের অবস্থা, পুশ/পুল ও অটো-সিঙ্ক।',
          'ফাইল ডাটা ব্যাকআপ: JSON ডাউনলোড/পুনরুদ্ধার অথবা Google Drive ব্যাকআপ।',
          'ইউজার ও রোল: নতুন ইউজার যোগ এবং অনুমতি ম্যাট্রিক্স (রিপোর্ট, হিসাব, সেটিংস, ডিলিট ইত্যাদি) নিয়ন্ত্রণ।',
          'অডিট লগ: কে কখন কী পরিবর্তন করেছে তা দেখা ও এক্সপোর্ট।'
        ],
        note: 'অনুমতি ম্যাট্রিক্স বদলালেই সাইডবার মেনু ও বাটনের সুবিধা সাথে সাথে বদলে যায়।'
      },
      {
        id: 'recycle-bin',
        title: 'রিসাইকেল বিন',
        icon: 'delete',
        route: '/recycle-bin',
        summary: 'ডিলিট করা সর্বশেষ ২০০০ রেকর্ড ফিরিয়ে আনা',
        steps: [
          'ডিলিট করা সর্বশেষ ২০০০ রেকর্ড এখানে দেখা যায়।',
          '“ফিরিয়ে আনুন” চাপলে রেকর্ড পুনরুদ্ধার হয়; একই তথ্য আগে থেকে থাকলে ডুপ্লিকেট সতর্কতা আসে।',
          '“স্থায়ীভাবে মুছুন” বা “সব স্থায়ীভাবে মুছুন” চিরতরে ডিলিট করে — সতর্ক থাকুন।',
          'এই পেজ দেখতে ইউজার ম্যানেজমেন্টের অনুমতি লাগে।'
        ]
      }
    ]
  }
];

const HOUSE_RULES = [
  { icon: 'save', title: 'কাজ শেষে সংরক্ষণ করুন', text: 'বিক্রয়, ক্রয়, POS বা ব্যাটারি এন্ট্রি অসম্পূর্ণ রেখে পেজ ছাড়লে “পরিবর্তন সংরক্ষণ হয়নি” সতর্কতা আসে। ভুলে সেভ না করে বের হলে কাজ হারাতে পারে।' },
  { icon: 'lock', title: 'লক করা অর্ডারে Admin PIN', text: 'লক করা বিক্রয়/ক্রয় পরিবর্তন এবং ব্যাটারি ভাউচার সম্পাদনা-ডিলিটে Admin পিন লাগে। এতে ভুলে পুরোনো হিসাব নষ্ট হওয়া থেকে সুরক্ষা মেলে।' },
  { icon: 'verified_user', title: 'ডিলিট করার অনুমতি আলাদা', text: 'সব ইউজার ডিলিট করতে পারেন না — সেটিংসের ইউজার ও রোলে “ডিলিট রেকর্ডস” অনুমতি থাকলে তবেই ডিলিট বাটন দেখা যায়।' },
  { icon: 'backup', title: 'নিয়মিত ব্যাকআপ রাখুন', text: 'সেটিংস → ফাইল ডাটা ব্যাকআপ থেকে JSON ডাউনলোড করুন। ক্লাউড অটো-সিঙ্ক চালু থাকলে ডাটা Supabase-এ নিয়মিত জমা হয়।' }
];

@Component({
  selector: 'app-app-info',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, RouterLink],
  styles: `
    @media print {
      .no-print { display: none !important; }
      .guide-card { break-inside: avoid; }
    }
  `,
  template: `
    <div class="space-y-4 text-xs text-slate-800 select-none dark:text-slate-200">

      <!-- Page head -->
      <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div class="flex min-w-0 flex-1 items-center gap-3.5">
            <div class="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-teal-600 to-teal-600 text-white shadow-lg shadow-teal-900/25">
              <mat-icon class="text-2xl">menu_book</mat-icon>
            </div>
            <div class="min-w-0">
              <h1 class="text-lg font-bold leading-tight text-slate-900 dark:text-white">এ্যাপ সম্পর্কিত তথ্য <span class="text-sm font-semibold text-slate-400 dark:text-slate-500">/ App Guide</span></h1>
              <p class="text-[11.5px] text-slate-500 dark:text-slate-400">SM Enterprise ব্যবহারের সম্পূর্ণ গাইড — প্রতিটি মেনু কী কাজ করে, কোথায় কী লিখবেন</p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2 no-print">
            <button (click)="printGuide()" class="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11.5px] font-bold text-slate-600 transition hover:border-teal-300 hover:bg-teal-50/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer">
              <mat-icon class="text-base">print</mat-icon> গাইড প্রিন্ট
            </button>
            <button (click)="toggleAll()" class="inline-flex items-center gap-1 rounded-xl bg-gradient-to-br from-teal-600 to-teal-600 px-4 py-2 text-[11.5px] font-bold text-white shadow-md shadow-teal-900/25 transition hover:brightness-110 cursor-pointer">
              <mat-icon class="text-base">{{ allOpen() ? 'unfold_less' : 'unfold_more' }}</mat-icon>
              {{ allOpen() ? 'সব বন্ধ করুন' : 'সব খুলুন' }}
            </button>
          </div>
        </div>

        <div class="mt-4 flex flex-col gap-2.5 lg:flex-row lg:items-center">
          <div class="relative flex-1">
            <mat-icon class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-lg">search</mat-icon>
            <input
              type="text"
              [ngModel]="query()"
              (ngModelChange)="query.set($event)"
              placeholder="গাইডে খুঁজুন — যেমন: বাকি, ফেরত, বেতন, পেমেন্ট ইন..."
              class="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-9 text-[12px] text-slate-800 placeholder-slate-400 focus:border-teal-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:focus:bg-slate-900"
            />
            @if (query()) {
              <button (click)="query.set('')" class="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer" title="মুছুন">
                <mat-icon class="text-base">close</mat-icon>
              </button>
            }
          </div>
          <div class="flex flex-wrap items-center gap-1.5 no-print">
            @for (s of shortcuts; track s.route) {
              <a [routerLink]="s.route" class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10.5px] font-bold text-slate-600 transition hover:border-teal-300 hover:bg-teal-50/60 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
                <mat-icon class="text-[14px] w-[14px] h-[14px]">{{ s.icon }}</mat-icon>
                {{ s.label }}
              </a>
            }
          </div>
        </div>
      </section>

      <!-- Search result strip -->
      @if (query().trim()) {
        <div class="flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50/70 px-3 py-2 text-[11.5px] font-semibold text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300">
          <mat-icon class="text-base">manage_search</mat-icon>
          “{{ query().trim() }}” — {{ visibleCount() }} টি বিষয় {{ visibleGroups().length }} টি গ্রুপে পাওয়া গেছে
        </div>
      }

      @for (g of visibleGroups(); track g.id) {
        <section class="guide-card rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <header class="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <span [class]="'grid h-9 w-9 shrink-0 place-items-center rounded-xl ' + g.tint">
              <mat-icon class="text-lg">{{ g.icon }}</mat-icon>
            </span>
            <div class="min-w-0 flex-1">
              <h2 class="text-[13px] font-bold text-slate-900 dark:text-white">{{ g.title }}</h2>
              <p class="text-[10.5px] text-slate-500 dark:text-slate-400">{{ g.subtitle }}</p>
            </div>
            <span class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">{{ g.items.length }}</span>
          </header>

          <div class="space-y-2 p-3">
            @for (item of g.items; track item.id; let idx = $index) {
              <article class="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/40 dark:border-slate-800 dark:bg-slate-950/30">
                <button
                  type="button"
                  (click)="toggle(item.id)"
                  class="flex w-full items-start gap-3 px-3.5 py-3 text-left transition hover:bg-slate-100/70 dark:hover:bg-slate-800/40 cursor-pointer"
                >
                  <span [class]="'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ' + g.tint">
                    <mat-icon class="text-base">{{ item.icon }}</mat-icon>
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="flex flex-wrap items-center gap-1.5">
                      <span class="text-[12.5px] font-bold text-slate-900 dark:text-white">{{ item.title }}</span>
                      @if (item.tag) {
                        <span class="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">{{ item.tag }}</span>
                      }
                    </span>
                    <span class="mt-0.5 block text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{{ item.summary }}</span>
                  </span>
                  <mat-icon class="mt-0.5 shrink-0 text-slate-400 transition-transform duration-200 dark:text-slate-500" [class.rotate-180]="isOpen(item.id)">expand_more</mat-icon>
                </button>

                @if (isOpen(item.id)) {
                  <div class="border-t border-slate-200 px-3.5 py-3 dark:border-slate-800">
                    <ol class="space-y-2">
                      @for (step of item.steps; track $index) {
                        <li class="flex gap-2.5">
                          <span class="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-teal-600/10 text-[10px] font-black text-teal-700 dark:bg-teal-500/15 dark:text-teal-300">{{ $index + 1 }}</span>
                          <span class="text-[11.5px] leading-relaxed text-slate-600 dark:text-slate-300">{{ step }}</span>
                        </li>
                      }
                    </ol>

                    @if (item.note) {
                      <p class="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                        <mat-icon class="text-sm shrink-0">info</mat-icon>
                        <span>{{ item.note }}</span>
                      </p>
                    }

                    @if (item.route) {
                      <a [routerLink]="item.route" class="mt-3 inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-[11px] font-bold text-teal-700 transition hover:bg-teal-100 dark:border-teal-900 dark:bg-teal-950/50 dark:text-teal-300 dark:hover:bg-teal-900/50 no-print">
                        পেজে যান
                        <mat-icon class="text-sm">arrow_forward</mat-icon>
                      </a>
                    }
                  </div>
                }
              </article>
            }
          </div>
        </section>
      } @empty {
        <div class="rounded-2xl border border-slate-200 bg-white px-4 py-14 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <mat-icon class="mb-2 block text-3xl text-slate-300 dark:text-slate-600">search_off</mat-icon>
          <p class="text-sm font-bold text-slate-700 dark:text-slate-200">“{{ query().trim() }}” খুঁজে পাওয়া যায়নি</p>
          <p class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">অন্য শব্দ লিখে দেখুন — যেমন: বিক্রয়, বকেয়া, ব্যাকআপ, হাজিরা।</p>
          <button (click)="query.set('')" class="mt-3 rounded-xl bg-teal-600 px-4 py-2 text-[11.5px] font-bold text-white hover:brightness-110 cursor-pointer">সব দেখুন</button>
        </div>
      }

      <!-- House rules -->
      <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div class="mb-3 flex items-center gap-2.5">
          <span class="grid h-9 w-9 place-items-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-300">
            <mat-icon class="text-lg">gavel</mat-icon>
          </span>
          <div>
            <h2 class="text-[13px] font-bold text-slate-900 dark:text-white">ব্যবহারের সাধারণ নিয়মাবলী</h2>
            <p class="text-[10.5px] text-slate-500 dark:text-slate-400">নিরাপদ ও নির্ভুল হিসাবের জন্য যা মনে রাখবেন</p>
          </div>
        </div>
        <div class="grid gap-2.5 md:grid-cols-2">
          @for (r of houseRules; track r.title) {
            <div class="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-950/30">
              <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-slate-500 shadow-sm dark:bg-slate-800 dark:text-slate-300">
                <mat-icon class="text-base">{{ r.icon }}</mat-icon>
              </span>
              <div class="min-w-0">
                <p class="text-[12px] font-bold text-slate-900 dark:text-white">{{ r.title }}</p>
                <p class="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{{ r.text }}</p>
              </div>
            </div>
          }
        </div>
      </section>

      <p class="pb-2 text-center text-[10.5px] text-slate-400 dark:text-slate-500">
        SM Enterprise — ইনভেন্টরি, বিক্রয় ও হিসাব সিস্টেম · গাইডটি অ্যাপের বর্তমান ফিচার অনুযায়ী তৈরি
      </p>
    </div>
  `
})
export class AppInfo {
  readonly shortcuts = SHORTCUTS;
  readonly houseRules = HOUSE_RULES;
  readonly query = signal('');
  private readonly expanded = signal<Record<string, boolean>>({});

  readonly visibleGroups = computed<GuideGroup[]>(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return GROUPS;
    return GROUPS
      .map(group => {
        const groupHit = (group.title + ' ' + group.subtitle).toLowerCase().includes(q);
        const items = groupHit ? group.items : group.items.filter(item => this.matches(item, q));
        return { ...group, items };
      })
      .filter(group => group.items.length > 0);
  });

  readonly visibleCount = computed(() =>
    this.visibleGroups().reduce((sum, group) => sum + group.items.length, 0)
  );

  readonly allOpen = computed(() => {
    const items = this.visibleGroups().flatMap(g => g.items);
    return items.length > 0 && items.every(i => this.isOpen(i.id));
  });

  isOpen(id: string): boolean {
    return this.expanded()[id] === true || this.query().trim().length > 0;
  }

  toggle(id: string): void {
    this.expanded.update(map => ({ ...map, [id]: !this.isOpen(id) }));
  }

  toggleAll(): void {
    if (this.allOpen()) {
      this.expanded.set({});
      this.query.set('');
      return;
    }
    const map: Record<string, boolean> = {};
    this.visibleGroups().forEach(g => g.items.forEach(i => (map[i.id] = true)));
    this.expanded.set(map);
  }

  printGuide(): void {
    this.expanded.set(Object.fromEntries(GROUPS.flatMap(g => g.items.map(i => [i.id, true]))));
    setTimeout(() => window.print(), 60);
  }

  private matches(item: GuideItem, q: string): boolean {
    return (item.title + ' ' + item.summary + ' ' + (item.note ?? '') + ' ' + item.steps.join(' '))
      .toLowerCase()
      .includes(q);
  }
}
