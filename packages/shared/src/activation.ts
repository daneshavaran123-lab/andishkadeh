import { normalizeDigits } from './format';

/**
 * One-time activation code for connecting a kiosk (A15): 8 digits issued in the panel, valid for a
 * short time and used once. The kiosk exchanges it for its id and a fresh key (POST /kiosk/activate),
 * so nobody types or copies the long device key. It travels as the code itself, or as a link to the
 * server's web app with ?activate=<code>: opened on a tablet, pasted, or read from its QR code by a
 * tablet camera or by the kiosk's own scanner.
 */
export const ACTIVATION_CODE_LENGTH = 8;
export const ACTIVATION_PARAM = 'activate';
/** How long a code stays usable after the panel issued it. */
export const ACTIVATION_MINUTES = 30;

/**
 * A keyboard-wedge scanner types what the keys would give on the active keyboard layout: with a
 * Persian layout a scanned link arrives in Persian letters. Same keys on the standard and the legacy
 * Windows Persian layouts.
 */
const PERSIAN_KEYS: Record<string, string> = {
  ض: 'q', ص: 'w', ث: 'e', ق: 'r', ف: 't', غ: 'y', ع: 'u', ه: 'i', خ: 'o', ح: 'p', ج: '[', چ: ']',
  ش: 'a', س: 's', ی: 'd', ي: 'd', ب: 'f', ل: 'g', ا: 'h', ت: 'j', ن: 'k', م: 'l', ک: ';', ك: ';', گ: "'",
  ظ: 'z', ط: 'x', ز: 'c', ر: 'v', ذ: 'b', د: 'n', پ: 'm', و: ',', '؟': '?',
};

function fromPersianLayout(s: string): string {
  return [...s].map((c) => PERSIAN_KEYS[c] ?? c).join('');
}

/** The 8 digits of a typed code ("1234 5678", or in Persian digits from a Persian keyboard), or null. */
export function normalizeActivationCode(input: string): string | null {
  const digits = normalizeDigits(input).replace(/[\s\-_.]/g, '');
  return digits.length === ACTIVATION_CODE_LENGTH && /^\d+$/.test(digits) ? digits : null;
}

/** "1234 5678": easier to read out and type. */
export function formatActivationCode(code: string): string {
  return `${code.slice(0, 4)} ${code.slice(4)}`;
}

/** The link that activates the browser opening it (and the QR code's contents). */
export function activationLink(serverUrl: string, code: string): string {
  return `${serverUrl.replace(/\/+$/, '')}/?${ACTIVATION_PARAM}=${code}`;
}

/** What the setup screen was given: a code (the server comes from the screen) or a link (it carries the server). */
export function parseActivationInput(input: string): { code: string; serverUrl: string | null } | null {
  const text = input.replace(/[\r\n\t]/g, '').trim();
  const code = normalizeActivationCode(text);
  if (code) return { code, serverUrl: null };
  for (const candidate of [text, fromPersianLayout(text)]) {
    try {
      const url = new URL(normalizeDigits(candidate));
      if (!/^https?:$/.test(url.protocol)) continue;
      const linked = normalizeActivationCode(url.searchParams.get(ACTIVATION_PARAM) ?? '');
      if (linked) return { code: linked, serverUrl: url.origin + url.pathname.replace(/\/+$/, '') };
    } catch {
      // not a link
    }
  }
  return null;
}
