// Version is the single source of truth for the MCP server's reported
// version (returned via initialize -> serverInfo.version). The literal below
// is rewritten at release time by .github/workflows/release.yml — see
// "Bake VERSION from tag" step — and the same value is mirrored into
// package.json "version" before `pnpm publish`.
//
// During local development and tests, the literal stays at
// "0.0.0-development" so we can tell unreleased builds apart from
// published ones at a glance.
//
// Do NOT bump this by hand. The release flow is: `git tag vX.Y.Z && git push
// origin vX.Y.Z` — CI handles the rest.
export const VERSION = "0.0.0-development";
