/**
 * i18n/languages.js
 * The 20 languages Drift ships in, roughly by number of speakers. `code` is
 * what the catalogs, the picker and the native extensions key on; `native` is
 * the name shown in the picker (a language should be findable by someone who
 * can't read English). `rtl` marks right-to-left scripts.
 */
export const LANGUAGES = [
  { code: "en",      name: "English",               native: "English" },
  { code: "zh-Hans", name: "Chinese (Simplified)",  native: "简体中文" },
  { code: "zh-Hant", name: "Chinese (Traditional)", native: "繁體中文" },
  { code: "hi",      name: "Hindi",                 native: "हिन्दी" },
  { code: "es",      name: "Spanish",               native: "Español" },
  { code: "fr",      name: "French",                native: "Français" },
  { code: "ar",      name: "Arabic",                native: "العربية", rtl: true },
  { code: "pt",      name: "Portuguese",            native: "Português" },
  { code: "ru",      name: "Russian",               native: "Русский" },
  { code: "id",      name: "Indonesian",            native: "Bahasa Indonesia" },
  { code: "de",      name: "German",                native: "Deutsch" },
  { code: "ja",      name: "Japanese",              native: "日本語" },
  { code: "tr",      name: "Turkish",               native: "Türkçe" },
  { code: "vi",      name: "Vietnamese",            native: "Tiếng Việt" },
  { code: "ko",      name: "Korean",                native: "한국어" },
  { code: "it",      name: "Italian",               native: "Italiano" },
  { code: "pl",      name: "Polish",                native: "Polski" },
  { code: "uk",      name: "Ukrainian",             native: "Українська" },
  { code: "th",      name: "Thai",                  native: "ไทย" },
  { code: "nl",      name: "Dutch",                 native: "Nederlands" },
];

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);

/**
 * Best supported code for a BCP-47 tag like "pt-BR", "zh-Hant-TW", "zh-TW",
 * "nb-NO" → null when nothing matches.
 */
export function matchLanguage(tag) {
  if (!tag) return null;
  const t = String(tag).replace("_", "-");
  const lower = t.toLowerCase();
  if (lower.startsWith("zh")) {
    if (/hant|-tw|-hk|-mo/.test(lower)) return "zh-Hant";
    return "zh-Hans";
  }
  if (lower.startsWith("tl")) return "fil";
  if (lower.startsWith("iw")) return "he";
  if (lower.startsWith("in")) return "id";
  const base = lower.split("-")[0];
  return LANGUAGE_CODES.find((c) => c.toLowerCase() === base) || null;
}
