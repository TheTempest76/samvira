import { env, isLang, Lang } from '@/lib/config';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Biases Whisper toward the archive's names and terms, which it otherwise mangles. Each hint is written in the
// language's own script: an English hint makes Whisper write Hindi speech in Latin letters.
const VOCAB: Record<Lang, string> = {
  en: 'Dr. B. R. Ambedkar, Babasaheb, Mahad Satyagraha, Chavdar Tank, Poona Pact, Round Table Conference, Annihilation of Caste, ' +
    'Mooknayak, Bahishkrit Hitakarini Sabha, Drafting Committee, Constituent Assembly, Hindu Code Bill, Deekshabhoomi, Nagpur, Dhamma.',
  hi: 'डॉ. बाबासाहेब आंबेडकर, महाड सत्याग्रह, पूना समझौता, गोलमेज सम्मेलन, जाति का विनाश, मूकनायक, संविधान सभा, हिंदू कोड बिल, दीक्षाभूमि, नागपुर।',
  mr: 'डॉ. बाबासाहेब आंबेडकर, महाड सत्याग्रह, चवदार तळे, पुणे करार, गोलमेज परिषद, मूकनायक, बहिष्कृत हितकारिणी सभा, संविधान सभा, दीक्षाभूमी, नागपूर.',
  kn: 'ಡಾ. ಬಾಬಾಸಾಹೇಬ್ ಅಂಬೇಡ್ಕರ್, ಮಹಾಡ್ ಸತ್ಯಾಗ್ರಹ, ಪೂನಾ ಒಪ್ಪಂದ, ದುಂಡುಮೇಜಿನ ಸಮ್ಮೇಳನ, ಮೂಕನಾಯಕ, ಸಂವಿಧಾನ ಸಭೆ, ದೀಕ್ಷಾಭೂಮಿ, ನಾಗಪುರ.',
};

const FULL: Record<string, Lang> = { english: 'en', hindi: 'hi', marathi: 'mr', kannada: 'kn' };

/**
 * Proxies recorded audio to an OpenAI-compatible transcription server (local whisper.cpp / faster-whisper or an online API).
 *
 * When the kiosk is in English, the spoken language is detected and restricted to the kiosk's four languages
 * (Whisper often labels spoken Hindi as Urdu, so Urdu counts toward Hindi). The detected language is returned so
 * the kiosk can switch its interface to match the visitor.
 */
export async function POST(req: Request) {
  if (!env.voice.sttUrl) return Response.json({ error: 'Speech-to-text is not configured (STT_URL)' }, { status: 404 });
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof Blob)) return Response.json({ error: 'file required' }, { status: 400 });
  const uiLang: Lang = isLang(form.get('lang')) ? (form.get('lang') as Lang) : 'en';
  const detect = uiLang === 'en' && form.get('detect') !== '0';
  const t0 = Date.now();

  const post = async (fields: Record<string, string>) => {
    const out = new FormData();
    out.append('file', file, 'speech.webm');
    out.append('model', env.voice.sttModel);
    for (const [k, v] of Object.entries(fields)) out.append(k, v);
    const res = await fetch(`${env.voice.sttUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: env.voice.sttKey ? { authorization: `Bearer ${env.voice.sttKey}` } : {},
      body: out,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`STT HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };

  try {
    let lang: Lang = uiLang;
    if (detect) {
      // 1. Detect only (one encoder pass, ~0.5 s on the Orin). Servers without detect_language just transcribe; we only read the language.
      const d = await post({ language: 'auto', detect_language: 'true', response_format: 'verbose_json' });
      const probs: Record<string, number> | undefined = d.language_probabilities;
      if (probs) {
        const score = (l: Lang) => (probs[l] ?? 0) + (l === 'hi' ? probs.ur ?? 0 : 0);
        lang = (['en', 'hi', 'mr', 'kn'] as Lang[]).reduce((a, b) => (score(b) > score(a) ? b : a));
      } else lang = FULL[String(d.language ?? '').toLowerCase()] ?? 'en';
    }
    // 2. Transcribe in that language, hinted with the archive's names in its own script.
    const j = await post({ language: lang, prompt: VOCAB[lang], response_format: 'json', temperature: '0' });
    const text = cleanTranscript(String(j.text ?? ''));
    return Response.json({ text, lang, ms: Date.now() - t0 });
  } catch (e) {
    return Response.json({ error: `STT unreachable: ${(e as Error).message}` }, { status: 502 });
  }
}

/** Drops Whisper's non-speech tags ([BLANK_AUDIO], (music), ♪) and the vocabulary prompt if it leaks back on silence. */
function cleanTranscript(s: string) {
  const t = s
    .replace(/\[[^\]]*\]|\([^)]*\)|♪/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Object.values(VOCAB).some((v) => v.startsWith(t.slice(0, 24)) && t.length > 10) ? '' : t;
}
