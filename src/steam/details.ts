import { getJson, HttpError } from './http.js';
import { stripMarkup } from './markup.js';
import { DEFAULT_LANGUAGE, steamCode, type LanguageCode } from '../config/languages.js';
import { AppNotFoundError } from './news.js';

export interface GameDetails {
  appid: number;
  name: string;
  developers: string[];
  publishers: string[];
  releaseDate: Date | undefined;
  genres: string[];
  categories: string[];
  priceCents: number | undefined;
  isFree: boolean;
  shortDescription: string;
  detailedDescription: string;
  /** True when Steam answered a non-English locale with the English text. */
  isFallback: boolean;
}

interface RawDetails {
  name: string;
  developers?: string[];
  publishers?: string[];
  release_date?: { coming_soon: boolean; date: string };
  genres?: { description: string }[];
  categories?: { description: string }[];
  price_overview?: { final: number };
  is_free?: boolean;
  short_description?: string;
  detailed_description?: string;
}

type DetailsResponse = Record<string, { success: boolean; data?: RawDetails }>;

async function fetchRaw(appid: number, language: string): Promise<RawDetails> {
  const url =
    `https://store.steampowered.com/api/appdetails?appids=${appid}&l=${language}`;
  let response: DetailsResponse;
  try {
    response = await getJson<DetailsResponse>(url);
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) throw new AppNotFoundError(appid);
    throw error;
  }
  const entry = response[String(appid)];
  if (entry === undefined || !entry.success || entry.data === undefined) {
    throw new AppNotFoundError(appid);
  }
  return entry.data;
}

/**
 * Store metadata. This is the strictest Steam endpoint for request rate, so the
 * disk cache in the HTTP client matters more here than anywhere else.
 *
 * Steam accepts any locale but only localises some of them, answering the rest
 * with English and no signal that it did. For a non-English request the English
 * text is fetched too - free after the first time, thanks to the cache - and the
 * two are compared, so a silent fallback is recorded rather than mistaken for a
 * translation.
 */
export async function fetchGameDetails(
  appid: number,
  opts: { language?: LanguageCode } = {},
): Promise<GameDetails> {
  const language = opts.language ?? DEFAULT_LANGUAGE;
  const raw = await fetchRaw(appid, steamCode(language));

  let isFallback = false;
  if (language !== DEFAULT_LANGUAGE) {
    const english = await fetchRaw(appid, steamCode(DEFAULT_LANGUAGE));
    isFallback = raw.short_description === english.short_description;
  }

  return {
    appid,
    name: raw.name,
    developers: raw.developers ?? [],
    publishers: raw.publishers ?? [],
    releaseDate: parseReleaseDate(raw.release_date),
    genres: (raw.genres ?? []).map((g) => g.description),
    categories: (raw.categories ?? []).map((c) => c.description),
    priceCents: raw.price_overview?.final,
    isFree: raw.is_free ?? false,
    shortDescription: stripMarkup(raw.short_description ?? ''),
    detailedDescription: stripMarkup(raw.detailed_description ?? ''),
    isFallback,
  };
}

/** Steam writes release dates as free text, localised, and sometimes as "Coming soon". */
function parseReleaseDate(raw: RawDetails['release_date']): Date | undefined {
  if (raw === undefined || raw.coming_soon || raw.date.trim().length === 0) return undefined;
  const parsed = new Date(raw.date);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
