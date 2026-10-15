/**
 * Offline app shell for the web app: the service worker (public/sw.js, asset list injected at
 * build time) serves the UI without a network, so a kiosk can restart while the server is down.
 * Not used inside the Android app (its files are local already) or in development.
 */
import { Capacitor } from '@capacitor/core';

export function registerServiceWorker() {
  if (!import.meta.env.PROD || Capacitor.isNativePlatform() || !('serviceWorker' in navigator)) return;
  const register = () =>
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((e) => console.warn('[kiosk] service worker not registered', e));
  // This module is loaded lazily, usually after the load event already fired.
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', () => void register(), { once: true });
}
