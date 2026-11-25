import { describe, expect, it } from 'vitest';
import { findAmountBoxes, toFractions } from './highlight';

const words = [
  { t: 'TOTAL', x: 10, y: 400, w: 60, h: 20 },
  { t: 'RM1,030.32', x: 200, y: 400, w: 90, h: 20 },
  { t: '58.33', x: 200, y: 300, w: 50, h: 20 },
  { t: '1,030.32', x: 200, y: 100, w: 80, h: 20 },
];
describe('findAmountBoxes', () => {
  it('finds the words that read as the amount, in several spellings, lowest last', () => {
    expect(findAmountBoxes(words, 1030.32).map((b) => b.y)).toEqual([100, 400]);
  });
  it('finds nothing for an amount that is not there, or an integer-looking word', () => {
    expect(findAmountBoxes(words, 99.99)).toEqual([]);
    expect(findAmountBoxes([{ t: '1030', x: 0, y: 0, w: 5, h: 5 }], 1030)).toEqual([]);
  });
});
describe('toFractions', () => {
  it('turns pixels into fractions', () => {
    expect(toFractions([{ x: 50, y: 100, w: 100, h: 20 }], 500, 1000)).toEqual([{ x: 0.1, y: 0.1, w: 0.2, h: 0.02 }]);
  });
  it('hides boxes that fall outside the image (the sizes did not match)', () => {
    expect(toFractions([{ x: 900, y: 10, w: 100, h: 10 }], 500, 500)).toEqual([]);
  });
});

import { findPhraseBox } from './highlight';
describe('findPhraseBox', () => {
  const line = [
    { t: 'Lacher', x: 10, y: 20, w: 50, h: 12 },
    { t: 'Patisserie', x: 64, y: 21, w: 70, h: 12 },
    { t: 'Date:', x: 10, y: 60, w: 30, h: 12 },
    { t: '26', x: 44, y: 60, w: 14, h: 12 },
    { t: 'Aug', x: 62, y: 60, w: 20, h: 12 },
    { t: '2026', x: 86, y: 60, w: 28, h: 12 },
  ];
  it('boxes the words of the line, in order', () => {
    expect(findPhraseBox(line, 'Lacher Patisserie')).toEqual([{ x: 10, y: 20, w: 124, h: 13 }]);
    expect(findPhraseBox(line, 'Date: 26 Aug 2026')).toEqual([{ x: 10, y: 60, w: 104, h: 12 }]);
  });
  it('still finds the line when one word was misread, and nothing when it is not there', () => {
    expect(findPhraseBox(line, 'Date: 26 Aug 2O26')).toHaveLength(1);
    expect(findPhraseBox(line, 'Totally different shop')).toEqual([]);
    expect(findPhraseBox([], 'Lacher')).toEqual([]);
  });
});
