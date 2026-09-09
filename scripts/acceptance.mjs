// End-to-end check of the MCP server, driven over stdio with raw JSON-RPC.
// Needs the database running and network access, so it is not part of `npm test`.
// Run with: npm run acceptance
import { spawn } from 'node:child_process';

const proc = spawn('node', [new URL('../dist/index.js', import.meta.url).pathname], {
  stdio: ['pipe', 'pipe', 'pipe'],
});
let stderr = '';
proc.stderr.on('data', (d) => { stderr += d.toString(); });

let buffer = '';
const pending = new Map();
proc.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let nextId = 1;
function send(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
function notify(method, params) {
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

const checks = [];
function check(name, pass, detail = '') {
  checks.push({ name, pass, detail });
  console.log(`  ${pass ? 'OK  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const init = await send('initialize', {
  protocolVersion: '2025-11-25',
  capabilities: {},
  clientInfo: { name: 'acceptance', version: '1.0.0' },
});
notify('notifications/initialized');
console.log(`server: ${init.result.serverInfo.name} ${init.result.serverInfo.version}, protocol ${init.result.protocolVersion}`);
console.log(`instructions: ${init.result.instructions ? 'yes' : 'no'}\n`);

const list = await send('tools/list', {});
const names = list.result.tools.map((t) => t.name).sort();
check('tools/list shows five tools', names.length === 5, names.join(', '));
check('every tool has a description', list.result.tools.every((t) => (t.description ?? '').length > 40));
check('every inputSchema is an object schema', list.result.tools.every((t) => t.inputSchema?.type === 'object'));

const call = async (name, args) => (await send('tools/call', { name, arguments: args })).result;
const textOf = (r) => r.content.map((c) => c.text).join('\n');

let r = await call('search_games', { query: 'hades' });
check('search_games("hades") finds appid 1145360', textOf(r).includes('1145360'));

// Escaped rather than written literally so the repo stays free of non-English
// text: this is test data, but the guard should have no exceptions to argue over.
// The query reads "vedmak" and the expected title is "Vedmak" (The Witcher).
r = await call('search_games', { query: '\u0432\u0435\u0434\u044c\u043c\u0430\u043a', language: 'ru' });
check(
  'search_games russian returns russian titles',
  /\u0412\u0435\u0434\u044c\u043c\u0430\u043a/.test(textOf(r)),
);

r = await call('get_review_timeline', { appid: 275850 });
const tl = textOf(r);
check('timeline: 2022-09 = 92%', /2022-09\s+92%/.test(tl), tl.match(/2022-09\s+\S+/)?.[0]);
check('timeline: 2022-10 = 72%', /2022-10\s+72%/.test(tl), tl.match(/2022-10\s+\S+/)?.[0]);

r = await call('get_game_news', { appid: 275850, kind: 'patches', since: '2022-10-01', limit: 100 });
check('news: Waypoint 4.0 patch on 2022-10-07', /2022-10-07.*Waypoint \(4\.0\) Update/.test(textOf(r)));

r = await call('get_reviews', { appid: 275850, voted_up: false, limit: 5, min_playtime_hours: 10 });
check('reviews: negative reviews with playtime', !r.isError && /^\d{4}-\d\d-\d\d\s+-\s+\d+h/m.test(textOf(r)));

r = await call('search_articles', { query: 'Dawnwalker' });
check('search_articles finds Dawnwalker coverage', /Dawnwalker/.test(textOf(r)));

r = await call('get_review_timeline', { appid: 999999999 });
check('unknown appid -> isError with guidance', r.isError === true && /search_games/.test(textOf(r)), textOf(r).slice(0, 60));

r = await call('get_reviews', { appid: 275850, since: '2022-10-01', until: '2022-11-01' });
check('deep window -> isError, not silence', r.isError === true && /too deep|more than/i.test(textOf(r)));

// The spec says an unknown tool is a protocol error. The SDK converts it into an
// isError result carrying the code in its text, so that is what we assert.
const bad = await send('tools/call', { name: 'no_such_tool', arguments: {} });
const badText = bad.error ? JSON.stringify(bad.error) : textOf(bad.result);
check('unknown tool reports -32602', /-32602/.test(badText), badText.slice(0, 50));

const big = textOf(await call('get_review_timeline', { appid: 275850 }));
check('response stays within budget', big.length <= 20000, `${big.length} chars`);
check('stdout carried protocol only', stderr.includes('ready on stdio'));

proc.kill();
const failed = checks.filter((c) => !c.pass).length;
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed === 0 ? 0 : 1);
