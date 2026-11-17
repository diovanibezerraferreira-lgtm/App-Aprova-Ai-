import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

const SW_RELOAD_GUARD_KEY = 'aprovadireito_sw_last_reload';
const SW_UPDATE_THROTTLE_MS = 30_000;
const SW_RELOAD_COOLDOWN_MS = 15_000;

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let hasTriggeredReload = false;
  let lastUpdateCheck = 0;

  const triggerSafeReload = () => {
    if (hasTriggeredReload) return;
    try {
      const lastReload = Number(sessionStorage.getItem(SW_RELOAD_GUARD_KEY) || '0');
      if (Date.now() - lastReload < SW_RELOAD_COOLDOWN_MS) {
        return;
      }
      sessionStorage.setItem(SW_RELOAD_GUARD_KEY, String(Date.now()));
    } catch {
      // Ignore sessionStorage restrictions in private/embedded contexts
    }
    hasTriggeredReload = true;
    window.location.reload();
  };

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) {
      triggerSafeReload();
    }
  });

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateSW(true).catch(() => {});
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      const checkForUpdate = () => {
        const now = Date.now();
        if (now - lastUpdateCheck < SW_UPDATE_THROTTLE_MS) return;
        lastUpdateCheck = now;
        registration.update().catch(() => {});
      };

      // Check shortly after startup and whenever user resumes the installed PWA
      setTimeout(checkForUpdate, 3_000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          checkForUpdate();
        }
      });
      window.addEventListener('online', checkForUpdate);
    },
  });
}

createRoot(document.getElementById('root')!).render(<App />);
