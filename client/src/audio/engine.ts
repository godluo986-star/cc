/**
 * Procedural audio engine. Every sound is synthesized with WebAudio at
 * runtime (noise buffers, oscillators, envelopes) — the project ships zero
 * recorded audio assets, so there is nothing to license.
 */
import { useSettings } from '../state/stores';

export interface Buses {
  master: GainNode;
  sfx: GainNode;
  ambient: GainNode;
  music: GainNode;
  voice: GainNode;
  media: GainNode;
}

class AudioEngine {
  ctx: AudioContext | null = null;
  buses: Buses | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private ambientNodes: AudioNode[] = [];
  private ambientTimers: ReturnType<typeof setInterval>[] = [];
  private ambientProfile = '';

  /** Create/resume the context — must be called from a user gesture. */
  ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
      const c = this.ctx;
      const mk = () => { const g = c.createGain(); return g; };
      const master = mk();
      master.connect(c.destination);
      const buses: Buses = { master, sfx: mk(), ambient: mk(), music: mk(), voice: mk(), media: mk() };
      for (const key of ['sfx', 'ambient', 'music', 'voice', 'media'] as const) buses[key].connect(master);
      this.buses = buses;
      this.applyVolumes();
      useSettings.subscribe(() => this.applyVolumes());
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  applyVolumes(): void {
    if (!this.buses) return;
    const s = useSettings.getState();
    this.buses.master.gain.value = s.masterVolume;
    this.buses.sfx.gain.value = s.sfxVolume;
    this.buses.ambient.gain.value = s.sfxVolume * 0.8;
    this.buses.music.gain.value = s.musicVolume;
    this.buses.voice.gain.value = s.voiceVolume;
    this.buses.media.gain.value = s.mediaVolume;
  }

  private noise(): AudioBuffer {
    const c = this.ctx!;
    if (!this.noiseBuffer) {
      const len = c.sampleRate * 2;
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;
    }
    return this.noiseBuffer;
  }

  // ── One-shot SFX ──────────────────────────────────────────────────────────
  private env(node: AudioNode, peak: number, attack: number, decay: number, when = 0): GainNode {
    const c = this.ctx!;
    const g = c.createGain();
    const t = c.currentTime + when;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(g);
    return g;
  }

  click(): void {
    if (!this.ensure()) return;
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = 880;
    const g = this.env(o, 0.12, 0.004, 0.07);
    g.connect(this.buses!.sfx);
    o.start(); o.stop(c.currentTime + 0.1);
  }

  chime(up = true): void {
    if (!this.ensure()) return;
    const c = this.ctx!;
    const notes = up ? [523.25, 783.99] : [783.99, 523.25];
    notes.forEach((f, i) => {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = this.env(o, 0.1, 0.01, 0.28, i * 0.09);
      g.connect(this.buses!.sfx);
      o.start(c.currentTime + i * 0.09);
      o.stop(c.currentTime + i * 0.09 + 0.4);
    });
  }

