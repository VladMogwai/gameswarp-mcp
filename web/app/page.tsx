import Link from 'next/link';
import { gamesDiscussed, recentArticles } from 'gameswarp-mcp/db';
import { coverUrl } from 'gameswarp-mcp/images';

// Nothing is cached for long: the collector writes every hour and a feed that
// lags behind it is worse than no feed.
export const revalidate = 300;

function ago(date: Date): string {
  const hours = Math.floor((Date.now() - date.getTime()) / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function Home() {
  const [discussed, feed] = await Promise.all([gamesDiscussed(7, 12), recentArticles(30)]);

  return (
    <>
      <h1>Gameswarp</h1>
      <p className="muted">
        What the gaming press published, and which games it was about.
      </p>

      <h2>Discussed this week</h2>
      {discussed.length === 0 && <p className="muted">Nothing resolved to a game yet.</p>}
      {discussed.map((game) => (
        <div className="card" key={game.appid}>
          <div className="with-cover">
            <img
              className="cover cover-row"
              src={coverUrl(game.appid, game.capsuleImage, 'row')}
              alt=""
              width={116}
              height={44}
              loading="lazy"
            />
            <Link className="grow" href={`/game/${game.appid}`}>
              {game.name}
            </Link>
            <span className="muted num">
              {game.outlets} outlet{game.outlets === 1 ? '' : 's'} · {game.articles} article
              {game.articles === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      ))}

      <h2>Latest</h2>
      {feed.map((article) => (
        <div className="card" key={article.id}>
          <a href={article.url} target="_blank" rel="noreferrer">
            {article.title}
          </a>
          <div className="muted" style={{ marginTop: 6 }}>
            {article.outlet} · {ago(article.publishedAt)}
          </div>
          {article.games.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {article.games.map((game) => (
                <Link className="tag" href={`/game/${game.appid}`} key={game.appid}>
                  {game.name}
                </Link>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
