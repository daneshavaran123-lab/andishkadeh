/// <reference types="vite/client" />

/** Kiosk app version (package.json), injected at build time. */
declare const __KIOSK_VERSION__: string;
/** true for the web app / Android build (vite --mode web). */
declare const __KIOSK_WEB__: boolean;
