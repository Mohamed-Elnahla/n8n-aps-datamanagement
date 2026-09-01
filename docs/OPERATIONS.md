# Operations reference

The node wraps the getter surface of `DataManagementClient` from `@aps_sdk/data-management` 1.1.4 and adds complete native-file upload/download workflows.

## Shared parameters

| Parameter | Description |
| --- | --- |
| ACC Hub | Search by display name or supply a `b.`-prefixed Data Management hub ID |
| ACC Project | Search by display name or supply a `b.`-prefixed Data Management project ID |
| Folder ID | Data Management folder URN |
| Item ID | Data Management lineage/item URN |
| Version ID | URL-safe Data Management version URN |
| Additional Options (JSON) | SDK optional arguments for the selected getter |

Hub and project list results show human-readable names; the stored value is the Autodesk ID. The **By ID** mode accepts n8n expressions.

## Getter mapping

| Node operation | SDK method | Required identifiers |
| --- | --- | --- |
| Get Hub | `getHub` | Hub |
| Get Hubs | `getHubs` | None |
| Get Hub Projects | `getHubProjects` | Hub |
| Get Project | `getProject` | Hub, project |
| Get Project Hub | `getProjectHub` | Hub, project |
| Get Project Top Folders | `getProjectTopFolders` | Hub, project |
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

Getter output is returned as the SDK/API response for that call. Except for the project list selector, the node does not automatically fetch every page. Use the method's `pageNumber`/`pageLimit` options and n8n looping when full pagination is required.

The searchable project selector internally pages through accessible projects and filters results to ACC projects.

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
