import { getJson, HttpError } from './http.js';
import { stripMarkup } from './markup.js';

export type NewsSource = 'developer' | 'press';

export interface NewsItem {
  gid: string;
  appid: number;
  date: Date;
  title: string;
  body: string;
  raw: string;
  source: NewsSource;
  outlet: string;
  url: string;
}

interface RawNewsItem {
  gid: string;
  title: string;
  url: string;
  author: string;
  contents: string;
  feedlabel: string;
  feedname: string;
  feed_type: number;
  date: number;
  appid: number;
}

interface NewsResponse {
  appnews?: { appid: number; newsitems: RawNewsItem[] };
}

export class AppNotFoundError extends Error {
  constructor(readonly appid: number) {
    super(`Steam does not know app ${appid}`);
    this.name = 'AppNotFoundError';
  }
}

/**
  * Steam imposes no cap on `count`; it returns whatever exists. 1000 covers the
  * full history even for long-lived games (No Man's Sky has ~715 items).
  * `maxlength` is deliberately omitted because it truncates `contents`.
  */
export async function fetchNews(appid: number, opts: { count?: number } = {}): Promise<NewsItem[]> {
  const count = opts.count ?? 1000;
  const url =
    `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}&count=${count}`;

  let response: NewsResponse;
  try {
    response = await getJson<NewsResponse>(url);
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) throw new AppNotFoundError(appid);
    throw error;
  }

  return (response.appnews?.newsitems ?? []).map(normalize);
}

function normalize(item: RawNewsItem): NewsItem {
  return {
    gid: item.gid,
    appid: item.appid,
    date: new Date(item.date * 1000),
    title: item.title,
    body: stripMarkup(item.contents),
    raw: item.contents,
    source: item.feed_type === 1 ? 'developer' : 'press',
    outlet: item.feedname,
    url: item.url,
  };
}
