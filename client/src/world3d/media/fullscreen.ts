/**
 * Fullscreen media viewer open/closed state. Lives in its own tiny store so
 * both the media panel (UI) and the in-world screen overlay can toggle it,
 * and FullscreenViewer can react — without touching the panel router.
 */
import { create } from 'zustand';

interface FullscreenMediaStore {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useFullscreenMedia = create<FullscreenMediaStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
