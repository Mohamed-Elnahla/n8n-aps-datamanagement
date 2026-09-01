# Installation

This package is an unofficial community node for self-hosted n8n.

## Package name

```text
n8n-nodes-community-autodesk-aps-data-management
```

The npm package is published by the npm account `mohamed.elnahla`.

## Install through the n8n interface

1. Sign in to your self-hosted n8n instance as an owner or administrator.
2. Open **Settings → Community Nodes**.
3. Select **Install a community node**.
4. Enter `n8n-nodes-community-autodesk-aps-data-management`.
5. Review and accept n8n's community-node warning.
6. Select **Install**.

The node appears as **Autodesk APS Data Management (Community)**.

If **Community Nodes** is not visible, confirm that your n8n edition and deployment allow unverified community packages. Administrators can disable community packages through n8n configuration.

## Manual npm installation

Install the package in the environment where n8n loads community nodes:

```bash
npm install n8n-nodes-community-autodesk-aps-data-management
```

Restart n8n after installation.

## Docker considerations

An installation performed inside a temporary container disappears when the container is replaced. Use one of these approaches:

- Install from the n8n Community Nodes interface while `/home/node/.n8n` is a persistent volume.
- Build a custom n8n image that installs the package.
- Install the package during a controlled container startup step into a persistent community-node directory.

Do not store APS credentials in the image, Dockerfile, Compose file, or repository. Create the credential inside n8n or use your organization's supported n8n secret-management mechanism.

## Update

Through n8n, open **Settings → Community Nodes** and use the available update action. For a manual installation:

```bash
npm install n8n-nodes-community-autodesk-aps-data-management@latest
```

Restart n8n and test critical workflows after updating.

## Uninstall

Remove the package from **Settings → Community Nodes**, or run:

```bash
npm uninstall n8n-nodes-community-autodesk-aps-data-management
```

Restart n8n. Existing workflows retain their serialized node configuration but cannot execute the node until the package is installed again.

## Verify an installed package

From the package installation directory:

```bash
npm list n8n-nodes-community-autodesk-aps-data-management
```

The npm package page and provenance information are available at:

```text
https://www.npmjs.com/package/n8n-nodes-community-autodesk-aps-data-management
```

## Troubleshooting

### The package cannot be found

The first public release must have completed successfully on npm. Confirm the package page exists and use the exact package name.

### The node does not appear

- Restart n8n.
- Confirm the package exists in the same filesystem/environment used by the running n8n process.
- Check n8n startup logs for community-node loading errors.
- Confirm the running n8n/Node.js versions meet the package requirements. Development and CI use Node.js 24 because of the current development toolchain; the published node supports Node.js 20.19+ and executes inside the runtime provided by the compatible self-hosted n8n release.

### The node loads but credentials fail

Continue with [AUTHENTICATION.md](AUTHENTICATION.md).
