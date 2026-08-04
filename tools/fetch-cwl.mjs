#!/usr/bin/env node
// Fetch the TeXstudio .cwl command library into resources/cwl/.
//
// Why this exists: LaTeX ships no machine-readable command index, so editors
// rely on the community-maintained .cwl files that live in the TeXstudio repo.
// They are GPLv3 data, bundled as a mere aggregate (GPLv3 §5) — see the
// generated resources/cwl/LICENSE-cwl.md.
//
// Pinned to a commit in tools/cwl-version.json so a given Clavis tag always
// ships the same command set. Bump that file to sync with upstream.
//
// Fetched with a partial + sparse clone, which transfers ~6 MB. The first
// version streamed the repo tarball instead and moved 115 MB for the same 11 MB
// of data; that worked locally but aborted mid-download on a CI runner, since
// the tarball has no resolution short of "all of it". Cloning `completion/`
// alone also removes the hand-rolled tar parser, which was its own hazard —
// it silently dropped 11 files until the ustar prefix field was handled.
//
// Requires `git` on PATH. Every CI job that runs this already checks out with
// git, and the fallback for a machine without it is to bump nothing and keep
// whatever is in resources/cwl/.

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm, readdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'resources', 'cwl');
const STAMP = path.join(OUT_DIR, '.cwl-commit');

/** Per-attempt ceiling. A healthy clone takes ~25s; 5 min means it is wedged. */
const ATTEMPT_TIMEOUT_MS = 5 * 60 * 1000;
const ATTEMPTS = 3;

/** Run a command, rejecting on non-zero exit or timeout. */
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${cmd} ${args[0]} timed out after ${ATTEMPT_TIMEOUT_MS / 1000}s`));
    }, ATTEMPT_TIMEOUT_MS);
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}: ${stderr.trim().slice(0, 300)}`));
    });
  });
}

/**
 * Clone just `completion/` at the pinned commit into `dest`.
 *
 * A shallow fetch of one revision rather than `clone --depth 1`, because the
 * pinned commit is usually not the tip of any branch — cloning the branch and
 * then checking the commit out would need the full history in between.
 */
async function sparseClone(repo, commit, dest) {
  await mkdir(dest, { recursive: true });
  const git = (...args) => run('git', args, { cwd: dest });

  await git('init', '--quiet');
  await git('remote', 'add', 'origin', `https://github.com/${repo}.git`);
  await git('config', 'core.sparseCheckout', 'true');
  await git('config', 'extensions.partialClone', 'origin');
  // Take the bytes exactly as upstream stored them. Without this, git's
  // autocrlf rewrites LF to CRLF on Windows checkouts, so the same pinned
  // commit yields different files per platform — 497 of 4465 in practice. The
  // parser tolerates either, but platform-dependent build output is a trap
  // waiting for whoever next compares two machines.
  await git('config', 'core.autocrlf', 'false');
  await git('config', 'core.eol', 'lf');
  // blob:none keeps file contents out of the fetch until checkout asks for the
  // ones inside completion/.
  await git('fetch', '--depth', '1', '--filter=blob:none', '--quiet', 'origin', commit);
  await git('sparse-checkout', 'init', '--cone');
  await git('sparse-checkout', 'set', 'completion');
  await git('checkout', '--quiet', 'FETCH_HEAD');
}

async function withRetries(label, fn) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < ATTEMPTS) {
        // Linear backoff. The failures worth retrying here are transient network
        // ones, which clear in seconds rather than needing a long wait.
        const waitMs = attempt * 5000;
        console.log(`cwl: ${label} failed (${err.message}); retry ${attempt + 1}/${ATTEMPTS} in ${waitMs / 1000}s`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }
  }
  throw lastError;
}

async function main() {
  const version = JSON.parse(await readFile(path.join(ROOT, 'tools', 'cwl-version.json'), 'utf8'));
  const { repo, commit, expectFiles = 1 } = version;

  // Skip when the pinned commit is already on disk — this runs on every
  // `npm run dev`, and re-cloning each time would be rude.
  try {
    if ((await readFile(STAMP, 'utf8')).trim() === commit) {
      console.log(`cwl: up to date (${commit.slice(0, 8)})`);
      return;
    }
  } catch {
    // No stamp yet — fall through and fetch.
  }

  console.log(`cwl: fetching ${repo}@${commit.slice(0, 8)}`);
  const work = path.join(tmpdir(), `clavis-cwl-${commit.slice(0, 8)}`);
  await rm(work, { recursive: true, force: true });

  try {
    await withRetries('clone', async () => {
      await rm(work, { recursive: true, force: true });
      await sparseClone(repo, commit, work);
    });

    const from = path.join(work, 'completion');
    const files = (await readdir(from)).filter(name => name.endsWith('.cwl'));

    // Guard against silent shortfalls: an earlier tar-parsing gap cost 11 files
    // with >100-byte paths, and the only symptom was a slightly lower count.
    if (files.length < expectFiles) {
      throw new Error(
        `got only ${files.length} .cwl files, expected at least ${expectFiles}. ` +
        `Bump "expectFiles" in tools/cwl-version.json if upstream genuinely shrank.`,
      );
    }

    await rm(OUT_DIR, { recursive: true, force: true });
    await mkdir(OUT_DIR, { recursive: true });
    let bytes = 0;
    for (const name of files) {
      await copyFile(path.join(from, name), path.join(OUT_DIR, name));
    }
    for (const name of files) {
      bytes += (await readFile(path.join(OUT_DIR, name))).length;
    }

    await writeFile(STAMP, `${commit}\n`);
    await writeFile(path.join(OUT_DIR, 'LICENSE-cwl.md'), licenseText(repo, commit));
    console.log(`cwl: wrote ${files.length} files (${(bytes / 1048576).toFixed(1)} MB) to resources/cwl/`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function licenseText(repo, commit) {
  return `# Bundled LaTeX command library (\`.cwl\`)

The \`*.cwl\` files in this directory are **not** part of Clavis. They are the
community-maintained LaTeX completion word lists from the TeXstudio project,
fetched verbatim at build time by \`tools/fetch-cwl.mjs\`.

- **Source**: https://github.com/${repo}/tree/${commit}/completion
- **Pinned commit**: \`${commit}\`
- **License**: GNU General Public License v3 (see https://github.com/${repo}/blob/${commit}/COPYING)

The \`.cwl\` format originated in [Kile](https://kile.sourceforge.io/) and was
extended by TeXstudio to carry argument placeholders and semantic classifiers.
These files are the work of TeXstudio contributors over roughly two decades;
individual attribution is preserved in the header comments of each file.

They are included here as a **mere aggregate** in the sense of GPLv3 §5:

> Inclusion of a covered work in an aggregate does not cause this License to
> apply to the other parts of the aggregate.

Clavis reads and parses these files as data. It does not link against, derive
from, or incorporate TeXstudio's source code.

To update this library, bump \`commit\` in \`tools/cwl-version.json\` and re-run
\`node tools/fetch-cwl.mjs\`.
`;
}

main().catch(err => {
  console.error(`cwl: ${err.message}`);
  process.exit(1);
});
