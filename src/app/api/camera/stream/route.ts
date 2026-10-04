import { adminAllowed, forbidden } from '@/lib/admin';
import { subscribe } from '@/lib/camera';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Live webcam preview as an MJPEG stream: <img src="/api/camera/stream">. ~10 frames a second. */
export async function GET(req: Request) {
  if (!adminAllowed(req)) return forbidden();
  const enc = new TextEncoder();
  let unsub = () => {};
  const stream = new ReadableStream({
    start(c) {
      let last = 0;
      unsub = subscribe((jpeg) => {
        const now = Date.now();
        if (now - last < 100) return;
        last = now;
        try {
          c.enqueue(enc.encode(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`));
          c.enqueue(new Uint8Array(jpeg));
          c.enqueue(enc.encode('\r\n'));
        } catch { unsub(); }
      });
      req.signal.addEventListener('abort', () => { unsub(); try { c.close(); } catch { /* closed */ } });
    },
    cancel() { unsub(); },
  });
  return new Response(stream, { headers: { 'content-type': 'multipart/x-mixed-replace; boundary=frame', 'cache-control': 'no-store' } });
}
