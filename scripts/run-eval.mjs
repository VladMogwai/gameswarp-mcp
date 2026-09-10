// Runs the patch-drop eval. Usage: node scripts/run-eval.mjs [model]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { runEval } from '../dist/evals/runner.js';
import { ollamaProvider } from '../dist/model/index.js';
import { closePool } from '../dist/db/pool.js';

const model = process.argv[2] ?? 'gemma4-local';
const cases = JSON.parse(readFileSync('evals/datasets/patch-drops.json', 'utf8'));
console.log(`model: ${model}, cases: ${cases.length}\n`);

mkdirSync('evals/results', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const path = `evals/results/patch-drops_${model.replace(/[:/]/g, '-')}_${stamp}.json`;
const partial = [];

// Written after every case: a run that dies at the tenth should not cost the
// nine that already worked.
const report = await runEval(cases, {
  provider: ollamaProvider({ model }),
  onCase: (r) => {
    partial.push(r);
    writeFileSync(path, JSON.stringify(partial, null, 2) + '\n');
    const mark = r.correct ? 'OK  ' : 'MISS';
    const named = r.namedDate ?? '-';
    console.log(
      `  ${mark} ${r.case.game.padEnd(24)} ${r.case.month}  truth ${r.case.patchDate}  named ${named.padEnd(10)}` +
        ` ${r.failure.padEnd(15)} ${r.steps} steps ${(r.durationMs / 1000).toFixed(0)}s`,
    );
  },
});

console.log(
  `\naccuracy ${(report.accuracy * 100).toFixed(0)}%  (${report.correct}/${report.cases})` +
    `  median ${report.medianSteps} steps, ${(report.medianDurationMs / 1000).toFixed(0)}s` +
    `  tokens ${report.totalInputTokens}->${report.totalOutputTokens}`,
);
console.log('failures:', JSON.stringify(report.failures));

writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
console.log(`saved ${path}`);
await closePool();
