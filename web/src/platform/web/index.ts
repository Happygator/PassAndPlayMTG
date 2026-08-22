import type { FunctionComponent } from 'preact';
import { PwaBanner } from '../../components/PwaBanner';
import type { CardData } from '../../types';
import type { PlatformCapabilities } from '../types';

export const capabilities = {
  cardSizeControl: false,
  pinchZoom: true,
  cubeLibrary: false,
  messaging: false,
} as const satisfies PlatformCapabilities;

/** Install prompt and service-worker update toast. Web channel only. */
export const InstallBanner: FunctionComponent = PwaBanner;

/** Bundle-relative: every card ships inside the deployed site. */
export const cardImageSrc = (card: CardData): string => `./${card.imagePath}`;
