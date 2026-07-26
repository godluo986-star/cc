import type { DB } from '../db/database';
import type {
  RoomData, RoomObject, RoomStyle, RoomDirectoryEntry,
} from '@nexuspark/shared';
import { FURNITURE_BY_TYPE, ROOM_BOUNDS, ROOM_MAX_OBJECTS } from '@nexuspark/shared';

const DEFAULT_STYLE: RoomStyle = {
  wallColor: '#cfc6b8', floorColor: '#8a6f52', ceilingColor: '#e8e4dc',
  trimColor: '#6d5b45', lightPreset: 'warm', lightsOn: true,
};

/** Starter furniture so a fresh room feels like home, not an empty box. */
const STARTER_LAYOUT: Array<[string, number, number, number, number, string?]> = [
  // [type, x, z, ry, y, color?]
  ['rug', 0, 0.5, 0, 0.005],
  ['sofa', -0.2, -1.1, 0, 0],
  ['coffee_table', -0.2, 0.6, 0, 0],
  ['tv', -0.2, 2.6, Math.PI, 0],
  ['floor_lamp', -2.1, -1.4, 0, 0],
  ['bed', -4.4, -3.2, Math.PI / 2, 0],
  ['wardrobe', -5.5, 0.8, Math.PI / 2, 0],
  ['desk', 4.6, -3.9, 0, 0],
  ['computer', 4.6, -4.05, 0, 0.76],
  ['chair', 4.6, -3.0, Math.PI, 0],
  ['bookshelf', 5.6, -0.6, -Math.PI / 2, 0],
  ['plant', 5.4, 3.9, 0, 0],
  ['mirror', -5.85, -1.8, Math.PI / 2, 1.0],
];

