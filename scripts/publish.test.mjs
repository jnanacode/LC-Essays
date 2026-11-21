import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { publish } from './publish.mjs';
import { digest } from './publisher-core.mjs';

const source = (body = 'Original text.') => `---
essay_id: first
title: First essay
set_id: first-set
position: 1
publish: true
question: What matters?
placeholder: false
---
${body}
`;
const declarations = { contractVersion: 1, sets: [{ id: 'first-set', title: 'First set', publish: true, essayIds: ['first'] }] };
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lc-publisher-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'authoring', 'essays'), { recursive: true });
  await fs.writeFile(path.join(root, 'authoring', 'sets.json'), JSON.stringify(declarations));
  await fs.writeFile(path.join(root, 'authoring', 'essays', 'first.md'), source());
  return root;
}
const manifest = async (root) => JSON.parse(await fs.readFile(path.join(root, 'public', 'manifest.json'), 'utf8'));
const payloadPath = (root, revision) => path.join(root, 'public', 'essays', 'first', `${revision}.json`);

test('check mode creates no output or ledger; build generates exact revision bytes and is repeatable', async (t) => {
  const root = await fixture(t);
  assert.deepEqual(await publish(root, { checkOnly: true }), { sets: 1, essays: 1 });
  assert.deepEqual((await fs.readdir(root)).sort(), ['authoring']);
  await publish(root);
  const before = await fs.readFile(path.join(root, 'public', 'manifest.json'));
  const revision = (await manifest(root)).sets[0].essays[0].revision;
  const bytes = await fs.readFile(payloadPath(root, revision));
  assert.equal(digest(bytes), revision);
  assert.equal(JSON.parse(bytes).id, 'first');
  await publish(root);
  assert.deepEqual(await fs.readFile(path.join(root, 'public', 'manifest.json')), before);
  await assert.rejects(fs.stat(path.join(root, '.publisher.lock')), { code: 'ENOENT' });
});

test('editing retains the old payload and whole-set withdrawal retains history', async (t) => {
  const root = await fixture(t);
  await publish(root);
  const oldRevision = (await manifest(root)).sets[0].essays[0].revision;
  const oldBytes = await fs.readFile(payloadPath(root, oldRevision));
  await fs.writeFile(path.join(root, 'authoring', 'essays', 'first.md'), source('Updated text.'));
  await publish(root);
  assert.notEqual((await manifest(root)).sets[0].essays[0].revision, oldRevision);
  assert.deepEqual(await fs.readFile(payloadPath(root, oldRevision)), oldBytes);
  const ledger = await fs.readFile(path.join(root, 'publication-ledger.json'));
  const withdrawn = structuredClone(declarations);
  withdrawn.sets[0].publish = false;
  await fs.writeFile(path.join(root, 'authoring', 'sets.json'), JSON.stringify(withdrawn));
  assert.deepEqual(await publish(root), { sets: 0, essays: 0 });
  assert.deepEqual((await manifest(root)).sets, []);
  assert.deepEqual(await fs.readFile(path.join(root, 'publication-ledger.json')), ledger);
  assert.deepEqual(await fs.readFile(payloadPath(root, oldRevision)), oldBytes);
});

test('failure before manifest replacement preserves the old manifest and permits retry', async (t) => {
  const root = await fixture(t);
  await publish(root);
  const before = await fs.readFile(path.join(root, 'public', 'manifest.json'));
  await fs.writeFile(path.join(root, 'authoring', 'essays', 'first.md'), source('New revision.'));
  await assert.rejects(publish(root, { onStep: async (step) => { if (step === 'ledger-written') throw new Error('Injected interruption'); } }), /Injected interruption/);
  assert.deepEqual(await fs.readFile(path.join(root, 'public', 'manifest.json')), before);
  await publish(root);
  assert.notDeepEqual(await fs.readFile(path.join(root, 'public', 'manifest.json')), before);
});

test('build refuses a lock, damaged immutable payloads, and lost ledger history', async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, '.publisher.lock'), 'other build');
  await assert.rejects(publish(root), /lock exists/);
  assert.equal(await fs.readFile(path.join(root, '.publisher.lock'), 'utf8'), 'other build');
  await fs.unlink(path.join(root, '.publisher.lock'));
  await publish(root);
  const revision = (await manifest(root)).sets[0].essays[0].revision;
  await fs.writeFile(payloadPath(root, revision), 'damaged');
  await assert.rejects(publish(root), /Immutable payload differs/);
  assert.equal(await fs.readFile(payloadPath(root, revision), 'utf8'), 'damaged');
  await fs.unlink(path.join(root, 'publication-ledger.json'));
  await assert.rejects(publish(root, { checkOnly: true }), /without a publication ledger/);
});
