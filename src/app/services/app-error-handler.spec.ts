import { classifyGlobalError } from './app-error-handler';

describe('global error classification', () => {
  it('treats chunk fetch failures as a stale deployment', () => {
    expect(classifyGlobalError(new Error('Failed to fetch dynamically imported module: https://shop/chunk-ABC.js'))).toBe('stale-chunk');
    expect(classifyGlobalError(new Error('Importing a module script failed.'))).toBe('stale-chunk');
    expect(classifyGlobalError(new Error('Loading chunk 42 failed.'))).toBe('stale-chunk');
  });

  it('ignores browser noise that is not a data problem', () => {
    expect(classifyGlobalError(new Error('ResizeObserver loop completed with undelivered notifications.'))).toBe('benign');
    expect(classifyGlobalError(new Error('Script error.'))).toBe('benign');
  });

  it('treats dropped requests as a sync problem, not a data problem', () => {
    expect(classifyGlobalError(new TypeError('Failed to fetch'))).toBe('benign');
    expect(classifyGlobalError(new TypeError('Load failed'))).toBe('benign');
    expect(classifyGlobalError(new Error('NetworkError when attempting to fetch resource.'))).toBe('benign');
    expect(classifyGlobalError(new Error('The request timed out.'))).toBe('benign');
  });

  it('keeps real failures reportable', () => {
    expect(classifyGlobalError(new TypeError("Cannot read properties of undefined (reading 'name')"))).toBe('unknown');
    expect(classifyGlobalError('plain string failure')).toBe('unknown');
    expect(classifyGlobalError(undefined)).toBe('unknown');
  });
});
