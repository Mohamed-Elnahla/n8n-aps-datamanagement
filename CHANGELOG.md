# Changelog

All notable changes to this project are documented in this file.

The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Prevented operations such as Get Hubs from trying to extract hidden resource-locator
  parameters, which caused `Could not find property` errors on n8n 2.36 and later.
- Updated CI and publishing workflows to Node.js 24 for the current n8n toolchain.
- Regenerated npm lockfile metadata for clean `npm ci` installations.

## [0.1.0] - 2026-09-02

### Added

- Initial unofficial community node package.
- Encrypted n8n credential for APS 2-legged OAuth.
- All 29 getter methods from APS Data Management SDK 1.1.4.
- Searchable ACC hub and project resource locators with By ID expression support.
- ACC-only project filtering.
- New item and new item-version uploads from n8n binary data.
- Native version downloads to n8n binary data.
- Multipart signed-S3 transfer implementation.
- Complete installation, authentication, operation, development, and publishing documentation.
- GitHub Actions CI and provenance-enabled npm publishing.

[Unreleased]: https://github.com/mohamedelnahla/n8n-aps-datamanagement/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mohamedelnahla/n8n-aps-datamanagement/releases/tag/v0.1.0
