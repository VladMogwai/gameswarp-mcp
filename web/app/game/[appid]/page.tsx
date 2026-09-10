import Link from 'next/link';
import { notFound } from 'next/navigation';
import { gamePage } from 'gameswarp-mcp/db';
import { coverUrl } from 'gameswarp-mcp/images';

export const revalidate = 300;

const DROP_THRESHOLD = 0.05;

/**
 * A sparkline drawn as SVG rather than pulled from a charting library: one path,
 * no client JavaScript, and it renders on the server with the rest of the page.
 */
function Timeline({ months }: { months: { month: string; positiveShare: number }[] }) {
  if (months.length < 2) return null;
  const width = 800;
  const height = 140;
  const points = months
    .map((point, index) => {
      const x = (index / (months.length - 1)) * width;
      const y = height - point.positiveShare * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const first = months[0]!.month.slice(0, 4);
  const last = months[months.length - 1]!.month.slice(0, 4);

  return (
    <svg viewBox={`0 0 ${width} ${height + 20}`} style={{ width: '100%', height: 'auto' }}>
      <line x1="0" y1={height * 0.1} x2={width} y2={height * 0.1} stroke="var(--line)" />
      <line x1="0" y1={height * 0.5} x2={width} y2={height * 0.5} stroke="var(--line)" />
      <polyline fill="none" stroke="var(--accent)" strokeWidth="1.6" points={points} />
      <text x="0" y={height + 16} fontSize="11" fill="var(--muted)">
        {first}
      </text>
      <text x={width - 30} y={height + 16} fontSize="11" fill="var(--muted)">
        {last}
      </text>
    </svg>
  );
}

export default async function GamePage({ params }: { params: Promise<{ appid: string }> }) {
  const { appid } = await params;
  const game = await gamePage(Number(appid));
  if (game === undefined) notFound();

  // Months where the positive share fell against the one before. This is the
  // arithmetic the whole product rests on, and it needs no model at all.
  const drops = game.months
    .map((point, index) => ({ point, previous: game.months[index - 1] }))
    .filter(
      (entry) =>
        entry.previous !== undefined &&
        entry.previous.positiveShare - entry.point.positiveShare >= DROP_THRESHOLD,
    )
    .reverse();

  return (
    <>
      <p className="muted">
        <Link href="/">← all games</Link>
      </p>
      <img
        className="cover cover-hero"
        src={coverUrl(game.appid, game.headerImage, 'hero')}
        alt=""
        width={460}
        height={215}
      />
      <h1>{game.name}</h1>
      <p className="muted">
        {game.months.length > 0
          ? `${game.months.length} months of review history`
          : 'No rating history collected yet'}
      </p>

      <Timeline months={game.months} />

      {drops.length > 0 && (
        <>
          <h2>Where the rating fell</h2>
          {drops.slice(0, 6).map((drop) => (
            <div className="card" key={drop.point.month}>
              <div className="row">
                <span className="grow">{drop.point.month.slice(0, 7)}</span>
                <span className="num">
                  <span className="muted">
                    {(drop.previous!.positiveShare * 100).toFixed(0)}%
                  </span>
                  {' → '}
                  <span style={{ color: 'var(--danger)' }}>
                    {(drop.point.positiveShare * 100).toFixed(0)}%
                  </span>
                </span>
              </div>
              <div className="muted" style={{ marginTop: 4 }}>
                {drop.point.up + drop.point.down} reviews that month
              </div>
            </div>
          ))}
        </>
      )}

      <h2>Press</h2>
      {game.articles.length === 0 && <p className="muted">No articles collected yet.</p>}
      {game.articles.map((article) => (
        <div className="card" key={article.id}>
          <a href={article.url} target="_blank" rel="noreferrer">
            {article.title}
          </a>
          <div className="muted" style={{ marginTop: 6 }}>
            {article.outlet} · {article.publishedAt.toISOString().slice(0, 10)}
          </div>
        </div>
      ))}
    </>
  );
}
