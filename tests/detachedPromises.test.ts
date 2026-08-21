/**
 * BUG-022 — every detached promise in the request path carries its own
 * rejection handler.
 *
 * A `void`-detached promise with no `.catch()` is an unhandled rejection away
 * from terminating the process on Node 15+. `logExchange` has carried that
 * guarantee at its call site since it was written, with a comment saying so;
 * `touchChat` did not, and the asymmetry read as accidental rather than
 * decided.
 *
 * THE SUBJECT HERE IS STRUCTURAL, DELIBERATELY. Both callees swallow their own
 * errors today, so no input reaches a rejection and a behavioural test would
 * pass identically with the `.catch()` deleted — it would measure the callees,
 * not the call site. The property actually being fixed is that the call site
 * stops depending on an invariant that lives in a different file and is
 * asserted nowhere near it. That property is visible only in the shape of the
 * call, so that is what is asserted.
 *
 * The vacuity trap this file is written around: "every detached promise has a
 * catch" is trivially true of a codebase with no detached promises, and would
 * stay green if a refactor moved these calls somewhere the scan does not look.
 * So the sweep asserts WHAT IT FOUND before it asserts anything about it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

function sourceFiles(dir: string): string[] {
  const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * The full `void ...;` statement starting at `from`, with nesting respected.
 *
 * A regex cannot do this: these statements span dozens of lines and contain
 * their own parentheses, braces and semicolons inside callback bodies, so
 * "up to the next semicolon" would truncate mid-callback and report a missing
 * catch on a statement that has one.
 */
function detachedStatement(text: string, from: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    const prev = text[i - 1];
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      i = text.indexOf('\n', i);
      if (i === -1) break;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ';' && depth === 0) return text.slice(from, i + 1);
  }
  return text.slice(from);
}

interface Detached {
  file: string;
  callee: string;
  statement: string;
}

function findDetached(): Detached[] {
  const found: Detached[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    const pattern = /\bvoid\s+([A-Za-z_$][\w$.]*)\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      found.push({
        file: path.relative(SRC, file).replace(/\\/g, '/'),
        callee: match[1],
        statement: detachedStatement(text, match.index),
      });
    }
  }
  return found;
}

describe('detached promises in src/', () => {
  const detached = findDetached();

  it('PRECONDITION: the sweep actually finds the known detached calls', () => {
    // Without this the whole file passes vacuously the moment a rename, a
    // refactor or a broken scanner stops matching anything.
    const callees = detached.map((d) => d.callee).sort();
    expect(callees, 'the sweep found nothing — it is not looking where the code is').not.toEqual(
      [],
    );
    expect(callees).toContain('touchChat');
    expect(callees).toContain('logExchange');
  });

  it('PRECONDITION: the statement extractor spans the whole multi-line call', () => {
    // The extractor is the part most likely to be quietly wrong. touchChat's
    // statement contains a `.then()` with a callback body; if extraction
    // stopped at the first semicolon it would end inside that body, and the
    // catch assertion below would be reading a fragment.
    const touch = detached.find((d) => d.callee === 'touchChat')!;
    expect(touch.statement).toContain('generateChatTitle');
    expect(touch.statement.trimEnd().endsWith(';')).toBe(true);
  });

  it('every one of them terminates in a .catch()', () => {
    const naked = detached.filter((d) => !/\.catch\s*\(/.test(d.statement));
    expect(
      naked.map((d) => `${d.file}: void ${d.callee}(…)`),
      'a detached promise with no rejection handler can terminate the process on Node 15+',
    ).toEqual([]);
  });

  it('BUG-022: touchChat carries the guarantee at its OWN call site', () => {
    // Named specifically rather than left to the sweep, because this is the
    // one the finding was written about and the sweep would still pass if it
    // were the only site and someone deleted both it and its catch together.
    const touch = detached.find((d) => d.callee === 'touchChat')!;
    expect(touch.file).toBe('server/app.ts');
    expect(touch.statement).toMatch(/\.catch\s*\(/);
  });

  it('CONTROL: the check can tell a naked detached call from a handled one', () => {
    // The assertion that makes the three above mean something. Without it, a
    // predicate that returned "handled" for every input would pass them all.
    const handled = 'void doThing(a, b).then(() => { if (x) return; }).catch((e) => log(e));';
    const nakedCall = 'void doThing(a, b).then(() => { if (x) return; });';
    expect(/\.catch\s*\(/.test(detachedStatement(handled, 0))).toBe(true);
    expect(/\.catch\s*\(/.test(detachedStatement(nakedCall, 0))).toBe(false);
  });

  it('CONTROL: a catch belonging to a DIFFERENT statement is not miscredited', () => {
    // The precise way this check could pass for the wrong reason: two detached
    // calls in a row where only the first is handled. Extraction must stop at
    // the first statement boundary, or the second would inherit the first's
    // catch — which is exactly the app.ts layout, logExchange followed by
    // touchChat.
    const pair =
      'void first().catch((e) => log(e));\n\nvoid second().then(() => run());';
    const secondAt = pair.indexOf('void second');
    expect(/\.catch\s*\(/.test(detachedStatement(pair, secondAt))).toBe(false);
  });
});
