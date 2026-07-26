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
  { type: 'sofa', name: 'Sofa', category: 'seating', price: 0, size: [2.1, 0.95], interaction: 'seat', defaultColor: '#4d6a92',
    seats: [ { x: -0.5, y: 0.44, z: 0.05, ry: 0 }, { x: 0.5, y: 0.44, z: 0.05, ry: 0 } ] },
  { type: 'armchair', name: 'Armchair', category: 'seating', price: 0, size: [1.05, 0.95], interaction: 'seat', defaultColor: '#8a5a44',
    seats: [ { x: 0, y: 0.44, z: 0.05, ry: 0 } ] },
  { type: 'chair', name: 'Chair', category: 'seating', price: 0, size: [0.6, 0.6], interaction: 'seat', defaultColor: '#7a6248',
    seats: [ { x: 0, y: 0.47, z: 0, ry: 0 } ] },
  { type: 'stool', name: 'Stool', category: 'seating', price: 0, size: [0.5, 0.5], interaction: 'seat', defaultColor: '#9a8563',
    seats: [ { x: 0, y: 0.62, z: 0, ry: 0 } ] },
  { type: 'bed', name: 'Bed', category: 'seating', price: 0, size: [1.7, 2.2], interaction: 'seat', defaultColor: '#7292b8',
    seats: [ { x: -0.4, y: 0.5, z: 0.55, ry: 0 }, { x: 0.4, y: 0.5, z: 0.55, ry: 0 } ] },
  { type: 'table', name: 'Table', category: 'tables', price: 0, size: [1.5, 0.9], interaction: 'none', defaultColor: '#8b6c4f' },
  { type: 'coffee_table', name: 'Coffee table', category: 'tables', price: 0, size: [1.1, 0.6], interaction: 'none', defaultColor: '#6e5136' },
  { type: 'desk', name: 'Desk', category: 'tables', price: 0, size: [1.5, 0.75], interaction: 'none', defaultColor: '#54606e' },
  { type: 'floor_lamp', name: 'Floor lamp', category: 'lights', price: 0, size: [0.45, 0.45], interaction: 'lamp', defaultColor: '#e8d9a0' },
  { type: 'table_lamp', name: 'Table lamp', category: 'lights', price: 0, size: [0.35, 0.35], interaction: 'lamp', defaultColor: '#ffd9a0' },
  { type: 'tv', name: 'Television', category: 'tech', price: 0, size: [1.6, 0.5], interaction: 'screen', defaultColor: '#20242a' },
  { type: 'computer', name: 'Computer', category: 'tech', price: 0, size: [0.9, 0.6], interaction: 'computer', defaultColor: '#2b3340' },
  { type: 'bookshelf', name: 'Bookshelf', category: 'storage', price: 0, size: [1.2, 0.42], interaction: 'bookshelf', defaultColor: '#6a4f37' },
  { type: 'wardrobe', name: 'Wardrobe', category: 'storage', price: 0, size: [1.3, 0.65], interaction: 'storage', defaultColor: '#7c603f' },
  { type: 'plant', name: 'Potted plant', category: 'decor', price: 0, size: [0.5, 0.5], interaction: 'none', defaultColor: '#3f7d44' },
  { type: 'rug', name: 'Rug', category: 'decor', price: 0, size: [2.4, 1.7], interaction: 'none', defaultColor: '#a05252' },
  { type: 'mirror', name: 'Mirror', category: 'decor', price: 0, size: [1.1, 0.15], interaction: 'mirror', defaultColor: '#c8ccd4', wallMounted: true },
  { type: 'whiteboard_s', name: 'Whiteboard', category: 'decor', price: 0, size: [1.5, 0.15], interaction: 'whiteboard', defaultColor: '#f4f6f8', wallMounted: true },

  // Premium unlocks (one-time purchase at the shop kiosk)
  { type: 'sofa_lux', name: 'Velvet sofa', category: 'seating', price: 35, size: [2.3, 1.0], interaction: 'seat', defaultColor: '#7d3b5e',
    seats: [ { x: -0.55, y: 0.46, z: 0.05, ry: 0 }, { x: 0.55, y: 0.46, z: 0.05, ry: 0 } ] },
  { type: 'tv_big', name: 'Cinema TV 85"', category: 'tech', price: 40, size: [2.2, 0.5], interaction: 'screen', defaultColor: '#14171c' },
  { type: 'speaker', name: 'Hi-fi speaker', category: 'tech', price: 25, size: [0.5, 0.45], interaction: 'speaker', defaultColor: '#23262b' },
  { type: 'neon_sign', name: 'Neon sign', category: 'decor', price: 20, size: [1.3, 0.12], interaction: 'lamp', defaultColor: '#ff4fd8', wallMounted: true },
  { type: 'aquarium', name: 'Aquarium', category: 'decor', price: 45, size: [1.5, 0.6], interaction: 'none', defaultColor: '#2b6f8f' },
  { type: 'party_light', name: 'Disco light', category: 'lights', price: 30, size: [0.4, 0.4], interaction: 'lamp', defaultColor: '#c040ff' },
  { type: 'fireplace', name: 'Fireplace', category: 'decor', price: 40, size: [1.5, 0.6], interaction: 'lamp', defaultColor: '#8a8078', wallMounted: true },
  { type: 'kitchen', name: 'Kitchenette', category: 'storage', price: 35, size: [2.4, 0.7], interaction: 'none', defaultColor: '#8fa3ad' },
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
  { id: 'coffee', name: 'Coffee', price: 5, kind: 'consumable', heldId: 1, icon: '☕' },
  { id: 'soda', name: 'Nexus Cola', price: 4, kind: 'consumable', heldId: 2, icon: '🥤' },
  { id: 'pizza', name: 'Pizza slice', price: 6, kind: 'consumable', heldId: 3, icon: '🍕' },
  { id: 'book_poems', name: 'Pocket book', price: 8, kind: 'collectible', heldId: 4, icon: '📖' },
  { id: 'ticket', name: 'Cinema ticket', price: 3, kind: 'collectible', icon: '🎟️' },
];
export const ITEMS_BY_ID: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

// ── Synth jukebox tracks (procedurally generated client-side; ids only) ─────
export interface TrackDef { id: string; name: string; bpm: number; }
export const TRACKS: TrackDef[] = [
  { id: 'sunset', name: 'Sunset Loop', bpm: 84 },
  { id: 'neon', name: 'Neon Drive', bpm: 118 },
  { id: 'waltz', name: 'Café Waltz', bpm: 96 },
];
export const TRACK_IDS = TRACKS.map((t) => t.id);
