#!/usr/bin/env node
// Rebuilds the archive index through the running kiosk server (so the server picks it up immediately).
//   npm run ingest                 → keyword + embeddings (if LOCAL_EMBED_MODEL is available)
//   npm run ingest -- --no-embed   → keyword index only
const base = process.env.KIOSK_URL || 'http://127.0.0.1:3000';
const embeddings = !process.argv.includes('--no-embed');
const headers = { 'content-type': 'application/json' };
if (process.env.ADMIN_PIN) headers['x-admin-pin'] = process.env.ADMIN_PIN;
try {
  const res = await fetch(`${base}/api/admin/ingest`, { method: 'POST', headers, body: JSON.stringify({ embeddings }) });
  if (!res.ok) { console.error(`HTTP ${res.status}: ${await res.text()}`); process.exit(1); }
  const dec = new TextDecoder();
  for await (const chunk of res.body) process.stdout.write(dec.decode(chunk));
} catch (e) {
  console.error(`Could not reach the kiosk server at ${base} — start it first (npm start). ${e.message}`);
  process.exit(1);
}
