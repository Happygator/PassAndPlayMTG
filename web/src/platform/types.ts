import type { CardData } from '../types';
import type { MessageState } from '../messageState';

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

/**
 * The conversation transport (APP-MIGRATION.md section 6.5). Every channel must
 * export all six, because shared code calls them without knowing which channel
 * it is in; the non-messaging channels export inert versions that tree-shake
 * away behind `capabilities.messaging`.
 *
 * This interface exists because they drifted without it. The web and app stubs
 * were written with no parameters while the real implementation took two, and
 * nothing caught it until a call site in shared code failed to compile against
 * the web channel -- which is the channel `tsconfig.json` maps `@platform` to,
 * so it is the one typecheck always sees. `satisfies PlatformTransport` on each
 * channel makes that class of drift a compile error instead.
 */
export interface PlatformTransport {
  /** True only inside the real extension, where Swift injected its handler. */
  hasNativeBridge: () => boolean;
  /** State the channel opened with, if any. */
  receiveMessageState: () => MessageState | null;
  /** Subscribe to later deliveries; returns an unsubscribe. */
  onIncomingState: (handler: (state: MessageState) => void) => () => void;
  /** Hand a payload to the host to stage. Returns the encoded payload. */
  sendMessageState: (state: MessageState, caption: string) => string;
  /** Ask the host for the expanded presentation. */
  requestExpanded: () => void;
  /** Subscribe to presentation-style changes; returns an unsubscribe. */
  onPresentationChange: (handler: (expanded: boolean) => void) => () => void;
}
