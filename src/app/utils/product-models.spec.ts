import { hasProductModel, joinProductModels, productModelsOf, replaceProductModel, toggleProductModel } from './product-models';

describe('product models list', () => {
  it('reads a legacy single model', () => {
    expect(productModelsOf('X20')).toEqual(['X20']);
    expect(productModelsOf('  X20 , X21 ')).toEqual(['X20', 'X21']);
    expect(productModelsOf('')).toEqual([]);
    expect(productModelsOf(undefined)).toEqual([]);
  });

  it('matches any model in the list, ignoring case', () => {
    expect(hasProductModel('X20, X21', 'x21')).toBe(true);
    expect(hasProductModel('X20, X21', 'X22')).toBe(false);
    expect(hasProductModel('X20', '')).toBe(false);
  });

  it('adds and removes a model on toggle', () => {
    expect(toggleProductModel('', 'X20')).toBe('X20');
    expect(toggleProductModel('X20', 'X21')).toBe('X20, X21');
    expect(toggleProductModel('X20, X21', 'x20')).toBe('X21');
  });

  it('replaces one model and keeps the rest', () => {
    expect(replaceProductModel('X20, X21, X22', 'x21', 'X21 Pro')).toBe('X20, X21 Pro, X22');
    expect(replaceProductModel('X20', 'X99', 'X100')).toBe('X20');
  });

  it('joins cleaned names', () => {
    expect(joinProductModels([' X20 ', '', 'X21'])).toBe('X20, X21');
  });
});
