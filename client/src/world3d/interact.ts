/**
 * Interaction targets: assembled per-space from the shared layout (public
 * spaces) or the live RoomData (personal rooms), mirroring the server's
 * validation exactly. Dynamic targets (NPCs, ball) are added by LocalPlayer.
 */
import {
  LAYOUTS, ROOM_DOOR, ROOM_SWITCH, FURNITURE_BY_TYPE, isRoomSpace,
} from '@nexuspark/shared';
import type { RoomData, Collider } from '@nexuspark/shared';
import { connection } from '../net/connection';
import { useUI, useWorld, useSession } from '../state/stores';
import { hot } from '../state/hot';
import { audio } from '../audio/engine';

export interface Target {
  id: string;
  kind: string;
  x: number; y: number; z: number;
  ry: number;
  label: string;
  data?: Record<string, unknown>;
}

export function buildTargets(spaceKey: string, room: RoomData | null): Target[] {
  const out: Target[] = [];
  if (isRoomSpace(spaceKey)) {
    const push = (i: typeof ROOM_DOOR) => out.push({
      id: i.id, kind: i.kind, x: i.pos[0], y: i.pos[1], z: i.pos[2], ry: i.ry, label: i.label, data: i.data,
    });
    push(ROOM_DOOR);
    push(ROOM_SWITCH);
    if (room) {
      const selfId = useSession.getState().self?.userId;
      const isOwner = selfId === room.ownerId;
      for (const o of room.objects) {
        const def = FURNITURE_BY_TYPE[o.type];
        if (!def) continue;
        const cos = Math.cos(o.ry), sin = Math.sin(o.ry);
        if (def.interaction === 'seat' && def.seats) {
          def.seats.forEach((sp, i) => {
            out.push({
              id: `obj:${o.id}:s${i}`, kind: 'seat',
              x: o.x + sp.x * cos + sp.z * sin, y: o.y + sp.y, z: o.z - sp.x * sin + sp.z * cos,
              ry: o.ry + sp.ry, label: o.type === 'bed' ? '坐到床上' : '坐下',
            });
          });
        } else if (def.interaction === 'lamp') {
          out.push({ id: `obj:${o.id}`, kind: 'objlamp', x: o.x, y: o.y + 0.6, z: o.z, ry: o.ry, label: (o.state.on ?? true) ? `关掉${def.name}` : `打开${def.name}` });
        } else if (def.interaction === 'screen') {
          out.push({ id: `obj:${o.id}`, kind: 'screen', x: o.x, y: o.y + 0.8, z: o.z, ry: o.ry, label: '电视' });
        } else if (def.interaction === 'computer') {
          out.push({ id: `obj:${o.id}`, kind: 'computer', x: o.x, y: o.y + 0.4, z: o.z, ry: o.ry, label: isOwner ? '使用电脑' : '看看电脑', data: { objectId: o.id } });
        } else if (def.interaction === 'storage') {
          out.push({ id: `obj:${o.id}`, kind: 'storage', x: o.x, y: o.y + 0.8, z: o.z, ry: o.ry, label: isOwner ? '打开衣柜' : '衣柜', data: { objectId: o.id } });
        } else if (def.interaction === 'whiteboard') {
          out.push({ id: `obj:${o.id}`, kind: 'whiteboard', x: o.x, y: o.y + 1.2, z: o.z, ry: o.ry, label: '白板', data: { boardId: `obj:${o.id}` } });
        } else if (def.interaction === 'bookshelf') {
          out.push({ id: `obj:${o.id}`, kind: 'bookshelf', x: o.x, y: o.y + 0.9, z: o.z, ry: o.ry, label: '翻翻书' });
        } else if (def.interaction === 'speaker') {
          out.push({ id: `obj:${o.id}`, kind: 'jukebox', x: o.x, y: o.y + 0.5, z: o.z, ry: o.ry, label: '音乐播放器' });
        }
      }
    }
    return out;
  }
  const layout = LAYOUTS[spaceKey];
  if (!layout) return out;
  for (const i of layout.interactables) {
    out.push({ id: i.id, kind: i.kind, x: i.pos[0], y: i.pos[1], z: i.pos[2], ry: i.ry, label: i.label, data: i.data });
  }
  return out;
}

