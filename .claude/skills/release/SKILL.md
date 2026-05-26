---
name: release
description: Tag a new version and trigger the npm publish workflow for @sirosuzume/mcp-tsmorph-refactor. Use when the user says "リリース", "release", "タグを打って", "v1.x.y にバージョンを上げて", "npm に出して" or similar.
---

# Release a new version

This package publishes to npm via tag-triggered GitHub Actions.
**Git tag is the single source of truth for the version** — there is no
`package.json` bump step. `release.yml` reads the tag, bakes the value into
`src/version.ts` and `package.json`, then `pnpm publish`s with provenance.

## Pre-flight checks

1. Confirm we are on `main` and clean:
   ```bash
   git checkout main && git pull --ff-only
   git status --short    # must be empty
   ```
2. Confirm the last CI run on main is green (recent merge passed checks).
3. Decide the new version. Default rule:
   - `feat:` commit since last tag → minor bump (1.X.0)
   - `fix:` only → patch bump (1.0.X)
   - Breaking change → major bump (X.0.0)
   - When in doubt, ask the user.
   - **Stable SemVer only.** Prerelease tags (`v1.2.0-rc.1`), build metadata
     (`v1.2.0+build.5`), and leading zeros (`v01.02.03`) are rejected by both
     the workflow trigger and `scripts/release-version.mjs`. If a prerelease
     channel is needed, update the workflow glob, the script's STRICT_SEMVER,
     and this skill together.
4. Verify the planned tag does not already exist:
   ```bash
   git tag --list 'v*' | sort -V | tail -5
   ```

## Steps

1. Confirm the target version with the user if they did not specify it
   explicitly.
2. Create and push the tag:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
3. Watch the release workflow until it finishes:

   ```bash
   gh run list -R SiroSuzume/mcp-ts-morph --workflow=release.yml --limit 1
   gh run watch <id> --exit-status
   ```

   The workflow performs in order:
   - Install dependencies
   - Resolve version from tag ref (strict SemVer, no prerelease)
   - `pnpm test` (run against the placeholder `0.0.0-development`)
   - **Bake VERSION** into `src/version.ts` and `package.json` via
     `node scripts/release-version.mjs --bake <version>`
   - `pnpm build`
   - Verify `dist/version.js` contains the exact baked line
   - Strip internal `_version_note` from `package.json`
   - `pnpm publish --provenance` via npm Trusted Publishing (OIDC)

4. Confirm the package is live:
   ```bash
   npm view @sirosuzume/mcp-tsmorph-refactor version
   ```

## Failure recovery

- If `pnpm test` or `Verify baked version` fails inside the workflow,
  **do not delete the tag**. Fix forward: push a fix commit to main, then
  create the next patch tag (`vX.Y.(Z+1)`).
- If `pnpm publish` fails (e.g. Trusted Publishing transient error),
  check `gh run view <id> --log` and either re-run the failed job, or
  publish the next patch tag.

## Things to NOT do

- Do not edit `package.json` `"version"` — it is intentionally pinned at
  `0.0.0-development` (see the `_version_note` field in the file).
- Do not edit `src/version.ts` to change the literal — same reason.
- Do not tag without explicit user approval for the version (semver
  decisions matter to consumers of the package).
- Do not skip the tag — the publish workflow only fires on tag push.
