// Exact base-10 arithmetic so a calculator never shows 0.30000000000000004.
// A value is n / 10^s with a BigInt numerator, which keeps long sums and
// currency maths exact for any number of digits.

export interface Dec {
  readonly n: bigint;
  readonly s: number;
}

/** Fractional digits kept when a division does not terminate. */
export const DIV_SCALE = 30;

export function decNormalize(value: Dec): Dec {
  let { n, s } = value;
  while (s > 0 && n % 10n === 0n) {
    n /= 10n;
    s--;
  }
  return { n, s };
}

/** Parses "123", "-4.5", ".25", "1.2e3". Returns null when the text is not a number. */
export function decParse(text: string): Dec | null {
  const cleaned = text.replace(/[,\s_]/g, '');
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(cleaned);
  if (!match) return null;
  const [, sign, intPart, fracPart = '', expPart] = match;
  if (!intPart && !fracPart) return null;

  const digits = ((intPart ?? '') + fracPart).replace(/^0+/, '') || '0';
  let n = BigInt(digits);
  if (sign === '-') n = -n;
  let s = fracPart.length;

  if (expPart) {
    const exp = Number(expPart);
    if (!Number.isSafeInteger(exp) || Math.abs(exp) > 10000) return null;
    s -= exp;
  }
  if (s < 0) {
    n *= 10n ** BigInt(-s);
    s = 0;
  }
  return decNormalize({ n, s });
}

/** Shortest round-trip decimal for a finite double, trimmed to `precision` significant digits. */
export function decFromNumber(value: number, precision = 15): Dec | null {
  if (!Number.isFinite(value)) return null;
  const text = Math.abs(value) >= 1e21 || (value !== 0 && Math.abs(value) < 1e-6)
    ? value.toExponential(precision - 1)
    : value.toPrecision(precision);
  return decParse(text);
}

export function decToString(value: Dec): string {
  const { n, s } = decNormalize(value);
  const negative = n < 0n;
  let digits = (negative ? -n : n).toString();
  if (s > 0) {
    digits = digits.padStart(s + 1, '0');
    digits = `${digits.slice(0, -s)}.${digits.slice(-s)}`;
  }
  return negative ? `-${digits}` : digits;
}

export function decToNumber(value: Dec): number {
  return Number(decToString(value));
}

export function decNeg(value: Dec): Dec {
  return { n: -value.n, s: value.s };
}

export function decAdd(a: Dec, b: Dec): Dec {
  const s = Math.max(a.s, b.s);
  return decNormalize({
    n: a.n * 10n ** BigInt(s - a.s) + b.n * 10n ** BigInt(s - b.s),
    s,
  });
}

export function decSub(a: Dec, b: Dec): Dec {
  return decAdd(a, decNeg(b));
}

export function decMul(a: Dec, b: Dec): Dec {
  return decNormalize({ n: a.n * b.n, s: a.s + b.s });
}

/** Division rounded half-up at DIV_SCALE; null means the divisor is zero. */
export function decDiv(a: Dec, b: Dec): Dec | null {
  if (b.n === 0n) return null;
  const shift = b.s + DIV_SCALE - a.s;
  const numerator = shift >= 0 ? a.n * 10n ** BigInt(shift) : a.n;
  const denominator = shift >= 0 ? b.n : b.n * 10n ** BigInt(-shift);

  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder !== 0n) {
    const twice = (remainder < 0n ? -remainder : remainder) * 2n;
    const divisor = denominator < 0n ? -denominator : denominator;
    if (twice >= divisor) quotient += quotient < 0n ? -1n : 1n;
  }
  return decNormalize({ n: quotient, s: DIV_SCALE });
}

/** Integer power; null when a negative exponent divides by zero. */
export function decPow(base: Dec, exponent: number): Dec | null {
  if (!Number.isSafeInteger(exponent)) return null;
  if (exponent === 0) return { n: 1n, s: 0 };

  const steps = Math.abs(exponent);
  let result: Dec = { n: 1n, s: 0 };
  let factor = base;
  let remaining = steps;
  while (remaining > 0) {
    if (remaining % 2 === 1) result = decMul(result, factor);
    remaining = Math.floor(remaining / 2);
    if (remaining > 0) factor = decMul(factor, factor);
  }
  if (exponent < 0) return decDiv({ n: 1n, s: 0 }, result);
  return result;
}

/** Half-up rounding to a fixed number of fractional digits. */
export function decRound(value: Dec, places: number): Dec {
  const target = Math.max(0, Math.trunc(places));
  if (value.s <= target) return value;
  const factor = 10n ** BigInt(value.s - target);
  const negative = value.n < 0n;
  const abs = negative ? -value.n : value.n;
  let quotient = abs / factor;
  const remainder = abs % factor;
  if (remainder * 2n >= factor) quotient += 1n;
  return decNormalize({ n: negative ? -quotient : quotient, s: target });
}

/** Result string trimmed of trailing zeros, capped to `maxDecimals` fractional digits. */
export function formatDec(value: Dec, maxDecimals = 16): string {
  return decToString(decRound(value, maxDecimals));
}
