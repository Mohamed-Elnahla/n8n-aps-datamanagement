# Publishing to npm

The public package name is:

```text
n8n-nodes-community-autodesk-aps-data-management
```

It is published as an unscoped public package by the npm account `mohamed.elnahla`. The unscoped `n8n-nodes-` prefix is intentional: it satisfies n8n community-node discovery conventions. npm ownership is determined by the account/token that performs the first publish.

## Authentication model

Releases use npm trusted publishing. GitHub Actions obtains a short-lived OIDC
credential for each run, so the repository does not need an `NPM_TOKEN` secret.
The workflow grants only `contents: read` and the required `id-token: write`.

The package must already exist before npm lets you attach a trusted publisher.
For this package's first release, complete the bootstrap procedure below once.

## Bootstrap the first release

At the time this repository was prepared, the package did not yet exist on npm.
Create it interactively from a trusted local machine rather than putting a
long-lived publishing token in GitHub Actions:

1. Sign in to npm as `mohamed.elnahla` and enable account-level 2FA.
2. Install Node.js 22.14 or newer and npm 11.5.1 or newer.
3. Check out the exact release tag, install, validate, and inspect the tarball:

   ```bash
   git checkout v0.1.0
   npm ci --ignore-scripts
   npm run lint
   npm test
   npm pack --dry-run
   ```

4. Authenticate interactively and publish. npm may prompt in the browser or for
   a one-time password, depending on the account configuration:

   ```bash
   npm login
   npm whoami
   RELEASE_MODE=true npm publish --access public
   ```

`RELEASE_MODE=true` is required because this package's `prepublishOnly` guard
normally permits publishing only through the n8n release command in CI.

Do not create another `v0.1.0` publish after this succeeds; npm versions are
immutable. Return to `main` before making further changes:

```bash
git checkout main
```

The local bootstrap release will not have GitHub provenance. After configuring
trusted publishing, publish `v0.1.1` through the workflow and use that
provenance-backed version for n8n verification. Rerunning the failed `v0.1.0`
job would still use the old workflow stored in that tag, so do not rerun or
force-move the tag.

## Configure npm trusted publishing

After the first release exists, open the package on npmjs.com and go to
**Settings → Trusted Publisher**. Choose **GitHub Actions** and enter:

- Organization or user: `mohamedelnahla`
- Repository: `n8n-aps-datamanagement`
- Workflow filename: `publish.yml` (filename only, not the full path)
- Environment: leave blank
- Allowed action: `npm publish`

Then go to **Settings → Publishing access**, select **Require two-factor
authentication and disallow tokens**, and save. If an `NPM_TOKEN` repository
secret or an old npm automation token exists, delete/revoke it after trusted
publishing is configured.

The repository URL, workflow filename, owner, and repository name are
case-sensitive trust inputs. A mismatch will make publishing fail.

## Why the old token fails

The npm `E403` message stating that two-factor authentication or a granular
access token with bypass 2FA is required means the workflow's token cannot
satisfy the package's publishing policy. A normal read/write granular token is
not enough for unattended direct publishing, and npm is retiring direct
publishing with bypass-2FA tokens.

Do not weaken the package's 2FA policy. Use the interactive first-publish step
once, configure trusted publishing, and let subsequent GitHub Actions runs use
OIDC. A token can still be used separately with read-only permissions if the
project later needs to install private dependencies; this package currently
uses public dependencies only.

## Release workflow

`.github/workflows/publish.yml` runs only for tags matching `v*.*.*`.

The job:

1. Installs exactly from `package-lock.json` with `npm ci --ignore-scripts`; native scripts from development-only n8n dependencies are unnecessary for lint/build.
2. Verifies that the tag without `v` equals `package.json.version`.
3. Runs lint and tests.
4. Checks the production dependency audit.
5. Runs the official `n8n-node release` tooling. npm authenticates using the
   workflow's OIDC identity and automatically publishes provenance.

The workflow uses a GitHub-hosted runner and `id-token: write`, which allows npm to attach a provenance statement linking the published package to the repository, commit, and workflow.

## Create a release

Update the version and changelog:

```bash
npm version patch --no-git-tag-version
```

Use `minor` or `major` when appropriate. Then edit `CHANGELOG.md`, run checks, commit, and tag:

```bash
npm ci --ignore-scripts
npm run lint
npm test
npm pack --dry-run
git add package.json package-lock.json CHANGELOG.md
git commit -m "release: v0.1.1"
git tag v0.1.1
git push origin main
git push origin v0.1.1
```

The version in the tag must exactly match `package.json`.

## Package-name check

The chosen package name was unclaimed when this repository was prepared, but availability can change. Immediately before the first release, confirm:

```bash
npm view n8n-nodes-community-autodesk-aps-data-management
```

An npm `E404` means no public package currently exists under that name. If another owner claims it first, choose a new name, update all badges/docs/package metadata, and rerun validation.

## Verify publication

```bash
npm view n8n-nodes-community-autodesk-aps-data-management version dist-tags repository
npm install --dry-run n8n-nodes-community-autodesk-aps-data-management@latest
```

Also inspect the npm package page for the provenance badge and verify installation through a clean self-hosted n8n test instance.
