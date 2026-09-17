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
