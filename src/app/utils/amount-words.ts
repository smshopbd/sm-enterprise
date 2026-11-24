const EN_UNITS = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
];
const EN_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function enInteger(n: number): string {
  let str = '';
  if (n >= 10000000) {
    str += enInteger(Math.floor(n / 10000000)) + ' Crore ';
    n %= 10000000;
  }
  if (n >= 100000) {
    str += enInteger(Math.floor(n / 100000)) + ' Lakh ';
    n %= 100000;
  }
  if (n >= 1000) {
    str += enInteger(Math.floor(n / 1000)) + ' Thousand ';
    n %= 1000;
  }
  if (n >= 100) {
    str += enInteger(Math.floor(n / 100)) + ' Hundred ';
    n %= 100;
  }
  if (n > 0) {
    if (str !== '') str += 'And ';
    if (n < 20) {
      str += EN_UNITS[n] + ' ';
    } else {
      str += EN_TENS[Math.floor(n / 10)];
      if (n % 10 > 0) str += ' ' + EN_UNITS[n % 10];
      str += ' ';
    }
  }
  return str.trim();
}

const BN_ONES = [
  'শূন্য', 'এক', 'দুই', 'তিন', 'চার', 'পাঁচ', 'ছয়', 'সাত', 'আট', 'নয়', 'দশ',
  'এগারো', 'বারো', 'তেরো', 'চৌদ্দ', 'পনেরো', 'ষোলো', 'সতেরো', 'আঠারো', 'উনিশ'
];

const BN_TWENTIES = [
  'বিশ', 'একুশ', 'বাইশ', 'তেইশ', 'চব্বিশ', 'পঁচিশ', 'ছাব্বিশ', 'সাতাশ', 'আটাশ', 'ঊনত্রিশ',
  'ত্রিশ', 'একত্রিশ', 'বত্রিশ', 'তেত্রিশ', 'চৌত্রিশ', 'পঁয়ত্রিশ', 'ছত্রিশ', 'সাঁইত্রিশ', 'আটত্রিশ', 'ঊনচল্লিশ',
  'চল্লিশ', 'একচল্লিশ', 'বিয়াল্লিশ', 'তেতাল্লিশ', 'চুয়াল্লিশ', 'পঁয়তাল্লিশ', 'ছেচল্লিশ', 'সাতচল্লিশ', 'আটচল্লিশ', 'ঊনপঞ্চাশ',
  'পঞ্চাশ', 'একান্ন', 'বায়ান্ন', 'তিপ্পান্ন', 'চুয়ান্ন', 'পঞ্চান্ন', 'ছাপ্পান্ন', 'সাতান্ন', 'আটান্ন', 'ঊনষাট',
  'ষাট', 'একষট্টি', 'বাষট্টি', 'তেষট্টি', 'চৌষট্টি', 'পঁয়ষট্টি', 'ছেষট্টি', 'সাতষট্টি', 'আটষট্টি', 'ঊনসত্তর',
  'সত্তর', 'একাত্তর', 'বাহাত্তর', 'তিয়াত্তর', 'চুয়াত্তর', 'পঁচাত্তর', 'ছিয়াত্তর', 'সাতাত্তর', 'আটাত্তর', 'ঊনআশি',
  'আশি', 'একাশি', 'বিরাশি', 'তিরাশি', 'চুরাশি', 'পঁচাশি', 'ছিয়াশি', 'সাতাশি', 'আটাশি', 'ঊননব্বই',
  'নব্বই', 'একানব্বই', 'বিরানব্বই', 'তিরানব্বই', 'চুরানব্বই', 'পঁচানব্বই', 'ছিয়ানব্বই', 'সাতানব্বই', 'আটানব্বই', 'নিরানব্বই'
];

const BN_HUNDREDS = ['একশ', 'দুইশ', 'তিনশ', 'চারশ', 'পাঁচশ', 'ছয়শ', 'সাতশ', 'আটশ', 'নয়শ'];

function bnUnder100(n: number): string {
  if (n < 20) return BN_ONES[n];
  return BN_TWENTIES[n - 20];
}

function bnInteger(n: number): string {
  const parts: string[] = [];
  if (n >= 10000000) {
    parts.push(bnInteger(Math.floor(n / 10000000)) + ' কোটি');
    n %= 10000000;
  }
  if (n >= 100000) {
    parts.push(bnUnder100(Math.floor(n / 100000)) + ' লক্ষ');
    n %= 100000;
  }
  if (n >= 1000) {
    parts.push(bnUnder100(Math.floor(n / 1000)) + ' হাজার');
    n %= 1000;
  }
  if (n >= 100) {
    parts.push(BN_HUNDREDS[Math.floor(n / 100) - 1]);
    n %= 100;
  }
  if (n > 0) parts.push(bnUnder100(n));
  return parts.join(' ');
}

function splitTakaPaisa(amount: number): { taka: number; paisa: number } {
  const safe = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  let taka = Math.floor(safe + 1e-6);
  let paisa = Math.round((safe - taka) * 100);
  if (paisa >= 100) {
    taka += 1;
    paisa -= 100;
  }
  return { taka, paisa };
}

export function takaInWordsBn(amount: number): string {
  const { taka, paisa } = splitTakaPaisa(amount);
  if (taka === 0 && paisa === 0) return 'শূন্য টাকা মাত্র';
  let text = `${taka === 0 ? 'শূন্য' : bnInteger(taka)} টাকা`;
  if (paisa > 0) text += ` এবং ${bnInteger(paisa)} পয়সা`;
  return `${text} মাত্র`;
}

export function takaInWordsEn(amount: number): string {
  const { taka, paisa } = splitTakaPaisa(amount);
  if (taka === 0 && paisa === 0) return 'Zero Taka Only';
  let result = (taka === 0 ? 'Zero' : enInteger(taka)) + ' Taka';
  if (paisa > 0) result += ' And ' + enInteger(paisa) + ' Paisa';
  return (result + ' Only').replace(/\s+/g, ' ');
}

/** Amount in words in the app language: Bengali words for Bengali, English words for English. */
export function takaInWords(amount: number, language: string): string {
  return language === 'en' ? takaInWordsEn(amount) : takaInWordsBn(amount);
}
