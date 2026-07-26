/** Room editor: bottom bar (catalog, selection tools) + room settings panel. */
import { useMemo, useState } from 'react';
import { useUI, useWorld, useSession } from '../state/stores';
import { connection } from '../net/connection';
import { FURNITURE } from '@nexuspark/shared';
import type { FurnitureCategory, LightPreset } from '@nexuspark/shared';

const CAT_ICONS: Record<FurnitureCategory, string> = {
  seating: '🛋️', tables: '🪑', lights: '💡', tech: '📺', decor: '🖼️', storage: '📦',
};
const PALETTE = ['#4d6a92', '#8a5a44', '#7d3b5e', '#3f7d44', '#c9a227', '#8e44ad', '#c05555', '#2b6f8f', '#6a4f37', '#20242a', '#e8e4dc', '#f2c4cd'];

export function RoomEditorBar() {
  const editMode = useUI((s) => s.editMode);
  const placing = useUI((s) => s.editPlacing);
  const selection = useUI((s) => s.editSelection);
  const ui = useUI.getState();
  const room = useWorld((s) => s.room);
  const self = useSession((s) => s.self);
  const [cat, setCat] = useState<FurnitureCategory>('seating');
  const [showCatalog, setShowCatalog] = useState(false);

  const available = useMemo(
    () => FURNITURE.filter((f) => f.category === cat && (f.price === 0 || self?.unlocks.includes(f.type))),
    [cat, self?.unlocks]
  );
  if (!editMode || !room || room.ownerId !== self?.userId) return null;
  const selObj = selection !== null ? room.objects.find((o) => o.id === selection) : null;

  return (
    <>
      <div className="editor-hint panel">
        {placing && '点击地面放置 · R 旋转 · Esc 取消'}
        {selObj && '点击地面移动 · R 旋转 · X 删除 · Esc 取消选中'}
        {!placing && !selObj && '从目录里挑家具,或点击已有家具来移动/换色'}
      </div>
      <div className="editor-bar panel">
        <button className={`btn small ${showCatalog ? 'primary' : ''}`} onClick={() => setShowCatalog(!showCatalog)}>
          🧰 家具目录
        </button>
        {selObj && (
          <>
            <span className="dim" style={{ fontSize: 12 }}>{FURNITURE.find((f) => f.type === selObj.type)?.name}</span>
            <div className="swatches">
              {PALETTE.map((c) => (
                <div
                  key={c} className={`swatch ${selObj.color === c ? 'sel' : ''}`} style={{ background: c, width: 20, height: 20 }}
                  onClick={() => connection.send('room_edit', { op: 'recolor', id: selObj.id, color: c })}
                />
              ))}
            </div>
            <button className="btn small danger" onClick={() => { connection.send('room_edit', { op: 'remove', id: selObj.id }); ui.setEditSelection(null); }}>
              🗑 删除
            </button>
          </>
        )}
        <button className="btn small" onClick={() => ui.openPanel({ kind: 'roomSettings' })}>🎨 墙面与设置</button>
        <button className="btn small ghost" onClick={() => ui.setEditMode(false)}>✓ 完成</button>
      </div>
      {showCatalog && (
        <div className="panel" style={{ position: 'absolute', left: '50%', bottom: 130, transform: 'translateX(-50%)', padding: 12, width: 460, maxWidth: '92vw', zIndex: 9 }}>
          <div className="row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
            {(Object.keys(CAT_ICONS) as FurnitureCategory[]).map((c) => (
              <button key={c} className={`btn small ${cat === c ? 'primary' : ''}`} onClick={() => setCat(c)}>
                {CAT_ICONS[c]} {({seating:'坐具',tables:'桌子',lights:'灯具',tech:'电器',decor:'装饰',storage:'收纳'} as Record<FurnitureCategory,string>)[c]}
              </button>
            ))}
          </div>
          <div className="cat-grid">
            {available.map((f) => (
              <div
                key={f.type}
                className={`cat-item ${placing === f.type ? 'sel' : ''}`}
                onClick={() => { ui.setEditPlacing(f.type); setShowCatalog(false); }}
              >
                <span className="ico">{CAT_ICONS[f.category]}</span>
                {f.name}
              </div>
            ))}
          </div>
          <div className="dim" style={{ fontSize: 11, marginTop: 8 }}>
            高级家具要先去广场商店的购买台解锁。
          </div>
        </div>
      )}
    </>
  );
}