/** Colliders for the current space (mirrors server derivation for rooms). */
export function buildColliders(spaceKey: string, room: RoomData | null): Collider[] {
  if (!isRoomSpace(spaceKey)) return LAYOUTS[spaceKey]?.colliders ?? [];
  const colliders: Collider[] = [];
  if (!room) return colliders;
  for (const o of room.objects) {
    const def = FURNITURE_BY_TYPE[o.type];
    if (!def) continue;
    const [w, d] = def.size;
    const solid = def.type !== 'rug' && !def.wallMounted && def.interaction !== 'seat';
    if (solid && Math.max(w, d) > 0.45) {
      const c = Math.abs(Math.cos(o.ry));
      const s = Math.abs(Math.sin(o.ry));
      colliders.push({ kind: 'box', x: o.x, z: o.z, w: c * w + s * d, d: s * w + c * d });
    }
  }
  return colliders;
}

export function labelFor(t: Target): string {
  const seats = useWorld.getState().seats;
  if (t.kind === 'seat' && seats[t.id] !== undefined) return '座位有人啦';
  return t.label;
}

/** Execute the interaction for a target (E key). */
export function performAction(t: Target): void {
  const ui = useUI.getState();
  audio.click();
  switch (t.kind) {
    case 'seat': {
      const seats = useWorld.getState().seats;
      if (seats[t.id] !== undefined) return;
      connection.send('sit', { seatId: t.id });
      break;
    }
    case 'door': {
      const target = String(t.data?.target ?? '');
      if (!target) return;
      const fromSpace = useWorld.getState().spaceKey;
      ui.setFade(true);
      audio.doorSlide();
      setTimeout(() => connection.send('switch_space', { target }), 230);
      // if the switch is rejected (or lost), don't leave the screen black
      setTimeout(() => {
        if (useWorld.getState().spaceKey === fromSpace) useUI.getState().setFade(false);
      }, 2600);
      break;
    }
    case 'switch':
      connection.send('switch_toggle', { switchId: String(t.data?.switchId ?? t.id) });
      break;
    case 'objlamp':
      connection.send('obj_toggle', { objectId: t.id });
      break;
    case 'board':
      ui.openPanel({ kind: 'board', boardId: t.id });
      break;
    case 'whiteboard':
      ui.openPanel({ kind: 'whiteboard', boardId: String(t.data?.boardId ?? t.id) });
      break;
    case 'screen':
      ui.openPanel({ kind: 'media', screenId: t.id });
      break;
    case 'jukebox':
      ui.openPanel({ kind: 'jukebox' });
      break;
    case 'ttt':
      ui.openPanel({ kind: 'ttt', machineId: t.id });
      break;
    case 'xiangqi':
      ui.openPanel({ kind: 'xiangqi', tableId: t.id });
      break;
    case 'mahjong':
      ui.openPanel({ kind: 'mahjong', tableId: t.id });
      break;
    case 'riichi':
      ui.openPanel({ kind: 'riichi', tableId: t.id });
      break;
    case 'lightsout':
      ui.openPanel({ kind: 'lightsout', machineId: t.id });
      break;
    case 'vending':
      ui.openPanel({ kind: 'vending', vendId: t.id, items: (t.data?.items as string[]) ?? [] });
      break;
    case 'kiosk':
      ui.openPanel({ kind: 'kiosk' });
      break;
    case 'elevator':
      connection.send('elevator_list', {});
      ui.openPanel({ kind: 'elevator' });
      break;
    case 'bookshelf':
      ui.openPanel({ kind: 'books', source: t.id });
      break;
    case 'computer':
      ui.openPanel({ kind: 'notes', objectId: Number(t.data?.objectId ?? 0) });
      break;
    case 'storage':
      ui.openPanel({ kind: 'storage', objectId: Number(t.data?.objectId ?? 0) });
      break;
    case 'npc':
      connection.send('npc_talk', { npcId: Number(t.data?.npcId ?? 0) });
      break;
    case 'ball': {
      const yaw = hot.camera.yaw;
      connection.send('kick_ball', { dirX: -Math.sin(yaw), dirZ: -Math.cos(yaw) });
      audio.kickBall();
      break;
    }
  }
}
