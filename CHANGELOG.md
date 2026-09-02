# Changelog

All notable changes to this project are documented in this file.

The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.1] - 2026-09-02

### Added

- Added node version 2 with lazy, level-by-level folder browsing, folder-scoped file lists, and per-file version lists.
- Added real API pagination to unfiltered folder, file, and version browser dropdowns.

### Changed

- New node instances no longer scan the complete project before showing folders, files, or versions.
- Preserved version 1 behavior for existing node instances and retained literal/expression **By ID** modes for every identifier.

## [0.2.0] - 2026-09-02

### Added

- Added **Load All Pages** to every paginated getter exposed by the node.
- Added a searchable folder/file hierarchy browser with folder-ID selection and expression support.
- Added item/file browsers to item operations and Upload File's optional Existing Item ID.
- Added a version browser grouped by file path with version number and creation date labels.
- Added recursive full-tree scanning to Get Folder Contents.
- Added Get Project Full Tree with nested and flat folder/file outputs.

## [0.1.2] - 2026-09-02

### Fixed

- Clarified that Upload File consumes an incoming n8n binary property and added
  in-node guidance for connecting a binary-producing upstream node.

## [0.1.1] - 2026-09-02

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

[Unreleased]: https://github.com/mohamedelnahla/n8n-aps-datamanagement/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/mohamedelnahla/n8n-aps-datamanagement/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/mohamedelnahla/n8n-aps-datamanagement/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/mohamedelnahla/n8n-aps-datamanagement/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/mohamedelnahla/n8n-aps-datamanagement/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/mohamedelnahla/n8n-aps-datamanagement/releases/tag/v0.1.0
