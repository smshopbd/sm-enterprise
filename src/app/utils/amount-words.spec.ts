import { takaInWords, takaInWordsBn, takaInWordsEn } from './amount-words';

describe('takaInWords', () => {
  it('writes English words for English invoices', () => {
    expect(takaInWordsEn(170)).toBe('One Hundred And Seventy Taka Only');
    expect(takaInWordsEn(105350.75)).toBe('One Lakh Five Thousand Three Hundred And Fifty Taka And Seventy Five Paisa Only');
    expect(takaInWords(170, 'en')).toBe('One Hundred And Seventy Taka Only');
  });

  it('writes Bengali words for Bengali invoices', () => {
    expect(takaInWordsBn(170)).toBe('একশ সত্তর টাকা মাত্র');
    expect(takaInWordsBn(105350)).toBe('এক লক্ষ পাঁচ হাজার তিনশ পঞ্চাশ টাকা মাত্র');
    expect(takaInWords(105350, 'bn')).toBe('এক লক্ষ পাঁচ হাজার তিনশ পঞ্চাশ টাকা মাত্র');
  });

  it('covers the Bengali compound numbers around tens and hundreds', () => {
    expect(takaInWordsBn(21)).toBe('একুশ টাকা মাত্র');
    expect(takaInWordsBn(87)).toBe('সাতাশি টাকা মাত্র');
    expect(takaInWordsBn(99)).toBe('নিরানব্বই টাকা মাত্র');
    expect(takaInWordsBn(100)).toBe('একশ টাকা মাত্র');
    expect(takaInWordsBn(999)).toBe('নয়শ নিরানব্বই টাকা মাত্র');
  });

  it('adds paisa in words and never drops a fraction', () => {
    expect(takaInWordsBn(125.75)).toBe('একশ পঁচিশ টাকা এবং পঁচাত্তর পয়সা মাত্র');
    expect(takaInWordsBn(0.5)).toBe('শূন্য টাকা এবং পঞ্চাশ পয়সা মাত্র');
    expect(takaInWordsBn(0)).toBe('শূন্য টাকা মাত্র');
  });

  it('handles crore-scale amounts', () => {
    expect(takaInWordsBn(12345678)).toBe(
      'এক কোটি তেইশ লক্ষ পঁয়তাল্লিশ হাজার ছয়শ আটাত্তর টাকা মাত্র'
    );
  });

  it('treats a broken amount as zero instead of printing NaN', () => {
    expect(takaInWordsBn(Number.NaN)).toBe('শূন্য টাকা মাত্র');
    expect(takaInWordsEn(Number.NaN)).toBe('Zero Taka Only');
  });
});
