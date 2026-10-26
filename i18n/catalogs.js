/**
 * i18n/catalogs.js
 * Lazy catalog loaders. Metro only evaluates a module when its require() runs,
 * so only the active language is ever parsed. English has no catalog: the
 * keys are English.
 */
export const CATALOGS = {
  "zh-Hans": () => require("./locales/zh-Hans.json"),
  "zh-Hant": () => require("./locales/zh-Hant.json"),
  "hi": () => require("./locales/hi.json"),
  "es": () => require("./locales/es.json"),
  "fr": () => require("./locales/fr.json"),
  "ar": () => require("./locales/ar.json"),
  "pt": () => require("./locales/pt.json"),
  "ru": () => require("./locales/ru.json"),
  "id": () => require("./locales/id.json"),
  "de": () => require("./locales/de.json"),
  "ja": () => require("./locales/ja.json"),
  "tr": () => require("./locales/tr.json"),
  "vi": () => require("./locales/vi.json"),
  "ko": () => require("./locales/ko.json"),
  "it": () => require("./locales/it.json"),
  "pl": () => require("./locales/pl.json"),
  "uk": () => require("./locales/uk.json"),
  "th": () => require("./locales/th.json"),
  "nl": () => require("./locales/nl.json"),
};
