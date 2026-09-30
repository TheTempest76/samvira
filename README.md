# Ambedkar Digital Heritage Archive — Jetson kiosk prototype

A Next.js app that runs on a **Jetson Orin Nano** and gives you two screens:

- **Kiosk** (`http://localhost:3000`) — the touch screen visitors use. Built for a 1920×1080 touch display.
- **Operator dashboard** (`http://localhost:3000/admin`) — for you and the judges. Shows live Jetson stats, model status and answer quality, and lets you switch engines and re-index the archive.

## What the prototype demonstrates

| Feature | Where to see it |
|---|---|
| **Answers grounded in the archive, with citations.** Each answer is built only from retrieved passages; every claim carries a tappable `S1`, `S2` chip that highlights the source card and opens the exact passage (with page number for PDFs). | Kiosk → Ask |
| **Cite-or-refuse.** If search finds nothing relevant the kiosk refuses *before* calling a model. If the model answers without citations, the answer is withheld. | Ask something off-topic, e.g. "Who won the cricket world cup?" |
| **Local, online, or both.** `Auto` tries the on-device model (Ollama on the Jetson), falls back to an online model, and if both are down still answers with archive passages. The fallback reason is logged. | Dashboard → Answer engine; unplug the network or stop Ollama mid-demo |
| **Works fully offline.** "Archive only" mode needs no model at all. | Dashboard → Archive only |
| **Side-by-side benchmark.** The same question, same sources, on-device vs online, with time-to-first-word and total time. | Dashboard → Side-by-side test |
| **Multilingual.** English, Hindi, Marathi, Kannada UI and answers. Non-English questions match English text through multilingual embeddings (bge-m3) or, without them, a model-translated search query. | Kiosk → language switch |
| **Voice.** Speak a question (any OpenAI-compatible speech-to-text server, local or online); answers can be read aloud. | Kiosk → mic button, "Read aloud" |
| **Timeline and connections.** Chronology and a people / events / works / organisations / places network; every item links to its source and can be asked about. | Kiosk → Timeline, Connections |
| **Collection search and reader.** Full-text search over every passage; document reader with the cited passage highlighted. | Kiosk → Collection |
| **Live Jetson telemetry.** CPU, GPU load, shared memory, temperature, board power, with 2-minute history. | Dashboard |
| **Drop-in ingestion.** Put PDFs in `data/docs/`, press **Re-index**: text is extracted page by page, chunked, embedded and searchable immediately. | Dashboard → Archive index |
| **Idle reset.** After 2 minutes without a touch the kiosk clears the conversation and shows the start screen. | Kiosk |

### About the bundled content

`data/seed/` holds 11 short **curator notes** written as demo content: plain summaries of well-documented events, with no quotations. They exist so the demo works out of the box. **Before any public showing, replace or verify them** against the primary source. The real corpus is *Dr. Babasaheb Ambedkar: Writings and Speeches* (Government of Maharashtra), which is available as scans on the Internet Archive. Put those PDFs in `data/docs/` and re-index.

`data/timeline.json` and `data/graph.json` are built from the same notes. Edit them to add events and relationships; each entry names the document it comes from.

The Hindi, Marathi and Kannada interface text and refusal messages are a first draft. **Have a native speaker review them.**

---

## Setting it up on the Jetson Orin Nano

Tested flow assumes **JetPack 6 (Ubuntu 22.04)**. Commands run on the Jetson.

### 1. System packages

```bash
sudo apt update
sudo apt install -y git curl poppler-utils fonts-noto-core   # pdftotext for PDFs, Devanagari/Kannada fonts
```

For the browser's built-in "read aloud" voice in Indian languages, also install `speech-dispatcher espeak-ng`.

