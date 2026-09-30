import fs from 'node:fs';
import path from 'node:path';
import { ANSWER_MODES, AnswerMode, DATA_DIR, env } from './config';

/** Operator-changeable settings. Persisted to data/settings.json so a reboot keeps them. */
export interface Settings {
  mode: AnswerMode;
  localChatModel: string;
  onlineChatModel: string;
  requireCitations: boolean;
}

const FILE = path.join(DATA_DIR, 'settings.json');

function defaults(): Settings {
  return {
    mode: env.answerMode,
    localChatModel: env.local.chatModel,
    onlineChatModel: env.online.chatModel,
    requireCitations: true,
  };
}

let cache: Settings | null = null;

export function getSettings(): Settings {
  if (cache) return cache;
  let s = defaults();
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    s = { ...s, ...saved };
  } catch {
    /* first run */
  }
  if (!ANSWER_MODES.includes(s.mode)) s.mode = 'auto';
  cache = s;
  return s;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const cur = getSettings();
  const next: Settings = { ...cur };
  if (patch.mode && ANSWER_MODES.includes(patch.mode)) next.mode = patch.mode;
  if (typeof patch.localChatModel === 'string' && patch.localChatModel.trim()) next.localChatModel = patch.localChatModel.trim();
  if (typeof patch.onlineChatModel === 'string') next.onlineChatModel = patch.onlineChatModel.trim();
  if (typeof patch.requireCitations === 'boolean') next.requireCitations = patch.requireCitations;
  cache = next;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  } catch (e) {
    console.warn('[settings] could not persist settings:', (e as Error).message);
  }
  return next;
}
