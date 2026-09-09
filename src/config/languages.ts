/**
  * The single place where languages are declared. Adding one is a line here:
  * the schema is keyed by language rather than having per-language columns,
  * so no migration is needed.
  *
  * `steam` is the language code used by the Steam API (`language` for reviews,
  * `l` for store descriptions).
  *
  * Romanian is deliberately deferred: Steam holds only a few hundred Romanian
  * reviews per game against hundreds of thousands of English ones, and it does
  * not localise store descriptions to Romanian - it silently returns English.
  */
export const LANGUAGES = [
  { code: 'en', steam: 'english' },
  { code: 'ru', steam: 'russian' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

export function steamCode(code: LanguageCode): string {
  const found = LANGUAGES.find((l) => l.code === code);
  if (!found) throw new Error(`Unknown language: ${code}`);
  return found.steam;
}
