import { getJson } from './http.js';
import { DEFAULT_LANGUAGE, steamCode, type LanguageCode } from '../config/languages.js';

export interface GameHit {
  appid: number;
  name: string;
  thumbnail: string | undefined;
  metascore: number | undefined;
  priceCents: number | undefined;
  currency: string | undefined;
  platforms: string[];
}

interface RawHit {
  type: string;
  id: number;
  name: string;
  tiny_image?: string;
  metascore?: string;
  price?: { currency: string; final: number };
  platforms?: Record<string, boolean>;
}

interface SearchResponse {
  total?: number;
  items?: RawHit[];
}

/**
 * Steam's own store search, which removes the need for a local catalogue.
 * Prefix matching works ("no man" finds No Man's Sky) but typos do not
 * ("cyberpnk" returns nothing), so a UI on top of this should search as the
 * user types rather than on submit.
 */
export async function searchGames(
  term: string,
  opts: { language?: LanguageCode; limit?: number } = {},
): Promise<GameHit[]> {
  const trimmed = term.trim();
  if (trimmed.length === 0) return [];

  const language = steamCode(opts.language ?? DEFAULT_LANGUAGE);
  const url =
    'https://store.steampowered.com/api/storesearch/' +
    `?term=${encodeURIComponent(trimmed)}&cc=us&l=${language}`;

  const response = await getJson<SearchResponse>(url);
  return (response.items ?? [])
    .filter((item) => item.type === 'app')
    .slice(0, opts.limit ?? 10)
    .map(toHit);
}

function toHit(item: RawHit): GameHit {
  const metascore = item.metascore === undefined ? NaN : Number.parseInt(item.metascore, 10);
  return {
    appid: item.id,
    name: item.name,
    thumbnail: item.tiny_image,
    metascore: Number.isFinite(metascore) ? metascore : undefined,
    priceCents: item.price?.final,
    currency: item.price?.currency,
    platforms: Object.entries(item.platforms ?? {})
      .filter(([, supported]) => supported)
      .map(([name]) => name),
  };
}

/**
 * Trademark symbols, punctuation and casing differ between how outlets write a
 * game name and how Steam spells it ("Stellar Blade" vs "Stellar Blade(tm)").
 */
function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Strict counterpart to searchGames, used to decide whether a string seen in the
 * wild - an RSS category, a phrase from a headline - names an actual game.
 * Requires the top hit to match the query exactly once normalised, so that
 * "Indie" or "PS5" resolve to nothing rather than to whatever Steam ranks first.
 */
export async function resolveGameName(
  name: string,
  opts: { language?: LanguageCode } = {},
): Promise<number | null> {
  const hits = await searchGames(name, { ...opts, limit: 5 });
  const wanted = normalise(name);
  const match = hits.find((hit) => normalise(hit.name) === wanted);
  return match?.appid ?? null;
}
