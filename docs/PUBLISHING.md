# Publishing to npm

The public package name is:

```text
n8n-nodes-community-autodesk-aps-data-management
```

It is published as an unscoped public package by the npm account `mohamed.elnahla`. The unscoped `n8n-nodes-` prefix is intentional: it satisfies n8n community-node discovery conventions. npm ownership is determined by the account/token that performs the first publish.

## One-time npm setup

1. Sign in to npm as `mohamed.elnahla`.
2. Enable two-factor authentication on the account.
3. Create a granular npm access token:
   - Package access: the package above, or permission to create/publish it for the first release.
   - Permissions: read and write.
   - Configure 2FA bypass only if npm requires it for CI publishing.
4. Copy the token once and store it only in GitHub Actions secrets.

## One-time GitHub setup

In `mohamedelnahla/n8n-aps-datamanagement`:

1. Open **Settings → Secrets and variables → Actions**.
2. Select **New repository secret**.
3. Name it exactly `NPM_TOKEN`.
4. Paste the granular token from npm.

Never add the token to `.npmrc`, `.env`, workflow YAML, issues, logs, or commits.

## Release workflow

`.github/workflows/publish.yml` runs only for tags matching `v*.*.*`.

The job:

1. Installs exactly from `package-lock.json` with `npm ci --ignore-scripts`; native scripts from development-only n8n dependencies are unnecessary for lint/build.
2. Runs `npm whoami` and refuses to continue unless the token belongs to `mohamed.elnahla`.
3. Verifies that the tag without `v` equals `package.json.version`.
4. Runs lint and tests.
5. Checks the production dependency audit.
6. Runs the official `n8n-node release` tooling, which publishes publicly with npm provenance.

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

## First release

The chosen package name was unclaimed when this repository was prepared, but availability can change. Immediately before the first release, confirm:

```bash
npm view n8n-nodes-community-autodesk-aps-data-management
```

An npm `E404` means no public package currently exists under that name. If another owner claims it first, choose a new name, update all badges/docs/package metadata, and rerun validation.

## Trusted publishing alternative

npm supports OIDC trusted publishers, which avoids a long-lived `NPM_TOKEN`. After the package exists, it can be configured to trust:

- GitHub owner: `mohamedelnahla`
- Repository: `n8n-aps-datamanagement`
- Workflow: `publish.yml`

If migrating to trusted publishing, test it before removing the token secret, then revoke unused npm tokens.

## Verify publication

```bash
npm view n8n-nodes-community-autodesk-aps-data-management version dist-tags repository
npm install --dry-run n8n-nodes-community-autodesk-aps-data-management@latest
```

Also inspect the npm package page for the provenance badge and verify installation through a clean self-hosted n8n test instance.
