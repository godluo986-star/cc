import { describe, it, expect } from 'vitest';
import { xqInitialBoard, xqLegalMove, xqMovesFrom } from '../src/xiangqi';
import { mjCanWin, mjSanJinDao, mjFullWall, mjTileName } from '../src/mahjong';

const idx = (x: number, y: number) => y * 9 + x;

describe('象棋走子规则', () => {
  it('初始局面:兵只能前进一步,过河后可横走', () => {
    const b = xqInitialBoard();
    expect(xqLegalMove(b, idx(0, 3), idx(0, 4))).toBe(true);   // 兵进一
    expect(xqLegalMove(b, idx(0, 3), idx(1, 3))).toBe(false);  // 未过河不能横走
    expect(xqLegalMove(b, idx(0, 3), idx(0, 2))).toBe(false);  // 不能后退
  });

  it('马蹩腿', () => {
    const b = xqInitialBoard();
    expect(xqLegalMove(b, idx(1, 0), idx(2, 2))).toBe(true);   // 马跳
    expect(xqLegalMove(b, idx(1, 0), idx(0, 2))).toBe(true);
    b[idx(1, 1)] = 'P';                                        // 塞马腿
    expect(xqLegalMove(b, idx(1, 0), idx(2, 2))).toBe(false);
    expect(xqLegalMove(b, idx(1, 0), idx(0, 2))).toBe(false);
  });

  it('炮需要炮架吃子,平移不能越子', () => {
    const b = xqInitialBoard();
    // 红炮 (1,2) 直线打黑马 (1,9)? 中间有黑炮(1,7)一个架 → 可以打
    expect(xqLegalMove(b, idx(1, 2), idx(1, 9))).toBe(true);
    // 无架不能吃:炮打(1,6)? 中间无子且目标为空 → 平移合法
    expect(xqLegalMove(b, idx(1, 2), idx(1, 6))).toBe(true);
    // 隔两子不能吃
    b[idx(1, 4)] = 'P';
    expect(xqLegalMove(b, idx(1, 2), idx(1, 9))).toBe(false);
  });

  it('将帅不出九宫;飞将可直取', () => {
    const b: ReturnType<typeof xqInitialBoard> = Array(90).fill('');
    b[idx(4, 0)] = 'K';
    b[idx(4, 9)] = 'k';
    expect(xqLegalMove(b, idx(4, 0), idx(4, 9))).toBe(true);   // 飞将
    b[idx(4, 5)] = 'p';
    expect(xqLegalMove(b, idx(4, 0), idx(4, 9))).toBe(false);  // 有子挡着
    expect(xqLegalMove(b, idx(4, 0), idx(5, 0))).toBe(true);
    expect(xqLegalMove(b, idx(4, 0), idx(4, 1))).toBe(true);
    b[idx(4, 0)] = 'K';
    expect(xqLegalMove(b, idx(4, 0), idx(2, 0))).toBe(false);  // 不能跳两格
  });

  it('相不过河、塞象眼', () => {
    const b = xqInitialBoard();
    expect(xqLegalMove(b, idx(2, 0), idx(4, 2))).toBe(true);
    b[idx(3, 1)] = 'P';
    expect(xqLegalMove(b, idx(2, 0), idx(4, 2))).toBe(false);  // 象眼被塞
  });

  it('xqMovesFrom 返回所有合法着法', () => {
    const b = xqInitialBoard();
    const moves = xqMovesFrom(b, idx(0, 0)); // 车被兵挡
    expect(moves).toContain(idx(0, 1));
    expect(moves).toContain(idx(0, 2));
    expect(moves).not.toContain(idx(0, 3));
  });
});

describe('福州麻将胡牌判定', () => {
  // 面子编码:0-8 万,9-17 条,18-26 筒
  it('平胡:四组顺/刻 + 一对', () => {
    // 123万 456万 789万 111条 99筒对
    const hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 26, 26];
    expect(mjCanWin(hand, 33)).toBe(true); // 金为白板(手里没有)
  });

  it('差一张不能胡', () => {
    const hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 10, 26, 26];
    expect(mjCanWin(hand, 33)).toBe(false);
  });

  it('金牌当任意牌', () => {
    // 12_万(缺3万用金) 456万 789万 111条 99筒 — 金是白板(33)
    const hand = [0, 1, 33, 3, 4, 5, 6, 7, 8, 9, 9, 9, 26, 26];
    expect(mjCanWin(hand, 33)).toBe(true);
  });

  it('两张金可以顶一对', () => {
    const hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 33, 33];
    expect(mjCanWin(hand, 33)).toBe(true);
  });

  it('三金倒', () => {
    const hand = [33, 33, 33, 0, 4, 8, 11, 15, 19, 22, 25, 27, 30];
    expect(mjSanJinDao(hand, 33)).toBe(true);
    expect(mjSanJinDao(hand, 32)).toBe(false);
  });

  it('字牌不能连顺', () => {
    // 东南西 不是顺子
    const hand = [27, 28, 29, 3, 4, 5, 6, 7, 8, 9, 9, 9, 26, 26];
    expect(mjCanWin(hand, 33)).toBe(false);
  });

  it('整副牌 136 张', () => {
    expect(mjFullWall().length).toBe(136);
    expect(mjTileName(0)).toBe('一万');
    expect(mjTileName(17)).toBe('9条');
    expect(mjTileName(33)).toBe('白');
  });
});
