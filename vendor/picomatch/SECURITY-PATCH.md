# Local security fork of picomatch

Source: npm `picomatch@4.0.7`, https://github.com/micromatch/picomatch/tree/4.0.7.
All five `lib/` files, `index.js`, `posix.js`, README and MIT license were copied
from that release. Only `lib/parse.js` has source changes. The scoped package
name and prerelease version explicitly identify our maintained fork, rather
than claiming an upstream fixed release. This is not a metadata-only rename.

## CVE-2026-112366 / GHSA-fc5q-39xc-vjpf

https://github.com/advisories/GHSA-fc5q-39xc-vjpf reports no fixed upstream
release as of 2026-11-18 (npm latest: 4.0.7). A single branch such as `+(*)`
or `+(*a)` compiles an unbounded wildcard inside a repeated extglob, causing
exponential regex backtracking on a failing input. The existing upstream
branch-count check does not protect these patterns.

Our parser checks every branch for unescaped `*`, `+` or nested optional
extglobs outside character classes and quotes. Risky repeated extglobs use
upstream's existing literalization fallback. Escape and quote rules, ordinary
globs, simple literal extglobs and upstream's safe character-class flattening
remain supported. The new wildcard guard also applies when callers set
`maxExtglobRecursion: false`. In that explicit opt-out case potentially nested
repeats are conservatively literalized rather than using the flattening path.
Complex repeated wildcard extglobs intentionally no longer match arbitrary
strings. They can still match their literal spelling. This is the compatibility
tradeoff of the fix; no build-tool caller in this repository requires them.

## Dependency and audit behavior

`pnpm-workspace.yaml` redirects every transitive `picomatch` dependency to this
local directory in `pnpm-lock.yaml`; Git pins the actual source contents.
`UPSTREAM.json` records the npm tarball integrity and original file hashes.
Docker copies the fork
before the frozen install. There is no registry override, advisory allowlist,
severity change or audit suppression. `pnpm audit --audit-level low` remains
unchanged and checks the rest of the dependency tree. As with all vendored code,
the registry cannot audit our private fork automatically: the security tests
and provenance below are an additional explicit maintenance obligation.

`scripts/picomatch-security.test.cjs` exercises both entrypoints, direct regex
and parser APIs, opt-out options, adversarial strings with a process deadline,
and normal matching behavior. It also checks every installed picomatch alias
resolves to this scoped fork, so an unpatched upstream copy cannot silently
re-enter the graph. `scripts/build-dependencies-smoke.cjs` and the complete
desktop checks validate consumers and packaging.

The unchanged upstream 4.0.7 suite was also run against the fork: 1,936 of 1,983
tests pass. The 47 differences expect complex repeated wildcard/nested extglob
matching or disabling its protection, which this patch deliberately literalizes.
This is not a claim that the unmodified upstream suite passes completely.
The repository's compatibility tests exercise the actual installed consumers.
`.gitattributes` preserves LF for this directory so upstream hashes stay valid
on Windows as well as Linux.

Run `node --test scripts/picomatch-security.test.cjs`. CI runs it from the
existing build-dependency compatibility check, without relaxing audit.
Replace the fork with an official fixed release when one exists, after running
these regression cases, the audit, desktop tests and the Docker web build.
