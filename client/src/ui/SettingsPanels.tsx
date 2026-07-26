/** Settings, avatar editor and help panels. */
import { useState } from 'react';
import { useSettings, useSession, type Quality } from '../state/stores';
import { connection } from '../net/connection';
import type { AvatarConfig } from '@nexuspark/shared';

export function SettingsPanel() {
  const s = useSettings();
  const Toggle = ({ label, k }: { label: string; k: 'shadows' | 'postfx' | 'reflections' | 'particles' | 'clouds' | 'invertY' }) => (
    <label className="row" style={{ fontSize: 13 }}>
      <input type="checkbox" checked={s[k]} onChange={(e) => s.set({ [k]: e.target.checked })} />
      {label}
    </label>
  );
  const Vol = ({ label, k }: { label: string; k: 'masterVolume' | 'musicVolume' | 'sfxVolume' | 'voiceVolume' | 'mediaVolume' }) => (
    <label className="field">
      {label}
      <input type="range" min={0} max={1} step={0.05} value={s[k]} onChange={(e) => s.set({ [k]: Number(e.target.value) })} />
    </label>
  );
  return (
    <div className="col">
      <div className="title" style={{ fontSize: 13 }}>Graphics quality</div>
      <div className="row">
        {(['low', 'medium', 'high', 'ultra'] as Quality[]).map((q) => (
          <button key={q} className={`btn small ${s.quality === q ? 'primary' : ''}`} onClick={() => s.applyQuality(q)}>
            {q}
          </button>
        ))}
      </div>
      <div className="grid2">
        <Toggle label="Shadows" k="shadows" />
        <Toggle label="Post-processing" k="postfx" />
        <Toggle label="Reflections & mirrors" k="reflections" />
        <Toggle label="Weather particles" k="particles" />
        <Toggle label="Clouds" k="clouds" />
      </div>
      <hr className="hr" />
      <div className="title" style={{ fontSize: 13 }}>Audio</div>
      <div className="grid2">
        <Vol label="Master" k="masterVolume" />
        <Vol label="Music" k="musicVolume" />
        <Vol label="Effects" k="sfxVolume" />
        <Vol label="Voice chat" k="voiceVolume" />
        <Vol label="Screens" k="mediaVolume" />
      </div>
    </div>
  );
}

const BODY_COLORS = ['#f5e6d3', '#f2c4cd', '#c4d9f2', '#c8ecc9', '#f5e28a', '#e0c4f2', '#f5c09a', '#ffffff', '#d9b8a3', '#b8d8d0'];
const SCARF_COLORS = ['#c05555', '#3e5f8a', '#3f7d44', '#8e44ad', '#d4a017', '#e8734a', '#2b2f36', '#f2f2f2'];
const SPROUT_COLORS = ['#5da55f', '#3f7d44', '#7fbf6f', '#d4a017', '#b03a48', '#8e44ad'];
const BLUSH_COLORS = ['#f2a5b5', '#f5b8c4', '#e88ba0', '#f2c4cd', '#e8a58a'];
const FEET_COLORS = ['#8a6f5f', '#5a5a6a', '#a08a7a', '#c05555', '#3e5f8a'];
const HAT_COLORS = ['#c0392b', '#2c3e50', '#8e44ad', '#d4a017', '#3f7d44', '#22262c'];

export function AvatarEditor() {
  const self = useSession((s) => s.self);
  const [cfg, setCfg] = useState<AvatarConfig | null>(self ? { ...self.avatar } : null);
  if (!self || !cfg) return null;
  const set = (patch: Partial<AvatarConfig>) => setCfg({ ...cfg, ...patch });
  const Sw = ({ colors, k }: { colors: string[]; k: keyof AvatarConfig }) => (
    <div className="swatches">
      {colors.map((c) => (
        <div key={c} className={`swatch ${cfg[k] === c ? 'sel' : ''}`} style={{ background: c }} onClick={() => set({ [k]: c } as Partial<AvatarConfig>)} />
      ))}
    </div>
  );
  const dirty = JSON.stringify(cfg) !== JSON.stringify(self.avatar);
  return (
    <div className="col">
      <div className="dim" style={{ fontSize: 12 }}>You are a dango — customize your squish.</div>
      <label className="field">Body<Sw colors={BODY_COLORS} k="shirt" /></label>
      <label className="field">Scarf<Sw colors={SCARF_COLORS} k="pants" /></label>
      <label className="field">Blush<Sw colors={BLUSH_COLORS} k="skin" /></label>
      <label className="field">Feet<Sw colors={FEET_COLORS} k="shoes" /></label>
      <div className="grid2">
        <label className="field">
          Sprout
          <select className="input" value={cfg.hairStyle} onChange={(e) => set({ hairStyle: Number(e.target.value) })}>
            <option value={0}>Curly sprout</option>
            <option value={1}>Little leaves</option>
            <option value={2}>None</option>
          </select>
        </label>
        <label className="field">
          Hat
          <select className="input" value={cfg.hat} onChange={(e) => set({ hat: Number(e.target.value) })}>
            <option value={0}>No hat</option>
            <option value={1}>Cap</option>
            <option value={2}>Beanie</option>
            <option value={3}>Top hat</option>
          </select>
        </label>
      </div>
      {cfg.hairStyle !== 2 && cfg.hat === 0 && <label className="field">Sprout color<Sw colors={SPROUT_COLORS} k="hair" /></label>}
      {cfg.hat !== 0 && <label className="field">Hat color<Sw colors={HAT_COLORS} k="hatColor" /></label>}
      <label className="row" style={{ fontSize: 13 }}>
        <input type="checkbox" checked={cfg.glasses} onChange={(e) => set({ glasses: e.target.checked })} />
        Glasses
      </label>
      <button
        className="btn primary" disabled={!dirty}
        onClick={() => connection.send('avatar_update', { avatar: cfg })}
      >
        {dirty ? 'Apply' : 'Applied ✓'}
      </button>
    </div>
  );
}

export function HelpPanel() {
  const K = ({ children }: { children: string }) => <span className="key">{children}</span>;
  return (
    <div className="kbd-help">
      <div><K>W A S D</K> hop around · <K>Shift</K> zoomies · <K>Space</K> jump</div>
      <div><K>Mouse drag</K> orbit camera · <K>Wheel</K> zoom</div>
      <div><K>E</K> interact with whatever the prompt shows</div>
      <div><K>Enter</K> chat · <K>1–5</K> emotes (wave, dance, clap, point, laugh)</div>
      <div><K>Esc</K> close panels / cancel editing</div>
      <hr className="hr" />
      <div className="dim" style={{ fontSize: 12, lineHeight: 1.6 }}>
        Things to try: queue a video in the cinema · challenge someone at the arcade's VERSUS
        machine · put a website on your room TV · redecorate your room from the ✏️ editor ·
        toggle your mic 🎙 for proximity voice chat — people close to you hear you louder.
      </div>
    </div>
  );
}
