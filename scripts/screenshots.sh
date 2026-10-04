#!/usr/bin/env bash
# Drives the kiosk on the Jetson's monitor (DEMO_MODE=1, 1920×1080) and saves README screenshots to docs/screenshots/.
set -u
export DISPLAY=:0 XAUTHORITY=/run/user/1000/gdm/Xauthority XDG_RUNTIME_DIR=/run/user/1000
X="python3 $(dirname "$0")/xwin.py"
OUT="$(cd "$(dirname "$0")/.." && pwd)/docs/screenshots"
mkdir -p "$OUT"
shot() { ffmpeg -loglevel error -y -f x11grab -video_size 1920x1080 -i :0 -frames:v 1 "$OUT/$1.png"; echo "saved $1.png"; }
park() { $X click 1880 1060; }

# reset: English, Ask page, fresh demo script
$X click 1614 44; sleep 0.5; $X click 368 44; sleep 1.5; $X key F5; sleep 4; park

$X click 922 284; sleep 2; shot voice-listening              # scripted mic: waveform + live caption
sleep 10; shot ask-answer                                     # answer read aloud, sentence + source highlighted
sleep 24
$X click 922 284; sleep 14; shot ask-hindi                    # spoken Hindi → kiosk switches to Hindi
sleep 22
$X click 930 288; sleep 6; shot ask-refusal                   # off-topic → refused
sleep 8

$X click 468 44; sleep 3.5; $X click 552 630; sleep 2; park; shot timeline
$X click 606 44; sleep 4; $X click 958 322; sleep 2; park; shot connections
$X click 750 44; sleep 3.5; park; shot collection

# document reader with the cited passage highlighted (typed scripted question, then "Open document" on S1)
$X click 368 44; sleep 3; $X click 550 284; $X key Control_L+a; $X type "What happened at Mahad in 1927"; $X key Return; sleep 7
$X click 1214 388; sleep 4; park; shot reader

$X click 750 44; sleep 3.5; $X click 1632 144; sleep 5; park; shot scan-camera
$X click 1486 294; sleep 1

systemd-run --user --quiet --collect --setenv=SNAP_REEXEC=0 --setenv=DISPLAY=:0 --setenv=XAUTHORITY=/run/user/1000/gdm/Xauthority \
  --setenv=XDG_RUNTIME_DIR=/run/user/1000 /snap/bin/firefox --new-tab http://localhost:3000/admin
sleep 12; park; shot dashboard
$X key Control_L+w; sleep 1; $X click 368 44; sleep 2; $X key F5
