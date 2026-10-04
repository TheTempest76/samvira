import { LANGUAGES, Lang } from './config';
import type { ChatMsg } from './providers';
import type { Hit } from './retrieval';

export const REFUSAL_TOKEN = 'NOT_IN_ARCHIVE';

export function sourceLabel(h: Hit) {
  const bits = [h.doc.title];
  if (h.doc.date) bits.push(h.doc.date);
  if (h.chunk.page) bits.push(`p. ${h.chunk.page}`);
  return bits.join(' · ');
}

export function buildMessages(question: string, hits: Hit[], lang: Lang): ChatMsg[] {
  const language = LANGUAGES[lang].label;
  const system = [
    'You are the research assistant on a visitor kiosk at the Dr. B. R. Ambedkar Digital Heritage Archive.',
    'Answer ONLY from the numbered archive sources you are given. Never use outside knowledge.',
    'After every sentence that states a fact, cite the source(s) it comes from like [S1] or [S2][S3].',
    `If the sources do not contain the answer, reply with exactly: ${REFUSAL_TOKEN}`,
    'Do not invent quotations. Only quote words that appear verbatim in a source.',
    `Write the answer in ${language}, in plain language for museum visitors, in at most 120 words.`,
    'Keep the citation markers exactly as [S1], [S2] … even when writing in another language.',
  ].join('\n');

  const sources = hits.map((h) => `[S${h.n}] (${sourceLabel(h)})\n${h.chunk.text}`).join('\n\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: `Archive sources:\n\n${sources}\n\nVisitor question: ${question}` },
  ];
}

// Worked examples: a 3B model otherwise echoes the question back in Hindi instead of translating it.
const TRANSLATE_EXAMPLES: [string, string][] = [
  ['महाड सत्याग्रह क्या था?', 'Mahad Satyagraha 1927'],
  ['ಅವರು ವಿದೇಶದಲ್ಲಿ ಎಲ್ಲಿ ಓದಿದರು?', 'Ambedkar education abroad Columbia London'],
  ['संविधान मसौदा समिति के अध्यक्ष कौन थे?', 'Drafting Committee chairman Constitution'],
];

export function translateQueryMessages(question: string): ChatMsg[] {
  return [
    {
      role: 'system',
      content: [
        "You translate museum visitors' questions about Dr. B. R. Ambedkar into English search keywords.",
        'Output ONLY English keywords in Latin letters: names, places, events, works, years. No other words, no explanation.',
        'Questions may be in Hindi, Marathi or Kannada and may contain spelling mistakes from speech recognition.',
      ].join('\n'),
    },
    ...TRANSLATE_EXAMPLES.flatMap(([q, a]): ChatMsg[] => [{ role: 'user', content: q }, { role: 'assistant', content: a }]),
    { role: 'user', content: question },
  ];
}

/** Which [S n] markers appear in the answer (only those that exist). */
export function citedNumbers(answer: string, max: number): number[] {
  const set = new Set<number>();
  for (const m of answer.matchAll(/\[S(\d+)\]/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= max) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/** Retrieval-only answer used when no model is reachable (or extractive mode). */
export function extractiveAnswer(hits: Hit[]): string {
  const top = hits.slice(0, 2);
  const lines = top.map((h) => {
    const sentences = h.chunk.text.replace(/\s+/g, ' ').match(/[^.!?।]+[.!?।]+/g) ?? [h.chunk.text];
    return `${sentences.slice(0, 2).join(' ').trim()} [S${h.n}]`;
  });
  return lines.join('\n\n');
}

export const REFUSAL_TEXT: Record<Lang, string> = {
  en: "I couldn't find this in the archive, so I won't guess. Try asking about a person, place, event or year — or explore the closest matches below.",
  hi: 'यह जानकारी संग्रह में नहीं मिली, इसलिए मैं अनुमान नहीं लगाऊँगा। किसी व्यक्ति, स्थान, घटना या वर्ष के बारे में पूछें — या नीचे दिए निकटतम स्रोत देखें।',
  mr: 'ही माहिती संग्रहात सापडली नाही, म्हणून मी अंदाज लावणार नाही. एखादी व्यक्ती, ठिकाण, घटना किंवा वर्ष याबद्दल विचारा — किंवा खालील जवळचे स्रोत पहा.',
  kn: 'ಈ ಮಾಹಿತಿ ಸಂಗ್ರಹದಲ್ಲಿ ಸಿಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ನಾನು ಊಹಿಸುವುದಿಲ್ಲ. ವ್ಯಕ್ತಿ, ಸ್ಥಳ, ಘಟನೆ ಅಥವಾ ವರ್ಷದ ಬಗ್ಗೆ ಕೇಳಿ — ಅಥವಾ ಕೆಳಗಿನ ಹತ್ತಿರದ ಮೂಲಗಳನ್ನು ನೋಡಿ.',
};
