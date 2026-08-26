/**
 * Launch-time data refresh (APP-MIGRATION.md section 7.3).
 *
 * The banlist is a build-time scrape and the booster set list a build-time
 * MTGJSON sync, so in a store binary both freeze on the day it ships. Without
 * this, a banlist change or a newly printed set would need an App Store review
 * round to reach anyone -- days of latency for a data change that costs a
 * redeploy on the web.
 *
 * So the native channels try the deployed site first and fall back to the copy
 * inside the bundle. The web channel IS that site, so its `dataBaseUrl` is
 * undefined and every fetch here is exactly the fetch it was before.
 *
 * Deliberately not cached across calls: the callers (`loadCatalogue`,
 * `loadBoosterIndex`) already memoise their results for the life of the page,
 * so this runs at most once per file per launch.
 */
import { dataBaseUrl } from '@platform';

/**
 * How long a refresh may take before the bundled copy is used instead.
 *
 * A game must never be held up by a slow network -- someone opening the app on
 * a train has a complete, playable copy of this data already on the device, and
 * a stale banlist is enormously better than a spinner.
 */
const REFRESH_TIMEOUT_MS = 3000;

/**
 * Fetch a data file, preferring a fresher copy from the deployed site.
 *
 * `path` is bundle-relative, exactly as the callers already write it
 * ('./banlist/3cb-official.json'). Any failure of the remote attempt -- offline,
 * timeout, 404, a proxy returning HTML -- falls through to the bundled copy
 * silently, because there is nothing the player could do about it and nothing
 * they need to know.
 */
export async function fetchData(path: string): Promise<Response> {
  if (dataBaseUrl) {
    const remote = dataBaseUrl.replace(/\/$/, '') + '/' + path.replace(/^\.\//, '');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
      try {
        const response = await fetch(remote, { signal: controller.signal });
        if (response.ok) return response;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // Fall through to the bundled copy.
    }
  }
  return fetch(path);
}
