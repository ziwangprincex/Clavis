#!/usr/bin/env node
// Fetch the TeXstudio .cwl command library into resources/cwl/.
//
// Why this exists: LaTeX ships no machine-readable command index, so editors
// rely on the community-maintained .cwl files that live in the TeXstudio repo.
// They are GPLv3 data, bundled as a mere aggregate (GPLv3 §5) — see the
// generated resources/cwl/LICENSE-cwl.md.
//
// The download is pinned to a commit in tools/cwl-version.json so that a given
// Clavis tag always ships the same command set. Bump that file to sync.
//
// Streams a single repo tarball and keeps only completion/*.cwl. Fetching the
// ~4.5k files individually would trip GitHub's rate limiter. Tar is parsed
// inline rather than shelling out, because Windows runners have no tar we can
// rely on.

import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'resources', 'cwl');
const STAMP = path.join(OUT_DIR, '.cwl-commit');

const BLOCK = 512;

/** Parse a tar stream, invoking onFile for entries the filter accepts. */
async function untar(stream, wantPath, onFile) {
  let buf = Buffer.alloc(0);
  // Pending file body we are still accumulating across chunks.
  let pending = null;
  // Name carried over from a GNU LongLink header, if any.
  let longName = null;

  for await (const chunk of stream) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;

    for (;;) {
      if (pending) {
        // Tar pads every body out to a 512-byte boundary.
        const padded = Math.ceil(pending.size / BLOCK) * BLOCK;
        if (buf.length < padded) break;
        const body = buf.subarray(0, pending.size);
        if (pending.longLink) {
          // A GNU LongLink body *is* the next entry's path.
          longName = body.toString('utf8').replace(/\0.*$/, '');
        } else if (!pending.skip) {
          await onFile(pending.name, body);
        }
        buf = buf.subarray(padded);
        pending = null;
        continue;
      }

      if (buf.length < BLOCK) break;
      const header = buf.subarray(0, BLOCK);
      // Two consecutive zero blocks mark end of archive; one is enough for us.
      if (header[0] === 0) return;

      const strip = s => s.replace(/\0.*$/, '');
      const rawName = strip(header.subarray(0, 100).toString('utf8'));
      // POSIX ustar splits paths longer than 100 bytes across `prefix` (offset
      // 345) and `name`, joined by "/". Eleven deep tikzlibrary*.cwl paths hit
      // this; reading `name` alone silently truncated them out of the result.
      const prefix = strip(header.subarray(345, 500).toString('utf8'));
      const sizeField = strip(header.subarray(124, 136).toString('utf8')).trim();
      const size = parseInt(sizeField, 8) || 0;
      const typeFlag = String.fromCharCode(header[156]);
      buf = buf.subarray(BLOCK);

      // GNU tar instead emits a LongLink entry whose body is the real path.
      // GitHub's tarballs use ustar prefixes, but mirrors may differ.
      if (typeFlag === 'L') {
        pending = { name: rawName, size, longLink: true };
        continue;
      }

      const name = longName ?? (prefix ? `${prefix}/${rawName}` : rawName);
      longName = null;

      // '0' and '\0' are regular files; skip dirs, links, and pax headers.
      const isFile = typeFlag === '0' || typeFlag === '\0';
      const keep = isFile && wantPath(name);
      const padded = Math.ceil(size / BLOCK) * BLOCK;
      if (keep) {
        pending = { name, size };
      } else if (buf.length < padded) {
        // Body straddles chunks but we do not want it — skip it as it arrives.
        pending = { name, size, skip: true };
      } else {
        buf = buf.subarray(padded);
      }
    }
  }
}

async function main() {
  const version = JSON.parse(await readFile(path.join(ROOT, 'tools', 'cwl-version.json'), 'utf8'));
  const { repo, commit, expectFiles = 1 } = version;

  // Skip when the pinned commit is already on disk — this runs on every
  // `npm run dev`, and re-downloading 38 MB each time would be rude.
  try {
    if ((await readFile(STAMP, 'utf8')).trim() === commit) {
      console.log(`cwl: up to date (${commit.slice(0, 8)})`);
      return;
    }
  } catch {
    // No stamp yet — fall through and fetch.
  }

  const url = `https://codeload.github.com/${repo}/tar.gz/${commit}`;
  console.log(`cwl: fetching ${repo}@${commit.slice(0, 8)}`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} ${url}`);

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  // Archive entries are prefixed with "<repo>-<commit>/".
  const wanted = /(^|\/)completion\/[^/]+\.cwl$/;
  let count = 0;
  let bytes = 0;

  const gunzip = createGunzip();
  const body = Readable.fromWeb(res.body);
  // Pump through gunzip while untar consumes the other end.
  const pumping = pipeline(body, gunzip);

  await untar(
    gunzip,
    name => wanted.test(name),
    async (name, data) => {
      // Flatten: completion/amsmath.cwl -> resources/cwl/amsmath.cwl
      const base = path.basename(name);
      await writeFile(path.join(OUT_DIR, base), data);
      count++;
      bytes += data.length;
    },
  );

  await pumping;

  if (count === 0) throw new Error('no .cwl files found in archive — did the upstream layout change?');
  // Guard against silent shortfalls: a tar-parsing gap once cost 11 files with
  // >100-byte paths, and the only symptom was a slightly lower count.
  if (count < expectFiles) {
    throw new Error(
      `extracted only ${count} .cwl files, expected at least ${expectFiles}. ` +
      `Bump "expectFiles" in tools/cwl-version.json if upstream genuinely shrank.`,
    );
  }

  await writeFile(STAMP, `${commit}\n`);
  await writeFile(path.join(OUT_DIR, 'LICENSE-cwl.md'), licenseText(repo, commit));

  console.log(`cwl: wrote ${count} files (${(bytes / 1048576).toFixed(1)} MB) to resources/cwl/`);
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
