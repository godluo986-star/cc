/** DOM overlay: top bar, chat, prompt, toasts, dock, dialogue, panel router. */
import { useEffect, useState, type ReactNode } from 'react';
import { useSession, useUI, useWorld, useVoice, type PanelKind } from '../state/stores';
import { connection } from '../net/connection';
import { hot } from '../state/hot';
import { voice } from '../voice/voice';
import { audio } from '../audio/engine';
import { EMOTES, isRoomSpace } from '@nexuspark/shared';
import { triggerEmote } from '../world3d/LocalPlayer';
import ChatPanel from './ChatPanel';
import WhiteboardPanel from './WhiteboardPanel';
import FullscreenViewer from './FullscreenViewer';
import {
  MediaPanel, JukeboxPanel, BoardPanel, TttPanel, LightsOutPanel,
  VendingPanel, KioskPanel, ElevatorPanel, BooksPanel, InventoryPanel,
  NotesPanel, StoragePanel,
} from './panels';
import { SettingsPanel, AvatarEditor, HelpPanel } from './SettingsPanels';
import { XiangqiPanel, MahjongPanel } from './GamePanelsCn';
import { RoomEditorBar, RoomSettingsPanel } from './RoomEditorBar';

function Clock() {
  const env = useWorld((s) => s.env);
  const [, force] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => force((n) => n + 1), 5000);
    return () => clearInterval(iv);
  }, []);
  const tod = (env.timeOfDay + (Date.now() - env.at) / 1000 / env.dayLengthSec) % 1;
  const mins = Math.floor(tod * 24 * 60);
  const hh = Math.floor(mins / 60).toString().padStart(2, '0');
  const mm = (mins % 60).toString().padStart(2, '0');
  const wIcon = env.weather === 'rain' ? '🌧' : env.weather === 'cloudy' ? '☁️' : tod > 0.83 || tod < 0.23 ? '🌙' : '☀️';
  return (
    <span className="hud-clock">{wIcon} {hh}:{mm}</span>
  );
}

function panelTitle(p: PanelKind): string {
  switch (p.kind) {
    case 'settings': return '设置';
    case 'avatar': return '我的团子';
    case 'help': return '玩法说明';
    case 'inventory': return '背包';
    case 'media': return '屏幕';
    case 'whiteboard': return '白板';
    case 'board': return '留言板';
    case 'jukebox': return '点歌机';
    case 'ttt': return 'VERSUS·井字棋';
    case 'lightsout': return '关灯谜题';
    case 'xiangqi': return '象棋';
    case 'mahjong': return '福州麻将';
    case 'vending': return '贩卖机';
    case 'kiosk': return '家具购买台';
    case 'elevator': return '电梯';
    case 'notes': return '电脑';
    case 'storage': return '衣柜';
    case 'books': return '书架';
    case 'roomSettings': return '房间设置';
    default: return '';
  }
}

function PanelBody({ p }: { p: PanelKind }): ReactNode {
  switch (p.kind) {
    case 'settings': return <SettingsPanel />;
    case 'avatar': return <AvatarEditor />;
    case 'help': return <HelpPanel />;
    case 'inventory': return <InventoryPanel />;
    case 'media': return <MediaPanel />;
    case 'whiteboard': return <WhiteboardPanel boardId={p.boardId} />;
    case 'board': return <BoardPanel boardId={p.boardId} />;
    case 'jukebox': return <JukeboxPanel />;
    case 'ttt': return <TttPanel machineId={p.machineId} />;
    case 'lightsout': return <LightsOutPanel machineId={p.machineId} />;
    case 'xiangqi': return <XiangqiPanel tableId={p.tableId} />;
    case 'mahjong': return <MahjongPanel tableId={p.tableId} />;
    case 'vending': return <VendingPanel vendId={p.vendId} items={p.items} />;
    case 'kiosk': return <KioskPanel />;
    case 'elevator': return <ElevatorPanel />;
    case 'notes': return <NotesPanel />;
    case 'storage': return <StoragePanel objectId={p.objectId} />;
    case 'books': return <BooksPanel />;
    case 'roomSettings': return <RoomSettingsPanel />;
    default: return null;
  }
}

function DialogueBox() {
  const dialogue = useUI((s) => s.dialogue);
  if (!dialogue) return null;
  return (
    <div className="dialogue panel">
      <div className="npc-name">{dialogue.npcName}</div>
      <div style={{ fontSize: 14, lineHeight: 1.5 }}>{dialogue.text}</div>
      <div className="options">
        {dialogue.options.map((o) => (
          <button
            key={o.id} className="btn"
            onClick={() => connection.send('npc_talk', { npcId: dialogue.npcId, choice: o.id })}
          >
            {o.label}
          </button>
        ))}
        <button className="btn ghost" onClick={() => useUI.getState().setDialogue(null)}>转身离开</button>
      </div>
    </div>
  );
}

function Roster() {
  const roster = useWorld((s) => s.roster);
  const voiceRoster = useWorld((s) => s.voiceRoster);
  const worldVoice = useWorld((s) => s.voiceWorldRoster);
  const label = useWorld((s) => s.label);
  return (
    <div className="roster panel">
      <div className="title" style={{ fontSize: 13, marginBottom: 6 }}>{label} · {roster.filter((r) => !r.isNpc).length} 人在场</div>
      {roster.map((p) => (
        <div key={p.id} className="roster-line">
          <span className={`roster-dot ${p.isNpc ? 'npc' : ''}`} />
          <span style={{ flex: 1 }}>{p.username}{p.id === hot.selfId ? '(我)' : ''}</span>
          {worldVoice.includes(p.id) ? <span>📢</span> : voiceRoster.includes(p.id) && <span>🎙</span>}
        </div>
      ))}
    </div>
  );
}

