// Language codes the app ships (i18n/languages.js) → English names, for
// telling the model which language to write user-facing text in. Keep in sync
// with i18n/languages.js.
export const LANGUAGE_NAMES: Record<string, string> = {
  "en": "English",
  "zh-Hans": "Chinese (Simplified)",
  "zh-Hant": "Chinese (Traditional)",
  "hi": "Hindi",
  "es": "Spanish",
  "fr": "French",
  "ar": "Arabic",
  "pt": "Portuguese",
  "ru": "Russian",
  "id": "Indonesian",
  "de": "German",
  "ja": "Japanese",
  "tr": "Turkish",
  "vi": "Vietnamese",
  "ko": "Korean",
  "it": "Italian",
  "pl": "Polish",
  "uk": "Ukrainian",
  "th": "Thai",
  "nl": "Dutch",
};

/** "" for English or an unknown code, else an instruction line for the prompt. */
export function replyLanguageLine(code: unknown, fields: string): string {
  const name = LANGUAGE_NAMES[String(code || "")];
  if (!name || name === "English") return "";
  return `Write ${fields} in ${name}. Keep the JSON keys and enum values in English.\n`;
}
