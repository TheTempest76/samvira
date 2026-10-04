/**
 * Answer text → sentences, shared by the answer renderer (to highlight the sentence being read)
 * and the speech queue (to read the answer aloud sentence by sentence while it is still streaming).
 */
export interface Sentence {
  text: string; // including any [S n] markers
  para: number;
}

// "Dr." and single initials ("B. R.") don't end a sentence.
const ABBR = new Set([
  'dr', 'mr', 'mrs', 'ms', 'st', 'no', 'vs', 'prof', 'sir', 'smt', 'shri', 'govt', 'ca', 'vol', 'pp',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'डॉ', 'श्री', 'ಡಾ',
]);
const CLOSERS = '"\'”’)]';

export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  text.replace(/\*\*/g, '').split(/\n{2,}/).forEach((p, para) => {
    let start = 0;
    let i = 0;
    while (i < p.length) {
      const ch = p[i];
      if (ch === '.' || ch === '!' || ch === '?' || ch === '।') {
        let end = i + 1;
        while (end < p.length && CLOSERS.includes(p[end])) end++;
        // attach citation markers that follow the full stop: "… in 1927. [S1][S2]"
        const tail = p.slice(end).match(/^(\s*\[S\d+\])+/);
        if (tail) end += tail[0].length;
        const atBoundary = end >= p.length || /\s/.test(p[end]);
        const word = p.slice(0, i).match(/([\p{L}\p{M}]+)$/u)?.[1] ?? '';
        const abbrev = ch === '.' && (ABBR.has(word.toLowerCase()) || /^\p{Lu}$/u.test(word));
        if (atBoundary && !abbrev) {
          const s = p.slice(start, end).trim();
          if (s) out.push({ text: s, para });
          start = end;
          i = end;
          continue;
        }
      }
      i++;
    }
    const rest = p.slice(start).trim();
    if (rest) out.push({ text: rest, para });
  });
  return out;
}

/** What gets spoken: no citation markers, no markdown. */
export const speakable = (s: string) =>
  s.replace(/\[S\d+\]/g, '').replace(/[*_#]/g, '').replace(/\s+/g, ' ').replace(/\s+([.,;:!?।])/g, '$1').trim();
