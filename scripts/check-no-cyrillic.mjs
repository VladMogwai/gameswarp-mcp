import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOTS = ['src', 'migrations', 'test', 'scripts'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.sql', '.json', '.yml', '.yaml']);
const SKIP_DIRS = new Set(['fixtures', 'node_modules', 'dist']);
const CYRILLIC = /[\u0400-\u04FF\u0500-\u052F]/;

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(join(dir, entry.name));
    } else if (EXTENSIONS.has(extname(entry.name))) {
      yield join(dir, entry.name);
    }
  }
}

const offenders = [];
for (const root of ROOTS) {
  for await (const file of walk(root)) {
    const lines = (await readFile(file, 'utf8')).split('\n');
    lines.forEach((line, index) => {
      if (CYRILLIC.test(line)) offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 90)}`);
    });
  }
}

if (offenders.length > 0) {
  console.error('Cyrillic text found in source. Everything in the repo must be English:\n');
  for (const offender of offenders) console.error(`  ${offender}`);
  process.exit(1);
}
console.log('No Cyrillic in source.');
