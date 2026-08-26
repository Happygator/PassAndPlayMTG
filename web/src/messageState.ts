/**
 * The iMessage state channel (APP-MIGRATION.md section 6.3).
 *
 * A game travels between two phones inside `MSMessage.url`, so the entire
 * playable state has to survive a round trip through a string. This module owns
 * that string and nothing else: no Swift, no UI, no policy about when a message
 * is sent.
 *
 * The payload is deliberately the resume save (`SavedGame`) plus one field, so
 * a message and a save rehydrate through the same `restoreGame` path with the
 * same failure modes -- two features, one format.
 *
 * Trust model: this payload contains BOTH players' pools, and either device
 * could read the other's. That is accepted, not a defect (section 6.4) -- the
 * pass-and-play handoff screen was never a security boundary either. `revealed`
 * says whether the app may DISPLAY the opposing pool yet; it is a UI gate, not
 * a secret.
 */
import type { SavedGame } from './resume';

/**
 * Payload format version, independent of the save's `v`: the two formats share
 * a shape today but travel over different channels and may diverge. An update
 * can ship while a game is in flight, so an unknown version is refused rather
 * than guessed at.
 */
export const MESSAGE_VERSION = 1;

/** Query parameter carrying the payload in `MSMessage.url`. */
const STATE_PARAM = 's';

export interface MessageState extends SavedGame {
  /**
   * Whether the app may show the opposing pool. False until both players have
   * locked their decks; the cards are present in the payload either way.
   */
  revealed: boolean;
  /** Message format version. Shadows SavedGame's `v` deliberately. */
  v: number;
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * A Scryfall UUID as 22 base64url characters instead of 36 hex-and-dashes.
 *
 * Hand-rolled rather than via btoa: this runs in a WebView where the payload is
 * built on every message, and going through a binary string adds nothing. The
 * 16 bytes divide into five 24-bit groups plus a 4-bit remainder, so the last
 * character encodes the final nibble and there is no padding.
 */
export function packUuid(uuid: string): string {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error(`Not a Scryfall id: ${uuid}`);
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < 32; i += 2) {
    value = (value << 8) | parseInt(hex.slice(i, i + 2), 16);
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += B64_ALPHABET[(value >>> bits) & 0x3f];
    }
    value &= (1 << bits) - 1;
  }
  // 128 bits is not a multiple of 6: the trailing 2 bits become one more
  // character, left-aligned, so unpacking can drop them again.
  if (bits > 0) out += B64_ALPHABET[(value << (6 - bits)) & 0x3f];
  return out;
}

/** Inverse of packUuid. Throws on anything that is not 22 valid characters. */
export function unpackUuid(token: string): string {
  if (token.length !== 22) throw new Error(`Not a packed card id: ${token}`);
  let bits = 0;
  let value = 0;
  let hex = '';
  for (const ch of token) {
    const index = B64_ALPHABET.indexOf(ch);
    if (index < 0) throw new Error(`Not a packed card id: ${token}`);
    value = (value << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      hex += ((value >>> bits) & 0xff).toString(16).padStart(2, '0');
      value &= (1 << bits) - 1;
    }
  }
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** The payload as it is actually serialised: pools packed, everything else literal. */
interface WirePayload extends Omit<MessageState, 'poolIds'> {
  p: [string, string];
}

function toWire(state: MessageState): WirePayload {
  const { poolIds, ...rest } = state;
  return {
    ...rest,
    // One string per pool rather than an array of 22-character strings: JSON
    // would otherwise spend four bytes of quotes and commas on every card.
    p: [poolIds[0].map(packUuid).join(''), poolIds[1].map(packUuid).join('')],
  };
}

function splitPacked(packed: string): string[] {
  if (packed.length % 22 !== 0) throw new Error('Truncated pool in message payload.');
  const ids: string[] = [];
  for (let i = 0; i < packed.length; i += 22) ids.push(unpackUuid(packed.slice(i, i + 22)));
  return ids;
}

/** The payload as a URL-safe string, ready to hang off `MSMessage.url`. */
export function encodeMessageState(state: MessageState): string {
  return encodeURIComponent(JSON.stringify(toWire({ ...state, v: MESSAGE_VERSION })));
}

/**
 * Decode a payload. Returns null for anything unreadable -- wrong version,
 * malformed JSON, truncated pool -- because a conversation is exactly where a
 * payload from a newer build will turn up, and failing politely there is the
 * whole point of carrying a version (section 6.4).
 */
export function decodeMessageState(encoded: string): MessageState | null {
  let wire: unknown;
  try {
    wire = JSON.parse(decodeURIComponent(encoded)) as unknown;
  } catch {
    return null;
  }
  if (typeof wire !== 'object' || wire === null) return null;
  const payload = wire as Partial<WirePayload>;
  if (payload.v !== MESSAGE_VERSION) return null;
  if (!Array.isArray(payload.p) || payload.p.length !== 2) return null;
  if (typeof payload.p[0] !== 'string' || typeof payload.p[1] !== 'string') return null;
  if (typeof payload.revealed !== 'boolean') return null;
  if (typeof payload.config !== 'object' || payload.config === null) return null;
  if (typeof payload.phase !== 'object' || payload.phase === null) return null;
  let poolIds: [string[], string[]];
  try {
    poolIds = [splitPacked(payload.p[0]), splitPacked(payload.p[1])];
  } catch {
    return null;
  }
  const { p, ...rest } = payload;
  return { ...(rest as Omit<MessageState, 'poolIds'>), poolIds };
}

/** `MSMessage.url` for a game: the scheme is the extension's own, not the web's. */
export function messageStateToUrl(state: MessageState, base = 'passandplay://game'): string {
  return `${base}?${STATE_PARAM}=${encodeMessageState(state)}`;
}

/** Read a payload back out of `conversation.selectedMessage?.url`. */
export function messageStateFromUrl(url: string): MessageState | null {
  const query = url.slice(url.indexOf('?') + 1);
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    if (eq > 0 && pair.slice(0, eq) === STATE_PARAM) {
      return decodeMessageState(pair.slice(eq + 1));
    }
  }
  return null;
}
