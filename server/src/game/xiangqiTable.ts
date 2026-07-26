import type { Session } from './session';
import { profileOf } from './session';
import { xqInitialBoard, xqLegalMove, xqIsRed } from '@nexuspark/shared';
import type { XiangqiState, XqPiece } from '@nexuspark/shared';

export class XiangqiTable {
  board: XqPiece[] = xqInitialBoard();
  players: [Session | null, Session | null] = [null, null]; // [红, 黑]
  turn: 0 | 1 = 0;
  winner: -1 | 0 | 1 = -1;
  lastMove: [number, number] | null = null;

  constructor(public tableId: string) {}

  join(s: Session): string | null {
    if (this.players[0] === s || this.players[1] === s) {
      if (this.winner !== -1) this.reset(); // 再来一局
      return null;
    }
    const slot = this.players[0] === null ? 0 : this.players[1] === null ? 1 : -1;
    if (slot === -1) return '两个座位都有人了,先观战吧!';
    this.players[slot] = s;
    return null;
  }

  leave(s: Session): boolean {
    const idx = this.players.indexOf(s);
    if (idx === -1) return false;
    this.players[idx] = null;
    this.reset();
    return true;
  }

  reset(): void {
    this.board = xqInitialBoard();
    this.turn = 0;
    this.winner = -1;
    this.lastMove = null;
  }

  move(s: Session, from: number, to: number): string | null {
    if (this.winner !== -1) return null;
    const me = this.players[0] === s ? 0 : this.players[1] === s ? 1 : -1;
    if (me === -1) return null;
    if (!this.players[0] || !this.players[1]) return '等对手坐下再走棋。';
    if (this.turn !== me) return '还没轮到你。';
    const piece = this.board[from];
    if (!piece) return null;
    if (xqIsRed(piece) !== (me === 0)) return null; // 只能动自己的子
    if (!xqLegalMove(this.board, from, to)) return null;
    const captured = this.board[to];
    this.board[to] = piece;
    this.board[from] = '';
    this.lastMove = [from, to];
    if (captured && captured.toUpperCase() === 'K') {
      this.winner = me;
    } else {
      this.turn = this.turn === 0 ? 1 : 0;
    }
    return null;
  }

  dropSession(s: Session): boolean {
    return this.leave(s);
  }

  publicState(): XiangqiState {
    return {
      tableId: this.tableId,
      board: [...this.board],
      players: [
        this.players[0] ? profileOf(this.players[0]) : null,
        this.players[1] ? profileOf(this.players[1]) : null,
      ],
      turn: this.turn,
      winner: this.winner,
      lastMove: this.lastMove,
    };
  }
}
