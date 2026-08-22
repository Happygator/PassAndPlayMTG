import type { CardData } from '../types';

/**
 * Capability flags a channel declares. The `@platform` alias points at exactly
 * ONE channel per build, so `capabilities.x && <Thing />` is a compile-time
 * constant: UI for a capability a channel lacks is never shipped, not merely
 * hidden.
 */
export interface PlatformCapabilities {
  /** Show +/- buttons that scale card thumbnails (channels without pinch-zoom). */
  readonly cardSizeControl: boolean;
  /** Browser pinch-zoom is available, so no in-app size control is needed. */
  readonly pinchZoom: boolean;
  /** Cubes can be imported, edited and deleted at runtime (APP-MIGRATION.md section 7). */
  readonly cubeLibrary: boolean;
  /** Running inside a conversation: no handoff screen, both players vote. */
  readonly messaging: boolean;
}

/** Resolve a card's stored image to something an <img src> can load. */
export type CardImageSrc = (card: CardData) => string;
