# Operations reference

The node wraps the getter surface of `DataManagementClient` from `@aps_sdk/data-management` 1.1.4 and adds complete native-file upload/download workflows.

## Shared parameters

| Parameter | Description |
| --- | --- |
| ACC Hub | Search by display name or supply a `b.`-prefixed Data Management hub ID |
| ACC Project | Search by display name or supply a `b.`-prefixed Data Management project ID |
| Folder ID | Browse by full path or supply a Data Management folder URN/expression |
| Item ID | Browse files by full path or supply a Data Management lineage/item URN/expression |
| Version ID | Browse files and their versions or supply a URL-safe Data Management version URN/expression |
| Additional Options (JSON) | SDK optional arguments for the selected getter |

Hub and project list results show human-readable names; the stored value is the Autodesk ID. The **By ID** mode accepts n8n expressions.

Node version 2 uses dependent lazy resource locators:

- The Folder ID field initially loads only project top folders.
- Each optional Subfolder Level field loads only direct child folders of the preceding selection.
- Item/file selectors load only direct files in the deepest selected folder.
- Version selectors load versions only for the selected item. Version rows show version number and creation date and return the version ID.
- Upload File's optional Existing Item ID is scoped to the selected destination folder; leaving it empty creates a new item.
- List searches may load all pages of only the current folder or selected item so filtering is complete. Opening an unfiltered list fetches one APS page at a time.

Twenty-five optional subfolder levels are exposed, matching the Autodesk Docs product limit. Only the next applicable level is shown. All folder, item, existing-item, and version identifier fields retain literal-ID and n8n-expression support.

Every selector returns only its target resource type: folder fields contain folders, item fields contain files/items, and version fields contain versions. Context rows of another resource type are not included.

Existing version 1 node instances retain the original full-project browser until upgraded, preventing saved workflows from changing behavior automatically.

## Getter mapping

| Node operation | SDK method | Required identifiers |
| --- | --- | --- |
| Get Hub | `getHub` | Hub |
| Get Hubs | `getHubs` | None |
| Get Hub Projects | `getHubProjects` | Hub |
| Get Project | `getProject` | Hub, project |
| Get Project Hub | `getProjectHub` | Hub, project |
| Get Project Top Folders | `getProjectTopFolders` | Hub, project |
| Get Project Full Tree | `getProjectTopFolders` + recursive `getFolderContents` | Hub, project |
| Get Download Details | `getDownload` | Project, download ID |
| Get Download Job | `getDownloadJob` | Project, job ID |
| Get Folder | `getFolder` | Project, folder |
| Get Folder Contents | `getFolderContents` | Project, folder |
| Get Folder Parent | `getFolderParent` | Project, folder |
| Get Folder References | `getFolderRefs` | Project, folder |
| Get Folder Relationship Links | `getFolderRelationshipsLinks` | Project, folder |
| Get Folder Relationship References | `getFolderRelationshipsRefs` | Project, folder |
| Search Folder | `getFolderSearch` | Project, folder |
| Get Item | `getItem` | Project, item |
| Get Item Parent Folder | `getItemParentFolder` | Project, item |
| Get Item References | `getItemRefs` | Project, item |
| Get Item Relationship Links | `getItemRelationshipsLinks` | Project, item |
| Get Item Relationship References | `getItemRelationshipsRefs` | Project, item |
| Get Item Tip | `getItemTip` | Project, item |
| Get Item Versions | `getItemVersions` | Project, item |
| Get Version | `getVersion` | Project, version |
| Get Version Download Formats | `getVersionDownloadFormats` | Project, version |
| Get Version Downloads | `getVersionDownloads` | Project, version |
| Get Version Item | `getVersionItem` | Project, version |
| Get Version References | `getVersionRefs` | Project, version |
| Get Version Relationship Links | `getVersionRelationshipsLinks` | Project, version |
| Get Version Relationship References | `getVersionRelationshipsRefs` | Project, version |

## Additional options

The JSON object is merged into the SDK's optional argument object. The generated `accessToken` and credential-level `xUserId` are controlled by the node and override neither workflow output nor stored IDs.

Examples of SDK options include:

```json
{
  "filterName": ["Project Files"],
  "filterExtensionType": ["folders:autodesk.bim360:Folder"],
  "pageNumber": 0,
  "pageLimit": 100
}
```

```json
{
  "includePathInProject": true
}
```

```json
{
  "excludeDeleted": true,
  "projectFilesOnly": true
}
```

SDK methods support different option sets. Unsupported options may be ignored by serialization or rejected by the API.

## Pagination

The **Load All Pages** toggle is available for every paginated getter exposed by the SDK:

- Get Hub Projects
- Get Folder Contents
- Search Folder
- Get Item Versions

When enabled, the node starts at page 0, requests the largest supported page size where applicable, and stops when APS omits the next-page link. It combines `data` and `included`, deduplicates resources by type and ID, and adds `pagination.allPagesLoaded` and `pagination.pagesLoaded`. When disabled, `pageNumber` and `pageLimit` in Additional Options continue to control the single call.

The searchable project selector internally pages through accessible projects and filters results to ACC projects.

## Full trees

**Get Folder Contents → Scan Full Folder Tree** uses a breadth-first traversal starting at the selected folder. **Get Project Full Tree** starts from every accessible top-level folder in the selected hub/project. Traversal is sequential to respect APS request limits, automatically fetches all pages for every folder, and guards against duplicate/cyclic folder IDs.

Both outputs contain a nested `tree`, flat `folders` and `files` arrays, deduplicated APS `included` resources, and a `summary`. Each entry contains convenient `id`, `type`, `name`, `path`, `depth`, and `parentId` fields, while `resource` retains the complete APS JSON:API resource. Folder-content filters are ignored during recursive traversal because they can hide subfolders and produce an incomplete tree; non-filter options such as `includeHidden` still apply.

## Upload File

Required inputs:

| Parameter | Description |
| --- | --- |
| ACC Project | Target project ID |
| Folder ID | Destination Docs folder |
| Input Binary Property Name | Incoming item binary property; defaults to `data` |
| ACC File Type | Project File or Plan Document |

Optional inputs:

| Parameter | Description |
| --- | --- |
| File Name | Overrides the n8n binary file name |
| Existing Item ID | Creates a new version instead of a new item |

Workflow:

The file must arrive from an upstream n8n node as binary data. The Autodesk APS Data Management node cannot display a local file picker; set **Input Binary Property Name** to the upstream binary property (usually `data`).

1. `createStorage` creates the ACC-controlled storage placeholder.
2. The node parses the returned storage URN.
3. It requests signed multipart upload URLs in batches of at most 25.
4. It uploads the n8n binary buffer in 8 MiB parts.
5. It finalizes the signed upload.
6. It calls `createItem` or `createVersion` with ACC relationships.

The result contains the finalized transfer response and created item/version response.

## Download File

Required inputs:

| Parameter | Description |
| --- | --- |
| ACC Project | Source project ID |
| Version ID | Native file version to download |
| Output Binary Field | Output binary property; defaults to `data` |

Workflow:

1. The node retrieves the version.
2. It reads the version's storage relationship.
3. It requests a short-lived signed download URL.
4. It downloads the native binary and prepares n8n binary metadata.

The JSON output is the version metadata and the binary output contains the downloaded file.

## Item pairing and errors

Each output item is paired to its corresponding input item. When **Continue On Fail** is enabled, a failed input produces an item containing an `error` field instead of stopping the entire execution.