export function createDefaultRoom(db: DB, ownerId: number, ownerName: string): void {
  db.prepare('INSERT OR IGNORE INTO rooms (owner_id, name, visibility, media_control, style, notes) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ownerId, `${ownerName}'s Room`, 'public', 'owner', JSON.stringify(DEFAULT_STYLE),
      'Welcome to your personal room!\n\nPress E on furniture to use it. Open Room Editor (bottom bar) to redecorate.');
  const insert = db.prepare(
    'INSERT INTO room_objects (owner_id, type, x, y, z, ry, color, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const count = db.prepare('SELECT COUNT(*) AS n FROM room_objects WHERE owner_id = ?').get(ownerId) as { n: number };
  if (count.n > 0) return;
  for (const [type, x, z, ry, y, color] of STARTER_LAYOUT) {
    const def = FURNITURE_BY_TYPE[type];
    if (!def) continue;
    insert.run(ownerId, type, x, y, z, ry, color ?? def.defaultColor, '{}');
  }
}

interface RoomRow {
  owner_id: number; name: string; visibility: string; media_control: string; style: string; notes: string;
}
interface ObjRow {
  id: number; type: string; x: number; y: number; z: number; ry: number; color: string; state: string;
}

export function loadRoom(db: DB, ownerId: number): RoomData | null {
  const row = db.prepare('SELECT * FROM rooms WHERE owner_id = ?').get(ownerId) as RoomRow | undefined;
  if (!row) return null;
  const owner = db.prepare('SELECT username FROM users WHERE id = ?').get(ownerId) as { username: string } | undefined;
  let style: RoomStyle;
  try { style = { ...DEFAULT_STYLE, ...JSON.parse(row.style) }; } catch { style = { ...DEFAULT_STYLE }; }
  const objects: RoomObject[] = (db.prepare('SELECT * FROM room_objects WHERE owner_id = ? ORDER BY id').all(ownerId) as ObjRow[])
    .map((o) => {
      let state: Record<string, unknown> = {};
      try { state = JSON.parse(o.state); } catch { /* ignore */ }
      return { id: o.id, type: o.type, x: o.x, y: o.y, z: o.z, ry: o.ry, color: o.color, state };
    });
  return {
    ownerId, ownerName: owner?.username ?? 'unknown',
    name: row.name,
    visibility: row.visibility === 'private' ? 'private' : 'public',
    mediaControl: row.media_control === 'guests' ? 'guests' : 'owner',
    style, objects, notes: row.notes,
  };
}

export function saveRoomMeta(db: DB, room: RoomData): void {
  db.prepare('UPDATE rooms SET name = ?, visibility = ?, media_control = ?, style = ?, notes = ? WHERE owner_id = ?')
    .run(room.name, room.visibility, room.mediaControl, JSON.stringify(room.style), room.notes, room.ownerId);
}

export function addRoomObject(
  db: DB, ownerId: number, type: string, x: number, y: number, z: number, ry: number, color: string
): RoomObject | { error: string } {
  const def = FURNITURE_BY_TYPE[type];
  if (!def) return { error: 'Unknown furniture type.' };
  const count = db.prepare('SELECT COUNT(*) AS n FROM room_objects WHERE owner_id = ?').get(ownerId) as { n: number };
  if (count.n >= ROOM_MAX_OBJECTS) return { error: `Room is full (max ${ROOM_MAX_OBJECTS} objects).` };
  if (x < ROOM_BOUNDS.minX + 0.1 || x > ROOM_BOUNDS.maxX - 0.1 || z < ROOM_BOUNDS.minZ + 0.1 || z > ROOM_BOUNDS.maxZ - 0.1) {
    return { error: 'Out of room bounds.' };
  }
  if (y < 0 || y > 2.4) return { error: 'Invalid height.' };
  const info = db.prepare(
    'INSERT INTO room_objects (owner_id, type, x, y, z, ry, color, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(ownerId, type, x, y, z, ry, color, '{}');
  return { id: Number(info.lastInsertRowid), type, x, y, z, ry, color, state: {} };
}

export function moveRoomObject(db: DB, ownerId: number, id: number, x: number, y: number, z: number, ry: number): boolean {
  if (x < ROOM_BOUNDS.minX + 0.1 || x > ROOM_BOUNDS.maxX - 0.1 || z < ROOM_BOUNDS.minZ + 0.1 || z > ROOM_BOUNDS.maxZ - 0.1) return false;
  if (y < 0 || y > 2.4) return false;
  const r = db.prepare('UPDATE room_objects SET x = ?, y = ?, z = ?, ry = ? WHERE id = ? AND owner_id = ?')
    .run(x, y, z, ry, id, ownerId);
  return r.changes > 0;
}

export function recolorRoomObject(db: DB, ownerId: number, id: number, color: string): boolean {
  return db.prepare('UPDATE room_objects SET color = ? WHERE id = ? AND owner_id = ?').run(color, id, ownerId).changes > 0;
}

export function removeRoomObject(db: DB, ownerId: number, id: number): boolean {
  return db.prepare('DELETE FROM room_objects WHERE id = ? AND owner_id = ?').run(id, ownerId).changes > 0;
}

export function setRoomObjectState(db: DB, ownerId: number, id: number, state: Record<string, unknown>): boolean {
  const json = JSON.stringify(state);
  if (json.length > 4000) return false;
  return db.prepare('UPDATE room_objects SET state = ? WHERE id = ? AND owner_id = ?').run(json, id, ownerId).changes > 0;
}

export function listDirectory(db: DB, onlineCounts: Map<number, number>, selfId: number): RoomDirectoryEntry[] {
  const rows = db.prepare(
    `SELECT r.owner_id, r.name, r.visibility, u.username FROM rooms r JOIN users u ON u.id = r.owner_id
     WHERE r.visibility = 'public' OR r.owner_id = ? ORDER BY u.username LIMIT 100`
  ).all(selfId) as Array<{ owner_id: number; name: string; visibility: string; username: string }>;
  const entries = rows.map((r) => ({
    ownerId: r.owner_id, ownerName: r.username, name: r.name,
    visibility: (r.visibility === 'private' ? 'private' : 'public') as 'private' | 'public',
    online: onlineCounts.get(r.owner_id) ?? 0,
  }));
  entries.sort((a, b) => (b.online - a.online) || a.ownerName.localeCompare(b.ownerName));
  return entries.slice(0, 60);
}
