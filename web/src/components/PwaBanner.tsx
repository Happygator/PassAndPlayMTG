import { useEffect, useState } from 'preact/hooks';
import { useRegisterSW } from 'virtual:pwa-register/preact';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

const DISMISS_KEY = 'pwa-install-hint-dismissed';

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * Start-screen banner with two jobs: offer installation (native prompt on
 * Android/Chrome, Share-sheet instructions on iOS) and announce service-worker
 * updates with a reload button. Also asks the browser for persistent storage so
 * the precached app is less likely to be evicted (DESIGN.md C6).
 */
export function PwaBanner() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [hintDismissed, setHintDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === '1'
  );
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    navigator.storage?.persist?.().catch(() => undefined);
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (needRefresh) {
    return (
      <div class="pwa-banner">
        <span>A new version is available.</span>
        <button type="button" class="pwa-action" onClick={() => updateServiceWorker(true)}>
          Reload
        </button>
      </div>
    );
  }

  if (isStandalone() || hintDismissed) return null;

  if (installEvent) {
    return (
      <div class="pwa-banner">
        <span>Install for full-screen, offline play.</span>
        <button
          type="button"
          class="pwa-action"
          onClick={() => {
            installEvent.prompt().catch(() => undefined);
            setInstallEvent(null);
          }}
        >
          Install
        </button>
      </div>
    );
  }

  if (isIos()) {
    return (
      <div class="pwa-banner">
        <span>Install: tap Share, then "Add to Home Screen" for full-screen, offline play.</span>
        <button
          type="button"
          class="pwa-action"
          onClick={() => {
            localStorage.setItem(DISMISS_KEY, '1');
            setHintDismissed(true);
          }}
        >
          Got it
        </button>
      </div>
    );
  }

  return null;
}
