# Changelog

All notable changes to this project are documented in this file.

The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Added progressive nested source-field controls for mapped output data.
- Added hub/project context prefixes to dependent multi-select option labels when selections span multiple contexts.

### Changed

- Version 3 now reveals only the next subfolder level after its parent has a selection instead of displaying every supported level.

## [0.3.0] - 2026-09-02

### Added

- Added node version 3 with ordered multi-select inputs across all APS identifiers and transfer fields.
- Added full-response, data-only, and per-resource field-mapping output modes with common-field UI controls and custom dotted-path JSON mappings.
- Added regression tests for ordered broadcasting, ambiguous-list rejection, collection ordering, field mapping, and backward-compatible full output.

### Changed

- List execution now preserves incoming-item, selected-input, and APS collection order without creating implicit Cartesian products.

## [0.2.2] - 2026-09-02

### Added

- Added all 25 Autodesk-supported subfolder levels, with only the next level displayed during browsing.

### Changed

- Folder, item, and version selectors now contain only resources of the selectable target type.

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

[Unreleased]: https://github.com/mohamedelnahla/n8n-aps-datamanagement/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/mohamedelnahla/n8n-aps-datamanagement/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/mohamedelnahla/n8n-aps-datamanagement/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/mohamedelnahla/n8n-aps-datamanagement/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/mohamedelnahla/n8n-aps-datamanagement/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/mohamedelnahla/n8n-aps-datamanagement/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/mohamedelnahla/n8n-aps-datamanagement/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/mohamedelnahla/n8n-aps-datamanagement/releases/tag/v0.1.0
