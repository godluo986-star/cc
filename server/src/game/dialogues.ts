/** NPC 对话树。action 由 world 在回复前处理。 */

export interface DialogueOption {
  id: string;
  label: string;
  next?: string;
  action?: 'buy_coffee' | 'end';
}
export interface DNode {
  text: string | ((ctx: DialogueCtx) => string);
  options: DialogueOption[];
}
export interface DialogueCtx {
  username: string;
  credits: number;
  weather: string;
  isNight: boolean;
}

export const DIALOGUES: Record<string, Record<string, DNode>> = {
  greeter: {
    root: {
      text: (c) => `${c.username},欢迎来到团子广场!第一次来吗?`,
      options: [
        { id: 'tour', label: '这里有什么好玩的?', next: 'tour' },
        { id: 'controls', label: '怎么操作呀?', next: 'controls' },
        { id: 'bye', label: '随便逛逛。', next: 'bye' },
      ],
    },
    tour: {
      text: '咖啡馆有现磨咖啡和点歌机,还有象棋桌和福州麻将桌;电影院的大银幕谁都能点片;游戏厅有双人对战机;坐团子塔的电梯能拜访大家的房间——你自己也有一间哦!',
      options: [
        { id: 'rooms', label: '我也有房间?', next: 'rooms' },
        { id: 'thanks', label: '谢啦!', action: 'end' },
      ],
    },
    rooms: {
      text: '每位住户都有。去我身后的团子塔,坐电梯选你的名字。家具随便摆,墙纸随便刷,还能锁门谢客——你说了算。',
      options: [{ id: 'ok', label: '这就去!', action: 'end' }],
    },
    controls: {
      text: 'WASD 蹦跶,Shift 狂奔,空格跳跳。看到发光的东西就按 E。回车打字聊天,右下角的按钮是表情、语音和设置。',
      options: [
        { id: 'more', label: '还有呢?', next: 'tour' },
        { id: 'ok', label: '记住了。', action: 'end' },
      ],
    },
    bye: {
      text: '玩得开心!迷路了再来找我。',
      options: [{ id: 'ok', label: '拜拜!', action: 'end' }],
    },
  },

  walker: {
    root: {
      text: (c) =>
        c.weather === 'rain'
          ? '下雨天也很好呀,池塘都涨水了。我照样遛弯——淋点雨怕什么。'
          : c.isNight
            ? '夜里散步最舒服了。喷泉边的路灯刚亮,这是我最喜欢的时辰。'
            : '今天真适合在公园里转转。池塘上的小桥你走过了吗?',
      options: [
        { id: 'route', label: '你常在这儿散步?', next: 'route' },
        { id: 'bye', label: '慢走哦!', action: 'end' },
      ],
    },
    route: {
      text: '风雨无阻,每天一圈:喷泉、公园、小桥,再绕回来。西边草坪的野餐桌是看日落的最佳位置,别错过。',
      options: [{ id: 'ok', label: '一定去看看。', action: 'end' }],
    },
  },

  barista: {
    root: {
      text: (c) => `欢迎光临研磨咖啡馆,${c.username}!现磨现煮,虚拟烘焙。来点什么?`,
      options: [
        { id: 'coffee', label: '来杯咖啡。(5金币)', action: 'buy_coffee' },
        { id: 'ask', label: '有什么推荐?', next: 'recommend' },
        { id: 'no', label: '先看看。', next: 'bye' },
      ],
    },
    recommend: {
      text: '当然是本店浓缩,无可争议。喜欢音乐的话,窗边的点歌机放一首吧——常客们最爱《咖啡圆舞曲》。东边还有麻将桌,三缺一的时候常有人喊人。',
      options: [
        { id: 'coffee', label: '成交,来一杯。(5金币)', action: 'buy_coffee' },
        { id: 'no', label: '下次一定。', next: 'bye' },
      ],
    },
    coffee_ok: {
      text: '给,小心烫!在背包里点一下就能端在手上。',
      options: [{ id: 'ok', label: '谢谢!', action: 'end' }],
    },
    coffee_broke: {
      text: (c) => `哎呀,你只有 ${c.credits} 金币,咖啡要 5 个。明天领了每日奖励再来,到时候算你……原价,嘿嘿。`,
      options: [{ id: 'ok', label: '行吧。', action: 'end' }],
    },
    bye: {
      text: '随便坐!壁炉边的沙发最舒服。',
      options: [{ id: 'ok', label: '好嘞。', action: 'end' }],
    },
  },

  shopkeeper: {
    root: {
      text: '欢迎光临团子百货。贩卖机自助购买;中间的购买台可以解锁你房间用的家具。',
      options: [
        { id: 'unlock', label: '解锁是什么意思?', next: 'unlock' },
        { id: 'credits', label: '金币怎么赚?', next: 'credits' },
        { id: 'bye', label: '随便看看。', action: 'end' },
      ],
    },
    unlock: {
      text: '在购买台付一次钱,那件家具就永久解锁,想在房间里摆几件摆几件。水族箱卖得最好——鱼看久了会上瘾。',
      options: [{ id: 'ok', label: '懂了。', action: 'end' }],
    },
    credits: {
      text: '每天登录送金币;去麻将桌胡一把也有彩头。买零食、喝咖啡,或者攒着换巨幕电视。本店概不搞抽卡。',
      options: [{ id: 'ok', label: '良心。', action: 'end' }],
    },
  },
};

export function resolveDialogueNode(dialogueId: string, nodeId: string): DNode | null {
  return DIALOGUES[dialogueId]?.[nodeId] ?? null;
}
