/**
 * Xiangqi (Chinese chess) rules, shared by server (authoritative validation)
 * and client (move highlighting). Folk-play style: win by capturing the
 * opposing general; the flying-general capture along an open file is legal.
 * Board: 9 files (x 0-8) × 10 ranks (y 0-9). Red at the bottom (y 0-4),
 * Black at the top (y 5-9). Cell index = y * 9 + x.
 */

/** Piece codes: uppercase = Red, lowercase = Black.
 *  K/k general 帅/将 · A/a advisor 仕/士 · E/e elephant 相/象 ·
 *  H/h horse 马 · R/r chariot 车 · C/c cannon 炮 · P/p soldier 兵/卒 */
export type XqPiece = 'K' | 'A' | 'E' | 'H' | 'R' | 'C' | 'P' | 'k' | 'a' | 'e' | 'h' | 'r' | 'c' | 'p' | '';

export const XQ_W = 9;
export const XQ_H = 10;

export function xqInitialBoard(): XqPiece[] {
  const b: XqPiece[] = Array(90).fill('');
  const back = ['R', 'H', 'E', 'A', 'K', 'A', 'E', 'H', 'R'] as const;
  back.forEach((p, x) => { b[0 * 9 + x] = p; b[9 * 9 + x] = p.toLowerCase() as XqPiece; });
  b[2 * 9 + 1] = 'C'; b[2 * 9 + 7] = 'C';
  b[7 * 9 + 1] = 'c'; b[7 * 9 + 7] = 'c';
  for (const x of [0, 2, 4, 6, 8]) { b[3 * 9 + x] = 'P'; b[6 * 9 + x] = 'p'; }
  return b;
}

export const xqIsRed = (p: XqPiece) => p !== '' && p === p.toUpperCase();
const inBoard = (x: number, y: number) => x >= 0 && x < 9 && y >= 0 && y < 10;
const inPalace = (x: number, y: number, red: boolean) =>
  x >= 3 && x <= 5 && (red ? y >= 0 && y <= 2 : y >= 7 && y <= 9);
const acrossRiver = (y: number, red: boolean) => (red ? y >= 5 : y <= 4);

/** Is `from → to` a legal move for the piece on `from`? (turn checked by caller) */
export function xqLegalMove(board: XqPiece[], from: number, to: number): boolean {
  if (from === to || from < 0 || from >= 90 || to < 0 || to >= 90) return false;
  const piece = board[from];
  if (!piece) return false;
  const red = xqIsRed(piece);
  const target = board[to];
  if (target && xqIsRed(target) === red) return false; // own piece

  const fx = from % 9, fy = Math.floor(from / 9);
  const tx = to % 9, ty = Math.floor(to / 9);
  const dx = tx - fx, dy = ty - fy;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  const at = (x: number, y: number) => board[y * 9 + x];

  const countBetween = (): number => {
    let n = 0;
    if (fy === ty) {
      for (let x = Math.min(fx, tx) + 1; x < Math.max(fx, tx); x++) if (at(x, fy)) n++;
    } else if (fx === tx) {
      for (let y = Math.min(fy, ty) + 1; y < Math.max(fy, ty); y++) if (at(fx, y)) n++;
    } else {
      return -1;
    }
    return n;
  };

  switch (piece.toUpperCase()) {
    case 'K': {
      // flying general: capture the opposing general along an open file
      if (target && target.toUpperCase() === 'K' && fx === tx && countBetween() === 0) return true;
      if (adx + ady !== 1) return false;
      return inPalace(tx, ty, red);
    }
    case 'A':
      if (adx !== 1 || ady !== 1) return false;
      return inPalace(tx, ty, red);
    case 'E': {
      if (adx !== 2 || ady !== 2) return false;
      if (acrossRiver(ty, red)) return false; // elephants stay home
      const eye = at(fx + dx / 2, fy + dy / 2);
      return !eye;
    }
    case 'H': {
      if (!((adx === 1 && ady === 2) || (adx === 2 && ady === 1))) return false;
      // horse leg
      const legX = fx + (adx === 2 ? dx / 2 : 0);
      const legY = fy + (ady === 2 ? dy / 2 : 0);
      return !at(legX, legY);
    }
    case 'R':
      return countBetween() === 0;
    case 'C': {
      const between = countBetween();
      if (between < 0) return false;
      return target ? between === 1 : between === 0;
    }
    case 'P': {
      const forward = red ? 1 : -1;
      if (dy === forward && dx === 0) return true;
      if (acrossRiver(fy, red) && dy === 0 && adx === 1) return true;
      return false;
    }
    default:
      return false;
  }
}

export function xqMovesFrom(board: XqPiece[], from: number): number[] {
  const out: number[] = [];
  if (!board[from]) return out;
  for (let to = 0; to < 90; to++) if (xqLegalMove(board, from, to)) out.push(to);
  return out;
}

export const XQ_CHAR: Record<string, string> = {
  K: '帅', A: '仕', E: '相', H: '马', R: '车', C: '炮', P: '兵',
  k: '将', a: '士', e: '象', h: '马', r: '车', c: '炮', p: '卒',
};

export interface XiangqiState {
  tableId: string;
  board: XqPiece[];
  players: [import('./types').PublicProfile | null, import('./types').PublicProfile | null]; // [red, black]
  turn: 0 | 1; // 0 = red
  winner: -1 | 0 | 1; // -1 none
  lastMove: [number, number] | null;
}