export default function HUD() {
  const phase = useSession((s) => s.phase);
  const reconnecting = useSession((s) => s.reconnecting);
  const connected = useSession((s) => s.connected);
  const self = useSession((s) => s.self);
  const label = useWorld((s) => s.label);
  const room = useWorld((s) => s.room);
  const spaceKey = useWorld((s) => s.spaceKey);
  const prompt = useUI((s) => s.prompt);
  const toasts = useUI((s) => s.toasts);
  const panel = useUI((s) => s.panel);
  const showRoster = useUI((s) => s.showRoster);
  const helpSeen = useUI((s) => s.helpSeen);
  const editMode = useUI((s) => s.editMode);
  const ui = useUI.getState();
  const voiceOn = useVoice((s) => s.enabled);
  const voiceScope = useVoice((s) => s.scope);
  const micLevel = useVoice((s) => s.micLevel);
  const voiceErr = useVoice((s) => s.error);
  const screenOn = useVoice((s) => s.screenOn);
  const [emotesOpen, setEmotesOpen] = useState(false);

  // Esc closes panels; first-run help
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (useUI.getState().panel.kind !== 'none') ui.closePanel();
        else if (useUI.getState().dialogue) ui.setDialogue(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (phase === 'inworld' && !helpSeen) {
      ui.openPanel({ kind: 'help' });
      ui.setHelpSeen();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, helpSeen]);

  if (phase !== 'inworld') return null;
  const isOwnRoom = isRoomSpace(spaceKey) && room?.ownerId === self?.userId;

  return (
    <div className="hud">
      {(!connected || reconnecting) && (
        <div className="conn-banner">⚡ 连接断开,正在重连…</div>
      )}

      <div className="hud-top panel">
        <span>📍 {label}</span>
        <span className="sep">|</span>
        <Clock />
        {connection.rtt > 0 && (
          <>
            <span className="sep">|</span>
            <span className="dim">{connection.rtt}ms</span>
          </>
        )}
      </div>

      <div className="hud-topright">
        <div className="hud-credits panel">💰 {self?.credits ?? 0}</div>
        <button className="btn" onClick={() => ui.setShowRoster(!showRoster)}>👥</button>
        <button className="btn" onClick={() => ui.openPanel({ kind: 'help' })}>❓</button>
      </div>
      {showRoster && <Roster />}

      {prompt && !editMode && (
        <div className="prompt panel">
          <span className="key">{prompt.key}</span>
          <span>{prompt.label}</span>
        </div>
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast panel ${t.level}`} onClick={() => ui.dismissToast(t.id)}>{t.text}</div>
        ))}
        {voiceErr && <div className="toast panel error" onClick={() => useVoice.getState().setError(null)}>{voiceErr}</div>}
      </div>

      <ChatPanel />
      <DialogueBox />
      <RoomEditorBar />
      <FullscreenViewer />

      {emotesOpen && (
        <div className="emotes">
          {EMOTES.map((e) => (
            <button key={e.anim} className="btn panel" title={e.label} onClick={() => { triggerEmote(e.anim); setEmotesOpen(false); }}>
              {e.icon}
            </button>
          ))}
        </div>
      )}
      <div className="dock">
        {isOwnRoom && (
          <button
            className={`btn ${editMode ? 'on' : ''}`} title="房间编辑器"
            onClick={() => { ui.setEditMode(!editMode); audio.click(); }}
          >
            ✏️
          </button>
        )}
        <button className="btn" title="表情(1-5)" onClick={() => setEmotesOpen(!emotesOpen)}>🎭</button>
        <button
          className={`btn ${voiceOn && voiceScope === 'near' ? 'on' : ''} ${voiceOn && voiceScope === 'near' && micLevel > 0.14 ? 'talking' : ''}`}
          title="就近语音(离得越近听得越清)"
          onClick={() => voice.toggleNear()}
        >
          {voiceOn && voiceScope === 'near' ? '🎙' : '🔇'}
        </button>
        <button
          className={`btn ${voiceOn && voiceScope === 'world' ? 'on' : ''} ${voiceOn && voiceScope === 'world' && micLevel > 0.14 ? 'talking' : ''}`}
          title="全世界语音(全服所有空间都能听到你)"
          onClick={() => voice.toggleWorld()}
        >
          📢
        </button>
        <button
          className={`btn ${screenOn ? 'on' : ''}`}
          title="分享屏幕(附近的团子会看到浮在你头顶的画面)"
          onClick={() => voice.toggleScreen()}
        >
          🖥️
        </button>
        <button className="btn" title="背包" onClick={() => ui.openPanel({ kind: 'inventory' })}>🎒</button>
        <button className="btn" title="捏团子" onClick={() => ui.openPanel({ kind: 'avatar' })}>🍡</button>
        <button className="btn" title="设置" onClick={() => ui.openPanel({ kind: 'settings' })}>⚙️</button>
      </div>

      {panel.kind !== 'none' && (
        <div className="modal-scrim" onClick={(e) => { if (e.target === e.currentTarget) ui.closePanel(); }}>
          <div className="panel modal">
            <div className="modal-head">
              <span className="title">{panelTitle(panel)}</span>
              <button className="btn small ghost close-x" onClick={() => ui.closePanel()}>✕</button>
            </div>
            <PanelBody p={panel} />
          </div>
        </div>
      )}
    </div>
  );
}
