/**
 * Proximity voice chat: P2P WebRTC mesh (server relays signaling only).
 * Remote streams are spatialized with WebAudio PannerNodes positioned from
 * live entity transforms; peers connect inside VOICE_CONNECT_RANGE and are
 * torn down beyond it (hysteresis).
 */
import { VOICE_RANGE, VOICE_CONNECT_RANGE } from '@nexuspark/shared';
import { connection } from '../net/connection';
import { hot } from '../state/hot';
import { useVoice, useWorld } from '../state/stores';
import { audio } from '../audio/engine';

interface Peer {
  id: number;
  pc: RTCPeerConnection;
  panner: PannerNode | null;
  gain: GainNode | null;
  analyser: AnalyserNode | null;
  levelData: Uint8Array<ArrayBuffer> | null;
  polite: boolean;
  makingOffer: boolean;
}

class VoiceManager {
  private stream: MediaStream | null = null;
  private peers = new Map<number, Peer>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private micData: Uint8Array<ArrayBuffer> | null = null;
  private unsubs: Array<() => void> = [];

  attach(): void {
    this.unsubs.push(connection.on('rtc', (d) => this.onSignal(d as { from: number; kind: string; payload: string })));
    this.unsubs.push(
      useWorld.subscribe((s, prev) => {
        if (s.voiceRoster !== prev.voiceRoster || s.spaceKey !== prev.spaceKey) this.reconcile();
      })
    );
    this.tickTimer = setInterval(() => this.tick(), 450);
  }

  detach(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.disable();
  }

