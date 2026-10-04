#!/usr/bin/env bash
# Drives the kiosk on the Jetson's monitor (Ask ~1 min, Timeline ~20 s, Connections ~20 s, Collection + camera) while recording screen + monitor audio.
set -u
export DISPLAY=:0 XAUTHORITY=/run/user/1000/gdm/Xauthority XDG_RUNTIME_DIR=/run/user/1000
X="python3 /home/af/ambedkar-heritage/samvira/scripts/xwin.py"
RAW=/home/af/ambedkar-heritage/demo-recording-raw.mkv
step() { echo "$(date +%T) $*"; }
park() { $X click 1880 1060; }   # move the pointer out of the way (empty corner)

# ── reset: English, Ask page, fresh script ──
$X click 1614 44; sleep 0.5; $X click 368 44; sleep 1.5; $X key F5; sleep 4; park; sleep 1

# Keep the monitor's audio output awake with silence: PulseAudio suspends an idle output, which stops its
# monitor source, and ffmpeg then stalls waiting for audio.
pacat -p --raw --format=s16le --rate=44100 --channels=2 --device=alsa_output.platform-3510000.hda.hdmi-stereo < /dev/zero &
KEEP=$!
sleep 1
# Video and audio are recorded by separate processes and joined afterwards: a live audio input that
# stalls (PulseAudio reconfigures the output when a new sound starts) would otherwise freeze the video too.
parecord --device=alsa_output.platform-3510000.hda.hdmi-stereo.monitor --file-format=wav /home/af/ambedkar-heritage/demo-recording-raw.wav &
AUD=$!
# Screen capture on the Orin's hardware: VIC scales/converts (nvvidconv), NVJPG encodes (nvjpegenc). CPU encoding
# can't keep up at 1080p while Firefox is animating.
gst-launch-1.0 -e -q ximagesrc display-name=:0 use-damage=false show-pointer=true ! video/x-raw,framerate=20/1 \
  ! queue max-size-buffers=60 ! nvvidconv ! 'video/x-raw(memory:NVMM),width=1280,height=720,format=I420' \
  ! nvjpegenc quality=85 ! queue ! matroskamux ! filesink location="$RAW" > /dev/null 2>&1 &
REC=$!
sleep 3

T0=$(date +%s)
until_t() { while [ $(( $(date +%s) - T0 )) -lt "$1" ]; do sleep 0.2; done; }   # wait until N s into the video

step "Ask (~1 min): voice question, read aloud with citations"
$X click 922 284; park; sleep 34
$X click 758 790; sleep 2.5; $X click 638 690; sleep 2.5          # tap citations S2, S1
step "  typed off-topic question → refusal"
$X click 550 284; $X key Control_L+a; $X type "Who won the cricket world cup"; $X key Return; park
until_t 62

step "Timeline (~20 s)"
$X click 468 44; sleep 3
$X click 552 630; sleep 2.5      # Mahad Satyagraha
$X click 552 742; sleep 2.5      # Poona Pact
$X click 518 140; sleep 2.5      # era: Movement
$X click 652 140; sleep 2.5      # era: Statecraft
$X click 772 140; sleep 2.5      # era: Legacy
$X click 248 140; sleep 2; park  # all years
until_t 83

step "Connections (~20 s)"
$X click 606 44; sleep 4
for xy in "958 642" "958 322" "1088 226" "468 396" "1022 568" "534 322"; do $X click $xy; sleep 2.6; done; park
until_t 104

step "Collection: open the archive document, then the camera"
$X click 750 44; sleep 3.5
$X click 1154 712; sleep 5; park    # "About the Writings and Speeches collection"
$X click 750 44; sleep 3.5
$X click 1632 144; sleep 7; park    # Scan a page → live camera interface
kill -INT $REC; wait $REC; kill -INT $AUD; wait $AUD; kill $KEEP
step "recording stopped"
$X click 1486 294; sleep 1; $X click 368 44; sleep 2; $X key F5   # close camera panel, back to Ask

# Join video + audio into the shareable MP4.
cd /home/af/ambedkar-heritage && ffmpeg -hide_banner -loglevel error -y -i demo-recording-raw.mkv -i demo-recording-raw.wav \
  -map 0:v -map 1:a -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -r 20 -c:a aac -b:a 160k -shortest \
  -movflags +faststart samvira-demo.mp4 && rm -f demo-recording-raw.mkv demo-recording-raw.wav && echo "saved samvira-demo.mp4"
