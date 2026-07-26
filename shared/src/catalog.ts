/**
 * Furniture + item catalogs. The client maps `type` to a 3D prefab; the server
 * uses footprint + interaction metadata for validation and seat indexing.
 */

export type FurnitureCategory = 'seating' | 'tables' | 'lights' | 'tech' | 'decor' | 'storage';
export type FurnitureInteraction =
  | 'none'
  | 'seat'
  | 'lamp'
  | 'screen'
  | 'computer'
  | 'storage'
  | 'whiteboard'
  | 'speaker'
  | 'mirror'
  | 'bookshelf';

export interface SeatSpot {
  /** Offset from object origin in object-local space (y = seat height). */
  x: number;
  y: number;
  z: number;
  ry: number;
}

export interface FurnitureDef {
  type: string;
  name: string;
  category: FurnitureCategory;
  /** Credits. 0 = free starter furniture. Non-zero requires a one-time unlock. */
  price: number;
  /** Footprint (x depth z) used for room bounds validation, metres. */
  size: [number, number];
  interaction: FurnitureInteraction;
  seats?: SeatSpot[];
  /** Default tint applied when placed. */
  defaultColor: string;
  /** Allowed against walls only (e.g. mirror, whiteboard). */
  wallMounted?: boolean;
}

export const FURNITURE: FurnitureDef[] = [
  // Free starter set
  { type: 'sofa', name: '沙发', category: 'seating', price: 0, size: [2.1, 0.95], interaction: 'seat', defaultColor: '#4d6a92',
    seats: [ { x: -0.5, y: 0.44, z: 0.05, ry: 0 }, { x: 0.5, y: 0.44, z: 0.05, ry: 0 } ] },
  { type: 'armchair', name: '单人沙发', category: 'seating', price: 0, size: [1.05, 0.95], interaction: 'seat', defaultColor: '#8a5a44',
    seats: [ { x: 0, y: 0.44, z: 0.05, ry: 0 } ] },
  { type: 'chair', name: '椅子', category: 'seating', price: 0, size: [0.6, 0.6], interaction: 'seat', defaultColor: '#7a6248',
    seats: [ { x: 0, y: 0.47, z: 0, ry: 0 } ] },
  { type: 'stool', name: '圆凳', category: 'seating', price: 0, size: [0.5, 0.5], interaction: 'seat', defaultColor: '#9a8563',
    seats: [ { x: 0, y: 0.62, z: 0, ry: 0 } ] },
  { type: 'bed', name: '床', category: 'seating', price: 0, size: [1.7, 2.2], interaction: 'seat', defaultColor: '#7292b8',
    seats: [ { x: -0.4, y: 0.5, z: 0.55, ry: 0 }, { x: 0.4, y: 0.5, z: 0.55, ry: 0 } ] },
  { type: 'table', name: '餐桌', category: 'tables', price: 0, size: [1.5, 0.9], interaction: 'none', defaultColor: '#8b6c4f' },
  { type: 'coffee_table', name: '茶几', category: 'tables', price: 0, size: [1.1, 0.6], interaction: 'none', defaultColor: '#6e5136' },
  { type: 'desk', name: '书桌', category: 'tables', price: 0, size: [1.5, 0.75], interaction: 'none', defaultColor: '#54606e' },
  { type: 'floor_lamp', name: '落地灯', category: 'lights', price: 0, size: [0.45, 0.45], interaction: 'lamp', defaultColor: '#e8d9a0' },
  { type: 'table_lamp', name: '台灯', category: 'lights', price: 0, size: [0.35, 0.35], interaction: 'lamp', defaultColor: '#ffd9a0' },
  { type: 'tv', name: '电视机', category: 'tech', price: 0, size: [1.6, 0.5], interaction: 'screen', defaultColor: '#20242a' },
  { type: 'computer', name: '电脑', category: 'tech', price: 0, size: [0.9, 0.6], interaction: 'computer', defaultColor: '#2b3340' },
  { type: 'bookshelf', name: '书架', category: 'storage', price: 0, size: [1.2, 0.42], interaction: 'bookshelf', defaultColor: '#6a4f37' },
  { type: 'wardrobe', name: '衣柜', category: 'storage', price: 0, size: [1.3, 0.65], interaction: 'storage', defaultColor: '#7c603f' },
  { type: 'plant', name: '盆栽', category: 'decor', price: 0, size: [0.5, 0.5], interaction: 'none', defaultColor: '#3f7d44' },
  { type: 'rug', name: '地毯', category: 'decor', price: 0, size: [2.4, 1.7], interaction: 'none', defaultColor: '#a05252' },
  { type: 'mirror', name: '镜子', category: 'decor', price: 0, size: [1.1, 0.15], interaction: 'mirror', defaultColor: '#c8ccd4', wallMounted: true },
  { type: 'whiteboard_s', name: '白板', category: 'decor', price: 0, size: [1.5, 0.15], interaction: 'whiteboard', defaultColor: '#f4f6f8', wallMounted: true },

  // Premium unlocks (one-time purchase at the shop kiosk)
  { type: 'sofa_lux', name: '丝绒沙发', category: 'seating', price: 35, size: [2.3, 1.0], interaction: 'seat', defaultColor: '#7d3b5e',
    seats: [ { x: -0.55, y: 0.46, z: 0.05, ry: 0 }, { x: 0.55, y: 0.46, z: 0.05, ry: 0 } ] },
  { type: 'tv_big', name: '85寸巨幕电视', category: 'tech', price: 40, size: [2.2, 0.5], interaction: 'screen', defaultColor: '#14171c' },
  { type: 'speaker', name: '音响', category: 'tech', price: 25, size: [0.5, 0.45], interaction: 'speaker', defaultColor: '#23262b' },
  { type: 'neon_sign', name: '霓虹灯牌', category: 'decor', price: 20, size: [1.3, 0.12], interaction: 'lamp', defaultColor: '#ff4fd8', wallMounted: true },
  { type: 'aquarium', name: '水族箱', category: 'decor', price: 45, size: [1.5, 0.6], interaction: 'none', defaultColor: '#2b6f8f' },
  { type: 'party_light', name: '舞台灯球', category: 'lights', price: 30, size: [0.4, 0.4], interaction: 'lamp', defaultColor: '#c040ff' },
  { type: 'fireplace', name: '壁炉', category: 'decor', price: 40, size: [1.5, 0.6], interaction: 'lamp', defaultColor: '#8a8078', wallMounted: true },
  { type: 'kitchen', name: '小厨房', category: 'storage', price: 35, size: [2.4, 0.7], interaction: 'none', defaultColor: '#8fa3ad' },
];

