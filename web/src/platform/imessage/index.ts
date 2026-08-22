import type { FunctionComponent } from 'preact';
import type { CardData } from '../../types';
import type { PlatformCapabilities } from '../types';

export const capabilities = {
  cardSizeControl: true,
  pinchZoom: false,
  // Read-only here: cubes are imported in the container app and reach the
  // extension through the App Group (APP-MIGRATION.md section 6.6).
  cubeLibrary: false,
  messaging: true,
} as const satisfies PlatformCapabilities;

/** Nothing to install: the extension ships inside the container app. */
export const InstallBanner: FunctionComponent = () => null;

/** M8 replaces this with the App Group path resolution. */
export const cardImageSrc = (card: CardData): string => `./${card.imagePath}`;
