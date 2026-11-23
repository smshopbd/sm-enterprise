const consonants: Record<string, string> = {
  'ক': 'k', 'খ': 'kh', 'গ': 'g', 'ঘ': 'gh', 'ঙ': 'ng',
  'চ': 'ch', 'ছ': 'chh', 'জ': 'j', 'ঝ': 'jh', 'ঞ': 'n',
  'ট': 't', 'ঠ': 'th', 'ড': 'd', 'ঢ': 'dh', 'ণ': 'n',
  'ত': 't', 'থ': 'th', 'দ': 'd', 'ধ': 'dh', 'ন': 'n',
  'প': 'p', 'ফ': 'ph', 'ব': 'b', 'ভ': 'bh', 'ম': 'm',
  'য': 'y', 'র': 'r', 'ল': 'l', 'শ': 'sh', 'ষ': 'sh', 'স': 's', 'হ': 'h',
  'ড়': 'r', 'ঢ়': 'rh', 'য়': 'y'
};
const vowelSigns: Record<string, string> = {
  'া': 'a', 'ি': 'i', 'ী': 'i', 'ু': 'u', 'ূ': 'u', 'ৃ': 'ri',
  'ে': 'e', 'ৈ': 'oi', 'ো': 'o', 'ৌ': 'ou'
};
const independentVowels: Record<string, string> = {
  'অ': 'o', 'আ': 'a', 'ই': 'i', 'ঈ': 'i', 'উ': 'u', 'ঊ': 'u', 'ঋ': 'ri',
  'এ': 'e', 'ঐ': 'oi', 'ও': 'o', 'ঔ': 'ou'
};
const marks: Record<string, string> = { 'ৎ': 't', 'ং': 'ng', 'ঃ': 'h', 'ঁ': 'n' };
const digits: Record<string, string> = {
  '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
  '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9'
};

export function normalizeSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildSlug(value: string): string {
  const chars = Array.from(value.normalize('NFC').toLowerCase());
  let out = '';
  let i = 0;

  while (i < chars.length) {
    const ch = chars[i];
    const next = chars[i + 1];

    if (next === '়' && (ch === 'ড' || ch === 'ঢ' || ch === 'য')) {
      out += ch === 'ড' ? 'r' : ch === 'ঢ' ? 'rh' : 'y';
      i += 2;
      const sign = vowelSigns[chars[i]];
      if (sign) {
        out += sign;
        i += 1;
      } else if (chars[i] === '্') {
        i += 1;
      } else if (chars[i] && /[\p{L}\p{M}\p{N}]/u.test(chars[i])) {
        out += 'o';
      }
      continue;
    }

    const consonant = consonants[ch];
    if (consonant) {
      if (next === '্') {
        out += consonant;
        i += 2;
        continue;
      }
      const sign = vowelSigns[next];
      if (sign) {
        out += consonant + sign;
        i += 2;
        continue;
      }
      out += consonant + (next && /[\p{L}\p{M}\p{N}]/u.test(next) ? 'o' : '');
      i += 1;
      continue;
    }

    if (marks[ch]) {
      out += marks[ch];
      i += 1;
      continue;
    }
    if (independentVowels[ch]) {
      out += independentVowels[ch];
      i += 1;
      continue;
    }
    if (digits[ch]) {
      out += digits[ch];
      i += 1;
      continue;
    }
    if (/[\p{L}\p{M}\p{N}]/u.test(ch)) {
      out += ch;
      i += 1;
      continue;
    }
    out += ' ';
    i += 1;
  }

  return out
    .replace(/[\u0980-\u09FF]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}
