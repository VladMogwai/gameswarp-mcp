/**
 * Единственное место, где объявлены языки. Добавить язык — дописать сюда строку:
 * схема БД ключуется языком, а не колонками, миграции не потребуется.
 *
 * `steam` — код языка в API Steam (параметр `language` у отзывов, `l` у описаний).
 * Румынский сознательно отложен: отзывов на нём на Steam единицы сотен на игру,
 * а описания Steam на румынский не переводит — молча отдаёт английские.
 */
export const LANGUAGES = [
  { code: 'en', steam: 'english' },
  { code: 'ru', steam: 'russian' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

export function steamCode(code: LanguageCode): string {
  const found = LANGUAGES.find((l) => l.code === code);
  if (!found) throw new Error(`Неизвестный язык: ${code}`);
  return found.steam;
}
