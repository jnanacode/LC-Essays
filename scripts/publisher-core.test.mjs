import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, validateFrontmatter, validateSets, validateMembership, nextLedger, serial, digest, byteLimit, splitText } from './publisher-core.mjs';

const empty = () => ({ contractVersion: 1, sets: [] });
const essay = (overrides = {}) => ({ essay_id: 'essay-one', title: 'Test essay', set_id: 'set-one', position: 1, publish: true, question: 'A test question?', placeholder: true, ...overrides });
const set = (overrides = {}) => ({ id: 'set-one', title: 'Test set', publish: true, essayIds: ['essay-one'], ...overrides });
const declarations = (...sets) => ({ contractVersion: 1, sets });

test('frontmatter validates detached data and rejects extra or missing fields', () => {
  const input = essay();
  const result = validateFrontmatter(input);
  assert.deepEqual(result, input);
  assert.notEqual(result, input);
  assert.throws(() => validateFrontmatter(essay({ extra: true })));
  const missing = essay();
  delete missing.question;
  assert.throws(() => validateFrontmatter(missing));
});

test('frontmatter rejects invalid identities, strings, positions and flags', () => {
  for (const change of [{ essay_id: '../bad' }, { set_id: 'UPPER' }, { title: ' ' }, { question: '' }, { title: '\ud800' }, { position: 0 }, { position: 1.5 }, { position: Number.MAX_SAFE_INTEGER + 1 }, { publish: 'true' }, { placeholder: 1 }]) {
    assert.throws(() => validateFrontmatter(essay(change)));
  }
});

test('sets allow an empty catalogue and return detached ordered membership', () => {
  assert.deepEqual(validateSets(empty()), empty());
  const input = declarations(set());
  const result = validateSets(input);
  input.sets[0].essayIds.push('essay-two');
  assert.deepEqual(result.sets[0].essayIds, ['essay-one']);
});

test('sets reject duplicate identities, reused members, empty membership and unsupported versions', () => {
  for (const input of [declarations(set(), set()), declarations(set(), set({ id: 'set-two' })), declarations(set({ essayIds: [] })), declarations(set({ essayIds: ['essay-one', 'essay-one'] })), { contractVersion: 2, sets: [] }, { ...empty(), extra: true }]) {
    assert.throws(() => validateSets(input));
  }
});

test('set count and per-set limits are enforced', () => {
  const members = Array.from({ length: LIMITS.perSet + 1 }, (_, i) => `essay-${i}`);
  assert.throws(() => validateSets(declarations(set({ essayIds: members }))));
  const sets = Array.from({ length: LIMITS.sets + 1 }, (_, i) => set({ id: `set-${i}`, essayIds: [`essay-${i}`] }));
  assert.throws(() => validateSets(declarations(...sets)));
});

test('membership rejects missing sources, duplicates, inconsistent positions and published orphans', () => {
  const input = declarations(set());
  assert.equal(validateMembership(input, [essay()]).essays.size, 1);
  for (const sources of [[], [essay(), essay()], [essay({ position: 2 })], [essay({ set_id: 'set-two' })], [essay({ publish: false })], [essay(), essay({ essay_id: 'orphan' })]]) {
    assert.throws(() => validateMembership(input, sources));
  }
});

test('whole-set withdrawal permits retained per-essay publication flags', () => {
  const input = declarations(set({ publish: false }));
  assert.equal(validateMembership(input, [essay()]).essays.size, 1);
  const ledger = nextLedger(declarations(set()), empty());
  assert.deepEqual(nextLedger(input, ledger), ledger);
});

test('ledger appends newly published sets and leaves unpublished sets unrecorded', () => {
  const first = nextLedger(declarations(set()), empty());
  const second = set({ id: 'set-two', essayIds: ['essay-two'] });
  const result = nextLedger(declarations(set(), second), first);
  assert.deepEqual(result.sets.map((item) => item.id), ['set-one', 'set-two']);
  assert.deepEqual(nextLedger(declarations(set(), { ...second, publish: false }), first), first);
  assert.deepEqual(first.sets, [{ id: 'set-one', essayIds: ['essay-one'] }]);
});

test('ledger rejects removal, reordering, membership edits and insertion before released sets', () => {
  const second = set({ id: 'set-two', essayIds: ['essay-two'] });
  const first = nextLedger(declarations(set()), empty());
  const both = nextLedger(declarations(set(), second), first);
  assert.throws(() => nextLedger(empty(), first));
  assert.throws(() => nextLedger(declarations(set({ essayIds: ['replacement'] })), first));
  assert.throws(() => nextLedger(declarations(second, set()), both));
  assert.throws(() => nextLedger(declarations(second, set()), first));
  assert.throws(() => nextLedger(declarations(set()), { contractVersion: 2, sets: [] }));
});

test('serialization and SHA-256 have fixed reproducible output', () => {
  assert.equal(serial({ contractVersion: 1, sets: [] }), '{\n  "contractVersion": 1,\n  "sets": []\n}\n');
  assert.equal(digest(Buffer.from('abc', 'utf8')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(digest(serial(empty())), digest(serial(empty())));
});

test('byte limits count UTF-8 bytes rather than JavaScript string length', () => {
  assert.doesNotThrow(() => byteLimit('é', 2, 'test'));
  assert.throws(() => byteLimit('é', 1, 'test'));
});

test('long Unicode text splits without loss or broken surrogate pairs', () => {
  const input = 'a'.repeat(4095) + String.fromCodePoint(0x1f600) + 'é'.repeat(6000);
  const chunks = splitText(input);
  assert.equal(chunks.join(''), input);
  assert.ok(chunks.every((chunk) => chunk.length > 0 && chunk.length <= LIMITS.runUnits && chunk.isWellFormed()));
  assert.deepEqual(splitText(''), []);
  assert.deepEqual(splitText('a'.repeat(4096)).map((chunk) => chunk.length), [4096]);
  assert.throws(() => splitText('\ud800'));
});
