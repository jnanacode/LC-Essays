import { createHash } from 'node:crypto';

export const LIMITS = Object.freeze({ sets: 200, perSet: 20, essays: 1000, essayBytes: 262144, manifestBytes: 1048576, blocks: 2000, runUnits: 4096 });
export function check(condition, message) {
  if (!condition) throw new Error(message);
}
export function exact(value, keys, label) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: expected an object`);
  const actual = Object.keys(value).sort();
  check(JSON.stringify(actual) === JSON.stringify([...keys].sort()), `${label}: missing or unknown fields`);
}
export function text(value, label) {
  check(typeof value === 'string' && value.trim().length > 0 && value.isWellFormed(), `${label}: expected nonblank well-formed text`);
  return value;
}
export function id(value, label) {
  check(typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value), `${label}: invalid identity`);
  return value;
}
export function serial(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
export function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
export function byteLimit(value, maximum, label) {
  check(Buffer.byteLength(value, 'utf8') <= maximum, `${label}: byte limit exceeded`);
}
export function splitText(value) {
  check(typeof value === 'string' && value.isWellFormed(), 'Inline text: malformed Unicode');
  const result = [];
  let offset = 0;
  while (offset < value.length) {
    let end = Math.min(value.length, offset + LIMITS.runUnits);
    const unit = value.charCodeAt(end - 1);
    if (end < value.length && unit >= 0xd800 && unit <= 0xdbff) end -= 1;
    result.push(value.slice(offset, end));
    offset = end;
  }
  return result;
}
export function validateFrontmatter(value, label = 'Essay') {
  exact(value, ['essay_id', 'title', 'set_id', 'position', 'publish', 'question', 'placeholder'], label);
  id(value.essay_id, `${label} essay_id`);
  id(value.set_id, `${label} set_id`);
  text(value.title, `${label} title`);
  text(value.question, `${label} question`);
  check(Number.isSafeInteger(value.position) && value.position > 0, `${label}: invalid position`);
  check(typeof value.publish === 'boolean' && typeof value.placeholder === 'boolean', `${label}: flags must be booleans`);
  return { ...value };
}
function memberships(sets, includePublish) {
  check(Array.isArray(sets) && sets.length <= LIMITS.sets, 'Invalid set collection or set limit');
  const setIds = new Set();
  const essayIds = new Set();
  return sets.map((set) => {
    exact(set, includePublish ? ['id', 'title', 'publish', 'essayIds'] : ['id', 'essayIds'], 'Set');
    id(set.id, 'Set id');
    check(!setIds.has(set.id), `Duplicate set: ${set.id}`);
    setIds.add(set.id);
    if (includePublish) {
      text(set.title, 'Set title');
      check(typeof set.publish === 'boolean', 'Set publish must be boolean');
    }
    check(Array.isArray(set.essayIds) && set.essayIds.length > 0 && set.essayIds.length <= LIMITS.perSet, `Invalid membership: ${set.id}`);
    const members = set.essayIds.map((member) => {
      id(member, 'Essay membership');
      check(!essayIds.has(member), `Duplicate essay membership: ${member}`);
      essayIds.add(member);
      return member;
    });
    check(essayIds.size <= LIMITS.essays, 'Essay limit exceeded');
    return includePublish ? { id: set.id, title: set.title, publish: set.publish, essayIds: members } : { id: set.id, essayIds: members };
  });
}
export function validateSets(value) {
  exact(value, ['contractVersion', 'sets'], 'Set declarations');
  check(value.contractVersion === 1, 'Unsupported set contract version');
  return { contractVersion: 1, sets: memberships(value.sets, true) };
}
export function validateLedger(value) {
  exact(value, ['contractVersion', 'sets'], 'Publication ledger');
  check(value.contractVersion === 1, 'Unsupported ledger version');
  return { contractVersion: 1, sets: memberships(value.sets, false) };
}
export function nextLedger(declarations, previous) {
  const current = validateSets(declarations);
  const ledger = validateLedger(previous);
  const oldIds = new Set(ledger.sets.map((set) => set.id));
  const oldMembers = new Set(ledger.sets.flatMap((set) => set.essayIds));
  let previousIndex = -1;
  for (const old of ledger.sets) {
    const index = current.sets.findIndex((set) => set.id === old.id);
    check(index > previousIndex, `Released set missing or reordered: ${old.id}`);
    previousIndex = index;
    check(JSON.stringify(current.sets[index].essayIds) === JSON.stringify(old.essayIds), `Released membership changed: ${old.id}`);
  }
  const additions = [];
  for (let index = 0; index < current.sets.length; index += 1) {
    const set = current.sets[index];
    if (oldIds.has(set.id) || !set.publish) continue;
    check(index > previousIndex, `New published sets must follow released sets: ${set.id}`);
    for (const member of set.essayIds) check(!oldMembers.has(member), `Released essay identity reused: ${member}`);
    additions.push({ id: set.id, essayIds: [...set.essayIds] });
  }
  return validateLedger({ contractVersion: 1, sets: [...ledger.sets, ...additions] });
}
export function validateMembership(declarations, frontmatters) {
  const current = validateSets(declarations);
  check(Array.isArray(frontmatters) && frontmatters.length <= LIMITS.essays, 'Invalid essay collection or limit');
  const byId = new Map();
  for (const value of frontmatters) {
    const essay = validateFrontmatter(value);
    check(!byId.has(essay.essay_id), `Duplicate essay source: ${essay.essay_id}`);
    byId.set(essay.essay_id, essay);
  }
  const declared = new Set();
  for (const set of current.sets) {
    set.essayIds.forEach((member, index) => {
      declared.add(member);
      const essay = byId.get(member);
      check(essay !== undefined, `Missing essay source: ${member}`);
      check(essay.set_id === set.id && essay.position === index + 1, `Inconsistent set or position: ${member}`);
      check(!set.publish || essay.publish, `Published set contains unpublished essay: ${member}`);
    });
  }
  for (const essay of byId.values()) check(!essay.publish || declared.has(essay.essay_id), `Published orphan essay: ${essay.essay_id}`);
  return { declarations: current, essays: byId };
}