const WALL_COLORS = ['#cfc6b8', '#d8cdb8', '#c4d9f2', '#c8ecc9', '#f2c4cd', '#e0c4f2', '#8a8078', '#5a6273', '#f5e6d3', '#2b3340'];
const FLOOR_COLORS = ['#8a6f52', '#a08a70', '#6e5136', '#5a5a6a', '#8f9aa5', '#7d3b5e', '#3f5f44', '#22262c'];

export function RoomSettingsPanel() {
  const room = useWorld((s) => s.room);
  const self = useSession((s) => s.self);
  const [name, setName] = useState(room?.name ?? '');
  if (!room || room.ownerId !== self?.userId) return <div className="dim">只有房主能修改这个房间。</div>;
  const Sw = ({ colors, value, onPick }: { colors: string[]; value: string; onPick: (c: string) => void }) => (
    <div className="swatches">
      {colors.map((c) => (
        <div key={c} className={`swatch ${value === c ? 'sel' : ''}`} style={{ background: c }} onClick={() => onPick(c)} />
      ))}
    </div>
  );
  return (
    <div className="col">
      <label className="field">
        房间名字
        <div className="row">
          <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          <button className="btn small" disabled={!name.trim() || name === room.name} onClick={() => connection.send('room_edit', { op: 'rename', name: name.trim() })}>
            改名
          </button>
        </div>
      </label>
      <label className="field">墙面<Sw colors={WALL_COLORS} value={room.style.wallColor} onPick={(c) => connection.send('room_edit', { op: 'style', wallColor: c })} /></label>
      <label className="field">地板<Sw colors={FLOOR_COLORS} value={room.style.floorColor} onPick={(c) => connection.send('room_edit', { op: 'style', floorColor: c })} /></label>
      <label className="field">天花板<Sw colors={WALL_COLORS} value={room.style.ceilingColor} onPick={(c) => connection.send('room_edit', { op: 'style', ceilingColor: c })} /></label>
      <label className="field">踢脚线<Sw colors={FLOOR_COLORS} value={room.style.trimColor} onPick={(c) => connection.send('room_edit', { op: 'style', trimColor: c })} /></label>
      <label className="field">
        灯光氛围
        <div className="row">
          {(['warm', 'cool', 'party'] as LightPreset[]).map((p) => (
            <button key={p} className={`btn small ${room.style.lightPreset === p ? 'primary' : ''}`} onClick={() => connection.send('room_edit', { op: 'style', lightPreset: p })}>
              {p === 'warm' ? '🕯 暖光' : p === 'cool' ? '❄ 冷光' : '🪩 派对'}
            </button>
          ))}
        </div>
      </label>
      <hr className="hr" />
      <label className="field">
        谁能进来
        <div className="row">
          <button className={`btn small ${room.visibility === 'public' ? 'primary' : ''}`} onClick={() => connection.send('room_edit', { op: 'visibility', visibility: 'public' })}>
            🌐 所有人
          </button>
          <button className={`btn small ${room.visibility === 'private' ? 'primary' : ''}`} onClick={() => connection.send('room_edit', { op: 'visibility', visibility: 'private' })}>
            🔒 只有我
          </button>
        </div>
      </label>
      <label className="field">
        屏幕与音乐控制权
        <div className="row">
          <button className={`btn small ${room.mediaControl === 'owner' ? 'primary' : ''}`} onClick={() => connection.send('room_edit', { op: 'mediaControl', policy: 'owner' })}>
            仅房主
          </button>
          <button className={`btn small ${room.mediaControl === 'guests' ? 'primary' : ''}`} onClick={() => connection.send('room_edit', { op: 'mediaControl', policy: 'guests' })}>
            客人也可以
          </button>
        </div>
      </label>
    </div>
  );
}
