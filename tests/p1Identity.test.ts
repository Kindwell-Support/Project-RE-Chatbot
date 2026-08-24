/**
 * P1 — the three protected mechanisms are byte-identical to the Phase 1
 * baseline (2dfc31e), asserted IN THE SUITE rather than by a hand-run script.
 *
 * stale(op), the op.cleanup inerting block, and the call-time session-id reads
 * are what stop chat A's late-arriving answer painting into chat B. INSPECTOR
 * could not break them across two adversarial passes, and this is the layout
 * phase — the phase most likely to move them by accident. Until now they were
 * pinned by nothing that runs: the byte comparison lived in a scratch script
 * (then tools/qa/p1_identity.py), and a suite that never runs a check does not
 * have that check.
 *
 * SITE-COUNT RECONCILIATION (operator item). INSPECTOR counted THREE
 * payload/URL session-id sites; an earlier report of mine said FOUR. INSPECTOR
 * is right about the payload class: the three requests that carry a session id
 * are the /chat message body, the /chat form-submission body, and the /history
 * URL. My four were the four pinned REGIONS — which included the sessionId
 * declaration and ensureChatId's mint, neither of which is a request site, and
 * MISSED the /history URL read, which is one. Both errors are corrected here:
 * the region list below covers all three payload sites plus the two
 * supporting mechanisms, and the census case pins the payload count at
 * exactly three.
 *
 * Every region is located by anchors that must match EXACTLY ONCE in each
 * revision — an extractor that matched nothing in both would hash two empty
 * strings and report identity, so ambiguity is a failure, never a fallback.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASELINE_REV = '2dfc31e';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.resolve(HERE, '../widget/widget.js');

const current = readFileSync(SOURCE_PATH, 'utf8');
const baseline = execSync(`git show ${BASELINE_REV}:widget/widget.js`, {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
  cwd: path.resolve(HERE, '..'),
});

interface Region {
  label: string;
  start: string;
  end: string;
}

const REGIONS: Region[] = [
  {
    label: 'P1a stale(op) — the generation check',
    start: '      /** True when this operation belongs to a chat the member has left. */',
    end: '      }\n',
  },
  {
    label: 'P1b op.cleanup inerting — resetChatState steps 1 and 2',
    start: '        // 1. Invalidate every callback that is already scheduled.',
    end: '        inFlight.length = 0;\n',
  },
  {
    label: 'P1c sessionId declaration (supporting mechanism, not a request site)',
    start: '    // The owner key is per-device and long-lived; the chat id is per-chat and',
    end: '    var sessionId = null;\n',
  },
  {
    label: 'P1c ensureChatId — the synchronous mint (supporting mechanism, not a request site)',
    start: '      function ensureChatId() {',
    end: '        return sessionId;\n      }\n',
  },
  {
    label: 'P1c payload site 1/3 — /chat form-submission body reads sessionId at call time',
    start: '            // Read at CALL time, never closed over at render time: a form card',
    end: '            session_id: sessionId,\n',
  },
  {
    label: 'P1c payload site 2/3 — /chat message body reads via ensureChatId at call time',
    start: '        var chatId = ensureChatId();',
    end: '            session_id: chatId,\n',
  },
];

/**
 * Payload site 3/3 — the /history URL. Pinned as a single LINE rather than a
 * region: loadHistory's surrounding body legitimately changed in Slice 1
 * (skeleton, error handling), and P1 protects the call-time read, not the
 * slice's additions around it. For one line, "appears exactly once in both
 * revisions" IS the byte-identity claim.
 */
const HISTORY_URL_READ =
  "        safeFetch(apiUrl + '/history?session_id=' + encodeURIComponent(sessionId), init)\n";

function extract(text: string, region: Region, rev: string): string {
  const n = text.split(region.start).length - 1;
  if (n !== 1) {
    throw new Error(`${region.label}: start anchor matched ${n} times in ${rev}`);
  }
  const begin = text.indexOf(region.start);
  const rest = text.slice(begin);
  const stop = rest.indexOf(region.end);
  if (stop === -1) throw new Error(`${region.label}: end anchor never matched in ${rev}`);
  return rest.slice(0, stop + region.end.length);
}

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describe(`P1 mechanisms are byte-identical to ${BASELINE_REV}`, () => {
  for (const region of REGIONS) {
    it(region.label, () => {
      const then = extract(baseline, region, BASELINE_REV);
      const now = extract(current, region, 'the working tree');
      expect(
        sha(now),
        `${region.label} has DIVERGED from ${BASELINE_REV}. This mechanism is load-bearing ` +
          'for chat isolation and is pinned for all of Phase 2; if the change is ' +
          'deliberate it needs an operator ruling, not a re-point.',
      ).toBe(sha(then));
      // An empty extraction hashing equal to an empty extraction is the trap
      // this guards; regions are required to have substance.
      expect(now.length, 'the extracted region is suspiciously small').toBeGreaterThan(80);
    });
  }

  it('payload site 3/3 — the /history URL read, byte-identical as a line', () => {
    expect(
      current.split(HISTORY_URL_READ).length - 1,
      'the /history call-time read changed or duplicated',
    ).toBe(1);
    expect(
      baseline.split(HISTORY_URL_READ).length - 1,
      `precondition: the pinned line is not what ${BASELINE_REV} actually shipped`,
    ).toBe(1);
  });

  it('census: exactly THREE payload/URL session-id request sites exist', () => {
    // INSPECTOR's count, pinned so a fourth cannot appear unannounced. A new
    // request that carries a session id is a new chat-isolation surface and
    // must be added here (and to the regions above) deliberately.
    const sites = [
      'session_id: sessionId,', // form submission body
      'session_id: chatId,', // message body
      "'/history?session_id='", // history URL
    ];
    for (const site of sites) {
      expect(current.split(site).length - 1, `payload site missing or duplicated: ${site}`).toBe(1);
    }
    // The census is only exhaustive if nothing ELSE writes a session_id into a
    // request. Count every session_id occurrence that looks like a payload key
    // and require it to be one of the three above.
    const bodyKeys = current.match(/session_id:/g) ?? [];
    expect(bodyKeys.length, 'a session_id body write this census does not know about').toBe(2);
    const urlKeys = current.match(/session_id=/g) ?? [];
    expect(urlKeys.length, 'a session_id URL write this census does not know about').toBe(1);
  });

  it('CONTROL: the extractor reports divergence for a one-character change', () => {
    // The tool version was proven against a real mutation of the source; the
    // committed test proves itself the same way, in-memory. Without this, an
    // extractor broken into matching nothing — or a sha of the wrong span —
    // could report identity forever.
    const region = REGIONS[0];
    const tampered = current.replace('op.gen !== generation', 'op.gen != generation');
    expect(tampered, 'precondition: the tamper target exists').not.toBe(current);
    expect(sha(extract(tampered, region, 'tampered'))).not.toBe(
      sha(extract(current, region, 'the working tree')),
    );
  });
});
