import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

const root = createRoot(document.getElementById('root')!);

if (__KIOSK_WEB__) {
  // Web app / Android app: device setup + in-page core (not part of the Electron bundle).
  const WebBoot = lazy(() => import('./WebBoot').then((m) => ({ default: m.WebBoot })));
  root.render(
    <StrictMode>
      <Suspense fallback={null}>
        <WebBoot />
      </Suspense>
    </StrictMode>,
  );
  void import('./pwa').then((m) => m.registerServiceWorker());
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
