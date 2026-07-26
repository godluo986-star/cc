/** 共享画面投大屏(media kind 'share')— 设计文档 §9.3:
 *  设置 → 广播 → 共享者停止共享/离开空间自动清屏。 */
import { describe, it, expect } from 'vitest';
import { testRig, lastOf } from './helpers';
import { handlers } from '../src/game/handlers';
import { SPACE, roomSpaceKey } from '@nexuspark/shared';

function cinemaRig() {
  const rig = testRig();
  const a = rig.mkSession('alice'); // 共享者
  const b = rig.mkSession('bob');   // 操作投屏的人
  for (const p of [a, b]) {
    rig.world.join(p.session, SPACE.PLAZA);
    p.session.x = 30; p.session.z = -17.4; // 影院门口
    handlers.switch_space(rig.world, p.session, { target: SPACE.CINEMA });
  }
  return { ...rig, a, b, cinema: rig.world.spaces.get(SPACE.CINEMA)! };
}

describe('share 投屏(共享画面上大屏)', () => {
  it('设置 share → 广播给全场 → 共享者停止共享自动清屏', () => {
    const { world, a, b, cinema } = cinemaRig();
    handlers.screen_share(world, a.session, { on: true });
    handlers.media_set(world, b.session, { shareOwnerId: a.session.id });

    expect(cinema.media!.kind).toBe('share');
    expect(cinema.media!.ownerId).toBe(a.session.id);
    expect(cinema.media!.url).toBe(null);
    expect(cinema.media!.setBy).toBe('bob');
    // 广播到达双方
    expect(lastOf(a.ws, 'media_state')?.d.kind).toBe('share');
    expect(lastOf(b.ws, 'media_state')?.d.kind).toBe('share');

    // 共享者关掉屏幕共享 → 大屏自动清空并广播
    handlers.screen_share(world, a.session, { on: false });
    expect(cinema.media!.kind).toBe(null);
    expect(cinema.media!.url).toBe(null);
    expect(lastOf(b.ws, 'media_state')?.d.kind).toBe(null);
  });

  it('共享者离开空间自动清屏并广播给留下的人', () => {
    const { world, a, b, cinema } = cinemaRig();
    handlers.screen_share(world, a.session, { on: true });
    handlers.media_set(world, b.session, { shareOwnerId: a.session.id });
    expect(cinema.media!.kind).toBe('share');

    world.leaveCurrent(a.session);
    expect(cinema.media!.kind).toBe(null);
    expect(lastOf(b.ws, 'media_state')?.d.kind).toBe(null);
  });

  it('拒绝不在场或未开共享的投屏目标', () => {
    const rig = cinemaRig();
    const { world, a, b, cinema } = rig;
    // a 在场但没开共享
    handlers.media_set(world, b.session, { shareOwnerId: a.session.id });
    expect(cinema.media!.kind).toBe(null);
    expect(lastOf(b.ws, 'toast')?.d.level).toBe('warn');
    // c 在别的空间开着共享:同样拒绝
    const c = rig.mkSession('carol');
    world.join(c.session, SPACE.PLAZA);
    handlers.screen_share(world, c.session, { on: true });
    handlers.media_set(world, b.session, { shareOwnerId: c.session.id });
    expect(cinema.media!.kind).toBe(null);
  });

  it('房间里投屏者本人即使无媒体控制权也能停掉自己的投屏', () => {
    const { world, mkSession } = testRig();
    const a = mkSession('alice'); // 房主(默认仅房主可控媒体)
    const b = mkSession('bob');   // 客人 = 共享者
    const key = roomSpaceKey(a.session.user.id);
    world.join(a.session, key);
    world.join(b.session, key);
    const sp = world.spaces.get(key)!;
    handlers.screen_share(world, b.session, { on: true });
    // 客人自己没有控制权,投不了
    handlers.media_set(world, b.session, { shareOwnerId: b.session.id });
    expect(sp.media!.kind).toBe(null);
    // 房主把客人的画面投上大屏
    handlers.media_set(world, a.session, { shareOwnerId: b.session.id });
    expect(sp.media!.kind).toBe('share');
    expect(sp.media!.ownerId).toBe(b.session.id);
    // 共享者本人可以停止自己的投屏
    handlers.media_ctrl(world, b.session, { op: 'clear' });
    expect(sp.media!.kind).toBe(null);
  });

  it('share 是临时状态:空间重载后不从数据库恢复', () => {
    const { world, a, b, cinema } = cinemaRig();
    handlers.screen_share(world, a.session, { on: true });
    handlers.media_set(world, b.session, { shareOwnerId: a.session.id });
    expect(cinema.media!.kind).toBe('share'); // 已落盘(broadcastMedia → saveMedia)
    world.spaces.delete(SPACE.CINEMA);
    const reloaded = world.getSpace(SPACE.CINEMA)!;
    expect(reloaded.media!.kind).toBe(null);
    expect(reloaded.media!.url).toBe(null);
  });
});