export const FURNITURE_BY_TYPE: Record<string, FurnitureDef> = Object.fromEntries(
  FURNITURE.map((f) => [f.type, f])
);

// ── Consumables & collectibles ──────────────────────────────────────────────
export interface ItemDef {
  id: string;
  name: string;
  price: number;
  kind: 'consumable' | 'collectible';
  /** HeldItem enum value shown in the avatar's hand when used. */
  heldId?: number;
  icon: string;
}

export const ITEMS: ItemDef[] = [
  { id: 'coffee', name: '咖啡', price: 5, kind: 'consumable', heldId: 1, icon: '☕' },
  { id: 'soda', name: '团子可乐', price: 4, kind: 'consumable', heldId: 2, icon: '🥤' },
  { id: 'pizza', name: '披萨', price: 6, kind: 'consumable', heldId: 3, icon: '🍕' },
  { id: 'book_poems', name: '口袋诗集', price: 8, kind: 'collectible', heldId: 4, icon: '📖' },
  { id: 'ticket', name: '电影票根', price: 3, kind: 'collectible', icon: '🎟️' },
];
export const ITEMS_BY_ID: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

// ── Synth jukebox tracks (procedurally generated client-side; ids only) ─────
export interface TrackDef { id: string; name: string; bpm: number; }
export const TRACKS: TrackDef[] = [
  { id: 'sunset', name: '日落慢摇', bpm: 84 },
  { id: 'neon', name: '霓虹疾驰', bpm: 118 },
  { id: 'waltz', name: '咖啡圆舞曲', bpm: 96 },
];
export const TRACK_IDS = TRACKS.map((t) => t.id);
