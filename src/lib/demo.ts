import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, Lang } from './config';

/**
 * Scripted demo (DEMO_MODE=1). Lightweight and predictable for presentations:
 *  - the mic silently "hears" the next scripted question instead of recording (no microphone or Whisper needed);
 *  - the scripted questions get pre-written answers built from the archive passages, streamed like a live answer
 *    (no chat model needed); other questions get archive passages only;
 *  - every spoken line is pre-rendered audio in data/demo-audio (no TTS server needed at show time).
 * Re-render the audio after editing this file: POST /api/admin/demo-audio with the Piper server running.
 */
export const DEMO = process.env.DEMO_MODE === '1';

/** What the mic "hears", in order, one per tap. */
export const DEMO_SCRIPT: { lang: Lang; question: string }[] = [
  { lang: 'en', question: 'What happened at Mahad in 1927?' },
  { lang: 'hi', question: 'पूना समझौता क्या था?' },
  { lang: 'en', question: 'Who won the cricket world cup?' }, // not in the archive → refused
];

/** Pre-written answers. Every sentence cites the passage it restates; `sources` are index chunk ids → S1, S2… */
export const DEMO_ANSWERS: { lang: Lang; question: string; sources: string[]; answer: string }[] = [
  {
    lang: 'en',
    question: 'What happened at Mahad in 1927?',
    sources: ['mahad-satyagraha#0', 'mahad-satyagraha#1'],
    answer:
      'On 20 March 1927, Dr. Ambedkar led a large gathering at Mahad to assert the right of untouchables to draw water from the Chavdar Tank, ' +
      'a public tank that was legally open to all but denied to them in practice. [S1] ' +
      'Later that year, on 25 December 1927, a copy of the Manusmriti was publicly burned at Mahad in protest against its sanction of caste hierarchy. [S1] ' +
      'Mahad is widely regarded as the first major organised movement for the civil rights of the depressed classes. [S2]',
  },
  {
    lang: 'hi',
    question: 'पूना समझौता क्या था?',
    sources: ['round-table-poona-pact#0', 'round-table-poona-pact#1'],
    answer:
      '1932 में ब्रिटिश सरकार के कम्युनल अवॉर्ड ने दलित वर्गों को पृथक निर्वाचन का अधिकार दिया। [S1] ' +
      'गांधीजी ने इसका विरोध किया और पूना की यरवदा जेल में अनशन शुरू किया। [S1] ' +
      'बातचीत के बाद 24 सितंबर 1932 को डॉ. आंबेडकर और गांधीजी के पक्ष के बीच पूना समझौता हुआ, जिसमें पृथक निर्वाचन की जगह सामान्य निर्वाचन के भीतर दलित वर्गों के लिए आरक्षित सीटें तय की गईं। [S1] ' +
      'आरक्षित प्रतिनिधित्व की यह व्यवस्था आगे चलकर संविधान में भी शामिल हुई। [S2]',
  },
];

const norm = (s: string) => s.toLowerCase().normalize('NFC').replace(/[\s\p{P}]+/gu, '');

export function findDemoAnswer(question: string) {
  const q = norm(question);
  return DEMO_ANSWERS.find((a) => norm(a.question) === q) ?? null;
}

// ── Pre-rendered audio ──
/** The exact text /api/tts synthesises for a request (cache keys depend on it). */
export const ttsInput = (text: unknown) => String(text ?? '').replace(/\[S\d+\]/g, '').replace(/\*\*/g, '').slice(0, 1500);
export const DEMO_AUDIO_DIR = path.join(DATA_DIR, 'demo-audio');
export const audioKey = (voice: string, text: string) =>
  crypto.createHash('sha1').update(`${voice}|${text}`).digest('hex').slice(0, 20);

export function cachedAudio(voice: string, text: string): Buffer | null {
  try {
    return fs.readFileSync(path.join(DEMO_AUDIO_DIR, `${audioKey(voice, text)}.wav`));
  } catch {
    return null;
  }
}
