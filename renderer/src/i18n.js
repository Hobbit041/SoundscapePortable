/**
 * i18n.js — minimal localization module.
 *
 * Usage:
 *   await initI18n();            // call once at startup
 *   t('header.winClose')         // → "Закрыть"
 *   t('mixer.channelNamePlaceholder', { n: 1 })  // → "Канал 1"
 *   tFileCount(3)                // → "3 файла"
 */

let _strings = {};

/** Load the active locale via IPC (main process reads translations/ru.json). */
export async function initI18n() {
  _strings = await window.api.getI18n() ?? {};
}

/**
 * Translate a dot-notation key, substituting {var} placeholders.
 * Returns the key itself when no translation is found (safe fallback).
 */
export function t(dotPath, vars = {}) {
  const val = dotPath.split('.').reduce((o, k) => o?.[k], _strings);
  if (val == null || typeof val !== 'string') return dotPath;
  const keys = Object.keys(vars);
  if (!keys.length) return val;
  return val.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/**
 * Russian plural for a file count.
 * Uses keys channelConfig.fileCount / fileCountFew / fileCountMany.
 */
export function tFileCount(n) {
  if (n % 100 >= 11 && n % 100 <= 19) return t('channelConfig.fileCountMany', { n });
  const r = n % 10;
  if (r === 1) return t('channelConfig.fileCount',     { n });
  if (r >= 2 && r <= 4) return t('channelConfig.fileCountFew',  { n });
  return t('channelConfig.fileCountMany', { n });
}
