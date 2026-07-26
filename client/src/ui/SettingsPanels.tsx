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
      <div className="title" style={{ fontSize: 13 }}>画质</div>
      <div className="row">
        {(['low', 'medium', 'high', 'ultra'] as Quality[]).map((q) => (
          <button key={q} className={`btn small ${s.quality === q ? 'primary' : ''}`} onClick={() => s.applyQuality(q)}>
            {q}
          </button>
        ))}
      </div>
      <div className="grid2">
        <Toggle label="阴影" k="shadows" />
        <Toggle label="后期特效" k="postfx" />
        <Toggle label="反射与镜面" k="reflections" />
        <Toggle label="天气粒子" k="particles" />
        <Toggle label="云朵" k="clouds" />
      </div>
      <hr className="hr" />
      <div className="title" style={{ fontSize: 13 }}>音量</div>
      <div className="grid2">
        <Vol label="主音量" k="masterVolume" />
        <Vol label="音乐" k="musicVolume" />
        <Vol label="音效" k="sfxVolume" />
        <Vol label="语音" k="voiceVolume" />
        <Vol label="屏幕媒体" k="mediaVolume" />
      </div>
    </div>
  );
}

const BODY_COLORS = ['#b7cf8f', '#8fc7c4', '#f3c3cc', '#a08a78', '#f5eee0', '#cbb8d9', '#f0e3ae', '#f2d3b8', '#dce8d2'];
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
      <div className="dim" style={{ fontSize: 12 }}>你是一颗团子——捏出你自己的样子。</div>
      <label className="field">身体<Sw colors={BODY_COLORS} k="shirt" /></label>
      <label className="field">围巾<Sw colors={SCARF_COLORS} k="pants" /></label>
      <label className="field">腮红<Sw colors={BLUSH_COLORS} k="skin" /></label>
      <label className="field">小脚<Sw colors={FEET_COLORS} k="shoes" /></label>
      <div className="grid2">
        <label className="field">
          头顶小芽
          <select className="input" value={cfg.hairStyle} onChange={(e) => set({ hairStyle: Number(e.target.value) })}>
            <option value={0}>卷卷芽</option>
            <option value={1}>小叶子</option>
            <option value={2}>不要</option>
          </select>
        </label>
        <label className="field">
          帽子
          <select className="input" value={cfg.hat} onChange={(e) => set({ hat: Number(e.target.value) })}>
            <option value={0}>不戴</option>
            <option value={1}>棒球帽</option>
            <option value={2}>毛线帽</option>
            <option value={3}>礼帽</option>
          </select>
        </label>
      </div>
      {cfg.hairStyle !== 2 && cfg.hat === 0 && <label className="field">小芽颜色<Sw colors={SPROUT_COLORS} k="hair" /></label>}
      {cfg.hat !== 0 && <label className="field">帽子颜色<Sw colors={HAT_COLORS} k="hatColor" /></label>}
      <label className="row" style={{ fontSize: 13 }}>
        <input type="checkbox" checked={cfg.glasses} onChange={(e) => set({ glasses: e.target.checked })} />
        眼镜
      </label>
      <button
        className="btn primary" disabled={!dirty}
        onClick={() => connection.send('avatar_update', { avatar: cfg })}
      >
        {dirty ? '应用' : '已应用 ✓'}
      </button>
    </div>
  );
}

export function HelpPanel() {
  const K = ({ children }: { children: string }) => <span className="key">{children}</span>;
  return (
    <div className="kbd-help">
      <div><K>W A S D</K> 蹦跶移动 · <K>Shift</K> 狂奔 · <K>空格</K> 跳跳</div>
      <div><K>鼠标拖动</K> 旋转视角 · <K>滚轮</K> 缩放</div>
      <div><K>E</K> 与提示中的东西互动</div>
      <div><K>回车</K> 聊天 · <K>1–5</K> 表情(挥手/跳舞/鼓掌/指一指/大笑)</div>
      <div><K>Esc</K> 关闭面板 / 取消编辑</div>
      <hr className="hr" />
      <div className="dim" style={{ fontSize: 12, lineHeight: 1.6 }}>
        可以试试:去电影院点部片一起看 · 咖啡馆下象棋、打福州麻将 · 游戏厅挑战井字棋 ·
        给自己房间的电视放个网站 · 点 ✏️ 重新装修房间 · 开 🎙 就近语音(离得越近听得越清)·
        开 📢 全世界语音(不管在哪个房间,全服都听得到你)·
        开 🖥️ 分享屏幕,画面会浮在你的团子头顶(720p·30帧)——五只团子排排坐各自开屏,大家围观。
      </div>
    </div>
  );
}