### 2. Node.js 22

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
```

### 3. Ollama and models (the on-device engine)

```bash
curl -fsSL https://ollama.com/install.sh | sh     # detects the Jetson and installs the GPU build
ollama pull llama3.2:3b                             # chat model — fits comfortably in 8 GB shared memory
ollama pull bge-m3                                  # multilingual embeddings for Hindi/Marathi/Kannada search
```

Any other Ollama model works. Change `LOCAL_CHAT_MODEL`, or pick it from the dashboard drop-down. On 8 GB, stay around 3–4B parameters at 4-bit so the chat model, the embedding model and the browser all fit together. For the best response times, put the board in its highest power mode: check the modes with `sudo nvpmodel -q`, then run `sudo jetson_clocks`.

### 4. The app

```bash
git clone <your repo> ~/heritage-kiosk     # or copy this folder over
cd ~/heritage-kiosk
cp .env.example .env.local                   # then edit — see below
npm install
npm run build                                # needs internet once (downloads the web fonts)
npm start                                    # http://localhost:3000  and  /admin
```

On first start the app builds a keyword index from `data/seed`. To add embeddings and your PDFs:

```bash
cp ~/Downloads/*.pdf data/docs/
npm run ingest            # or press "Re-index archive" on /admin
```

### 5. Online model (optional)

In `.env.local`:

```ini
# Any OpenAI-compatible API (OpenAI, Groq, OpenRouter, Together, Gemini's OpenAI endpoint…)
ONLINE_PROVIDER=openai
ONLINE_BASE_URL=https://api.openai.com/v1
ONLINE_API_KEY=sk-...
ONLINE_CHAT_MODEL=<a model your key can use>

# or Claude
ONLINE_PROVIDER=anthropic
ONLINE_API_KEY=sk-ant-...
ONLINE_CHAT_MODEL=<a Claude model id>
```

Leave `ANSWER_MODE=auto` to get on-device first with online fallback.

### 6. Voice (optional)

- **Speech-to-text:** set `STT_URL` to anything that serves the OpenAI `POST /audio/transcriptions` API. That can be an online API (`https://api.openai.com/v1` with `STT_MODEL=whisper-1` and `STT_API_KEY`), or a local Whisper server on the Jetson. *speaches* (formerly faster-whisper-server) is one OpenAI-compatible option. Check its docs for an ARM64/Jetson build before you rely on it. The mic button only appears when `STT_URL` is set.
- **Read aloud:** by default this uses the browser's voice. To use a server voice instead, set `TTS_URL` to anything that serves `POST /audio/speech`.

The microphone only works on `localhost` or HTTPS. The kiosk runs on `localhost`, so it's fine on the device.

### 7. Start at boot, full-screen

```bash
sudo cp deploy/heritage-kiosk.service /etc/systemd/system/   # edit User/WorkingDirectory/ExecStart first
sudo systemctl daemon-reload && sudo systemctl enable --now heritage-kiosk
mkdir -p ~/.config/autostart && cp deploy/kiosk-browser.desktop ~/.config/autostart/
```

`scripts/kiosk.sh` waits for the server, disables screen blanking and opens Chromium in kiosk mode with the microphone pre-approved.

Set `ADMIN_PIN` in `.env.local` so visitors can't change settings from `/admin`. The kiosk screens never link to it.

---

## How it works

```
Kiosk (Chromium) ──► Next.js on the Jetson
                      ├─ /api/ask ── retrieval (BM25 + optional bge-m3 vectors, in-process)
                      │              └─► prompt with numbered sources ─► Ollama (local)  ─┐
                      │                                                  └► online API ◄──┘ fallback
                      │              └─► cite-or-refuse check ─► streamed NDJSON to the kiosk
                      ├─ /api/transcribe, /api/tts ─► speech servers (optional)
                      ├─ /api/system ─► /proc + /sys (CPU, GPU load, temps, INA3221 power)
                      └─ /api/admin/ingest ─► pdftotext ─► chunks ─► embeddings ─► data/index.json + vectors.f32
```

No database is needed for the prototype: the index is a JSON file plus a binary vector file, loaded into memory. This keeps the Jetson footprint small. The full design's PostgreSQL + pgvector, Neo4j and MinIO slot in behind the same `/api/search` and `/api/ask` interfaces.

| Path | What's there |
|---|---|
| `src/lib/retrieval.ts` | BM25 + vector hybrid search, refusal threshold |
| `src/lib/providers.ts` | Ollama, OpenAI-compatible and Anthropic streaming clients, health checks |
| `src/lib/prompt.ts` | Grounding prompt, citation parsing, refusal text |
| `src/app/api/ask/route.ts` | Retrieve → generate → fallback chain → verdict |
| `src/lib/jetson.ts` | Hardware telemetry |
| `src/lib/corpus.ts` | PDF/text ingestion and chunking |
| `src/components/` | Kiosk and dashboard UI |

### Tuning

- `MIN_RETRIEVAL_SCORE` (default 1.5) and `MIN_VECTOR_SCORE` (default 0.55) decide when the kiosk says "not in the archive". Tune them on your real corpus: ask ten in-scope and ten out-of-scope questions and adjust until both sets behave.
- `TOP_K` (default 5) sets how many passages go to the model. Fewer passages means faster answers on the Jetson.
- The on-device model's context is set to 4096 tokens (`num_ctx` in `providers.ts`).

### Privacy note

Questions are logged, cut to 120 characters, to `data/querylog.jsonl` for the dashboard's statistics. Nothing else about visitors is stored. Delete the file or remove `recordQuery` if you don't want the log.
