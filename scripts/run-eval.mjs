// Runs the patch-drop eval. Usage: node scripts/run-eval.mjs [model]
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { runEval } from '../dist/evals/runner.js';
import { defaultProvider, ollamaProvider } from '../dist/model/index.js';
import { closePool } from '../dist/db/pool.js';

const forced = process.argv[2];
const provider = forced === undefined ? defaultProvider() : ollamaProvider({ model: forced });
const model = provider.id;
const allCases = JSON.parse(readFileSync('evals/datasets/patch-drops.json', 'utf8'));

/**
 * A full run is close to an hour, which is long enough that it will be
 * interrupted - a closed laptop, a change of mind. Results are written after
 * every case, so the only thing missing was picking them back up: the newest
 * file for this model is read, its cases are skipped, and the rest continue
 * into it.
 */
mkdirSync('evals/results', { recursive: true });
const slug = model.replace(/[:/]/g, '-');
const previous = readdirSync('evals/results')
  .filter((name) => name.startsWith(`patch-drops_${slug}_`))
  .sort()
  .pop();

let partial = [];
let path;
if (previous !== undefined && process.argv.includes('--fresh') === false) {
  const stored = JSON.parse(readFileSync(`evals/results/${previous}`, 'utf8'));
  partial = Array.isArray(stored) ? stored : stored.results;
  path = `evals/results/${previous}`;
}
const done = new Set(partial.map((r) => `${r.case.appid}:${r.case.bucket}`));
const cases = allCases.filter((c) => !done.has(`${c.appid}:${c.bucket}`));

if (done.size > 0) {
  console.log(`resuming: ${done.size} cases already done, ${cases.length} to go`);
}
console.log(`model: ${model}, cases: ${cases.length}\n`);

if (cases.length === 0) {
  console.log('nothing left to run; pass --fresh to start over');
  process.exit(0);
}

if (path === undefined) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  path = `evals/results/patch-drops_${slug}_${stamp}.json`;
}

// Written after every case: a run that dies at the tenth should not cost the
// nine that already worked.
const report = await runEval(cases, {
  provider,
  onCase: (r) => {
    partial.push(r);
    writeFileSync(path, JSON.stringify(partial, null, 2) + '\n');
    const mark = r.correct ? 'OK  ' : 'MISS';
    const named = r.namedDate ?? '-';
    const period = r.case.granularity === 'month' ? r.case.bucket.slice(0, 7) : r.case.bucket;
    console.log(
      `  ${mark} ${r.case.game.slice(0, 24).padEnd(26)} ${period.padEnd(11)} truth ${r.case.patchDate}  named ${named.padEnd(10)}` +
        ` ${r.failure.padEnd(15)} ${r.steps} steps ${(r.durationMs / 1000).toFixed(0)}s`,
    );
  },
});

// The report covers this session; the file holds every case ever run for this
// model, which is the number that matters after a resume.
const total = partial.length;
const correct = partial.filter((r) => r.correct).length;
console.log(
  `\nthis session: ${report.correct}/${report.cases}` +
    `  |  overall ${(100 * correct / total).toFixed(0)}%  (${correct}/${total})`,
);
console.log(
  `session detail: accuracy ${(report.accuracy * 100).toFixed(0)}%` +
    `  median ${report.medianSteps} steps, ${(report.medianDurationMs / 1000).toFixed(0)}s` +
    `  tokens ${report.totalInputTokens}->${report.totalOutputTokens}`,
);
console.log('failures:', JSON.stringify(report.failures));

writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
console.log(`saved ${path}`);
await closePool();
