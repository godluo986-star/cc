/**
 * 抓取(单人抓单团子)参数 —— 双端同源常量。
 * 【双方共享契约 —— 逐字实现,不得偏离】客户端与服务器都只从这里取值。
 */
/** 发起抓取的最大距离(m);服务器同样以此校验,防远距吸人。 */
export const GRAB_RANGE = 2.2;
/** 把持点距抓取者的最小水平距离(m)。 */
export const HOLD_MIN = 0.9;
/** 把持点距抓取者的最大水平距离(m)。 */
export const HOLD_MAX = 2.6;
/** 点质量弹簧刚度(服务器 tick 积分用)。 */
export const SPRING_K = 26;
/** 弹簧阻尼。 */
export const DAMPING = 6.5;
/** 弹簧力上限(N,MASS=1 时即加速度上限)。 */
export const MAX_FORCE = 60;
/** 被抓者与把持点距离超过此值即判定拉断(m)。 */
export const BREAK_DIST = 3.4;
/** 挣扎积累秒数达到即挣脱。 */
export const ESCAPE_BREAK = 2.2;
/** 最大举高(相对抓取者脚底,m)。 */
export const LIFT_MAX = 2.2;
/** 点质量(kg,归一)。 */
export const MASS = 1;
/** 拖着人移动时抓取者的速度倍率。 */
export const GRABBER_SLOW = 0.55;
/** 被抓者模拟速度上限(m/s)。 */
export const MAX_VEL = 9;
