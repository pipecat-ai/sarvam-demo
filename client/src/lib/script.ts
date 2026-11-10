/** Devanagari block: Hindi (and Marathi, Nepali…) as Sarvam writes it. */
const DEVANAGARI = /[ऀ-ॿ]/

/**
 * The `lang` to put on a transcript line: "hi" when it carries Devanagari,
 * so the Hindi line height applies and screen readers switch voice;
 * otherwise undefined, inheriting the page's English.
 */
export function textLang(text: string): "hi" | undefined {
  return DEVANAGARI.test(text) ? "hi" : undefined
}
