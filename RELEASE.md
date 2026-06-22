# Releasing falsegreen-js

Publishing to npm uses Trusted Publishing (OIDC) through `.github/workflows/release.yml`.
No long-lived `NPM_TOKEN`: the publish job proves its identity to the npm registry with a
short-lived OIDC credential and attaches build provenance.

## One-time setup (before the first publish)

### 1. npm Trusted Publisher

On npmjs.com, configure a trusted publisher for the package `falsegreen-js`:

- GitHub owner: `vinicq`
- Repository: `falsegreen-js`
- Workflow: `release.yml`

Note: a brand-new package name sometimes needs one initial manual `npm publish` to claim
the name before OIDC publishing works, depending on npm policy at the time.

### 2. (fallback) NPM_TOKEN

If trusted publishing is unavailable, create an automation token on npm and add it as the
`NPM_TOKEN` repository secret, then set `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` on the
publish step.

## Publishing a version

1. Bump `version` in `package.json` and the `VERSION` constant in `src/cli.ts` (and the
   `VERSION` in any doc) in lockstep.
2. Move the `[Unreleased]` entries in `CHANGELOG.md` under the new version with today's date.
3. Run the self-scan: `npm run build && node dist/cli.js test`. It must report zero HIGH
   findings before tagging.
4. Commit: `git add -A && git commit -m "release: X.Y.Z"`.
5. Tag and push: `git tag -a vX.Y.Z -m "falsegreen-js vX.Y.Z" && git push origin main --tags`.
6. Create the GitHub release: `gh release create vX.Y.Z --generate-notes`. Publishing the
   release fires `release.yml`, which builds, tests, and publishes to npm.

Confirm it is live: <https://www.npmjs.com/package/falsegreen-js>

## Version scheme

[Semantic Versioning](https://semver.org/spec/v2.0.0.html):
- **PATCH** (`0.x.Y`): bug fixes, false-positive fixes, docs.
- **MINOR** (`0.X.0`): new detection codes, new config options, backward-compatible features.
- **MAJOR** (`X.0.0`): breaking changes to the CLI, config format, or output structure.
