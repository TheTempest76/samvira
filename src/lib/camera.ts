import { ChildProcess, spawn } from 'node:child_process';

/**
 * The webcam on the Jetson (USB/UVC, read with ffmpeg). One capture process feeds both the live preview and
 * "Capture", because a V4L2 device can only be opened once. It starts on first use and stops after 20 s unwatched.
 * CAMERA_DEVICE (default /dev/video0), CAMERA_SIZE (default 640x480 — the most the bundled webcam offers).
 */
const DEVICE = process.env.CAMERA_DEVICE || '/dev/video0';
const SIZE = process.env.CAMERA_SIZE || '640x480';
const IDLE_MS = 20000;

type Listener = (jpeg: Buffer) => void;
interface Cam {
  proc: ChildProcess | null;
  latest: Buffer | null;
  latestAt: number;
  listeners: Set<Listener>;
  idle: ReturnType<typeof setTimeout> | null;
  error: string | null;
}
// Survives module reloads and is shared by every route.
const g = globalThis as unknown as { __camera?: Cam };
const cam: Cam = (g.__camera ??= { proc: null, latest: null, latestAt: 0, listeners: new Set(), idle: null, error: null });

function start() {
  if (cam.proc) return;
  cam.error = null;
  // Re-encode to complete baseline JPEGs: webcam MJPEG often omits the Huffman tables, which some decoders reject.
  const p = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'v4l2', '-input_format', 'mjpeg', '-video_size', SIZE, '-framerate', '15',
    '-i', DEVICE, '-c:v', 'mjpeg', '-q:v', '3', '-f', 'image2pipe', 'pipe:1',
  ]);
  cam.proc = p;
  let buf = Buffer.alloc(0);
  p.stdout.on('data', (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    // Inside JPEG data every 0xFF is followed by 0x00, so FF D9 only ever marks the end of a frame.
    for (;;) {
      const end = buf.indexOf(Buffer.from([0xff, 0xd9]));
      if (end < 0) break;
      const frame = buf.subarray(0, end + 2);
      buf = buf.subarray(end + 2);
      const soi = frame.indexOf(Buffer.from([0xff, 0xd8]));
      if (soi < 0) continue;
      cam.latest = Buffer.from(frame.subarray(soi));
      cam.latestAt = Date.now();
      for (const l of cam.listeners) l(cam.latest);
    }
  });
  p.stderr.on('data', (d: Buffer) => (cam.error = d.toString().trim().split('\n').pop() || cam.error));
  p.on('exit', () => {
    if (cam.proc === p) { cam.proc = null; cam.latest = null; }
  });
}

function stop() {
  cam.proc?.kill('SIGTERM');
  cam.proc = null;
  cam.latest = null;
}

function keepAlive() {
  if (cam.idle) clearTimeout(cam.idle);
  cam.idle = setTimeout(() => (cam.listeners.size ? keepAlive() : stop()), IDLE_MS);
}

/** Calls `fn` with every new frame until the returned function is called. */
export function subscribe(fn: Listener): () => void {
  start();
  keepAlive();
  cam.listeners.add(fn);
  if (cam.latest) fn(cam.latest);
  return () => { cam.listeners.delete(fn); keepAlive(); };
}

/** A fresh frame (waits for the camera to start if needed). */
export function grabFrame(timeoutMs = 6000): Promise<Buffer> {
  start();
  keepAlive();
  if (cam.latest && Date.now() - cam.latestAt < 200) return Promise.resolve(cam.latest);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { cam.listeners.delete(on); reject(new Error(cam.error || `no picture from ${DEVICE}`)); }, timeoutMs);
    const on: Listener = (f) => { clearTimeout(t); cam.listeners.delete(on); resolve(f); };
    cam.listeners.add(on);
  });
}
