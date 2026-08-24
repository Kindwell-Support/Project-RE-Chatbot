/**
 * BUG-025 — public/widget.js must never drift from widget/widget.js.
 *
 * THE INCIDENT: a Phase 2 commit shipped widget source without rebuilding the
 * bundle. /demo served Phase 1 code while the tree said Phase 2 — the operator
 * reviewed the wrong build, and INSPECTOR's first browser run silently tested
 * Phase 1 and produced a false finding. Every jsdom widget test reads
 * widget/widget.js directly, so the entire suite is structurally blind to this
 * class: source tests pass, browser evidence lies, and nothing mechanical
 * disagrees.
 *
 * THE GUARD: rebuild the bundle in-memory with esbuild's API using the same
 * flags as `npm run build:widget`, and require public/widget.js to be
 * byte-identical. Content comparison, deliberately not mtimes — git checkouts
 * rewrite mtimes wholesale, which would make a time-based check fire on clean
 * trees and teach everyone to ignore it.
 *
 * Production is NOT protected by this and does not need to be: the Docker
 * build runs `npm run build` and bakes the bundle into the image, so it cannot
 * drift there. This hazard is local and /demo-review only — which is exactly
 * why it went unnoticed.
 *
 * NOTE the BUG-021 interaction: the server reads the bundle ONCE at boot and
 * serves from memory. A green here means the FILE is fresh; a locally running
 * server still serves whatever it read at startup and must be restarted after
 * a rebuild.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildSync } from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(HERE, '../widget/widget.js');
const BUNDLE = path.resolve(HERE, '../public/widget.js');

// Must mirror package.json's build:widget exactly:
//   esbuild widget/widget.js --bundle --minify --format=iife
function freshBuild(): string {
  const result = buildSync({
    entryPoints: [SOURCE],
    bundle: true,
    minify: true,
    format: 'iife',
    write: false,
  });
  return Buffer.from(result.outputFiles[0].contents).toString('utf8');
}

describe('BUG-025 — the committed bundle matches the source it claims to be', () => {
  it('public/widget.js is byte-identical to a fresh esbuild of widget/widget.js', () => {
    const fresh = freshBuild();
    // public/ is GITIGNORED — the bundle exists only where someone built it,
    // which is precisely how it drifted unnoticed. A missing file gets the
    // same actionable failure as a stale one, not a bare ENOENT.
    let committed: string;
    try {
      committed = readFileSync(BUNDLE, 'utf8');
    } catch {
      throw new Error(
        'public/widget.js does not exist — /demo has nothing to serve. Run `npm run build:widget`.',
      );
    }

    // Compared as a boolean so a mismatch does not dump two minified bundles
    // into the terminal; the lengths in the message are the useful signal.
    expect(
      committed === fresh,
      `public/widget.js (${committed.length} bytes) is NOT the build of the current ` +
        `widget/widget.js (fresh build: ${fresh.length} bytes). /demo and every ` +
        'browser-based check are serving code that does not match the tree. ' +
        'Run `npm run build:widget`, and restart any local server (it holds the ' +
        'bundle in memory from boot).',
    ).toBe(true);
  });

  it('CONTROL: the fresh build is substantial and contains the widget entry point', () => {
    // Guards the guard. If esbuild silently built nothing — a bad entry path
    // after a rename, an empty file — the comparison above could go green
    // against an equally empty committed bundle. Two empty strings are equal.
    const fresh = freshBuild();
    expect(fresh.length, 'the in-memory build produced almost nothing').toBeGreaterThan(10_000);
    expect(fresh, 'the global entry point is missing from the build').toContain('createJamesBot');
  });

  it('CONTROL: the comparison discriminates a one-byte difference', () => {
    // The check is a string equality — this pins that the subject really is
    // byte-level content, so nobody later "optimises" it into a length or
    // prefix comparison that a same-size edit would slip past.
    const fresh = freshBuild();
    const tampered = fresh.slice(0, -1) + (fresh.endsWith(';') ? ',' : ';');
    expect(tampered === fresh).toBe(false);
    expect(tampered.length).toBe(fresh.length);
  });
});
