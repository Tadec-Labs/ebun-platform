import { normaliseFallbackCode } from './fallback-code.util';

describe('normaliseFallbackCode', () => {
  it('accepts a code exactly as the recipient sees it', () => {
    expect(normaliseFallbackCode('EBN-4M8K2L')).toBe('EBN-4M8K2L');
  });

  it('accepts the ways a person actually types one', () => {
    expect(normaliseFallbackCode('ebn-4m8k2l')).toBe('EBN-4M8K2L');
    expect(normaliseFallbackCode('EBN 4M8K2L')).toBe('EBN-4M8K2L');
    expect(normaliseFallbackCode('ebn4m8k2l')).toBe('EBN-4M8K2L');
    expect(normaliseFallbackCode('  EBN-4M8K2L  ')).toBe('EBN-4M8K2L');
  });

  it('accepts the six characters alone, without the prefix', () => {
    expect(normaliseFallbackCode('4m8k2l')).toBe('EBN-4M8K2L');
  });

  it('rejects anything that is not a real code shape', () => {
    expect(normaliseFallbackCode('')).toBeNull();
    expect(normaliseFallbackCode('EBN-')).toBeNull();
    expect(normaliseFallbackCode('EBN-4M8K2')).toBeNull(); // five
    expect(normaliseFallbackCode('EBN-4M8K2LX')).toBeNull(); // seven
    expect(normaliseFallbackCode('EBN-4M8K2!')).toBeNull();
    expect(normaliseFallbackCode("'; drop table redemptions--")).toBeNull();
  });

  it('rejects the four characters the generator deliberately never emits', () => {
    // 0/O/1/I are excluded from the alphabet because they are misread
    // aloud. A code containing one was misheard, not mistyped, so
    // "correcting" it could silently land on someone else's code.
    for (const ambiguous of ['0', 'O', '1', 'I']) {
      expect(normaliseFallbackCode(`EBN-4M8K2${ambiguous}`)).toBeNull();
    }
  });

  it('never lets a longer string sneak through by containing a valid code', () => {
    expect(normaliseFallbackCode('EBN-4M8K2L/../admin')).toBeNull();
  });
});
