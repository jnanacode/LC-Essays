import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEssay, parseBody } from './parse-essay.mjs';
import { digest, LIMITS } from './publisher-core.mjs';

const header = '---\nessay_id: test-one\ntitle: Test essay\nset_id: test-set\nposition: 1\npublish: true\nquestion: A test question?\nplaceholder: true\n---\n';
const source = (body = 'A paragraph.') => header + body + '\n';

test('essay conversion produces stable payload and a digest of exact output bytes', () => {
  const result = parseEssay(source());
  assert.equal(result.payload.id, 'test-one');
  assert.equal(result.payload.placeholder, true);
  assert.deepEqual(result.payload.blocks, [{ type: 'paragraph', content: [{ text: 'A paragraph.', marks: [] }] }]);
  assert.equal(result.revision, digest(Buffer.from(result.json, 'utf8')));
  assert.equal(result.json, parseEssay(source()).json);
  assert.equal(result.json, parseEssay(source().replaceAll('\n', '\r\n')).json);
});

test('approved headings, quotation and flat lists preserve order', () => {
  const blocks = parseBody('## Heading\n\n> First quotation.\n>\n> Second quotation.\n\n- One\n- Two\n\n3. Third\n4. Fourth');
  assert.deepEqual(blocks.map((block) => block.type), ['heading', 'quote', 'list', 'list']);
  assert.equal(blocks[0].level, 2);
  assert.equal(blocks[1].paragraphs.length, 2);
  assert.equal(blocks[2].ordered, false);
  assert.equal(blocks[2].items.length, 2);
  assert.equal(blocks[3].ordered, true);
  assert.equal(blocks[3].start, 3);
});

test('inline emphasis and soft wrapping are converted without HTML rendering', () => {
  const [paragraph] = parseBody('Plain **bold** and *italic* and ***both***.\nNext line.');
  assert.equal(paragraph.content.map((run) => run.text).join(''), 'Plain bold and italic and both. Next line.');
  assert.deepEqual(paragraph.content.find((run) => run.text === 'bold').marks, ['bold']);
  assert.deepEqual(paragraph.content.find((run) => run.text === 'both').marks, ['bold', 'italic']);
});

test('unsupported Markdown fails explicitly', () => {
  const cases = ['# Main heading', '##### Too deep', 'Heading\n=======', '<b>HTML</b>', '`code`', '```js\ncode\n```', '![image](a.png)', '[link](relative)', '[link][ref]\n\n[ref]: relative', 'https://example.com', '[[Private note]]', 'Text[^one]\n\n[^one]: footnote', '~~deleted~~', '---', '| A | B |\n| --- | --- |\n| a | b |', '- Parent\n  - Child', 'Line  \nBreak', ''];
  for (const body of cases) assert.throws(() => parseBody(body), body);
});

test('invalid frontmatter, duplicates, aliases, tags and wrong types are rejected', () => {
  const cases = [source().replace('title: Test essay', 'title: Test essay\ntitle: Duplicate'), source().replace('title: Test essay', 'title: &name Test essay').replace('question: A test question?', 'question: *name'), source().replace('title: Test essay', 'title: !!str Test essay'), source().replace('publish: true', 'publish: "true"'), source().replace('position: 1', 'position: 0'), source().replace('placeholder: true', 'unknown: true'), 'No frontmatter', header.slice(0, -4)];
  for (const value of cases) assert.throws(() => parseEssay(value));
});

test('invalid UTF-8 and malformed Unicode fail rather than replace user text', () => {
  assert.throws(() => parseEssay(Buffer.from([0xc3, 0x28])));
  assert.throws(() => parseEssay(source('\ud800')));
});

test('long Unicode paragraphs split into bounded runs without loss', () => {
  const body = 'a'.repeat(4095) + String.fromCodePoint(0x1f600) + 'é'.repeat(5000);
  const result = parseEssay(source(body));
  const runs = result.payload.blocks[0].content;
  assert.equal(runs.map((run) => run.text).join(''), body);
  assert.ok(runs.every((run) => run.text.length <= LIMITS.runUnits && run.text.isWellFormed()));
});

test('source byte and output block limits are enforced', () => {
  assert.throws(() => parseEssay(source('é'.repeat(LIMITS.essayBytes))));
  assert.throws(() => parseBody(Array.from({ length: LIMITS.blocks + 1 }, () => 'Paragraph.').join('\n\n')));
});
