import { describe, it, expect } from 'vitest';
import {
  rcAllTiles,
  rcCounts,
  rcDoraFace,
  rcParseFaces,
  rcParseTiles,
  rcSeededRng,
  rcShuffle,
  rcSuit,
  rcTileEmoji,
  rcTileName,
  RC_TILE_COUNT,
} from '../src/riichi';

describe('立直麻将 · 牌面与实体牌', () => {
  it('全副 136 张,每 face 恰 4 张,红 5 共 3 张', () => {
    const all = rcAllTiles();
    expect(all).toHaveLength(RC_TILE_COUNT);
    const counts = rcCounts(all.map((t) => t.face));
    expect(counts.every((n) => n === 4)).toBe(true);
    const reds = all.filter((t) => t.red);
    expect(reds.map((t) => t.face).sort((a, b) => a - b)).toEqual([4, 13, 22]);
    // id 唯一
    expect(new Set(all.map((t) => t.id)).size).toBe(136);
  });

  it('洗牌:种子确定性 + 结果是置换', () => {
    const a = rcShuffle(rcAllTiles(), rcSeededRng(42));
    const b = rcShuffle(rcAllTiles(), rcSeededRng(42));
    const c = rcShuffle(rcAllTiles(), rcSeededRng(43));
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
    expect(a.map((t) => t.id)).not.toEqual(c.map((t) => t.id));
    expect([...a.map((t) => t.id)].sort((x, y) => x - y)).toEqual(
      Array.from({ length: 136 }, (_, i) => i),
    );
  });

  it('中文名与 emoji', () => {
    expect(rcTileName(0)).toBe('一万');
    expect(rcTileName(13, true)).toBe('红五筒');
    expect(rcTileName(26)).toBe('九索');
    expect(rcTileName(27)).toBe('东');
    expect(rcTileName(33)).toBe('中');
    expect(rcTileEmoji(0)).toBe('🀇');
    expect(rcTileEmoji(33)).toBe('🀄');
    expect(rcTileEmoji(27)).toBe('🀀');
  });

  it('花色判定', () => {
    expect(rcSuit(4)).toBe('m');
    expect(rcSuit(13)).toBe('p');
    expect(rcSuit(22)).toBe('s');
    expect(rcSuit(31)).toBe('z');
  });

  it('宝牌指示牌循环:9→1、北→东、中→白', () => {
    expect(rcDoraFace(rcParseFaces('4m')[0])).toBe(rcParseFaces('5m')[0]);
    expect(rcDoraFace(rcParseFaces('9m')[0])).toBe(rcParseFaces('1m')[0]);
    expect(rcDoraFace(rcParseFaces('9p')[0])).toBe(rcParseFaces('1p')[0]);
    expect(rcDoraFace(rcParseFaces('9s')[0])).toBe(rcParseFaces('1s')[0]);
    expect(rcDoraFace(27 + 3)).toBe(27); // 北 → 东
    expect(rcDoraFace(33)).toBe(31); // 中 → 白
    expect(rcDoraFace(31)).toBe(32); // 白 → 发
  });

  it('牌谱解析:红 5 与普通 5 区分', () => {
    const tiles = rcParseTiles('05m1z');
    expect(tiles).toHaveLength(3);
    expect(tiles[0]).toMatchObject({ face: 4, red: true });
    expect(tiles[1]).toMatchObject({ face: 4, red: false });
    expect(tiles[2]).toMatchObject({ face: 27, red: false });
    expect(tiles[0].id).not.toBe(tiles[1].id);
    expect(rcParseFaces('123m123p123s')).toEqual([0, 1, 2, 9, 10, 11, 18, 19, 20]);
    expect(() => rcParseTiles('0z')).toThrow();
    expect(() => rcParseTiles('8z')).toThrow();
  });
});
