import path from 'node:path';

export type AnswerMode = 'auto' | 'local' | 'online' | 'extractive';
export const ANSWER_MODES: AnswerMode[] = ['auto', 'local', 'online', 'extractive'];

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v !== undefined ? n : d;
};

export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

export const env = {
  answerMode: (ANSWER_MODES.includes(process.env.ANSWER_MODE as AnswerMode)
    ? process.env.ANSWER_MODE
    : 'auto') as AnswerMode,

  local: {
    baseUrl: (process.env.LOCAL_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, ''),
    chatModel: process.env.LOCAL_CHAT_MODEL || 'llama3.2:3b',
    embedModel: process.env.LOCAL_EMBED_MODEL ?? 'bge-m3',
    // Run the embedding model on the CPU (~0.2 s per question). On the 8 GB Orin Nano the GPU can't hold
    // the chat model, the embedder and Whisper together; CPU memory can borrow from the file cache, GPU memory can't.
    embedOnCpu: process.env.LOCAL_EMBED_ON_CPU !== 'false',
    timeoutMs: num(process.env.LOCAL_TIMEOUT_MS, 45000),
    // How long Ollama keeps models in memory after use. -1 = always (a kiosk shouldn't make a visitor wait ~20 s for a reload).
    keepAlive: /^-?\d+$/.test(process.env.LOCAL_KEEP_ALIVE || '-1') ? Number(process.env.LOCAL_KEEP_ALIVE || -1) : (process.env.LOCAL_KEEP_ALIVE as string),
  },

  online: {
    provider: (process.env.ONLINE_PROVIDER === 'anthropic' ? 'anthropic' : 'openai') as 'openai' | 'anthropic',
    baseUrl: (process.env.ONLINE_BASE_URL ||
      (process.env.ONLINE_PROVIDER === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1')
    ).replace(/\/$/, ''),
    apiKey: process.env.ONLINE_API_KEY || '',
    chatModel: process.env.ONLINE_CHAT_MODEL || '',
    timeoutMs: num(process.env.ONLINE_TIMEOUT_MS, 30000),
  },

  voice: {
    sttUrl: (process.env.STT_URL || '').replace(/\/$/, ''),
    sttModel: process.env.STT_MODEL || 'Systran/faster-whisper-small',
    sttKey: process.env.STT_API_KEY || '',
    ttsUrl: (process.env.TTS_URL || '').replace(/\/$/, ''),
    ttsModel: process.env.TTS_MODEL || '',
    ttsVoice: process.env.TTS_VOICE || '',
    ttsKey: process.env.TTS_API_KEY || '',
  },

  retrieval: {
    minScore: num(process.env.MIN_RETRIEVAL_SCORE, 1.5),
    minVector: num(process.env.MIN_VECTOR_SCORE, 0.55),
    topK: num(process.env.TOP_K, 5),
  },
};

export const LANGUAGES = {
  en: { label: 'English', native: 'English', speech: 'en-IN' },
  hi: { label: 'Hindi', native: 'हिन्दी', speech: 'hi-IN' },
  mr: { label: 'Marathi', native: 'मराठी', speech: 'mr-IN' },
  kn: { label: 'Kannada', native: 'ಕನ್ನಡ', speech: 'kn-IN' },
} as const;
export type Lang = keyof typeof LANGUAGES;
export const isLang = (v: unknown): v is Lang => typeof v === 'string' && v in LANGUAGES;
