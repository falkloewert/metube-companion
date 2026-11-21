#!/usr/bin/env python3
"""Builds the final video from what record.js captured (OUT/manifest.json).

  compose.py OUT docs/demo.mp4

Video: part 1 is cut out of the screen recording (x11.mkv), waiting time sped up
where record.js marked it; part 2 is the CDP screencast (frames with
timestamps). Audio: quiet music (music.ogg, see CREDITS.md) plus soft UI sounds,
synthesized here from numpy sines and noise, placed at the event times that
record.js logged. Needs ffmpeg and numpy.
"""
import json
import os
import subprocess
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT, DEST = sys.argv[1], sys.argv[2]
FPS = 30
SR = 48000
FADE = 0.35                    # fade to/from black between the parts and at the end
TARGET_LUFS = -20.0            # of the whole mix; the music alone sits a few dB lower


def run(cmd, **kw):
    subprocess.run(cmd, check=True, **kw)


def ffmpeg(*args):
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *args])


def duration(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                       check=True, capture_output=True, text=True)
    return float(r.stdout)


def out_time(t, t0, segs):
    """Seconds into the part's output for wall-clock time t: sped-up segments count 1/speed."""
    d = t - t0
    for s in segs:
        ov = min(t, s['t1']) - max(t0, s['t0'])
        if ov > 0:
            d -= ov * (1 - 1 / s['speed'])
    return d


manifest = json.load(open(os.path.join(OUT, 'manifest.json')))
parts = {p['name']: p for p in manifest['parts']}

# ---- Part 1: the screen recording, trimmed, waiting time sped up ----------------
ext = parts['extension']
off = ext['offset']
a, b = ext['tStart'] - off, ext['tEnd'] - off
pieces, cur = [], a
for s in sorted(ext['segs'], key=lambda s: s['t0']):
    s0, s1 = s['t0'] - off, s['t1'] - off
    if s0 > cur:
        pieces.append((cur, s0, 1))
    pieces.append((s0, s1, s['speed']))
    cur = s1
pieces.append((cur, b, 1))


def popup_flashes(src):
    """pts of frames showing a window that is mapped but not painted yet (a pure white
    box for a moment: context menu, notification). They are dropped; the previous frame stays."""
    w, h = 96, 54
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-vf', f'scale={w}:{h}:flags=area,format=gray', '-f', 'rawvideo', '-'],
                         check=True, capture_output=True).stdout
    white = (np.frombuffer(raw, dtype=np.uint8).reshape(-1, h, w) > 235).mean(axis=(1, 2))
    pts = [float(x.strip(',')) for x in subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', src],
        check=True, capture_output=True, text=True).stdout.split()]
    bad = []
    for i in range(1, len(white) - 5):
        base = white[i - 1]
        if white[i] - base > 0.02:
            run = [j for j in range(i, i + 5) if white[j] - base > 0.02]
            if run == list(range(i, i + len(run))) and len(run) <= 4 and white[i + len(run)] - base <= 0.02:
                bad += [pts[j] for j in run]
    return bad


flash = popup_flashes(os.path.join(OUT, 'x11.mkv'))
print(f'dropping {len(flash)} frames of unpainted popups')
drop = '+'.join(f'between(t,{t - 0.004:.3f},{t + 0.004:.3f})' for t in flash) or '0'
chain = f"[0:v]select='not({drop})',split={len(pieces)}" + ''.join(f'[s{i}]' for i in range(len(pieces))) + ';'
chain += ''.join(
    f"[s{i}]trim=start={p0:.3f}:end={p1:.3f},setpts=(PTS-STARTPTS)/{sp},fps={FPS}[v{i}];" for i, (p0, p1, sp) in enumerate(pieces))
chain += ''.join(f'[v{i}]' for i in range(len(pieces))) + f'concat=n={len(pieces)}:v=1:a=0,format=yuv420p[v]'
ffmpeg('-i', os.path.join(OUT, 'x11.mkv'), '-filter_complex', chain, '-map', '[v]',
       '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', os.path.join(OUT, 'part1.mp4'))
d1 = duration(os.path.join(OUT, 'part1.mp4'))
print(f'part 1: {d1:.1f} s')

# ---- Part 2: the screencast ---------------------------------------------------------
web = parts['web']
frames = sorted(web['frames'], key=lambda f: f['t'])
keep = [f for f in frames if f['t'] >= web['tStart'] - 0.5]
lines, total, last, carry = [], 0.0, None, 0.0
for i, f in enumerate(keep):
    t0 = f['t']
    t1 = keep[i + 1]['t'] if i + 1 < len(keep) else web['tEnd']
    if t1 <= web['tStart']:
        continue
    d = out_time(t1, web['tStart'], web['segs']) - out_time(max(t0, web['tStart']), web['tStart'], web['segs'])
    d += carry
    if d < 0.004:          # too short for a frame of its own: the next one takes over its time
        carry = d
        continue
    carry = 0.0
    lines += [f"file '{f['file']}'", f'duration {d:.4f}']
    total += d
    last = f['file']
