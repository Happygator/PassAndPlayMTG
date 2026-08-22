import type { FunctionComponent } from 'preact';
import { PwaBanner } from '../../components/PwaBanner';
import type { CardData } from '../../types';
import type { PlatformCapabilities } from '../types';

export const capabilities = {
  // Pinch-zoom and the size control do different jobs: zoom magnifies ONE card
  // and then you pan back out, while the size control reflows the grid and
  // stays. Scanning a 45-card pool wants the second. Both are available here.
  cardSizeControl: true,
  pinchZoom: true,
  cubeLibrary: false,
  messaging: false,
} as const satisfies PlatformCapabilities;

/** Install prompt and service-worker update toast. Web channel only. */
export const InstallBanner: FunctionComponent = PwaBanner;

/** Bundle-relative: every card ships inside the deployed site. */
export const cardImageSrc = (card: CardData): string => `./${card.imagePath}`;
