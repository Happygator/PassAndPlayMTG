import type { FunctionComponent } from 'preact';
import type { CardData } from '../../types';
import type { PlatformCapabilities } from '../types';

export const capabilities = {
  cardSizeControl: true,
  pinchZoom: false,
  cubeLibrary: true,
  messaging: false,
} as const satisfies PlatformCapabilities;

/** Nothing to install: this IS the installed app. */
export const InstallBanner: FunctionComponent = () => null;

/**
 * M7 replaces this. Imported cards live in the App Group container and need
 * Capacitor.convertFileSrc(), because a WebView cannot load a raw file:// path;
 * bundled cards keep the relative path. Capacitor is not a dependency yet, so
 * this deliberately matches the web behaviour for now.
 */
export const cardImageSrc = (card: CardData): string => `./${card.imagePath}`;
