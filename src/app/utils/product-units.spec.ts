import { productUnitChoices, hasExtraUnits, unitChoiceOf, unitFactorOf, unitPriceOf, saleLineBaseQty } from './product-units';

const rice = {
  unit: 'গ্রাম',
  salesPrice: 0.16,
  wholesalePrice: 0.15,
  units: [
    { name: 'কেজি', factor: 1000 },
    { name: 'বস্তা', factor: 25000, price: 3600 }
  ]
};

describe('product unit helpers', () => {
  it('lists the base unit first, then every configured unit', () => {
    const choices = productUnitChoices(rice);
    expect(choices.map(c => c.name)).toEqual(['গ্রাম', 'কেজি', 'বস্তা']);
    expect(choices[0]).toMatchObject({ factor: 1, price: 0.16, isBase: true });
    expect(choices[1]).toMatchObject({ factor: 1000, price: 160, isBase: false });
    expect(choices[2]).toMatchObject({ factor: 25000, price: 3600 });
  });

  it('derives the wholesale price of an extra unit from the base wholesale price', () => {
    expect(unitPriceOf(rice, 'কেজি', true)).toBe(150);
    // বস্তা is priced by hand at 3600; wholesale keeps the shop's rate ratio
    // (0.15 / 0.16), so it never exceeds the retail price of the unit.
    expect(unitPriceOf(rice, 'বস্তা', true)).toBe(3375);
  });

  it('falls back to the unit price for wholesale when no wholesale price is set', () => {
    const product = { unit: 'পিস', salesPrice: 10, wholesalePrice: 0, units: [{ name: 'ডজন', factor: 12, price: 110 }] };
    expect(unitPriceOf(product, 'ডজন')).toBe(110);
    expect(unitPriceOf(product, 'ডজন', true)).toBe(110);
  });

  it('skips malformed or duplicate extra units and falls back to the base unit', () => {
    const choices = productUnitChoices({
      ...rice,
      units: [
        { name: 'কেজি', factor: 0 },
        { name: 'গ্রাম', factor: 1000 },
        { name: 'কেজি', factor: 1000 },
        { name: 'কেজি', factor: 500 }
      ]
    });
    expect(choices.map(c => c.name)).toEqual(['গ্রাম', 'কেজি']);
    expect(unitFactorOf(rice, 'অজানা')).toBe(1);
    expect(unitChoiceOf(rice, 'কেজি').name).toBe('কেজি');
  });

  it('reports extra units only when at least one valid unit exists', () => {
    expect(hasExtraUnits(rice)).toBe(true);
    expect(hasExtraUnits({ ...rice, units: undefined })).toBe(false);
    expect(hasExtraUnits(null)).toBe(false);
  });

  it('converts sale lines to base quantity', () => {
    expect(saleLineBaseQty({ quantity: 2, unitFactor: 1000 })).toBe(2000);
    expect(saleLineBaseQty({ quantity: 3 })).toBe(3);
    expect(saleLineBaseQty(null)).toBe(0);
  });

  it('shares one stock across factor-1 units, each with its own price', () => {
    const rope = {
      unit: 'গজ',
      salesPrice: 150,
      wholesalePrice: 140,
      units: [
        { name: 'কেজি', factor: 1, price: 800 },
        { name: 'পিস', factor: 1, price: 200 }
      ]
    };
    const choices = productUnitChoices(rope);
    expect(choices.map(c => c.name)).toEqual(['গজ', 'কেজি', 'পিস']);
    expect(choices[1]).toMatchObject({ factor: 1, price: 800, isBase: false });
    expect(unitPriceOf(rope, 'পিস')).toBe(200);
    // A shared unit moves the same stock count it sells (no conversion).
    expect(saleLineBaseQty({ quantity: 4, unitFactor: unitFactorOf(rope, 'কেজি') })).toBe(4);
  });
});
