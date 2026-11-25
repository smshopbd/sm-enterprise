import { localizeAddress, stripRegionNames } from './bd-geo';

describe('geo address helpers', () => {
  it('prints saved English region names in Bangla without touching the area line', () => {
    expect(localizeAddress('বাসা ১২, রোড ৩, Phultala, Khulna, Khulna', 'bn'))
      .toBe('বাসা ১২, রোড ৩, ফুলতলা, খুলনা');
  });

  it('translates Bangla region names back for the English UI', () => {
    expect(localizeAddress('House 2, ফুলতলা, খুলনা', 'en')).toBe('House 2, Phultala, Khulna');
  });

  it('keeps an address that is already in one language unchanged', () => {
    expect(localizeAddress('বাসা ২, ফুলতলা, খুলনা', 'bn')).toBe('বাসা ২, ফুলতলা, খুলনা');
    expect(localizeAddress('', 'bn')).toBe('');
    expect(localizeAddress(undefined, 'bn')).toBe('');
  });

  it('drops the repeated region names a legacy full-address field left in the area line', () => {
    expect(stripRegionNames('House 4, Road 2, Khulna, Khulna')).toBe('House 4, Road 2');
    expect(stripRegionNames('বাসা ৪, ফুলতলা, খুলনা')).toBe('বাসা ৪');
    expect(stripRegionNames('রোড ৭')).toBe('রোড ৭');
  });
});
