/** Suggestions for the "what language will you speak" step. Free text is allowed. */
export const LANGUAGE_SUGGESTIONS = [
  "English", "Spanish", "Portuguese", "French", "Tagalog", "Cebuano", "Ilocano", "Swahili",
  "Korean", "Japanese", "Mandarin Chinese", "Cantonese", "Vietnamese", "Thai", "Indonesian",
  "Hindi", "Samoan", "Tongan", "German", "Italian", "Russian", "Ukrainian", "Arabic",
];

export function normalizeLanguage(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/** The single active area whose language matches, or null when none or several match. */
export function areaForLanguage<T extends { id: string; language: string }>(areas: T[], language: string): T | null {
  const key = normalizeLanguage(language).toLowerCase();
  if (!key) return null;
  const matches = areas.filter((a) => a.language.trim().toLowerCase() === key);
  return matches.length === 1 ? matches[0] : null;
}
