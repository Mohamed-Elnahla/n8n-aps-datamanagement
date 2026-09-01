# n8n Community Node for Autodesk APS Data Management

[![npm version](https://img.shields.io/npm/v/n8n-nodes-community-autodesk-aps-data-management.svg?logo=npm)](https://www.npmjs.com/package/n8n-nodes-community-autodesk-aps-data-management)
[![npm downloads](https://img.shields.io/npm/dm/n8n-nodes-community-autodesk-aps-data-management.svg?logo=npm)](https://www.npmjs.com/package/n8n-nodes-community-autodesk-aps-data-management)
[![CI](https://github.com/mohamedelnahla/n8n-aps-datamanagement/actions/workflows/ci.yml/badge.svg)](https://github.com/mohamedelnahla/n8n-aps-datamanagement/actions/workflows/ci.yml)
[![Publish](https://github.com/mohamedelnahla/n8n-aps-datamanagement/actions/workflows/publish.yml/badge.svg)](https://github.com/mohamedelnahla/n8n-aps-datamanagement/actions/workflows/publish.yml)
[![License: MIT](https://img.shields.io/npm/l/n8n-nodes-community-autodesk-aps-data-management.svg)](LICENSE.md)
[![Node.js](https://img.shields.io/node/v/n8n-nodes-community-autodesk-aps-data-management.svg?logo=node.js)](package.json)
[![n8n Community Node](https://img.shields.io/badge/n8n-community%20node-ff6d5a?logo=n8n)](https://docs.n8n.io/integrations/community-nodes/)
[![Unofficial](https://img.shields.io/badge/Autodesk-unofficial%20community%20integration-blue)](#unofficial-community-project)

An unofficial, community-maintained n8n node for Autodesk Platform Services (APS) Data Management and Autodesk Construction Cloud (ACC) Docs.

It provides all read operations exposed by Autodesk's current APS Data Management TypeScript SDK, searchable hub/project selectors, 2-legged authentication, and ACC Docs upload/download workflows.

## Unofficial community project

> [!IMPORTANT]
> This package is independently developed and maintained by the community. It is **not an official Autodesk product**, is not affiliated with or endorsed by Autodesk, and is not an official n8n node. Autodesk, Autodesk Construction Cloud, ACC, and APS are trademarks of Autodesk, Inc.

Package: `n8n-nodes-community-autodesk-aps-data-management`  
npm publisher: `mohamed.elnahla`

## Features

- All 29 `get*` methods in `@aps_sdk/data-management` 1.1.4.
- ACC-focused hub/project browsing; non-ACC projects are filtered out.
- Searchable **From List** selectors that display Autodesk names instead of IDs.
- **By ID** selector modes compatible with n8n expressions and upstream node output.
- Encrypted n8n credentials for APS client ID and client secret.
- Short-lived 2-legged OAuth tokens generated at execution time.
- Optional ACC `x-user-id` context.
- Upload a new ACC Docs item or a new version from n8n binary data.
- Download a native ACC Docs version into n8n binary data.
- Autodesk's required direct-to-S3 multipart transfer flow for larger files.
- No standalone OSS bucket creation, listing, deletion, or generic object management.

## Requirements

- Self-hosted n8n with community nodes enabled.
- Node.js 24 or later for local development and CI. The current n8n node tooling depends on `isolated-vm` 7, which requires Node.js 24+.
- An Autodesk APS application with client ID and client secret.
- The APS application provisioned in the target ACC account.
- Appropriate Docs permissions for the service account or selected user context.

This package uses Autodesk's official npm SDK as a runtime dependency. For that reason, it is intended for self-hosted n8n and is not eligible for n8n Cloud's dependency-free verified-node program.

## Install in n8n

### n8n Community Nodes interface

1. Open your self-hosted n8n instance.
2. Go to **Settings → Community Nodes**.
3. Select **Install a community node**.
4. Enter:

   ```text
   n8n-nodes-community-autodesk-aps-data-management
   ```

5. Accept the community-node risk notice and install.
6. Restart n8n if your deployment does not reload community packages automatically.

### npm/manual installation

From the directory used for n8n custom/community packages:

```bash
npm install n8n-nodes-community-autodesk-aps-data-management
```

Restart n8n after installation.

For Docker, make sure the package is installed in the persistent n8n data volume or included in your custom image. See [docs/INSTALLATION.md](docs/INSTALLATION.md) for examples and troubleshooting.

## Configure Autodesk authentication

1. Create an APS application in the Autodesk developer portal.
2. Provision the application as a custom integration for the relevant ACC account.
3. In n8n, create an **Autodesk APS 2-Legged OAuth Community API** credential.
4. Enter the APS **Client ID** and **Client Secret**.
5. Optionally enter **Act as User ID** to send the ACC `x-user-id` header.
6. Use **Test credential**.

n8n stores the credential encrypted and does not place the secret in workflow JSON. The node requests an access token when execution starts; it never stores an APS access token as a workflow parameter.

See [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) for scopes, ACC provisioning, permissions, and troubleshooting.

## Resource selection

Hub and project fields provide two modes:

- **From List**: searchable, with human-readable account/project names.
- **By ID**: accepts a literal Data Management ID or an expression such as `{{$json.projectId}}`.

To browse projects, choose an ACC hub first. When a project ID comes from another node, switch Project to **By ID**; the hub can remain empty for operations whose APS endpoint only requires a project ID.

## Operations

### Hubs, projects, and downloads

- Get Hub
- Get Hubs
- Get Hub Projects
- Get Project
- Get Project Hub
- Get Project Top Folders
- Get Download Details
- Get Download Job

### Folders

- Get Folder
- Get Folder Contents
- Get Folder Parent
- Get Folder References
- Get Folder Relationship Links
- Get Folder Relationship References
- Search Folder

### Items

- Get Item
- Get Item Parent Folder
- Get Item References
- Get Item Relationship Links
- Get Item Relationship References
- Get Item Tip
- Get Item Versions

### Versions

- Get Version
- Get Version Download Formats
- Get Version Downloads
- Get Version Item
- Get Version References
- Get Version Relationship Links
- Get Version Relationship References

### Binary file operations

- Upload File
- Download File

The complete parameter and response guide is in [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Upload files

The Upload File operation expects an n8n binary property, an ACC project ID, and a destination folder ID.

- Leave **Existing Item ID** empty to create a new item and its first version.
- Set **Existing Item ID** to create a new version of that item.
- Choose **Project File** for Project Files folders.
- Choose **Plan Document** for Plans folders.

The node creates an ACC storage placeholder, transfers the binary through Autodesk's signed-S3 flow, finalizes the upload, and creates the item/version relationship.

Although Autodesk's signed transfer URLs use `/oss/v2/` endpoints, this node does not expose general OSS operations. Autodesk requires this transfer mechanism for ACC Data Management files.

## Download files

Provide an ACC project ID and version ID. The node resolves the version's storage relationship, downloads the native file using a short-lived signed URL, and writes it to the configured n8n binary output field.

## Additional SDK options

Read operations include **Additional Options (JSON)**. The object is forwarded as SDK optional arguments together with the generated access token and optional `x-user-id`.

Example:

```json
{
  "pageNumber": 0,
  "pageLimit": 100,
  "includePathInProject": true,
  "excludeDeleted": true
}
```

Only include options supported by the selected SDK method. See Autodesk's Data Management API reference and the installed SDK declarations.

## Example workflow pattern

1. **Get Hubs** to discover connected ACC accounts.
2. **Get Hub Projects** to retrieve ACC projects.
3. **Get Project Top Folders** to find Project Files or Plans.
4. **Get Folder Contents** to navigate items and subfolders.
5. Pass returned IDs into later node instances using **By ID** expressions.
6. Use **Upload File** or **Download File** for binary transfer.

## Security notes

- Never place the APS client secret in a normal workflow field.
- Use an n8n credential and restrict credential sharing to the required projects/users.
- Keep `N8N_ENCRYPTION_KEY` stable and protected in self-hosted deployments.
- Grant the APS integration only the ACC permissions it needs.
- Signed transfer URLs are deliberately short-lived and are not returned in normal node output.
- Do not commit `.env` files, n8n data directories, credentials, or npm tokens.

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Development

```bash
git clone https://github.com/mohamedelnahla/n8n-aps-datamanagement.git
cd n8n-aps-datamanagement
npm ci --ignore-scripts
npm run lint
npm test
npm run dev
```

Production build:

```bash
npm run build
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for architecture and release checks.

## Publishing

Publishing is performed by `.github/workflows/publish.yml` when a version tag such as `v0.1.0` is pushed. The workflow validates the tag/package version, runs lint and tests, and uses the official n8n release tooling to publish with an npm provenance statement.

The repository owner must create a GitHub Actions secret named `NPM_TOKEN` using an npm granular access token belonging to `mohamed.elnahla`. Full setup and release commands are in [docs/PUBLISHING.md](docs/PUBLISHING.md).

## Support and contribution

- Bugs and feature requests: [GitHub Issues](https://github.com/mohamedelnahla/n8n-aps-datamanagement/issues)
- Contribution guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- Change history: [CHANGELOG.md](CHANGELOG.md)

Community support does not replace Autodesk or n8n commercial support.

## License

[MIT](LICENSE.md)
