/** Settings, avatar editor and help panels. */
import { useState } from 'react';
import { useSettings, useSession, type Quality } from '../state/stores';
import { connection } from '../net/connection';
import type { AvatarConfig } from '@nexuspark/shared';

export function SettingsPanel() {
  const s = useSettings();
  const Toggle = ({ label, k }: { label: string; k: 'shadows' | 'postfx' | 'reflections' | 'particles' | 'clouds' | 'invertY' | 'reduceMotion' }) => (
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
        {/* 被抓着升降时进一步钳制相机高度变化速率(第一人称防晕) */}
        <Toggle label="减少镜头运动" k="reduceMotion" />
        {/* 个人边界:服务器强制,别人抓不起我(prefs 消息即时同步) */}
        <label className="row" style={{ fontSize: 13 }} title="开启后其他团子无法把你抓起来">
          <input
            type="checkbox"
            checked={s.noGrab}
            onChange={(e) => {
              s.set({ noGrab: e.target.checked });
              connection.send('prefs', { noGrab: e.target.checked });
            }}
          />
          免抓取(别人抓不起我)
        </label>
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

// 参考图规范: 团子只有主体色一个可捏维度 (低饱和粉彩; 无衣服/帽子/配件)
const BODY_COLORS = ['#e8a58e', '#ccd6ae', '#f3c3cc', '#b7cf8f', '#8fc7c4', '#f0e3ae', '#f5eee0', '#cbb8d9', '#f2d3b8'];

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
      <div className="dim" style={{ fontSize: 12 }}>
        你是一颗团子。团子朴素:挑一个喜欢的颜色就够了。
      </div>
      <label className="field">身体颜色<Sw colors={BODY_COLORS} k="shirt" /></label>
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
      <div><K>G</K> 长按抓住附近团子(按住即抓、松手即放) · <K>V</K> 切换第一人称</div>
      <div><K>回车</K> 聊天 · <K>1–5</K> 表情(挥手/跳舞/鼓掌/指一指/大笑)</div>
      <div><K>Esc</K> 关闭面板 / 取消编辑</div>
      <hr className="hr" />
      <div className="dim" style={{ fontSize: 12, lineHeight: 1.6 }}>
        可以试试:去电影院点部片一起看 · 咖啡馆下象棋、打福州麻将 · 游戏厅挑战井字棋 ·
        给自己房间的电视放个网站 · 点 ✏️ 重新装修房间 · 开 🎙 就近语音(离得越近听得越清)·
        开 📢 全世界语音(不管在哪个房间,全服都听得到你)·
        开 🖥️ 分享屏幕,画面会浮在你的团子头顶(720p·30帧)——五只团子排排坐各自开屏,大家围观。
        还可以走到别的团子跟前长按 G 把它抓起来拖着走、举过头顶——被抓的团子可以按方向键挣扎,
        攒够劲就能挣脱;容易晕 3D 的话到设置里打开「减少镜头运动」。
      </div>
    </div>
  );
}
