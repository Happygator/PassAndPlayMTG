import type { FunctionComponent } from 'preact';
import type { CardData } from '../../types';
import type { PlatformCapabilities, PlatformTransport } from '../types';

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
// Cube cards ship in the bundle; constructed-mode cards are fetched from
// Scryfall at runtime, so their imagePath is already absolute.
export const cardImageSrc = (card: CardData): string =>
  /^https?:\/\//.test(card.imagePath) ? card.imagePath : `./${card.imagePath}`;

/**
 * Where the banlist and set list are re-fetched from at launch
 * (APP-MIGRATION.md section 7.3). This is the app's only server, and it is a
 * static file host that already exists.
 */
export const dataBaseUrl: string | undefined = 'https://happygator.github.io/PassAndPlayMTG/';

/**
 * Transport stubs. The container app has no conversation either: it is the
 * home-screen app, and the extension is the channel that talks to Messages.
 * They exist so shared code can call them without asking which channel it is
 * in (§4); with `messaging: false` the call sites are compile-time dead and
 * these tree-shake away.
 */
export const hasNativeBridge: PlatformTransport['hasNativeBridge'] = () => false;
export const receiveMessageState: PlatformTransport['receiveMessageState'] = () => null;
export const onIncomingState: PlatformTransport['onIncomingState'] = () => () => {};
export const sendMessageState: PlatformTransport['sendMessageState'] = () => '';
export const requestExpanded: PlatformTransport['requestExpanded'] = () => {};
export const onPresentationChange: PlatformTransport['onPresentationChange'] = () => () => {};
