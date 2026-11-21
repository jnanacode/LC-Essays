import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseEssay } from './parse-essay.mjs';
import { LIMITS, check, serial, byteLimit, validateMembership, nextLedger } from './publisher-core.mjs';

async function info(filename) {
  try { return await fs.lstat(filename); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function directory(filename, create = false) {
  const stat = await info(filename);
  if (!stat && create) { await fs.mkdir(filename); return; }
  check(stat?.isDirectory() && !stat.isSymbolicLink(), `Expected a real directory: ${filename}`);
}
async function readLimited(filename, maximum) {
  const stat = await info(filename);
  check(stat?.isFile() && !stat.isSymbolicLink(), `Expected a regular file: ${filename}`);
  check(stat.size <= maximum, `File byte limit exceeded: ${filename}`);
  const bytes = await fs.readFile(filename);
  check(bytes.length <= maximum, `File grew beyond byte limit: ${filename}`);
  return bytes;
}
async function readJson(filename, maximum) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readLimited(filename, maximum)));
}
async function replaceFile(filename, content) {
  const old = await info(filename);
  check(!old || (old.isFile() && !old.isSymbolicLink()), `Unsafe output target: ${filename}`);
  if (old && (await readLimited(filename, Math.max(Buffer.byteLength(content), old.size))).equals(Buffer.from(content))) return;
  const temporary = path.join(path.dirname(filename), `.publisher-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx');
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporary, filename);
  } finally {
    if (handle) await handle.close();
    await fs.rm(temporary, { force: true });
  }
}

export async function planPublication(root) {
  root = path.resolve(root);
  await directory(root);
  await directory(path.join(root, 'authoring'));
  const sourceDir = path.join(root, 'authoring', 'essays');
  await directory(sourceDir);
  const declarations = await readJson(path.join(root, 'authoring', 'sets.json'), LIMITS.manifestBytes);
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  check(entries.length <= LIMITS.essays, 'Essay directory entry limit exceeded');
  const essays = [];
  for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    check(entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.md'), `Unsupported authoring entry: ${entry.name}`);
    const filename = path.join(sourceDir, entry.name);
    essays.push(parseEssay(await readLimited(filename, LIMITS.essayBytes), entry.name));
  }
  const validated = validateMembership(declarations, essays.map((essay) => essay.frontmatter));
  const byId = new Map(essays.map((essay) => [essay.frontmatter.essay_id, essay]));
  const publicDir = path.join(root, 'public');
  if (await info(publicDir)) await directory(publicDir);
  const payloadDir = path.join(publicDir, 'essays');
  if (await info(payloadDir)) await directory(payloadDir);
  const ledgerPath = path.join(root, 'publication-ledger.json');
  const hasLedger = await info(ledgerPath);
  check(hasLedger || !(await info(path.join(publicDir, 'manifest.json'))), 'Manifest exists without a publication ledger; inspect and recover it, do not reset history');
  const previous = hasLedger ? await readJson(ledgerPath, LIMITS.manifestBytes) : { contractVersion: 1, sets: [] };
  const ledger = nextLedger(validated.declarations, previous);
  const payloads = [];
  const manifest = { contractVersion: 1, sets: validated.declarations.sets.filter((set) => set.publish).map((set) => ({
    id: set.id, title: set.title, essays: set.essayIds.map((id) => {
      const essay = byId.get(id);
      payloads.push({ id, revision: essay.revision, json: essay.json });
      return { id, title: essay.payload.title, revision: essay.revision, placeholder: essay.payload.placeholder };
    }),
  })) };
  const manifestJson = serial(manifest);
  const ledgerJson = serial(ledger);
  byteLimit(manifestJson, LIMITS.manifestBytes, 'Manifest');
  byteLimit(ledgerJson, LIMITS.manifestBytes, 'Ledger');
  for (const payload of payloads) {
    const essayDir = path.join(payloadDir, payload.id);
    if (await info(essayDir)) await directory(essayDir);
    const filename = path.join(essayDir, `${payload.revision}.json`);
    if (await info(filename)) check((await readLimited(filename, LIMITS.essayBytes)).equals(Buffer.from(payload.json)), `Immutable payload differs: ${payload.id}`);
  }
  return { root, payloads, manifestJson, ledgerJson, summary: { sets: manifest.sets.length, essays: payloads.length } };
}

export async function publish(root, { checkOnly = false, onStep = async () => {} } = {}) {
  root = path.resolve(root);
  if (checkOnly) return (await planPublication(root)).summary;
  await directory(root);
  const lockPath = path.join(root, '.publisher.lock');
  let lock;
  try { lock = await fs.open(lockPath, 'wx'); } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Publisher lock exists. Check for another build or inspect an interrupted build before manually removing the lock.');
    throw error;
  }
  try {
    const plan = await planPublication(root);
    await onStep('validated');
    const publicDir = path.join(root, 'public');
    await directory(publicDir, true);
    const payloadDir = path.join(publicDir, 'essays');
    await directory(payloadDir, true);
    for (const payload of plan.payloads) {
      const essayDir = path.join(payloadDir, payload.id);
      await directory(essayDir, true);
      const filename = path.join(essayDir, `${payload.revision}.json`);
      if (!(await info(filename))) await replaceFile(filename, payload.json);
      check((await readLimited(filename, LIMITS.essayBytes)).equals(Buffer.from(payload.json)), `Payload verification failed: ${payload.id}`);
    }
    await onStep('payloads-written');
    await replaceFile(path.join(root, 'publication-ledger.json'), plan.ledgerJson);
    await onStep('ledger-written');
    await replaceFile(path.join(publicDir, 'manifest.json'), plan.manifestJson);
    return plan.summary;
  } finally {
    await lock.close();
    await fs.unlink(lockPath);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    check(args.length === 0 || (args.length === 1 && args[0] === '--check'), 'Usage: node scripts/publish.mjs [--check]');
    const root = fileURLToPath(new URL('../', import.meta.url));
    const result = await publish(root, { checkOnly: args.includes('--check') });
    console.log(`${args.includes('--check') ? 'Validated' : 'Generated'} ${result.sets} sets and ${result.essays} essays. No commit, push, or deployment performed.`);
  } catch (error) {
    console.error(`Publisher failed: ${error.message}`);
    process.exitCode = 1;
  }
}
