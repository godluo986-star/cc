/** NPC dialogue trees. Actions are resolved by the world before replying. */

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
      text: (c) => `Hey ${c.username}, welcome to Nexus Park! First time here?`,
      options: [
        { id: 'tour', label: 'What is there to do?', next: 'tour' },
        { id: 'controls', label: 'How do I get around?', next: 'controls' },
        { id: 'bye', label: 'Just passing through.', next: 'bye' },
      ],
    },
    tour: {
      text: 'The café serves coffee and has a jukebox. The cinema plays synced videos — anyone can queue one. The arcade has real two-player machines, and the tower elevator takes you to residents\' rooms. Yours included!',
      options: [
        { id: 'rooms', label: 'I have a room?', next: 'rooms' },
        { id: 'thanks', label: 'Thanks!', action: 'end' },
      ],
    },
    rooms: {
      text: 'Every resident gets one. Enter the tower behind me, take the elevator, and pick your name. You can redecorate everything and invite friends — or lock it, your call.',
      options: [{ id: 'ok', label: 'On my way.', action: 'end' }],
    },
    controls: {
      text: 'WASD to walk, Shift to run, Space to jump. Press E on anything that glows. Enter opens chat, and the buttons bottom-right do emotes, voice and settings.',
      options: [
        { id: 'more', label: 'What else?', next: 'tour' },
        { id: 'ok', label: 'Got it.', action: 'end' },
      ],
    },
    bye: {
      text: 'Enjoy the plaza! Come find me if you get lost.',
      options: [{ id: 'ok', label: 'Bye!', action: 'end' }],
    },
  },

  walker: {
    root: {
      text: (c) =>
        c.weather === 'rain'
          ? 'Lovely rain today, isn\'t it? The pond fills right up. I still do my loop — a little water never hurt.'
          : c.isNight
            ? 'Beautiful night for a stroll. The lamps around the fountain came on a while ago — my favourite hour.'
            : 'Perfect day for a walk around the park. Have you crossed the little bridge by the pond yet?',
      options: [
        { id: 'route', label: 'Do you walk here often?', next: 'route' },
        { id: 'bye', label: 'Enjoy your walk!', action: 'end' },
      ],
    },
    route: {
      text: 'Every day, rain or shine. Fountain, park, bridge, and back. Try the picnic table on the west lawn — best spot to watch the sunset.',
      options: [{ id: 'ok', label: 'I will, thanks.', action: 'end' }],
    },
  },

  barista: {
    root: {
      text: (c) => `Welcome to The Daily Grind, ${c.username}! Freshly ground, virtually roasted. What can I get you?`,
      options: [
        { id: 'coffee', label: 'Coffee, please. (5 cr)', action: 'buy_coffee' },
        { id: 'ask', label: 'What do you recommend?', next: 'recommend' },
        { id: 'no', label: 'Just looking, thanks.', next: 'bye' },
      ],
    },
    recommend: {
      text: 'The house espresso, no contest. And if you like music, put something on the jukebox by the window — the regulars love the Café Waltz.',
      options: [
        { id: 'coffee', label: 'Sold — one coffee. (5 cr)', action: 'buy_coffee' },
        { id: 'no', label: 'Maybe later.', next: 'bye' },
      ],
    },
    coffee_ok: {
      text: 'Here you go — careful, it\'s hot! Press the item in your inventory to hold it.',
      options: [{ id: 'ok', label: 'Thanks!', action: 'end' }],
    },
    coffee_broke: {
      text: (c) => `Ah — you're at ${c.credits} credits, and coffee is 5. Come back after the daily bonus, it's on the house then... kidding, it's never on the house.`,
      options: [{ id: 'ok', label: 'Fair enough.', action: 'end' }],
    },
    bye: {
      text: 'Take a seat anywhere, the sofa by the fireplace is the cozy one.',
      options: [{ id: 'ok', label: 'Will do.', action: 'end' }],
    },
  },

  shopkeeper: {
    root: {
      text: 'Welcome to the General Store. Vending machines are self-service; the kiosk in the middle sells furniture unlocks for your room.',
      options: [
        { id: 'unlock', label: 'How do unlocks work?', next: 'unlock' },
        { id: 'credits', label: 'How do I earn credits?', next: 'credits' },
        { id: 'bye', label: 'Thanks, just browsing.', action: 'end' },
      ],
    },
    unlock: {
      text: 'Pay once at the kiosk, then place that furniture in your room as often as you like. The aquarium is my best seller — the fish are hypnotic.',
      options: [{ id: 'ok', label: 'Good to know.', action: 'end' }],
    },
    credits: {
      text: 'Everyone gets a daily bonus for logging in. Spend it on snacks, coffee, or save up for the big-screen TV. No loot boxes in this town.',
      options: [{ id: 'ok', label: 'Respect.', action: 'end' }],
    },
  },
};

export function resolveDialogueNode(dialogueId: string, nodeId: string): DNode | null {
  return DIALOGUES[dialogueId]?.[nodeId] ?? null;
}
