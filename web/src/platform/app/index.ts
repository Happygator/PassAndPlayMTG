import type { FunctionComponent } from 'preact';
import type { CardData } from '../../types';
import type { PlatformCapabilities, PlatformTransport, RemoteImageSrc } from '../types';

export const capabilities = {
  cardSizeControl: true,
  pinchZoom: false,
  cubeLibrary: true,
  messaging: false,
} as const satisfies PlatformCapabilities;

/** Nothing to install: this IS the installed app. */
export const InstallBanner: FunctionComponent = () => null;

// Cube cards ship in the bundle; constructed-mode and sealed cards are fetched
// from Scryfall at runtime, so their imagePath is already absolute.
export const cardImageSrc = (card: CardData): string =>
  /^https?:\/\//.test(card.imagePath) ? remoteImageSrc(card.imagePath) : `./${card.imagePath}`;

/** Scryfall's image CDN. The only host the native handler will fetch from. */
const SCRYFALL_IMAGES = 'https://cards.scryfall.io/';

/**
 * Hand card art to the native disk cache in `ios/App/App/CardImageCache.swift`
 * instead of letting the WebView hot-link it.
 *
 * The swap is a rewrite rather than a fetch because this has to stay
 * synchronous: it is called from inside `<img src={...}>`, so there is nowhere
 * to await. `cardcache://cards.scryfall.io/<path>` names an image the native
 * side then redeems — from the App Group container if it has been seen before,
 * otherwise from Scryfall with the descriptive User-Agent and the ~10 req/s
 * ceiling their API guidelines ask for.
 *
 * The host is carried through verbatim so the native allowlist is a plain
 * comparison, and so a non-Scryfall URL falls through untouched.
 */
export const remoteImageSrc: RemoteImageSrc = (url) =>
  url.startsWith(SCRYFALL_IMAGES)
    ? `cardcache://cards.scryfall.io/${url.slice(SCRYFALL_IMAGES.length)}`
    : url;

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
