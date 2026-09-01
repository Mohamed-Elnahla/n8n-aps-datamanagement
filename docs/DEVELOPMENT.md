# Development guide

## Prerequisites

- Node.js 22+
- npm
- Git
- A self-hosted/local n8n environment for interactive testing
- Optional ACC sandbox account and APS app for live integration tests

## Setup

```bash
npm ci
npm run lint
npm test
```

Start n8n with the node loaded:

```bash
npm run dev
```

## Project structure

```text
credentials/
  AutodeskApsApi.credentials.ts
nodes/AutodeskApsDataManagement/
  AutodeskApsDataManagement.node.ts
  apsClient.ts
  transfer.ts
docs/
.github/workflows/
```

- `AutodeskApsApi.credentials.ts` defines encrypted credential fields.
- `apsClient.ts` initializes the official Autodesk SDK and requests 2-legged tokens.
- `AutodeskApsDataManagement.node.ts` contains n8n metadata, selectors, SDK dispatch, and binary operation orchestration.
- `transfer.ts` implements Autodesk's signed-S3 multipart transfer protocol without exposing generic OSS resources.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Compile TypeScript and copy static assets to `dist/` |
| `npm run dev` | Start the n8n node development environment |
| `npm run lint` | Run n8n node and TypeScript lint rules |
| `npm run lintfix` | Apply safe lint fixes |
| `npm run typecheck` | Type-check without emitting files |
| `npm test` | Type-check and build |
| `npm pack --dry-run` | Inspect files that would be published |

## Adding an SDK getter

1. Confirm the method exists in the installed `DataManagementClient` declaration.
2. Add a human-readable entry to `GET_OPERATIONS`.
3. Add identifier visibility rules if it needs folder/item/version fields.
4. Add an explicit execution switch branch.
5. Update `docs/OPERATIONS.md`.
6. Run lint, tests, and the SDK coverage comparison.

## Quality checks before a pull request

```bash
npm ci
npm run lint
npm test
npm audit --omit=dev
npm pack --dry-run
```

Never use production ACC data or credentials in automated tests or fixtures.

## Dependency policy

Autodesk APS SDK packages are intentionally runtime dependencies because using the official TypeScript SDK is a project requirement. This makes the package suitable for self-hosted n8n community-node installation but not n8n Cloud verification under the dependency-free policy.
