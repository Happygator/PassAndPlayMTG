/**
 * The page side of the Swift bridge (APP-MIGRATION.md §6.5). Swift owns
 * transport and this file owns nothing else: it converts between the encoded
 * payload and the app's state, and it never decides when to send.
 *
 * The identifiers here mirror ios-src/MessagesViewController.swift exactly --
 * handler name `game`, an object body tagged with `type`, and the two globals
 * Swift calls into. A mismatch fails silently at runtime rather than at build
 * time, which is why they are named in one place instead of inline.
 */
import { decodeMessageState, encodeMessageState } from '../../messageState';
import type { MessageState } from '../../messageState';
import type { PlatformTransport } from '../types';

/** Matches `bridgeName` in MessagesViewController.swift. */
const BRIDGE = 'game';

interface BridgeBody {
  type: 'state' | 'expand';
  payload?: string;
  caption?: string;
}

interface BridgeWindow {
  webkit?: { messageHandlers?: Record<string, { postMessage: (body: BridgeBody) => void }> };
  __onMessageState?: (encoded: string) => void;
  __setPresentation?: (expanded: boolean) => void;
}

const bridgeWindow = (): BridgeWindow => window as unknown as BridgeWindow;

/**
 * True inside the real extension, false in a browser. Not a capability flag:
 * capabilities describe the CHANNEL at build time, while this describes whether
 * Swift is actually on the other end right now -- the imessage bundle runs in a
 * browser during development, where it is false.
 */
export function hasNativeBridge(): boolean {
  const handlers = bridgeWindow().webkit?.messageHandlers;
  return Boolean(handlers && handlers[BRIDGE]);
}

/**
 * State the extension opened with, if any. Two sources, in priority order:
 * the payload Swift injects, then the `s` query parameter -- which is how the
 * custom-scheme URL carries it, and also how two browser windows stand in for
 * two participants during development.
 *
 * Returns null for absent, malformed, or unknown-version payloads. A refused
 * payload must read as "no game here", never as a corrupt one.
 */
export function receiveMessageState(): MessageState | null {
  const param = new URLSearchParams(window.location.search).get('s');
  if (param) return decodeMessageState(param);
  return null;
}

/**
 * Subscribe to states arriving after load. Swift calls `__onMessageState` from
 * `willBecomeActive`, which fires every time the extension is presented -- not
 * only on first load -- so this cannot be a one-shot read.
 *
 * Returns an unsubscribe function that only clears the global if it is still
 * the one installed here.
 */
export function onIncomingState(handler: (state: MessageState) => void): () => void {
  const target = bridgeWindow();
  const listener = (encoded: string) => {
    const state = decodeMessageState(encoded);
    if (state) handler(state);
  };
  target.__onMessageState = listener;
  return () => {
    if (target.__onMessageState === listener) delete target.__onMessageState;
  };
}

/**
 * Hand a state to Swift to stage as a message, and return the encoded payload
 * so a browser harness can display it.
 *
 * `insert` STAGES: the player still has to tap send (APP-MIGRATION.md §6.2).
 * Nothing here can bypass that, and no code should assume the opponent has the
 * state merely because this returned.
 */
export function sendMessageState(state: MessageState, caption: string): string {
  const encoded = encodeMessageState(state);
  const handler = bridgeWindow().webkit?.messageHandlers?.[BRIDGE];
  if (handler) handler.postMessage({ type: 'state', payload: encoded, caption });
  return encoded;
}

/** Ask for the full sheet. Deck building is unusable in the compact tray. */
export function requestExpanded(): void {
  const handler = bridgeWindow().webkit?.messageHandlers?.[BRIDGE];
  if (handler) handler.postMessage({ type: 'expand' });
}

/**
 * Observe the presentation style Swift reports. The page cannot read it: only
 * the extension knows whether it is in the compact tray or expanded.
 */
export function onPresentationChange(handler: (expanded: boolean) => void): () => void {
  const target = bridgeWindow();
  const listener = (expanded: boolean) => handler(expanded);
  target.__setPresentation = listener;
  return () => {
    if (target.__setPresentation === listener) delete target.__setPresentation;
  };
}

/**
 * Compile-time proof that this channel implements the shared contract.
 *
 * The web and app stubs are each annotated with `PlatformTransport[...]`, so
 * THEY cannot drift. This is the real implementation, and without this it
 * could -- tsconfig pins `@platform` to the WEB channel for typechecking, so a
 * signature change here type-checks against nothing at all. An object literal
 * is the cheapest way to make that a compile error; it is erased by the
 * bundler because nothing reads it.
 */
const contract: PlatformTransport = {
  hasNativeBridge,
  onIncomingState,
  onPresentationChange,
  receiveMessageState,
  requestExpanded,
  sendMessageState,
};
void contract;
