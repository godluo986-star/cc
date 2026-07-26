/** In-world reading material. Public-domain texts + original writing; see
 *  ASSETS.md for licensing details. */
export interface Book {
  id: string;
  title: string;
  subtitle: string;
  attribution: string;
  pages: string[];
}

export const BOOKS: Book[] = [
  {
    id: 'alice',
    title: 'Alice in Wonderland (excerpt)',
    subtitle: 'Lewis Carroll, 1865',
    attribution: 'Public domain. From "Alice\'s Adventures in Wonderland" by Lewis Carroll (1865), Chapter I.',
    pages: [
      `Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, "and what is the use of a book," thought Alice "without pictures or conversations?"

So she was considering in her own mind (as well as she could, for the hot day made her feel very sleepy and stupid), whether the pleasure of making a daisy-chain would be worth the trouble of getting up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her.`,
      `There was nothing so very remarkable in that; nor did Alice think it so very much out of the way to hear the Rabbit say to itself, "Oh dear! Oh dear! I shall be late!" (when she thought it over afterwards, it occurred to her that she ought to have wondered at this, but at the time it all seemed quite natural); but when the Rabbit actually took a watch out of its waistcoat-pocket, and looked at it, and then hurried on, Alice started to her feet, for it flashed across her mind that she had never before seen a rabbit with either a waistcoat-pocket, or a watch to take out of it, and burning with curiosity, she ran across the field after it, and fortunately was just in time to see it pop down a large rabbit-hole under the hedge.

In another moment down went Alice after it, never once considering how in the world she was to get out again.`,
    ],
  },
  {
    id: 'frost',
    title: 'The Road Not Taken',
    subtitle: 'Robert Frost, 1915',
    attribution: 'Public domain (first published 1915).',
    pages: [
      `Two roads diverged in a yellow wood,
And sorry I could not travel both
And be one traveler, long I stood
And looked down one as far as I could
To where it bent in the undergrowth;

Then took the other, as just as fair,
And having perhaps the better claim,
Because it was grassy and wanted wear;
Though as for that the passing there
Had worn them really about the same,`,
      `And both that morning equally lay
In leaves no step had trodden black.
Oh, I kept the first for another day!
Yet knowing how way leads on to way,
I doubted if I should ever come back.

I shall be telling this with a sigh
Somewhere ages and ages hence:
Two roads diverged in a wood, and I—
I took the one less traveled by,
And that has made all the difference.`,
    ],
  },
  {
    id: 'dango-guide',
    title: 'A Dumpling\'s Guide to Nexus Park',
    subtitle: 'The management, this year',
    attribution: 'Original text written for Nexus Park (same license as the project).',
    pages: [
      `Welcome, little dumpling!

You have bounced your way into Nexus Park, a town square that never quite sleeps (it does dim the lamps around midnight, though — very cozy).

A few tips from those who rolled here before you:

• The café pours a mean espresso. Ask Bea. Tell her the jukebox misses her.
• The cinema screen belongs to everyone. Queue something nice; you can always
  pause it if the plot gets too intense for the front row.`,
      `• The arcade's VERSUS machine has ended friendships. The Lights Out record
  holder checks the board every day. You could ruin their week.
• Your room in Nexus Tower is truly yours: paint the walls, hoard aquariums,
  leave notes on your computer for guests to find.
• When it rains, the pond gets excited and so does Milo. Say hi to him on
  the little bridge.

Bounce responsibly,
— The management`,
    ],
  },
];
