/**
 * Synth jukebox: three procedurally sequenced tracks played with WebAudio
 * oscillators. Playback position is derived from the server's `startedAt`
 * timestamp, so every listener hears the same beat at the same time.
 */
import { audio } from './engine';
import { hot } from '../state/hot';

interface Note { beat: number; midi: number; dur: number; vel: number; type: OscillatorType; }
interface TrackDefn { id: string; bpm: number; bars: number; notes: Note[]; }

const N = (beat: number, midi: number, dur = 0.9, vel = 0.5, type: OscillatorType = 'triangle'): Note =>
  ({ beat, midi, dur, vel, type });

function arp(startBeat: number, chord: number[], pattern: number[], stepDur: number, vel: number, type: OscillatorType): Note[] {
  return pattern.map((idx, i) => N(startBeat + i * stepDur, chord[idx % chord.length] + 12 * Math.floor(idx / chord.length), stepDur * 0.9, vel, type));
}

function buildTracks(): TrackDefn[] {
  const tracks: TrackDefn[] = [];

  // Sunset Loop — lofi-ish I–vi–IV–V in C, 8 bars of 4 beats
  {
    const notes: Note[] = [];
    const chords = [
      [48, 55, 60, 64], // C
      [45, 52, 57, 60], // Am
      [41, 48, 53, 57], // F
      [43, 50, 55, 59], // G
    ];
    chords.forEach((ch, ci) => {
      const base = ci * 8;
      // pad
      ch.forEach((m) => notes.push(N(base, m, 7.6, 0.16, 'sine')));
      // arp
      notes.push(...arp(base, ch.slice(1), [0, 1, 2, 1, 0, 2, 1, 2], 1, 0.2, 'triangle'));
      // bass
      notes.push(N(base, ch[0] - 12, 3.6, 0.34, 'sine'));
      notes.push(N(base + 4, ch[0] - 12, 3.4, 0.3, 'sine'));
    });
    tracks.push({ id: 'sunset', bpm: 84, bars: 8, notes });
  }

  // Neon Drive — minor arpeggio runner, 8 bars
  {
    const notes: Note[] = [];
    const seq = [
      [45, 52, 57, 60], // Am
      [45, 52, 57, 60],
      [41, 48, 53, 57], // F
      [43, 50, 55, 59], // G
    ];
    seq.forEach((ch, ci) => {
      const base = ci * 8;
      notes.push(...arp(base, ch, [0, 2, 1, 3, 0, 2, 1, 3, 2, 0, 3, 1, 2, 0, 3, 1], 0.5, 0.17, 'sawtooth'));
      notes.push(N(base, ch[0] - 24, 7.4, 0.3, 'square'));
      for (let b = 0; b < 8; b += 2) notes.push(N(base + b, 33, 0.12, 0.35, 'sine')); // kick-ish pulse
    });
    tracks.push({ id: 'neon', bpm: 118, bars: 8, notes });
  }

  // Café Waltz — 3/4 feel (encoded in 4/4 grid with 6-beat bars)
  {
    const notes: Note[] = [];
    const chords = [
      [48, 55, 64], // C
      [45, 52, 60], // Am
      [50, 57, 65], // Dm
      [43, 55, 62], // G
    ];
    chords.forEach((ch, ci) => {
      const base = ci * 6;
      notes.push(N(base, ch[0] - 12, 1.6, 0.3, 'sine'));
      notes.push(N(base + 2, ch[1], 0.9, 0.2, 'triangle'));
      notes.push(N(base + 4, ch[2], 0.9, 0.2, 'triangle'));
      notes.push(N(base + 1, ch[2] + 12, 1.4, 0.12, 'sine'));
      notes.push(N(base + 3.5, ch[1] + 12, 1.2, 0.1, 'sine'));
    });
    tracks.push({ id: 'waltz', bpm: 96, bars: 4, notes: notes.map((n) => ({ ...n, beat: n.beat })) });
  }

  return tracks;
}

const TRACKS = buildTracks();
const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

class MusicPlayer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private current: { trackId: string; startedAt: number } | null = null;
  private scheduledUpTo = 0; // in loop-absolute beats
  private delayNode: DelayNode | null = null;
  /** Volume multiplier from listener distance (updated by the space renderer). */
  distanceGain = 1;
  private gainNode: GainNode | null = null;

  play(trackId: string | null, startedAt: number): void {
    if (!trackId) { this.stop(); return; }
    if (this.current?.trackId === trackId && this.current.startedAt === startedAt) return;
    this.stop();
    const ctx = audio.ensure();
    if (!ctx || !audio.buses) return;
    this.current = { trackId, startedAt };
    const g = ctx.createGain();
    g.gain.value = this.distanceGain;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.27;
    const fb = ctx.createGain(); fb.gain.value = 0.22;
    delay.connect(fb); fb.connect(delay);
    g.connect(delay);
    delay.connect(audio.buses.music);
    g.connect(audio.buses.music);
    this.gainNode = g;
    this.delayNode = delay;
    this.scheduledUpTo = -1;
    this.timer = setInterval(() => this.pump(), 120);
    this.pump();
  }

  setDistanceGain(v: number): void {
    this.distanceGain = v;
    if (this.gainNode) this.gainNode.gain.value = v;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.current = null;
    try { this.gainNode?.disconnect(); this.delayNode?.disconnect(); } catch { /* fine */ }
    this.gainNode = null;
    this.delayNode = null;
  }

  get playingTrack(): string | null { return this.current?.trackId ?? null; }

  private pump(): void {
    if (!this.current || !audio.ctx || !this.gainNode) return;
    const track = TRACKS.find((t) => t.id === this.current!.trackId);
    if (!track) return;
    const ctx = audio.ctx;
    const beatSec = 60 / track.bpm;
    const loopBeats = track.id === 'waltz' ? 24 : track.bars * 4;
    const serverNow = Date.now() + hot.serverTimeOffset;
    const elapsedBeats = ((serverNow - this.current.startedAt) / 1000) / beatSec;
    const horizon = elapsedBeats + 0.45 / beatSec; // schedule ~450ms ahead
    if (this.scheduledUpTo < elapsedBeats - 0.2) this.scheduledUpTo = elapsedBeats;

    for (const note of track.notes) {
      // find occurrences of this note between scheduledUpTo and horizon
      const firstLoop = Math.floor((this.scheduledUpTo - note.beat) / loopBeats);
      for (let k = Math.max(0, firstLoop); ; k++) {
        const abs = note.beat + k * loopBeats;
        if (abs >= horizon) break;
        if (abs < this.scheduledUpTo) continue;
        const when = ctx.currentTime + (abs - elapsedBeats) * beatSec;
        if (when < ctx.currentTime - 0.05) continue;
        this.scheduleNote(note, Math.max(when, ctx.currentTime), beatSec);
      }
    }
    this.scheduledUpTo = horizon;
  }

  private scheduleNote(n: Note, when: number, beatSec: number): void {
    const ctx = audio.ctx!;
    const o = ctx.createOscillator();
    o.type = n.type;
    o.frequency.value = midiHz(n.midi);
    const g = ctx.createGain();
    const dur = n.dur * beatSec;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(n.vel * 0.22, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(0.08, dur));
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = n.type === 'sawtooth' ? 1800 : 3600;
    o.connect(f); f.connect(g); g.connect(this.gainNode!);
    o.start(when);
    o.stop(when + Math.max(0.1, dur) + 0.05);
  }
}

export const music = new MusicPlayer();
export const MUSIC_TRACKS = TRACKS.map((t) => t.id);
