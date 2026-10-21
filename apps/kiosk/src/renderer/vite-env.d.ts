/// <reference types="vite/client" />

/** Kiosk app version (package.json), injected at build time. */
declare const __KIOSK_VERSION__: string;
/** Server suggested on the setup screen of the Windows and Android apps (vite.config.ts); may be empty. */
declare const __KIOSK_DEFAULT_SERVER__: string;
/** true for the web app / Android build (vite --mode web). */
declare const __KIOSK_WEB__: boolean;
