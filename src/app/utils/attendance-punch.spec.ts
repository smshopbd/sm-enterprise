import { describe, expect, it } from 'vitest';
import { nextPunch, punchField } from './attendance-punch';

describe('nextPunch', () => {
  it('starts a fresh day at check-in', () => {
    expect(nextPunch(null)).toBe('in');
    expect(nextPunch(undefined)).toBe('in');
  });

  it('walks in, lunch out, lunch back, out, then done', () => {
    expect(nextPunch({ timeIn: '09:10', timeOut: '' })).toBe('lunchOut');
    expect(nextPunch({ timeIn: '09:10', lunchOut: '13:30', timeOut: '' })).toBe('lunchIn');
    expect(nextPunch({ timeIn: '09:10', lunchOut: '13:30', lunchIn: '14:00', timeOut: '' })).toBe('out');
    expect(nextPunch({ timeIn: '09:10', lunchOut: '13:30', lunchIn: '14:00', timeOut: '18:05' })).toBe('done');
  });

  it('treats a legacy in/out row as finished', () => {
    expect(nextPunch({ timeIn: '09:00', timeOut: '17:00' })).toBe('done');
  });
});

describe('punchField', () => {
  it('maps every punch to its record field', () => {
    expect(punchField('in')).toBe('timeIn');
    expect(punchField('lunchOut')).toBe('lunchOut');
    expect(punchField('lunchIn')).toBe('lunchIn');
    expect(punchField('out')).toBe('timeOut');
    expect(punchField('done')).toBeNull();
  });
});