lines.append(f"file '{last}'")      # the concat demuxer ignores the duration of the last entry
open(os.path.join(OUT, 'frames.txt'), 'w').write('\n'.join(lines) + '\n')
ffmpeg('-f', 'concat', '-safe', '0', '-i', os.path.join(OUT, 'frames.txt'), '-vf', f'fps={FPS},format=yuv420p',
       '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', os.path.join(OUT, 'part2.mp4'))
d2 = duration(os.path.join(OUT, 'part2.mp4'))
print(f'part 2: {d2:.1f} s')
total_len = d1 + d2

# ---- Sounds ---------------------------------------------------------------------------
rng = np.random.default_rng(7)


def tt(sec):
    return np.arange(int(sec * SR)) / SR


def decay(t, tau):
    return np.exp(-t / tau)


def attack(t, a=0.004):
    return np.minimum(1, t / a)


def sweep(f0, f1, t, dur):
    """Sine with an exponential frequency glide from f0 to f1 over dur seconds."""
    f = f0 * (f1 / f0) ** np.minimum(1, t / dur)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def bandnoise(t, f0, f1, dur, q=3.0):
    """Noise through a resonant band whose center glides from f0 to f1."""
    f = f0 * (f1 / f0) ** np.minimum(1, t / dur)
    n = rng.standard_normal(len(t))
    y, z1, z2 = np.empty_like(n), 0.0, 0.0
    for i in range(len(n)):
        w = 2 * np.sin(np.pi * f[i] / SR)
        z1 += w * z2
        hp = n[i] - z1 - z2 / q
        z2 += w * hp
        y[i] = z1
    return y / (np.max(np.abs(y)) + 1e-9)


def bell(f, t, tau, parts=((1, 1.0), (2.76, 0.25), (5.4, 0.08))):
    return sum(g * np.sin(2 * np.pi * f * m * t) * decay(t, tau / m ** 0.6) for m, g in parts)


def room(x, tail=0.28, wet=0.16):
    """A little soft room: the sound plus a decaying noise tail, so nothing sounds dry."""
    n = int(tail * SR)
    ir = rng.standard_normal(n) * decay(np.arange(n) / SR, tail / 4)
    ir = lowpass(ir, 3500)
    nfft = 1 << int(np.ceil(np.log2(len(x) + n)))
    wetsig = np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(ir, nfft), nfft)[:len(x)]
    wetsig *= np.max(np.abs(x)) / (np.max(np.abs(wetsig)) + 1e-9)
    return x + wet * wetsig


def fit(x, peak):
    return x / (np.max(np.abs(x)) + 1e-9) * peak


def s_tile():       # soft rising "bloop"
    t = tt(0.22)
    return room(fit(sweep(520, 780, t, 0.09) * attack(t, .006) * decay(t, .07), .5))


def s_send():       # a quick upward whoosh with a round pop at the end
    t = tt(0.42)
    whoosh = lowpass(bandnoise(t, 500, 2600, 0.28), 4000) * np.sin(np.pi * np.minimum(1, t / 0.3)) ** 2 * (t < 0.3)
    pop = np.zeros_like(t)
    m = t >= 0.2
    pop[m] = np.sin(2 * np.pi * 880 * t[m]) * decay(t[m] - 0.2, .06) * attack(t[m] - 0.2, .004)
    return room(fit(0.5 * fit(whoosh, 1) + 0.6 * fit(sweep(330, 700, t, 0.22) * attack(t) * decay(t, .12), 1) * 0.5 + 0.7 * pop, .5))


def s_done():       # gentle two-note chime
    t = tt(1.5)
    x = bell(784, t, .55) * attack(t, .005)
    t2 = np.clip(t - 0.11, 0, None)
    x2 = bell(1175, t2, .75) * attack(t2, .005) * (t >= 0.11)
    return room(fit(x * 0.8 + x2, .5), tail=.5, wet=.25)


def s_copy():       # tiny, soft "tick"
    t = tt(0.14)
    return room(fit((np.sin(2 * np.pi * 1500 * t) + .4 * np.sin(2 * np.pi * 2250 * t)) * attack(t, .002) * decay(t, .022), .35), tail=.15, wet=.1)


def s_save():       # a round little "dub" with a tick
    t = tt(0.3)
    x = sweep(360, 480, t, .1) * attack(t, .005) * decay(t, .09)
    tick = np.sin(2 * np.pi * 1800 * t) * decay(t, .018) * (t >= 0.07) * 0.35
    return room(fit(x + tick, .45))


def s_trash():      # soft swoosh falling away, with a low thump
    t = tt(0.55)
    sw = bandnoise(t, 3200, 450, 0.4, q=2.2) * np.sin(np.pi * np.minimum(1, t / 0.45)) ** 1.5 * (t < 0.45)
    thump = sweep(150, 70, t, .15) * attack(t, .004) * decay(t, .06) * 0.8
    return room(fit(fit(sw, 1) * 0.55 + thump * 0.6, .5))


