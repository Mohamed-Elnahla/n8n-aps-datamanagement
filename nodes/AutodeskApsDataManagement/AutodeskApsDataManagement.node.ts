import type {
	ICredentialDataDecryptedObject,
	ICredentialsDecrypted,
	ICredentialTestFunctions,
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeCredentialTestResult,
	INodeListSearchResult,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type { ItemPayload, StoragePayload, VersionPayload } from '@aps_sdk/data-management';
import {
	TypeFolder,
	TypeFolderItemsForStorage,
	TypeItem,
	TypeObject,
	TypeVersion,
} from '@aps_sdk/data-management';
import {
	createApsContext,
	displayName,
	isAccProject,
	resourceId,
	resourceValue,
} from './apsClient';
import { downloadBuffer, uploadBuffer } from './transfer';

const GET_OPERATIONS = [
	['Get Hub', 'getHub'],
	['Get Hubs', 'getHubs'],
	['Get Hub Projects', 'getHubProjects'],
	['Get Project', 'getProject'],
	['Get Project Hub', 'getProjectHub'],
	['Get Project Top Folders', 'getProjectTopFolders'],
	['Get Download Details', 'getDownload'],
	['Get Download Job', 'getDownloadJob'],
	['Get Folder', 'getFolder'],
	['Get Folder Contents', 'getFolderContents'],
	['Get Folder Parent', 'getFolderParent'],
	['Get Folder References', 'getFolderRefs'],
	['Get Folder Relationship Links', 'getFolderRelationshipsLinks'],
	['Get Folder Relationship References', 'getFolderRelationshipsRefs'],
	['Search Folder', 'getFolderSearch'],
	['Get Item', 'getItem'],
	['Get Item Parent Folder', 'getItemParentFolder'],
	['Get Item References', 'getItemRefs'],
	['Get Item Relationship Links', 'getItemRelationshipsLinks'],
	['Get Item Relationship References', 'getItemRelationshipsRefs'],
	['Get Item Tip', 'getItemTip'],
	['Get Item Versions', 'getItemVersions'],
	['Get Version', 'getVersion'],
	['Get Version Download Formats', 'getVersionDownloadFormats'],
	['Get Version Downloads', 'getVersionDownloads'],
	['Get Version Item', 'getVersionItem'],
	['Get Version References', 'getVersionRefs'],
	['Get Version Relationship Links', 'getVersionRelationshipsLinks'],
	['Get Version Relationship References', 'getVersionRelationshipsRefs'],
] as const;

const PROJECT_OPERATIONS = GET_OPERATIONS.map(([, value]) => value).filter(
	(value) => !['getHub', 'getHubs', 'getHubProjects'].includes(value),
);
const FOLDER_OPERATIONS = [
	'getFolder',
	'getFolderContents',
	'getFolderParent',
	'getFolderRefs',
	'getFolderRelationshipsLinks',
	'getFolderRelationshipsRefs',
	'getFolderSearch',
];
const ITEM_OPERATIONS = [
	'getItem',
	'getItemParentFolder',
	'getItemRefs',
	'getItemRelationshipsLinks',
	'getItemRelationshipsRefs',
	'getItemTip',
	'getItemVersions',
];
const VERSION_OPERATIONS = [
	'getVersion',
	'getVersionDownloadFormats',
	'getVersionDownloads',
	'getVersionItem',
	'getVersionRefs',
	'getVersionRelationshipsLinks',
	'getVersionRelationshipsRefs',
	'downloadFile',
];
const HUB_REQUIRED_OPERATIONS = [
	'getHub',
	'getHubProjects',
	'getProject',
	'getProjectHub',
	'getProjectTopFolders',
];

const hubProperty: INodeProperties = {
	displayName: 'ACC Hub',
	name: 'hubId',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	description:
		'Choose an ACC account by name to browse projects, or supply its Data Management hub ID. It is optional when the project is supplied By ID.',
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: { searchListMethod: 'searchHubs', searchable: true },
		},
		{ displayName: 'By ID', name: 'id', type: 'string', placeholder: 'b.account-guid' },
	],
	displayOptions: {
		show: { operation: [...PROJECT_OPERATIONS, 'getHub', 'getHubProjects', 'uploadFile', 'downloadFile'] },
	},
};

