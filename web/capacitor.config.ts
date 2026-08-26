import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor container app (APP-MIGRATION.md M7).
 *
 * `appId` is PERMANENT. It is the primary key of the App Store Connect record,
 * the thing provisioning profiles and TestFlight hang off, and the parent of
 * the Messages extension's own id (com.happygator.passandplay.MessagesExtension,
 * section 6.1). It cannot be changed after the first upload without creating a
 * new app record, so it is not a thing to tidy up later.
 *
 * `webDir` is the APP channel's output, never `dist/`: the website bundle
 * registers a service worker and expects to be served from a repository
 * sub-path, neither of which is true inside a native shell.
 */
const config: CapacitorConfig = {
  appId: 'com.happygator.passandplay',
  // Xcode uses this for the generated project and product name. The
  // user-facing home-screen name is CFBundleDisplayName, set separately once
  // the store name is chosen (section 10), so this one only has to be stable.
  appName: 'Pass and Play',
  webDir: 'dist-app',
  ios: {
    // The app already pads itself with env(safe-area-inset-*) in style.css, so
    // the WebView must not inset the content a second time. Verify on device at
    // M7: getting this wrong shows up as doubled padding, not as a crash.
    contentInset: 'never',
  },
};

export default config;