  /** Cute dango hop: a soft "boing" pop per bounce. */
  footstep(run = false): void {
    if (!this.ctx || !this.buses) return; // don't create ctx for passive sounds
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    const base = (run ? 300 : 250) + Math.random() * 40;
    o.frequency.setValueAtTime(base, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(base * 0.55, c.currentTime + 0.09);
    const g = this.env(o, run ? 0.09 : 0.06, 0.006, 0.085);
    g.connect(this.buses.sfx);
    o.start(); o.stop(c.currentTime + 0.12);
    // tiny landing pat
    const src = c.createBufferSource();
    src.buffer = this.noise();
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    src.connect(f);
    const g2 = this.env(f, 0.03, 0.003, 0.05);
    g2.connect(this.buses.sfx);
    src.start(); src.stop(c.currentTime + 0.07);
  }

  jump(): void {
    if (!this.ctx || !this.buses) return;
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(240, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(430, c.currentTime + 0.12);
    const g = this.env(o, 0.08, 0.01, 0.13);
    g.connect(this.buses.sfx);
    o.start(); o.stop(c.currentTime + 0.18);
  }

  kickBall(): void {
    if (!this.ensure()) return;
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise();
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 210;
    src.connect(f);
    const g = this.env(f, 0.35, 0.004, 0.13);
    g.connect(this.buses!.sfx);
    src.start(); src.stop(c.currentTime + 0.16);
  }

  doorSlide(): void {
    if (!this.ensure()) return;
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise();
    src.playbackRate.value = 0.4;
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 620; f.Q.value = 2;
    src.connect(f);
    const g = this.env(f, 0.09, 0.05, 0.4);
    g.connect(this.buses!.sfx);
    src.start(); src.stop(c.currentTime + 0.5);
  }

  vend(): void {
    if (!this.ensure()) return;
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(160, c.currentTime);
    o.frequency.setValueAtTime(120, c.currentTime + 0.1);
    const g = this.env(o, 0.06, 0.005, 0.22);
    g.connect(this.buses!.sfx);
    o.start(); o.stop(c.currentTime + 0.3);
    setTimeout(() => this.chime(true), 240);
  }

  // ── Ambient beds ──────────────────────────────────────────────────────────
  setAmbient(outdoor: boolean, weather: string, night: boolean): void {
    const profile = `${outdoor}|${weather}|${night}`;
    if (profile === this.ambientProfile) return;
    this.ambientProfile = profile;
    this.stopAmbient();
    if (!this.ctx || !this.buses) return;
    const c = this.ctx;
    const bus = this.buses.ambient;

    if (outdoor) {
      // Wind: looped noise through a slowly-wobbling lowpass
      const wind = c.createBufferSource();
      wind.buffer = this.noise();
      wind.loop = true;
      const wf = c.createBiquadFilter();
      wf.type = 'lowpass'; wf.frequency.value = 300;
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.13;
      const lfoGain = c.createGain(); lfoGain.gain.value = 120;
      lfo.connect(lfoGain); lfoGain.connect(wf.frequency);
      const wg = c.createGain(); wg.gain.value = weather === 'rain' ? 0.05 : 0.035;
      wind.connect(wf); wf.connect(wg); wg.connect(bus);
      wind.start(); lfo.start();
      this.ambientNodes.push(wind, wf, wg, lfo, lfoGain);

      if (weather === 'rain') {
        const rain = c.createBufferSource();
        rain.buffer = this.noise();
        rain.loop = true;
        rain.playbackRate.value = 1.7;
        const rf = c.createBiquadFilter();
        rf.type = 'highpass'; rf.frequency.value = 900;
        const rg = c.createGain(); rg.gain.value = 0.055;
        rain.connect(rf); rf.connect(rg); rg.connect(bus);
        rain.start();
        this.ambientNodes.push(rain, rf, rg);
      } else if (!night) {
        // Daytime bird chirps
        this.ambientTimers.push(setInterval(() => {
          if (Math.random() < 0.55) this.birdChirp();
        }, 2600));
      } else {
        // Night crickets
        this.ambientTimers.push(setInterval(() => this.cricket(), 1200));
      }
    } else {
      // Interior room tone: very quiet filtered noise
      const tone = c.createBufferSource();
      tone.buffer = this.noise();
      tone.loop = true;
      const tf = c.createBiquadFilter();
      tf.type = 'lowpass'; tf.frequency.value = 160;
      const tg = c.createGain(); tg.gain.value = 0.012;
      tone.connect(tf); tf.connect(tg); tg.connect(bus);
      tone.start();
      this.ambientNodes.push(tone, tf, tg);
    }
  }

  private birdChirp(): void {
    if (!this.ctx || !this.buses) return;
    const c = this.ctx;
    const base = 2200 + Math.random() * 1400;
    for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
      const o = c.createOscillator();
      o.type = 'sine';
      const t = c.currentTime + i * 0.12 + Math.random() * 0.03;
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * (1.1 + Math.random() * 0.25), t + 0.06);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.025, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      o.connect(g); g.connect(this.buses.ambient);
      o.start(t); o.stop(t + 0.12);
    }
  }

  private cricket(): void {
    if (!this.ctx || !this.buses) return;
    const c = this.ctx;
    if (Math.random() > 0.7) return;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = 4200 + Math.random() * 500;
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.value = 0;
    for (let i = 0; i < 6; i++) {
      g.gain.setValueAtTime(0.008, t + i * 0.07);
      g.gain.setValueAtTime(0.0001, t + i * 0.07 + 0.035);
    }
    o.connect(g); g.connect(this.buses.ambient);
    o.start(t); o.stop(t + 0.45);
  }

  private stopAmbient(): void {
    for (const n of this.ambientNodes) {
      try { (n as AudioScheduledSourceNode).stop?.(); } catch { /* not a source */ }
      try { n.disconnect(); } catch { /* already gone */ }
    }
    this.ambientNodes = [];
    for (const t of this.ambientTimers) clearInterval(t);
    this.ambientTimers = [];
  }
}

export const audio = new AudioEngine();