const projectProperty: INodeProperties = {
	displayName: 'ACC Project',
	name: 'projectId',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	description: 'Choose an ACC project by name or supply its Data Management project ID',
	typeOptions: { loadOptionsDependsOn: ['hubId.value'] },
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: { searchListMethod: 'searchProjects', searchable: true },
		},
		{ displayName: 'By ID', name: 'id', type: 'string', placeholder: 'b.project-guid' },
	],
	displayOptions: { show: { operation: [...PROJECT_OPERATIONS, 'uploadFile', 'downloadFile'] } },
};

const properties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getHubs',
		options: [
			...GET_OPERATIONS.map(([name, value]) => ({ name, value, action: name })),
			{ name: 'Upload File', value: 'uploadFile', action: 'Upload a file to ACC Docs' },
			{ name: 'Download File', value: 'downloadFile', action: 'Download a file from ACC Docs' },
		],
	},
	hubProperty,
	projectProperty,
	{
		displayName: 'Folder ID',
		name: 'folderId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'urn:adsk.wipprod:fs.folder:co....',
		displayOptions: { show: { operation: [...FOLDER_OPERATIONS, 'uploadFile'] } },
	},
	{
		displayName: 'Item ID',
		name: 'itemId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'urn:adsk.wipprod:dm.lineage:...',
		displayOptions: { show: { operation: ITEM_OPERATIONS } },
	},
	{
		displayName: 'Version ID',
		name: 'versionId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'urn:adsk.wipprod:fs.file:vf....?version=1',
		displayOptions: { show: { operation: VERSION_OPERATIONS } },
	},
	{
		displayName: 'Download ID',
		name: 'downloadId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { operation: ['getDownload'] } },
	},
	{
		displayName: 'Job ID',
		name: 'jobId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { operation: ['getDownloadJob'] } },
	},
	{
		displayName: 'Input Binary Field',
		name: 'inputBinaryField',
		type: 'string',
		default: 'data',
		required: true,
		displayOptions: { show: { operation: ['uploadFile'] } },
	},
	{
		displayName: 'File Name',
		name: 'fileName',
		type: 'string',
		default: '',
		description: 'Leave empty to use the binary file name',
		displayOptions: { show: { operation: ['uploadFile'] } },
	},
	{
		displayName: 'Existing Item ID',
		name: 'existingItemId',
		type: 'string',
		default: '',
		description: 'Set an item ID to upload a new version; leave empty to create a new item',
		displayOptions: { show: { operation: ['uploadFile'] } },
	},
	{
		displayName: 'ACC File Type',
		name: 'accFileType',
		type: 'options',
		default: 'File',
		options: [
			{ name: 'Project File', value: 'File' },
			{ name: 'Plan Document', value: 'Document' },
		],
		displayOptions: { show: { operation: ['uploadFile'] } },
	},
	{
		displayName: 'Output Binary Field',
		name: 'outputBinaryField',
		type: 'string',
		default: 'data',
		required: true,
		displayOptions: { show: { operation: ['downloadFile'] } },
	},
	{
		displayName: 'Additional Options (JSON)',
		name: 'additionalOptions',
		type: 'json',
		default: '{}',
		description:
			'Optional SDK arguments such as filters, pagination, includePathInProject, excludeDeleted, or projectFilesOnly',
		displayOptions: { hide: { operation: ['uploadFile', 'downloadFile'] } },
	},
];

function asJson(value: unknown): IDataObject {
	return JSON.parse(JSON.stringify(value)) as IDataObject;
}

function storageUrnFromVersion(version: unknown): string {
	const data = (version as { data?: { relationships?: { storage?: { data?: { id?: unknown } } } } }).data;
	return String(data?.relationships?.storage?.data?.id ?? '');
}

