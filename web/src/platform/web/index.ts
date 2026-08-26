import type { FunctionComponent } from 'preact';
import { PwaBanner } from '../../components/PwaBanner';
import type { CardData } from '../../types';
import type { PlatformCapabilities, PlatformTransport } from '../types';

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
// Cube cards ship in the bundle; constructed-mode cards are fetched from
// Scryfall at runtime, so their imagePath is already absolute.
export const cardImageSrc = (card: CardData): string =>
  /^https?:\/\//.test(card.imagePath) ? card.imagePath : `./${card.imagePath}`;

/**
 * No refresh source: this channel IS the deployed site, so a bundle-relative
 * fetch is already the freshest copy there is (APP-MIGRATION.md section 7.3).
 */
export const dataBaseUrl: string | undefined = undefined;

/**
 * Transport stubs. This channel is a website: there is no conversation to
 * receive from or send to. They exist so shared code can call them without
 * asking which channel it is in (§4); with `messaging: false` the call sites
 * are compile-time dead and these tree-shake away.
 */
export const hasNativeBridge: PlatformTransport['hasNativeBridge'] = () => false;
export const receiveMessageState: PlatformTransport['receiveMessageState'] = () => null;
export const onIncomingState: PlatformTransport['onIncomingState'] = () => () => {};
export const sendMessageState: PlatformTransport['sendMessageState'] = () => '';
export const requestExpanded: PlatformTransport['requestExpanded'] = () => {};
export const onPresentationChange: PlatformTransport['onPresentationChange'] = () => () => {};
