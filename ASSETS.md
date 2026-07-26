# Asset inventory & licenses

Nexus Park ships **no third-party binary assets**. Everything you see and
hear is generated at runtime from code in this repository.

## Graphics

| Asset | Source | License |
| --- | --- | --- |
| All 3D models (buildings, furniture, avatars, props) | Procedural geometry composed from Three.js primitives in `client/src/world3d/**` | Project license |
| Surface patterns (wood planks, tiles, marble, grass, paving, carpet) | Generated on `<canvas>` at runtime (`client/src/world3d/spaces/textures.ts`) | Project license |
| Signage, nametags, menu boards, arcade screens | Canvas-rendered text/drawings at runtime | Project license |
| UI icons | Unicode emoji rendered by the user's system font | System fonts |

The dango avatar is an original stylized dumpling character (sphere body,
dot eyes, blush, sprout) implemented from primitives in
`client/src/world3d/Avatar.tsx`. It is inspired by the general Japanese
dango motif; no third-party character art, models, names or other material
are included.

## Audio

| Asset | Source | License |
| --- | --- | --- |
| Sound effects (hops, chimes, doors, vending) | WebAudio oscillators/noise synthesis (`client/src/audio/engine.ts`) | Project license |
| Ambience (wind, rain, birds, crickets, room tone) | WebAudio synthesis, same file | Project license |
| Jukebox tracks ("Sunset Loop", "Neon Drive", "Café Waltz") | Note sequences + synthesis in `client/src/audio/music.ts`, composed for this project | Project license |

## Text content

| Content | Source | Status |
| --- | --- | --- |
| *Alice's Adventures in Wonderland* excerpt | Lewis Carroll, 1865 | Public domain |
| *The Road Not Taken* | Robert Frost, first published 1915 | Public domain |
| *A Dumpling's Guide to Nexus Park* | Written for this project | Project license |
| NPC dialogue | Written for this project (`server/src/game/dialogues.ts`) | Project license |

## Runtime-loaded third-party content

- **YouTube playback** uses the official YouTube IFrame Player API loaded
  from `youtube.com` at runtime, under YouTube's Terms of Service. Only
  standard embeds — no downloading, no restriction bypassing.
- **Website screens** embed user-provided URLs in sandboxed iframes. Sites
  that disallow embedding simply refuse to render.
- **Sample video URLs for testing synchronized playback**: the Blender
  Foundation's open movies are handy, e.g. Big Buck Bunny
  (`https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4`),
  © Blender Foundation, [CC-BY 3.0](https://peach.blender.org/about/) —
  referenced here for convenience, not bundled.
