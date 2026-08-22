import type { CardData } from './types';

/**
 * Resolve a card's stored image to something an <img src> can load.
 *
 * Bundled cards carry a bundle-relative path ("cards/<id>.jpg") and load as-is.
 * The app channel also stores imported cards in the device filesystem, where a
 * WebView cannot load a raw file:// path and it must go through
 * Capacitor.convertFileSrc(); that channel replaces this module. Route every
 * card <img> through here so the two channels differ in one file rather than at
 * six call sites.
 */
export function cardImageSrc(card: CardData): string {
  return `./${card.imagePath}`;
}

/** Back face of a double-faced card; null when the card has a single face. */
export function cardBackImageSrc(card: CardData): string | null {
  return card.backImagePath ? `./${card.backImagePath}` : null;
}
