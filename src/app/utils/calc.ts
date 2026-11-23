// Expression parser for the calculator: + − × ÷ ^ parentheses and the
// scientific functions. Arithmetic stays in base-10 (see decimal.ts), and only
// the transcendental functions fall back to doubles with a 15-digit trim.

import {
  Dec,
  decAdd,
  decDiv,
  decFromNumber,
  decMul,
  decNeg,
  decParse,
  decPow,
  decSub,
  decToNumber,
} from './decimal';

export type CalcErrorCode = 'syntax' | 'div0' | 'math' | 'range';

export class CalcError extends Error {
  constructor(readonly code: CalcErrorCode, message: string) {
    super(message);
    this.name = 'CalcError';
  }
}

export interface CalcOptions {
  degrees?: boolean;
}

type FunctionName = 'sin' | 'cos' | 'tan' | 'log' | 'ln' | 'sqrt';

const FUNCTIONS = new Set<FunctionName>(['sin', 'cos', 'tan', 'log', 'ln', 'sqrt']);
const MAX_INTEGER_EXPONENT = 10000;

type Token =
  | { kind: 'number'; value: Dec }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' | '^' }
  | { kind: 'fn'; value: FunctionName }
  | { kind: 'const'; value: 'pi' | 'e' }
  | { kind: 'lparen' }
  | { kind: 'rparen' };

export function evaluateExpression(source: string, options: CalcOptions = {}): Dec {
  const tokens = tokenize(source);
  if (!tokens.length) throw new CalcError('syntax', 'Empty expression');
  return new Parser(tokens, options.degrees ?? true).parse();
}

function tokenize(source: string): Token[] {
  const text = source
    .replace(/[,\s_]/g, '')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-');

  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < text.length && /[0-9.]/.test(text[j])) j++;
      if ((text.slice(i, j).match(/\./g) ?? []).length > 1) {
        throw new CalcError('syntax', 'Malformed number');
      }
      const value = decParse(text.slice(i, j));
      if (!value) throw new CalcError('syntax', 'Malformed number');
      tokens.push({ kind: 'number', value });
      i = j;
      continue;
    }

    if (ch === '+' || ch === '-' || ch === '^') {
      tokens.push({ kind: 'op', value: ch });
      i++;
      continue;
    }
    if (ch === '*' || ch === '/') {
      tokens.push({ kind: 'op', value: ch });
      i++;
      continue;
    }
    if (ch === '(') { tokens.push({ kind: 'lparen' }); i++; continue; }
    if (ch === ')') { tokens.push({ kind: 'rparen' }); i++; continue; }
    if (ch === 'π') { tokens.push({ kind: 'const', value: 'pi' }); i++; continue; }
    if (ch === '√') { tokens.push({ kind: 'fn', value: 'sqrt' }); i++; continue; }

    if (/[a-z]/i.test(ch)) {
      let j = i;
      while (j < text.length && /[a-z]/i.test(text[j])) j++;
      const word = text.slice(i, j).toLowerCase();
      if (word === 'e') tokens.push({ kind: 'const', value: 'e' });
      else if (word === 'pi') tokens.push({ kind: 'const', value: 'pi' });
      else if (FUNCTIONS.has(word as FunctionName)) tokens.push({ kind: 'fn', value: word as FunctionName });
      else throw new CalcError('syntax', `Unknown name "${word}"`);
      i = j;
      continue;
    }

    throw new CalcError('syntax', `Unexpected character "${ch}"`);
  }
  return tokens;
}

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[], private readonly degrees: boolean) {}

  parse(): Dec {
    const value = this.parseSum();
    if (this.pos < this.tokens.length) throw new CalcError('syntax', 'Unexpected token');
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private parseSum(): Dec {
    let left = this.parseProduct();
    for (;;) {
      const token = this.peek();
      if (token?.kind !== 'op' || (token.value !== '+' && token.value !== '-')) return left;
      this.pos++;
      const right = this.parseProduct();
      left = token.value === '+' ? decAdd(left, right) : decSub(left, right);
    }
  }

  private parseProduct(): Dec {
    let left = this.parseUnary();
    for (;;) {
      const token = this.peek();
      if (token?.kind !== 'op' || (token.value !== '*' && token.value !== '/')) return left;
      this.pos++;
      const right = this.parseUnary();
      if (token.value === '*') {
        left = decMul(left, right);
      } else {
        const quotient = decDiv(left, right);
        if (!quotient) throw new CalcError('div0', 'Division by zero');
        left = quotient;
      }
    }
  }

  private parseUnary(): Dec {
    const token = this.peek();
    if (token?.kind === 'op' && (token.value === '+' || token.value === '-')) {
      this.pos++;
      const value = this.parseUnary();
      return token.value === '-' ? decNeg(value) : value;
    }
    return this.parsePower();
  }

  private parsePower(): Dec {
    const base = this.parsePrimary();
    const token = this.peek();
    if (token?.kind !== 'op' || token.value !== '^') return base;
    this.pos++;
    return this.power(base, this.parseUnary());
  }

  private parsePrimary(): Dec {
    const token = this.peek();
    if (!token) throw new CalcError('syntax', 'Expression is incomplete');

    if (token.kind === 'number') {
      this.pos++;
      return token.value;
    }
    if (token.kind === 'const') {
      this.pos++;
      const value = token.value === 'pi' ? decFromNumber(Math.PI) : decFromNumber(Math.E);
      if (!value) throw new CalcError('math', 'Constant is unavailable');
      return value;
    }
    if (token.kind === 'fn') {
      this.pos++;
      this.expect('lparen');
      const argument = this.parseSum();
      this.expect('rparen');
      return this.applyFunction(token.value, argument);
    }
    if (token.kind === 'lparen') {
      this.pos++;
      const value = this.parseSum();
      this.expect('rparen');
      return value;
    }
    throw new CalcError('syntax', 'Unexpected token');
  }

  private expect(kind: 'lparen' | 'rparen'): void {
    const token = this.peek();
    if (token?.kind !== kind) throw new CalcError('syntax', 'Missing parenthesis');
    this.pos++;
  }

  private applyFunction(name: FunctionName, argument: Dec): Dec {
    const x = decToNumber(argument);
    const rad = this.degrees ? (x * Math.PI) / 180 : x;
    let result: number;
    switch (name) {
      case 'sin': result = Math.sin(rad); break;
      case 'cos': result = Math.cos(rad); break;
      case 'tan': result = Math.tan(rad); break;
      case 'log': result = Math.log10(x); break;
      case 'ln': result = Math.log(x); break;
      default: result = Math.sqrt(x); break;
    }
    const value = decFromNumber(result, 15);
    if (!value) throw new CalcError('math', 'Result is not a number');
    return value;
  }

  private power(base: Dec, exponent: Dec): Dec {
    if (exponent.s === 0 && exponent.n <= BigInt(MAX_INTEGER_EXPONENT) && exponent.n >= BigInt(-MAX_INTEGER_EXPONENT)) {
      const value = decPow(base, Number(exponent.n));
      if (!value) throw new CalcError('div0', 'Division by zero');
      return value;
    }
    const result = Math.pow(decToNumber(base), decToNumber(exponent));
    const value = decFromNumber(result, 15);
    if (!value) throw new CalcError('math', 'Result is not a number');
    return value;
  }
}
