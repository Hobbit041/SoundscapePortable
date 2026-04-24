/**
 * pathUtils.js — pure-renderer helpers for converting local paths to URLs.
 *
 * Replaces the `window.api.fs.toUrl` IPC round-trip with a synchronous
 * string transform. Saves an IPC hop per playlist item (matters for
 * large playlists loaded in a tight `Promise.all`).
 */

/**
 * Convert an absolute local path to a `file://` URL usable by <audio>/<img>.
 * Passes through any existing URL (http:, https:, file:, blob:, data:).
 * Returns '' for falsy input.
 */
export function pathToUrl(p) {
  if (!p) return '';
  if (/^(https?:|file:|blob:|data:)/i.test(p)) return p;
  return 'file:///' + p.replace(/\\/g, '/').replace(/^\//, '');
}
