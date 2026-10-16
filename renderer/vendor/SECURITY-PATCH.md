# Local sprintf-js patch

This is upstream **1.1.3 plus a local patch**, identified as `1.1.3-local.1`.
The previous `1.1.4` metadata was local and must not be interpreted as an upstream release.

Upstream advisory: https://github.com/advisories/GHSA-hp3w-g68c-fv3c
As checked on 2026-10-16, it lists `<=1.1.3` affected and no patched release.
The user approved keeping and verifying the existing local patch during this review.

Both `sprintf.js` and `src/sprintf.js` clamp floating-point precision:

- `%e` / `%f`: at most 100.
- `%g`: between 1 and 100.

The patch is retained unchanged. `npm test` checks both copies, normal formatting,
large precision, and zero precision for `%g`. The advisory concerns untrusted format
strings. Here the dependency is used by the development-only `roarr` logging chain;
renderer input is not passed to it. Width, total output length and format cache are
not globally bounded: this local patch is **not** a general guarantee for hostile
format strings. Do not reuse it for untrusted format-string APIs without review.

The build copies `renderer/vendor` into the application archive. These vendor files
are present in the installed app, but neither application HTML page loads them;
the active use found in this review is the build-time logging dependency.

The root `file:` dependency and override intentionally select this local copy.
`npm audit` does not establish the safety of locally modified code. Keep this note
and regression tests when upgrading or replacing the build toolchain.
