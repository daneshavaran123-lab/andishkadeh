/** Escapes text for HTML written into print windows (values may come from kiosks or other admins). */
export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Prints a popup filled with document.write. The panel triggers it: the popup inherits the panel's
 * Content-Security-Policy, which blocks an inline <script> calling print().
 */
export function printWhenReady(w: Window) {
  w.document.close();
  w.focus();
  if (w.document.readyState === 'complete') w.print();
  else w.addEventListener('load', () => w.print(), { once: true });
}