def s_restore():    # swoosh rising back, ending in a small bell
    t = tt(0.9)
    sw = bandnoise(t, 450, 3000, 0.35, q=2.2) * np.sin(np.pi * np.minimum(1, t / 0.4)) ** 1.5 * (t < 0.4)
    t2 = np.clip(t - 0.3, 0, None)
    ding = bell(988, t2, .35) * attack(t2, .004) * (t >= 0.3)
    return room(fit(fit(sw, 1) * 0.35 + ding * 0.8, .5), tail=.4, wet=.2)


def s_end():        # warm rising arpeggio
    t = tt(2.6)
    x = np.zeros_like(t)
    for i, f in enumerate([523.25, 659.25, 783.99, 1046.5]):
        t2 = np.clip(t - i * 0.16, 0, None)
        x += bell(f, t2, .9 if i < 3 else 1.4) * attack(t2, .006) * (t >= i * 0.16) * (0.7 if i < 3 else 1.0)
    return room(fit(x, .5), tail=.7, wet=.3)


SOUNDS = {k: v() for k, v in dict(tile=s_tile, send=s_send, done=s_done, copy=s_copy, save=s_save,
                                  trash=s_trash, restore=s_restore, end=s_end).items()}

events = []   # (global seconds, name)
for p, start in ((ext, 0.0), (web, d1)):
    t0 = p['tStart']
    for e in p['events']:
        events.append((start + out_time(e['t'], t0, p['segs']), e['name']))
events.sort()
for t, n in events:
    print(f'  {t:6.2f} s  {n}')

n_total = int((total_len + 1.0) * SR)
sfx = np.zeros((n_total, 2))
for i, (t, name) in enumerate(events):
    x = SOUNDS[name]
    pan = 0.5 + 0.18 * np.sin(i * 2.1)          # a hint of stereo movement
    i0 = int(t * SR)
    j = min(len(x), n_total - i0)
    assert i0 >= 0 and j > 0, f'event {name} at {t:.2f} s is outside the video'
    sfx[i0:i0 + j, 0] += x[:j] * np.sqrt(1 - pan)
    sfx[i0:i0 + j, 1] += x[:j] * np.sqrt(pan)

# ---- Music: excerpt, gentle compression, fade in and out --------------------------------
raw = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', os.path.join(HERE, 'music.ogg'), '-af',
                      'acompressor=threshold=-26dB:ratio=3:attack=200:release=800,aresample=%d' % SR, '-f', 'f32le', '-ac', '2', '-'],
                     check=True, capture_output=True).stdout
music = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)
while len(music) < n_total:                      # loop if the video is longer than the excerpt
    music = np.concatenate([music, music])
music = music[:n_total]
tm = np.arange(n_total) / SR
music *= (np.clip(tm / 2.0, 0, 1) * np.clip((total_len + 0.6 - tm) / 3.5, 0, 1))[:, None]   # fade in 2 s, out 3.5 s

# ---- Mix and loudness ----------------------------------------------------------------------
def write_wav(path, x):
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())


def lufs(path):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
                       capture_output=True, text=True)
    tail = r.stderr.split('Summary:')[-1]
    return float(tail.split('I:')[1].split('LUFS')[0])


# Music alone about 3 dB under the target, sounds on top at about 10 dB above the music's level.
write_wav(os.path.join(OUT, 'music.wav'), music)
gm = 10 ** ((TARGET_LUFS - 3 - lufs(os.path.join(OUT, 'music.wav'))) / 20)
mix = music * gm
sfx_peak = 10 ** (-13 / 20)
mix = mix + sfx / (np.max(np.abs(sfx)) + 1e-9) * sfx_peak
write_wav(os.path.join(OUT, 'mix.wav'), mix)
g = 10 ** ((TARGET_LUFS - lufs(os.path.join(OUT, 'mix.wav'))) / 20)
mix = mix * g
print(f'music gain {20 * np.log10(gm * g):.1f} dB, mix peak {20 * np.log10(np.max(np.abs(mix))):.1f} dBFS')
assert np.max(np.abs(mix)) < 0.95, 'mix clips'
write_wav(os.path.join(OUT, 'audio.wav'), mix)

# ---- Final: both parts, fade through black between them and at the end -------------------------
fl = FADE
ffmpeg('-i', os.path.join(OUT, 'part1.mp4'), '-i', os.path.join(OUT, 'part2.mp4'), '-i', os.path.join(OUT, 'audio.wav'),
       '-filter_complex',
       f'[0:v]fade=t=in:st=0:d={fl},fade=t=out:st={d1 - fl:.3f}:d={fl}[a];'
       f'[1:v]fade=t=in:st=0:d={fl},fade=t=out:st={d2 - fl:.3f}:d={fl}[b];'
       f'[a][b]concat=n=2:v=1:a=0[v]',
       '-map', '[v]', '-map', '2:a', '-t', f'{total_len:.3f}',
       '-c:v', 'libx264', '-preset', 'slow', '-crf', os.environ.get('DEMO_CRF', '24'), '-pix_fmt', 'yuv420p', '-r', str(FPS),
       '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', DEST)
print(f'{DEST}: {duration(DEST):.1f} s, {os.path.getsize(DEST) / 1e6:.1f} MB')
