/**
 * FINDING-030 — the suite-level guard: `npm run test:gated` is the merge gate.
 *
 * A collection failure reports "Test Files N failed / Tests no tests", and at
 * its worst it has collapsed ALL 67 files at once — which reads like
 * catastrophe ("67 files failed") while actually meaning NOTHING RAN. Both
 * mutation drivers already refuse to score that shape; this closes the last
 * place that did not: the top level a human actually looks at.
 *
 * A run that produces no passes is not a red suite; it is an UNRUN suite, and
 * the two must not be readable as the same thing. The guard:
 *   - exits non-zero when vitest does (real failures stay failures);
 *   - exits non-zero WITH ITS OWN LOUD BANNER when the passed count is zero
 *     or unparseable — even if vitest exited zero;
 *   - never retries silently: recurrence is the signal being tracked, so a
 *     collection failure must be SEEN, then rerun by a human/agent decision.
 *
 * The cause of the collection failures is deliberately undiagnosed (ruled:
 * the recurrence is the risk, not the cause). Extra vitest args pass through:
 *   npm run test:gated -- tests/foo.test.ts
 */
import { spawn } from 'node:child_process';

const args = ['vitest', 'run', ...process.argv.slice(2)];
const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
});

let output = '';
child.stdout.on('data', (d) => {
  output += String(d);
  process.stdout.write(d);
});
child.stderr.on('data', (d) => {
  output += String(d);
  process.stderr.write(d);
});

child.on('close', (code) => {
  const summary = output.match(/Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed/);
  const noTests = /Tests\s+no tests/.test(output);
  const passed = summary ? Number(summary[2]) : 0;

  if (noTests || !summary || passed === 0) {
    console.error('');
    console.error('='.repeat(72));
    console.error('GATED RUN REFUSED: ZERO TESTS PASSED — THIS SUITE DID NOT RUN.');
    console.error(
      noTests
        ? 'vitest reported "no tests": a COLLECTION FAILURE (FINDING-030), not a red suite.'
        : 'No parseable passed-count in the output — treat as a collection failure.',
    );
    console.error('Do NOT read any failed-file count above as real failures.');
    console.error('Clear the vitest cache and rerun; if it recurs, report it.');
    console.error('='.repeat(72));
    process.exit(3);
  }
  process.exit(code ?? 1);
});
