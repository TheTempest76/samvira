import { env } from './config';

export type Target = 'local' | 'online';
export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class ProviderError extends Error {
  constructor(public target: Target, message: string) {
    super(message);
  }
}

/** Reads a fetch body as text lines (handles chunks that split lines). */
async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      yield line;
    }
  }
  if (buf.trim()) yield buf;
}

function withTimeout(ms: number, outer?: AbortSignal) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(new Error(`no response within ${ms} ms`)), ms);
  outer?.addEventListener('abort', () => ctl.abort(outer.reason));
  return { signal: ctl.signal, clear: () => clearTimeout(t) };
}

async function failIfBad(res: Response, target: Target) {
  if (res.ok && res.body) return;
  const text = await res.text().catch(() => '');
  throw new ProviderError(target, `HTTP ${res.status}: ${text.slice(0, 300) || res.statusText}`);
}

// ─────────────────────────── Local: Ollama ───────────────────────────
async function* ollamaStream(messages: ChatMsg[], model: string, signal?: AbortSignal) {
  const { signal: s, clear } = withTimeout(env.local.timeoutMs, signal);
  let res: Response;
  try {
    res = await fetch(`${env.local.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        keep_alive: '30m',
        options: { temperature: 0.2, num_ctx: 4096 },
      }),
      signal: s,
    });
  } catch (e) {
    clear();
    throw new ProviderError('local', `Ollama unreachable at ${env.local.baseUrl} (${(e as Error).message})`);
  }
  try {
    await failIfBad(res, 'local');
    let first = true;
    for await (const line of lines(res.body!)) {
      if (!line.trim()) continue;
      const j = JSON.parse(line);
      if (j.error) throw new ProviderError('local', j.error);
      const piece: string = j.message?.content ?? '';
      if (piece) {
        if (first) { clear(); first = false; }
        yield piece;
      }
      if (j.done) break;
    }
  } finally {
    clear();
  }
}

// ──────────────────── Online: OpenAI-compatible API ────────────────────
async function* openaiStream(messages: ChatMsg[], model: string, signal?: AbortSignal) {
  const { signal: s, clear } = withTimeout(env.online.timeoutMs, signal);
  try {
    const res = await fetch(`${env.online.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.online.apiKey}` },
      body: JSON.stringify({ model, messages, stream: true, temperature: 0.2, max_tokens: 700 }),
      signal: s,
    }).catch((e) => {
      throw new ProviderError('online', `Online API unreachable (${(e as Error).message})`);
    });
    await failIfBad(res, 'online');
    for await (const line of lines(res.body!)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') break;
      const j = JSON.parse(data);
      const piece: string = j.choices?.[0]?.delta?.content ?? '';
      if (piece) { clear(); yield piece; }
    }
  } finally {
    clear();
  }
}

// ──────────────────── Online: Anthropic Messages API ────────────────────
async function* anthropicStream(messages: ChatMsg[], model: string, signal?: AbortSignal) {
  const { signal: s, clear } = withTimeout(env.online.timeoutMs, signal);
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const rest = messages.filter((m) => m.role !== 'system');
  try {
    const res = await fetch(`${env.online.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.online.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, system, messages: rest, max_tokens: 700, temperature: 0.2, stream: true }),
      signal: s,
    }).catch((e) => {
      throw new ProviderError('online', `Anthropic API unreachable (${(e as Error).message})`);
    });
    await failIfBad(res, 'online');
    for await (const line of lines(res.body!)) {
      if (!line.startsWith('data:')) continue;
      const j = JSON.parse(line.slice(5).trim());
      if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') {
        clear();
        yield j.delta.text as string;
      } else if (j.type === 'error') {
        throw new ProviderError('online', j.error?.message || 'stream error');
      } else if (j.type === 'message_stop') break;
    }
  } finally {
    clear();
  }
}

export function onlineConfigured() {
  return Boolean(env.online.apiKey);
}

export function streamChat(target: Target, messages: ChatMsg[], model: string, signal?: AbortSignal) {
  if (target === 'local') return ollamaStream(messages, model, signal);
  if (!onlineConfigured()) throw new ProviderError('online', 'No ONLINE_API_KEY set');
  if (!model) throw new ProviderError('online', 'No online model set (ONLINE_CHAT_MODEL or the dashboard)');
  return env.online.provider === 'anthropic'
    ? anthropicStream(messages, model, signal)
    : openaiStream(messages, model, signal);
}

export async function completeChat(target: Target, messages: ChatMsg[], model: string, signal?: AbortSignal) {
  let out = '';
  for await (const p of streamChat(target, messages, model, signal)) out += p;
  return out;
}

// ─────────────────────────── Health checks ───────────────────────────
export async function localStatus() {
  const t0 = Date.now();
  try {
    const [tags, ps] = await Promise.all([
      fetch(`${env.local.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2500) }).then((r) => r.json()),
      fetch(`${env.local.baseUrl}/api/ps`, { signal: AbortSignal.timeout(2500) }).then((r) => r.json()).catch(() => ({ models: [] })),
    ]);
    return {
      reachable: true,
      pingMs: Date.now() - t0,
      installed: (tags.models ?? []).map((m: { name: string; size?: number }) => ({ name: m.name, size: m.size ?? 0 })),
      loaded: (ps.models ?? []).map((m: { name: string; size_vram?: number }) => ({ name: m.name, vram: m.size_vram ?? 0 })),
    };
  } catch (e) {
    return { reachable: false, pingMs: null, error: (e as Error).message, installed: [], loaded: [] };
  }
}

export async function onlineStatus() {
  if (!onlineConfigured()) return { configured: false, reachable: false, pingMs: null };
  const t0 = Date.now();
  try {
    // A HEAD-ish probe: any HTTP answer (even 401/404) proves the network path works.
    const res = await fetch(`${env.online.baseUrl}/models`, {
      headers:
        env.online.provider === 'anthropic'
          ? { 'x-api-key': env.online.apiKey, 'anthropic-version': '2023-06-01' }
          : { authorization: `Bearer ${env.online.apiKey}` },
      signal: AbortSignal.timeout(4000),
    });
    return { configured: true, reachable: true, pingMs: Date.now() - t0, authOk: res.ok, status: res.status };
  } catch (e) {
    return { configured: true, reachable: false, pingMs: null, error: (e as Error).message };
  }
}

// ─────────────────────────── Embeddings (local) ───────────────────────────
export async function embed(texts: string[], timeoutMs = 60000): Promise<number[][]> {
  const model = env.local.embedModel;
  if (!model) throw new Error('No LOCAL_EMBED_MODEL');
  const res = await fetch(`${env.local.baseUrl}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: texts, keep_alive: '30m' }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`embed HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  if (!Array.isArray(j.embeddings)) throw new Error('embed: unexpected response');
  return j.embeddings;
}
