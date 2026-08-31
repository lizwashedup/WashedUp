import {
  formatDisplay,
  formatToE164,
  isValidUSPhone,
  normalizeUSPhoneInput,
} from '../phoneFormat';

describe('US phone input normalization', () => {
  it.each([
    ['2135550123', '2135550123'],
    ['(213) 555-0123', '2135550123'],
    ['+1 (213) 555-0123', '2135550123'],
    ['12135550123', '2135550123'],
    ['1', ''],
    ['12', '2'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeUSPhoneInput(input)).toBe(expected);
  });

  it('caps the national number at ten digits', () => {
    expect(normalizeUSPhoneInput('2135550123999')).toBe('2135550123');
  });

  it('keeps pasted country-code numbers valid through display and E.164 conversion', () => {
    const normalized = normalizeUSPhoneInput('+1 (213) 555-0123');
    expect(formatDisplay(normalized)).toBe('(213) 555-0123');
    expect(isValidUSPhone(normalized)).toBe(true);
    expect(formatToE164('+1 (213) 555-0123')).toBe('+12135550123');
  });
});