  async enable(): Promise<void> {
    const vs = useVoice.getState();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      vs.setError('Microphone access was denied.');
      vs.setEnabled(false);
      return;
    }
    const ctx = audio.ensure();
    if (ctx && audio.buses) {
      const src = ctx.createMediaStreamSource(this.stream);
      this.micAnalyser = ctx.createAnalyser();
      this.micAnalyser.fftSize = 256;
      this.micData = new Uint8Array(new ArrayBuffer(this.micAnalyser.frequencyBinCount));
      src.connect(this.micAnalyser); // analysis only; not routed to output
    }
    vs.setError(null);
    vs.setEnabled(true);
    connection.send('voice_state', { on: true });
    this.reconcile();
  }

  disable(): void {
    useVoice.getState().setEnabled(false);
    useVoice.getState().setMicLevel(0);
    hot.local.speaking = false;
    connection.send('voice_state', { on: false });
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.micAnalyser = null;
    for (const id of [...this.peers.keys()]) this.closePeer(id);
  }

  toggle(): void {
    if (useVoice.getState().enabled) this.disable();
    else void this.enable();
  }

  /** Peers we should currently be connected to. */
  private desiredPeers(): number[] {
    const { voiceRoster } = useWorld.getState();
    if (!useVoice.getState().enabled || !this.stream) return [];
    const out: number[] = [];
    for (const id of voiceRoster) {
      if (id === hot.selfId) continue;
      const e = hot.players.get(id);
      if (!e) continue;
      const d = Math.hypot(e.x - hot.local.x, e.z - hot.local.z);
      const connected = this.peers.has(id);
      if (d < (connected ? VOICE_CONNECT_RANGE + 4 : VOICE_CONNECT_RANGE)) out.push(id);
    }
    return out;
  }

  private reconcile(): void {
    const want = new Set(this.desiredPeers());
    for (const id of [...this.peers.keys()]) {
      if (!want.has(id)) this.closePeer(id);
    }
    for (const id of want) {
      if (!this.peers.has(id)) this.createPeer(id);
    }
    useVoice.getState().setPeers([...this.peers.keys()]);
  }

  private tick(): void {
    this.reconcile();
    // mic level → speaking flag
    const vs = useVoice.getState();
    if (this.micAnalyser && this.micData && vs.enabled) {
      this.micAnalyser.getByteFrequencyData(this.micData);
      let sum = 0;
      for (let i = 2; i < 40; i++) sum += this.micData[i];
      const level = Math.min(1, sum / 38 / 110);
      vs.setMicLevel(level);
      hot.local.speaking = level > 0.14;
    }
    // remote levels + panner positions
    const ctx = audio.ctx;
    if (ctx) {
      const l = ctx.listener;
      const yaw = hot.camera.yaw;
      setV(l.positionX, hot.local.x); setV(l.positionY, hot.local.y + 0.9); setV(l.positionZ, hot.local.z);
      setV(l.forwardX, -Math.sin(yaw)); setV(l.forwardY, 0); setV(l.forwardZ, -Math.cos(yaw));
      setV(l.upX, 0); setV(l.upY, 1); setV(l.upZ, 0);
    }
    for (const [id, peer] of this.peers) {
      const e = hot.players.get(id);
      if (e && peer.panner) {
        setV(peer.panner.positionX, e.x);
        setV(peer.panner.positionY, e.y + 0.9);
        setV(peer.panner.positionZ, e.z);
      }
      if (e && peer.analyser && peer.levelData) {
        peer.analyser.getByteFrequencyData(peer.levelData);
        let sum = 0;
        for (let i = 2; i < 40; i++) sum += peer.levelData[i];
        e.voiceLevel = Math.min(1, sum / 38 / 110);
      }
    }
  }

  private createPeer(id: number): void {
    if (!this.stream) return;
    const polite = hot.selfId > id; // lower id is the impolite initiator
    const pc = new RTCPeerConnection({
      iceServers: connection.stunServers.map((urls) => ({ urls })),
    });
    const peer: Peer = { id, pc, panner: null, gain: null, analyser: null, levelData: null, polite, makingOffer: false };
    this.peers.set(id, peer);

    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);

    pc.onicecandidate = (e) => {
      if (e.candidate) connection.send('rtc', { to: id, kind: 'ice', payload: JSON.stringify(e.candidate) });
    };
    pc.onnegotiationneeded = async () => {
      if (polite) return; // initiator drives the first offer
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        connection.send('rtc', { to: id, kind: 'offer', payload: JSON.stringify(pc.localDescription) });
      } catch { /* torn down */ }
      finally { peer.makingOffer = false; }
    };
    pc.ontrack = (e) => {
      const ctx = audio.ensure();
      if (!ctx || !audio.buses) return;
      const remote = new MediaStream([e.track]);
      // Chrome needs a muted media element for WebRTC audio to flow into WebAudio
      const el = document.createElement('audio');
      el.srcObject = remote;
      el.muted = true;
      void el.play().catch(() => undefined);
      const src = ctx.createMediaStreamSource(remote);
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 2;
      panner.maxDistance = VOICE_RANGE;
      panner.rolloffFactor = 1.4;
      const gain = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(panner);
      panner.connect(gain);
      gain.connect(audio.buses.voice);
      src.connect(analyser);
      peer.panner = panner;
      peer.gain = gain;
      peer.analyser = analyser;
      peer.levelData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        this.closePeer(id);
      }
    };
  }

  private async onSignal(d: { from: number; kind: string; payload: string }): Promise<void> {
    if (!useVoice.getState().enabled || !this.stream) return;
    let peer = this.peers.get(d.from);
    if (!peer) {
      this.createPeer(d.from);
      peer = this.peers.get(d.from);
      if (!peer) return;
    }
    const pc = peer.pc;
    try {
      if (d.kind === 'offer') {
        const desc = JSON.parse(d.payload) as RTCSessionDescriptionInit;
        const collision = peer.makingOffer || pc.signalingState !== 'stable';
        if (collision && !peer.polite) return; // impolite side ignores glare
        await pc.setRemoteDescription(desc);
        await pc.setLocalDescription();
        connection.send('rtc', { to: d.from, kind: 'answer', payload: JSON.stringify(pc.localDescription) });
      } else if (d.kind === 'answer') {
        await pc.setRemoteDescription(JSON.parse(d.payload) as RTCSessionDescriptionInit);
      } else if (d.kind === 'ice') {
        await pc.addIceCandidate(JSON.parse(d.payload) as RTCIceCandidateInit);
      }
    } catch { /* transient signaling races are fine */ }
  }

  private closePeer(id: number): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    try { peer.pc.close(); } catch { /* fine */ }
    try { peer.panner?.disconnect(); peer.gain?.disconnect(); peer.analyser?.disconnect(); } catch { /* fine */ }
    this.peers.delete(id);
    const e = hot.players.get(id);
    if (e) e.voiceLevel = 0;
    useVoice.getState().setPeers([...this.peers.keys()]);
  }
}

function setV(param: AudioParam | undefined, v: number): void {
  if (param) param.value = v;
}

export const voice = new VoiceManager();
