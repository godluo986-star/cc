/**
 * P2P media mesh (server relays signaling only), carrying:
 *  - proximity voice: mic audio spatialized through WebAudio HRTF panners
 *  - screen sharing: low-bitrate captures (≤640×360 @ ≤10fps, ~350 kbps cap)
 *    shown on floating displays above the sharing dango
 * Links form between peers in range whenever either side publishes media,
 * using the standard "perfect negotiation" pattern for renegotiation.
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
  ignoreOffer: boolean;
  audioSender: RTCRtpSender | null;
  videoSender: RTCRtpSender | null;
}

const SCREEN_MAX_BITRATE = 350_000; // ~350 kbps per viewer — keep it light

class VoiceManager {
  private micStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private peers = new Map<number, Peer>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private micData: Uint8Array<ArrayBuffer> | null = null;
  private unsubs: Array<() => void> = [];
  /** Remote screen streams by session id (read by ScreenBillboard). */
  readonly screenStreams = new Map<number, MediaStream>();

  attach(): void {
    this.unsubs.push(connection.on('rtc', (d) => this.onSignal(d as { from: number; kind: string; payload: string })));
    this.unsubs.push(
      useWorld.subscribe((s, prev) => {
        if (s.voiceRoster !== prev.voiceRoster || s.screenRoster !== prev.screenRoster || s.spaceKey !== prev.spaceKey) {
          this.reconcile();
        }
      })
    );
    this.tickTimer = setInterval(() => this.tick(), 450);
  }

  detach(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.disable();
    this.disableScreen();
  }

  // ── Microphone ────────────────────────────────────────────────────────────
  async enable(): Promise<void> {
    const vs = useVoice.getState();
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      vs.setError('Microphone access was denied.');
      vs.setEnabled(false);
      return;
    }
    const ctx = audio.ensure();
    if (ctx && audio.buses) {
      const src = ctx.createMediaStreamSource(this.micStream);
      this.micAnalyser = ctx.createAnalyser();
      this.micAnalyser.fftSize = 256;
      this.micData = new Uint8Array(new ArrayBuffer(this.micAnalyser.frequencyBinCount));
      src.connect(this.micAnalyser); // analysis only; not routed to output
    }
    vs.setError(null);
    vs.setEnabled(true);
    connection.send('voice_state', { on: true });
    // attach mic to existing links
    const track = this.micStream.getAudioTracks()[0];
    for (const peer of this.peers.values()) {
      if (track && !peer.audioSender) peer.audioSender = peer.pc.addTrack(track, this.micStream);
    }
    this.reconcile();
  }

  disable(): void {
    useVoice.getState().setEnabled(false);
    useVoice.getState().setMicLevel(0);
    hot.local.speaking = false;
    connection.send('voice_state', { on: false });
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.micAnalyser = null;
    for (const peer of this.peers.values()) {
      if (peer.audioSender) {
        try { peer.pc.removeTrack(peer.audioSender); } catch { /* closed */ }
        peer.audioSender = null;
      }
    }
    this.reconcile();
  }

  toggle(): void {
    if (useVoice.getState().enabled) this.disable();
    else void this.enable();
  }

  // ── Screen sharing ────────────────────────────────────────────────────────
  async enableScreen(): Promise<void> {
    const vs = useVoice.getState();
    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { max: 640 }, height: { max: 360 }, frameRate: { max: 10 } },
        audio: false,
      });
    } catch {
      vs.setError('Screen sharing was cancelled or blocked.');
      return;
    }
    const track = this.screenStream.getVideoTracks()[0];
    if (!track) return;
    track.addEventListener('ended', () => this.disableScreen()); // browser "stop sharing" bar
    vs.setScreenOn(true);
    vs.bumpScreens();
    connection.send('screen_share', { on: true });
    for (const peer of this.peers.values()) this.attachScreenTo(peer);
    this.reconcile();
  }

  disableScreen(): void {
    if (!useVoice.getState().screenOn && !this.screenStream) return;
    useVoice.getState().setScreenOn(false);
    useVoice.getState().bumpScreens();
    connection.send('screen_share', { on: false });
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    for (const peer of this.peers.values()) {
      if (peer.videoSender) {
        try { peer.pc.removeTrack(peer.videoSender); } catch { /* closed */ }
        peer.videoSender = null;
      }
    }
    this.reconcile();
  }

  toggleScreen(): void {
    if (useVoice.getState().screenOn) this.disableScreen();
    else void this.enableScreen();
  }

  /** My own preview stream (rendered above my dango too). */
  get localScreenStream(): MediaStream | null {
    return this.screenStream;
  }

  private attachScreenTo(peer: Peer): void {
    const track = this.screenStream?.getVideoTracks()[0];
    if (!track || peer.videoSender) return;
    peer.videoSender = peer.pc.addTrack(track, this.screenStream!);
    // cap bitrate + prefer legibility over framerate
    void (async () => {
      try {
        const params = peer.videoSender!.getParameters();
        params.encodings = params.encodings?.length ? params.encodings : [{}];
        params.encodings[0].maxBitrate = SCREEN_MAX_BITRATE;
        params.degradationPreference = 'maintain-resolution';
        await peer.videoSender!.setParameters(params);
      } catch { /* sender gone */ }
    })();
  }

  // ── Mesh management ───────────────────────────────────────────────────────
  private desiredPeers(): number[] {
    const { voiceRoster, screenRoster } = useWorld.getState();
    const vs = useVoice.getState();
    const iPublish = (vs.enabled && !!this.micStream) || (vs.screenOn && !!this.screenStream);
    const out: number[] = [];
    const candidates = new Set([...voiceRoster, ...screenRoster]);
    for (const id of candidates) {
      if (id === hot.selfId) continue;
      const e = hot.players.get(id);
      if (!e) continue;
      const theyPublish = voiceRoster.includes(id) || screenRoster.includes(id);
      if (!iPublish && !theyPublish) continue;
      const d = Math.hypot(e.x - hot.local.x, e.z - hot.local.z);
      const connected = this.peers.has(id);
      if (d < (connected ? VOICE_CONNECT_RANGE + 4 : VOICE_CONNECT_RANGE)) out.push(id);
    }
    // also keep links where *I* publish to anyone in range (they may publish nothing)
    if (iPublish) {
      for (const e of hot.players.values()) {
        if (e.profile.isNpc || out.includes(e.id)) continue;
        const d = Math.hypot(e.x - hot.local.x, e.z - hot.local.z);
        const connected = this.peers.has(e.id);
        if (d < (connected ? VOICE_CONNECT_RANGE + 4 : VOICE_CONNECT_RANGE)) out.push(e.id);
      }
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
    const vs = useVoice.getState();
    if (this.micAnalyser && this.micData && vs.enabled) {
      this.micAnalyser.getByteFrequencyData(this.micData);
      let sum = 0;
      for (let i = 2; i < 40; i++) sum += this.micData[i];
      const level = Math.min(1, sum / 38 / 110);
      vs.setMicLevel(level);
      hot.local.speaking = level > 0.14;
    }
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
    const polite = hot.selfId > id;
    const pc = new RTCPeerConnection({
      iceServers: connection.stunServers.map((urls) => ({ urls })),
    });
    const peer: Peer = {
      id, pc, panner: null, gain: null, analyser: null, levelData: null,
      polite, makingOffer: false, ignoreOffer: false, audioSender: null, videoSender: null,
    };
    this.peers.set(id, peer);

    const micTrack = this.micStream?.getAudioTracks()[0];
    if (micTrack && useVoice.getState().enabled) {
      peer.audioSender = pc.addTrack(micTrack, this.micStream!);
    }
    this.attachScreenTo(peer);

    pc.onicecandidate = (e) => {
      if (e.candidate) connection.send('rtc', { to: id, kind: 'ice', payload: JSON.stringify(e.candidate) });
    };
    // perfect negotiation: both sides may offer; glare resolved by politeness
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        connection.send('rtc', { to: id, kind: 'offer', payload: JSON.stringify(pc.localDescription) });
      } catch { /* torn down */ }
      finally { peer.makingOffer = false; }
    };
    pc.ontrack = (e) => {
      if (e.track.kind === 'audio') this.wireRemoteAudio(peer, e.track);
      else this.wireRemoteScreen(peer, e.track);
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        this.closePeer(id);
      }
    };
  }

  private wireRemoteAudio(peer: Peer, track: MediaStreamTrack): void {
    const ctx = audio.ensure();
    if (!ctx || !audio.buses) return;
    const remote = new MediaStream([track]);
    // Chrome quirk: WebRTC audio must be attached to a media element to flow
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
  }

  private wireRemoteScreen(peer: Peer, track: MediaStreamTrack): void {
    const stream = new MediaStream([track]);
    this.screenStreams.set(peer.id, stream);
    useVoice.getState().bumpScreens();
    const drop = () => {
      if (this.screenStreams.get(peer.id) === stream) {
        this.screenStreams.delete(peer.id);
        useVoice.getState().bumpScreens();
      }
    };
    track.addEventListener('ended', drop);
    track.addEventListener('mute', () => {
      // treat prolonged mute as gone (sender stopped sharing)
      setTimeout(() => { if (track.muted) drop(); }, 4000);
    });
  }

  private async onSignal(d: { from: number; kind: string; payload: string }): Promise<void> {
    let peer = this.peers.get(d.from);
    if (!peer) {
      // an in-range peer started publishing to us
      this.createPeer(d.from);
      peer = this.peers.get(d.from);
      if (!peer) return;
    }
    const pc = peer.pc;
    try {
      if (d.kind === 'offer') {
        const desc = JSON.parse(d.payload) as RTCSessionDescriptionInit;
        const collision = peer.makingOffer || pc.signalingState !== 'stable';
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(desc); // implicit rollback for polite side
        await pc.setLocalDescription();
        connection.send('rtc', { to: d.from, kind: 'answer', payload: JSON.stringify(pc.localDescription) });
      } else if (d.kind === 'answer') {
        await pc.setRemoteDescription(JSON.parse(d.payload) as RTCSessionDescriptionInit);
      } else if (d.kind === 'ice') {
        try {
          await pc.addIceCandidate(JSON.parse(d.payload) as RTCIceCandidateInit);
        } catch (err) {
          if (!peer.ignoreOffer) throw err;
        }
      }
    } catch { /* transient signaling races are fine */ }
  }

  private closePeer(id: number): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    try { peer.pc.close(); } catch { /* fine */ }
    try { peer.panner?.disconnect(); peer.gain?.disconnect(); peer.analyser?.disconnect(); } catch { /* fine */ }
    this.peers.delete(id);
    if (this.screenStreams.delete(id)) useVoice.getState().bumpScreens();
    const e = hot.players.get(id);
    if (e) e.voiceLevel = 0;
    useVoice.getState().setPeers([...this.peers.keys()]);
  }
}

function setV(param: AudioParam | undefined, v: number): void {
  if (param) param.value = v;
}

export const voice = new VoiceManager();
