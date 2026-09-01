# Contributing

Thank you for improving this unofficial community integration.

## Before opening an issue

- Search existing issues.
- Confirm the problem occurs on the latest package version.
- Remove client secrets, access tokens, signed URLs, user IDs, project names, and confidential ACC data.
- For Autodesk API behavior, include a link to the relevant public API documentation when possible.

## Pull requests

1. Fork the repository and create a focused branch.
2. Keep changes limited to one concern.
3. Add or update documentation for user-visible changes.
4. Run:

   ```bash
   npm ci
   npm run lint
   npm test
   npm audit --omit=dev
   npm pack --dry-run
   ```

5. Describe the behavior, testing performed, and compatibility impact.

Do not commit credentials, tokens, `.env` files, n8n instance data, customer data, or generated `dist/` files.

## Design expectations

- Keep the package ACC-focused.
- Do not add standalone OSS resource operations.
- Prefer the official Autodesk TypeScript SDK where it exposes the required Data Management operation.
- Preserve expression-compatible By ID modes.
- Display human-readable names in all list selectors.
- Maintain `continueOnFail` and item pairing behavior.
- Wrap actionable failures in n8n node errors.

By contributing, you agree that your contribution is provided under the MIT License and that you will follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
