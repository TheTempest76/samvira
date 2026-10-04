/**
 * Runs once when the server starts. Loads the on-device models in the background so the first visitor
 * doesn't hit a cold start: bge-m3 takes ~20 s to load on the Orin Nano, longer than search waits for it,
 * so a cold embedder silently drops multilingual search back to keywords.
 */
export async function register() {
  // The scripted demo (DEMO_MODE=1) runs without models, so there is nothing to load.
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.DEMO_MODE === '1') return;
  const { warmUp } = await import('./lib/warmup');
  void warmUp(); // not awaited: the server must not wait for model loading
}
