#!/usr/bin/env bash
# Opens the kiosk full-screen in Chromium once the server answers.
# Autostart it from the desktop session (see deploy/kiosk-browser.desktop).
URL="${KIOSK_URL:-http://localhost:3000}"
for i in $(seq 1 60); do curl -fs "$URL/api/voice" >/dev/null && break; sleep 2; done
BROWSER=$(command -v chromium-browser || command -v chromium || command -v google-chrome)
xset s off -dpms 2>/dev/null   # keep the screen on
exec "$BROWSER" --kiosk --app="$URL" \
  --noerrdialogs --disable-infobars --disable-session-crashed-bubble --no-first-run \
  --overscroll-history-navigation=0 --disable-pinch \
  --use-fake-ui-for-media-stream   # auto-allow the microphone for voice questions