export class AutodeskApsDataManagement implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Autodesk APS Data Management (Community)',
		name: 'autodeskApsDataManagement',
		icon: {
			light: 'file:AutodeskApsDataManagement.svg',
			dark: 'file:AutodeskApsDataManagement.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Unofficial community node to read, upload, and download Autodesk Construction Cloud Docs data',
		defaults: { name: 'Autodesk APS Data Management (Community)' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{ name: 'autodeskApsApi', required: true, testedBy: 'autodeskApsCredentialTest' },
		],
		usableAsTool: true,
		properties,
	};

	methods = {
		credentialTest: {
			async autodeskApsCredentialTest(
				this: ICredentialTestFunctions,
				credential: ICredentialsDecrypted<ICredentialDataDecryptedObject>,
			): Promise<INodeCredentialTestResult> {
				try {
					const context = await createApsContext(credential.data ?? {});
					await context.client.getHubs({
						accessToken: context.accessToken,
						xUserId: context.xUserId,
					});
					return { status: 'OK', message: 'Connection successful' };
				} catch (error) {
					return {
						status: 'Error',
						message: error instanceof Error ? error.message : 'Authentication failed',
					};
				}
			},
		},
		listSearch: {
			async searchHubs(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
				const credentials = await this.getCredentials('autodeskApsApi');
				const { client, accessToken, xUserId } = await createApsContext(credentials);
				const response = await client.getHubs({ accessToken, xUserId });
				const query = (filter ?? '').toLowerCase();
				const results = (response.data ?? [])
					.filter((hub) => resourceId(hub).startsWith('b.'))
					.filter((hub) => displayName(hub).toLowerCase().includes(query))
					.map((hub) => ({ name: displayName(hub), value: resourceId(hub) }));
				return { results };
			},
			async searchProjects(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
				const hubId = resourceValue(this.getNodeParameter('hubId', undefined, { extractValue: true }));
				if (!hubId) return { results: [] };
				const credentials = await this.getCredentials('autodeskApsApi');
				const { client, accessToken, xUserId } = await createApsContext(credentials);
				const query = (filter ?? '').toLowerCase();
				const results: Array<{ name: string; value: string }> = [];
				for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
					const response = await client.getHubProjects(hubId, {
						accessToken,
						xUserId,
						pageNumber,
						pageLimit: 200,
					});
					const projects = response.data ?? [];
					results.push(
						...projects
							.filter(isAccProject)
							.filter((project) => displayName(project).toLowerCase().includes(query))
							.map((project) => ({ name: displayName(project), value: resourceId(project) })),
					);
					if (projects.length < 200) break;
				}
				return { results };
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const inputItems = this.getInputData();
		const outputItems: INodeExecutionData[] = [];
		if (inputItems.length === 0) return [outputItems];
		const operation = this.getNodeParameter('operation', 0) as string;
		const credentials = await this.getCredentials('autodeskApsApi', 0);
		let context: Awaited<ReturnType<typeof createApsContext>>;
		try {
			context = await createApsContext(credentials, operation === 'uploadFile');
		} catch (error) {
			throw new NodeOperationError(
				this.getNode(),
				error instanceof Error ? error : new Error(String(error)),
			);
		}

		for (let itemIndex = 0; itemIndex < inputItems.length; itemIndex++) {
			try {
				const { client, accessToken, xUserId } = context;
				const hubId = resourceValue(this.getNodeParameter('hubId', itemIndex, '', { extractValue: true }));
				const projectId = resourceValue(
					this.getNodeParameter('projectId', itemIndex, '', { extractValue: true }),
				);
				const folderId = String(this.getNodeParameter('folderId', itemIndex, ''));
				const itemId = String(this.getNodeParameter('itemId', itemIndex, ''));
				const versionId = String(this.getNodeParameter('versionId', itemIndex, ''));
				const rawOptions = this.getNodeParameter('additionalOptions', itemIndex, '{}');
				const parsedOptions = typeof rawOptions === 'string' ? JSON.parse(rawOptions) : rawOptions;
				const optionalArgs = {
					...(parsedOptions as IDataObject),
					accessToken,
					...(xUserId ? { xUserId } : {}),
				};
				if (HUB_REQUIRED_OPERATIONS.includes(operation) && !hubId) {
					throw new NodeOperationError(this.getNode(), 'ACC Hub is required for this operation', {
						itemIndex,
					});
				}

				let result: unknown;
				switch (operation) {
					case 'getHub': result = await client.getHub(hubId, optionalArgs); break;
					case 'getHubs': {
						const response = await client.getHubs(optionalArgs);
						result = { ...response, data: (response.data ?? []).filter((hub) => resourceId(hub).startsWith('b.')) };
						break;
					}
					case 'getHubProjects': {
						const response = await client.getHubProjects(hubId, optionalArgs);
						result = { ...response, data: (response.data ?? []).filter(isAccProject) };
						break;
					}
					case 'getProject': result = await client.getProject(hubId, projectId, optionalArgs); break;
					case 'getProjectHub': result = await client.getProjectHub(hubId, projectId, optionalArgs); break;
					case 'getProjectTopFolders': result = await client.getProjectTopFolders(hubId, projectId, optionalArgs); break;
					case 'getDownload': result = await client.getDownload(projectId, String(this.getNodeParameter('downloadId', itemIndex)), optionalArgs); break;
					case 'getDownloadJob': result = await client.getDownloadJob(projectId, String(this.getNodeParameter('jobId', itemIndex)), optionalArgs); break;
					case 'getFolder': result = await client.getFolder(projectId, folderId, optionalArgs); break;
					case 'getFolderContents': result = await client.getFolderContents(projectId, folderId, optionalArgs); break;
					case 'getFolderParent': result = await client.getFolderParent(projectId, folderId, optionalArgs); break;
					case 'getFolderRefs': result = await client.getFolderRefs(projectId, folderId, optionalArgs); break;
					case 'getFolderRelationshipsLinks': result = await client.getFolderRelationshipsLinks(projectId, folderId, optionalArgs); break;
					case 'getFolderRelationshipsRefs': result = await client.getFolderRelationshipsRefs(folderId, projectId, optionalArgs); break;
					case 'getFolderSearch': result = await client.getFolderSearch(projectId, folderId, optionalArgs); break;
					case 'getItem': result = await client.getItem(projectId, itemId, optionalArgs); break;
					case 'getItemParentFolder': result = await client.getItemParentFolder(projectId, itemId, optionalArgs); break;
					case 'getItemRefs': result = await client.getItemRefs(projectId, itemId, optionalArgs); break;
					case 'getItemRelationshipsLinks': result = await client.getItemRelationshipsLinks(projectId, itemId, optionalArgs); break;
					case 'getItemRelationshipsRefs': result = await client.getItemRelationshipsRefs(projectId, itemId, optionalArgs); break;
					case 'getItemTip': result = await client.getItemTip(projectId, itemId, optionalArgs); break;
					case 'getItemVersions': result = await client.getItemVersions(projectId, itemId, optionalArgs); break;
					case 'getVersion': result = await client.getVersion(projectId, versionId, optionalArgs); break;
					case 'getVersionDownloadFormats': result = await client.getVersionDownloadFormats(projectId, versionId, optionalArgs); break;
					case 'getVersionDownloads': result = await client.getVersionDownloads(projectId, versionId, optionalArgs); break;
					case 'getVersionItem': result = await client.getVersionItem(projectId, versionId, optionalArgs); break;
					case 'getVersionRefs': result = await client.getVersionRefs(projectId, versionId, optionalArgs); break;
					case 'getVersionRelationshipsLinks': result = await client.getVersionRelationshipsLinks(projectId, versionId, optionalArgs); break;
					case 'getVersionRelationshipsRefs': result = await client.getVersionRelationshipsRefs(projectId, versionId, optionalArgs); break;
					case 'uploadFile': {
						const binaryField = String(this.getNodeParameter('inputBinaryField', itemIndex));
						const binary = inputItems[itemIndex].binary?.[binaryField];
						if (!binary) throw new NodeOperationError(this.getNode(), `Binary field "${binaryField}" was not found`, { itemIndex });
						const fileName = String(this.getNodeParameter('fileName', itemIndex, '')).trim() || binary.fileName || 'upload.bin';
						const existingItemId = String(this.getNodeParameter('existingItemId', itemIndex, '')).trim();
						const fileType = String(this.getNodeParameter('accFileType', itemIndex, 'File'));
						const storagePayload: StoragePayload = {
							jsonapi: { version: '1.0' },
							data: {
								type: TypeObject.Objects,
								attributes: { name: fileName },
								relationships: { target: { data: { type: TypeFolderItemsForStorage.Folders, id: folderId } } },
							},
						};
						const storage = await client.createStorage(projectId, storagePayload, { accessToken, xUserId });
						const storageUrn = String(storage.data?.id ?? '');
						const transfer = await uploadBuffer(storageUrn, await this.helpers.getBinaryDataBuffer(itemIndex, binaryField), accessToken);
						if (existingItemId) {
							const versionPayload: VersionPayload = {
								jsonapi: { version: '1.0' },
								data: {
									type: TypeVersion.Versions,
									attributes: { name: fileName, extension: { type: `versions:autodesk.bim360:${fileType}`, version: '1.0' } },
									relationships: {
										item: { data: { type: TypeItem.Items, id: existingItemId } },
										storage: { data: { type: TypeObject.Objects, id: storageUrn } },
									},
								},
							};
							result = { transfer, version: await client.createVersion(projectId, versionPayload, { accessToken, xUserId }) };
						} else {
							const itemPayload: ItemPayload = {
								jsonapi: { version: '1.0' },
								data: {
									type: TypeItem.Items,
									attributes: { displayName: fileName, extension: { type: `items:autodesk.bim360:${fileType}`, version: '1.0' } },
									relationships: {
										tip: { data: { type: TypeVersion.Versions, id: '1' } },
										parent: { data: { type: TypeFolder.Folders, id: folderId } },
									},
								},
								included: [{
									type: TypeVersion.Versions,
									id: '1',
									attributes: { name: fileName, extension: { type: `versions:autodesk.bim360:${fileType}`, version: '1.0' } },
									relationships: { storage: { data: { type: TypeObject.Objects, id: storageUrn } } },
								}],
							};
							result = { transfer, item: await client.createItem(projectId, itemPayload, { accessToken, xUserId }) };
						}
						break;
					}
					case 'downloadFile': {
						const version = await client.getVersion(projectId, versionId, { accessToken, xUserId });
						const storageUrn = storageUrnFromVersion(version);
						const downloaded = await downloadBuffer(storageUrn, accessToken);
						const fileName = String(version.data?.attributes?.name ?? version.data?.attributes?.displayName ?? 'download.bin');
						const binaryField = String(this.getNodeParameter('outputBinaryField', itemIndex));
						const prepared = await this.helpers.prepareBinaryData(downloaded.buffer, fileName, downloaded.contentType);
						outputItems.push({ json: asJson(version), binary: { [binaryField]: prepared }, pairedItem: { item: itemIndex } });
						continue;
					}
					default: throw new NodeOperationError(this.getNode(), `Unsupported operation: ${operation}`, { itemIndex });
				}

				outputItems.push({ json: asJson(result), pairedItem: { item: itemIndex } });
			} catch (error) {
				if (this.continueOnFail()) {
					outputItems.push({ json: { error: error instanceof Error ? error.message : String(error) }, pairedItem: { item: itemIndex } });
					continue;
				}
				throw new NodeOperationError(
					this.getNode(),
					error instanceof Error ? error : new Error(String(error)),
					{ itemIndex },
				);
			}
		}

		return [outputItems];
	}
}
