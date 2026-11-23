import { CalcError, evaluateExpression } from './calc';
import { formatDec } from './decimal';

const calc = (expression: string, degrees = true): string =>
  formatDec(evaluateExpression(expression, { degrees }));

describe('calculator engine', () => {
  it('adds decimals without binary rounding noise', () => {
    expect(calc('0.1+0.2')).toBe('0.3');
    expect(calc('1.1×3')).toBe('3.3');
  });

  it('handles unlimited terms and unlimited digits', () => {
    const terms = Array.from({ length: 1000 }, () => '0.1');
    expect(calc(terms.join('+'))).toBe('100');
    expect(calc('99999999999999999999+1')).toBe('100000000000000000000');
  });

  it('keeps operator precedence and parentheses', () => {
    expect(calc('2+3×4')).toBe('14');
    expect(calc('(2+3)×4')).toBe('20');
    expect(calc('2^3^2')).toBe('512');
  });

  it('is exact for long money sums', () => {
    expect(calc('1234567890.12+0.88')).toBe('1234567891');
    expect(calc('0.07+0.01+0.02')).toBe('0.1');
  });

  it('evaluates scientific functions in degrees', () => {
    expect(calc('sin(30)')).toBe('0.5');
    expect(calc('√(81)')).toBe('9');
    expect(calc('log(1000)')).toBe('3');
  });

  it('rounds repeating divisions instead of printing noise', () => {
    expect(calc('10/4')).toBe('2.5');
    expect(calc('1/3')).toBe('0.3333333333333333');
  });

  it('reports division by zero', () => {
    expect(() => evaluateExpression('5/0')).toThrowError(CalcError);
  });
});
