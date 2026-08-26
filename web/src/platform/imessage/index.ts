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
// Cube cards ship in the bundle; constructed-mode cards are fetched from
// Scryfall at runtime, so their imagePath is already absolute.
export const cardImageSrc = (card: CardData): string =>
  /^https?:\/\//.test(card.imagePath) ? card.imagePath : `./${card.imagePath}`;

/**
 * Same source as the container app (APP-MIGRATION.md section 7.3). The
 * extension is the channel most likely to be on a bad connection, which is
 * exactly why the bundled fallback is not optional.
 */
export const dataBaseUrl: string | undefined = 'https://happygator.github.io/PassAndPlayMTG/';

/**
 * Transport (APP-MIGRATION.md §6.5). Re-exported through `@platform` so shared
 * code never imports a channel directly -- the web and app channels export
 * inert versions of the same names.
 */
export {
  hasNativeBridge,
  onIncomingState,
  onPresentationChange,
  receiveMessageState,
  requestExpanded,
  sendMessageState,
} from './transport';
