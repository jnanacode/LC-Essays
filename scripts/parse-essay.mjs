import MarkdownIt from 'markdown-it';
import { parseDocument, visit, isAlias } from 'yaml';
import { LIMITS, check, text, validateFrontmatter, splitText, serial, digest, byteLimit } from './publisher-core.mjs';

const markdown = new MarkdownIt({ html: true, linkify: false, typographer: false });
const forbidden = /\[\[|\]\]|!\[|\[\^|(?:https?:\/\/|www\.)/i;

function inlineContent(token) {
  check(token?.type === 'inline' && Array.isArray(token.children), 'Expected inline text');
  const runs = [];
  const stack = [];
  function add(value) {
    if (!value) return;
    const marks = ['bold', 'italic'].filter((mark) => stack.includes(mark));
    const last = runs.at(-1);
    if (last && JSON.stringify(last.marks) === JSON.stringify(marks)) last.text += value;
    else runs.push({ text: value, marks });
  }
  for (const child of token.children) {
    if (child.type === 'text') add(child.content);
    else if (child.type === 'softbreak') add(' ');
    else if (child.type === 'strong_open' || child.type === 'em_open') stack.push(child.type === 'strong_open' ? 'bold' : 'italic');
    else if (child.type === 'strong_close' || child.type === 'em_close') {
      check(stack.pop() === (child.type === 'strong_close' ? 'bold' : 'italic'), 'Unbalanced emphasis');
    } else throw new Error(`Unsupported inline Markdown: ${child.type}`);
  }
  check(stack.length === 0 && runs.some((run) => run.text.trim()), 'Empty or unbalanced inline content');
  check(!forbidden.test(runs.map((run) => run.text).join('')), 'Links, embeds and footnotes are not supported');
  return runs.flatMap((run) => splitText(run.text).map((part) => ({ text: part, marks: [...run.marks] })));
}

export function parseBody(body) {
  text(body, 'Essay body');
  check(!forbidden.test(body), 'Links, embeds and footnotes are not supported');
  const environment = {};
  const tokens = markdown.parse(body, environment);
  check(!environment.references || Object.keys(environment.references).length === 0, 'Reference links are not supported');
  const blocks = [];
  let index = 0;
  function take(type) {
    const token = tokens[index++];
    check(token?.type === type, `Expected ${type}; found ${token?.type ?? 'end'}`);
    return token;
  }
  function paragraph() {
    take('paragraph_open');
    const content = inlineContent(take('inline'));
    take('paragraph_close');
    return content;
  }
  while (index < tokens.length) {
    const token = tokens[index];
    if (token.type === 'paragraph_open') blocks.push({ type: 'paragraph', content: paragraph() });
    else if (token.type === 'heading_open') {
      take('heading_open');
      const level = Number(token.tag.slice(1));
      check([2, 3, 4].includes(level) && /^#{2,4}$/.test(token.markup), 'Use ATX headings levels 2 through 4');
      const content = inlineContent(take('inline'));
      take('heading_close');
      blocks.push({ type: 'heading', level, content });
    } else if (token.type === 'blockquote_open') {
      take('blockquote_open');
      const paragraphs = [];
      while (tokens[index]?.type === 'paragraph_open') paragraphs.push(paragraph());
      take('blockquote_close');
      check(paragraphs.length > 0, 'Quotation must contain paragraphs');
      blocks.push({ type: 'quote', paragraphs });
    } else if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      const ordered = token.type === 'ordered_list_open';
      take(token.type);
      const start = ordered ? Number(token.attrGet('start') ?? 1) : 1;
      check(Number.isSafeInteger(start) && start > 0, 'List start must be positive');
      const items = [];
      while (tokens[index]?.type === 'list_item_open') {
        take('list_item_open');
        items.push(paragraph());
        take('list_item_close');
      }
      take(ordered ? 'ordered_list_close' : 'bullet_list_close');
      check(items.length > 0, 'List must not be empty');
      blocks.push({ type: 'list', ordered, start, items });
    } else throw new Error(`Unsupported block Markdown: ${token.type}`);
    check(blocks.length <= LIMITS.blocks, 'Essay block limit exceeded');
  }
  check(blocks.length > 0, 'Essay requires content blocks');
  return blocks;
}

export function parseEssay(input, label = 'Essay source') {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  check(bytes instanceof Uint8Array, `${label}: expected UTF-8 bytes or a string`);
  if (typeof input === 'string') check(input.isWellFormed(), `${label}: malformed Unicode`);
  check(bytes.byteLength <= LIMITS.essayBytes, `${label}: source byte limit exceeded`);
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n?/g, '\n');
  check(source.startsWith('---\n'), `${label}: frontmatter must start the file`);
  const end = source.indexOf('\n---\n', 4);
  check(end >= 0, `${label}: missing frontmatter closing delimiter`);
  const header = source.slice(4, end);
  check(!/^%/m.test(header), `${label}: YAML directives are unsupported`);
  const doc = parseDocument(header, { version: '1.2', schema: 'core', uniqueKeys: true, strict: true, stringKeys: true, resolveKnownTags: false, prettyErrors: false });
  check(doc.errors.length === 0 && doc.warnings.length === 0, `${label}: invalid or unsupported YAML`);
  visit(doc, (_key, node) => {
    check(!isAlias(node) && !node?.anchor && !node?.tag, `${label}: YAML aliases, anchors and explicit tags are unsupported`);
  });
  const frontmatter = validateFrontmatter(doc.toJS({ maxAliasCount: 0 }), label);
  const blocks = parseBody(source.slice(end + 5));
  const payload = { contractVersion: 1, id: frontmatter.essay_id, title: frontmatter.title, question: frontmatter.question, placeholder: frontmatter.placeholder, blocks };
  const json = serial(payload);
  byteLimit(json, LIMITS.essayBytes, 'Generated essay');
  return { frontmatter, payload, json, revision: digest(Buffer.from(json, 'utf8')) };
}
