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
	buildFolderTree,
	createApsContext,
	displayName,
	isAccProject,
	loadAllPages,
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
	['Get Project Full Tree', 'getProjectTree'],
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
	'getProjectTree',
];

const PAGINATED_OPERATIONS = [
	'getHubProjects',
	'getFolderContents',
	'getFolderSearch',
	'getItemVersions',
];
const PROJECT_FIELD_OPERATIONS = [...PROJECT_OPERATIONS, 'uploadFile', 'downloadFile'];
const HUB_FIELD_OPERATIONS = [...PROJECT_OPERATIONS, 'getHub', 'getHubProjects', 'uploadFile', 'downloadFile'];
const FOLDER_FIELD_OPERATIONS = [...FOLDER_OPERATIONS, 'uploadFile'];
const LAZY_BROWSER_VERSION = 2;
const SUBFOLDER_LEVELS = 8;
const SUBFOLDER_PARAMETER_NAMES = Array.from(
	{ length: SUBFOLDER_LEVELS },
	(_, index) => `subfolderId${index + 1}`,
);
const FOLDER_PATH_PARAMETER_NAMES = ['folderId', ...SUBFOLDER_PARAMETER_NAMES];
const BROWSE_FOLDER_OPERATIONS = [
	...new Set([...FOLDER_FIELD_OPERATIONS, ...ITEM_OPERATIONS, ...VERSION_OPERATIONS]),
];
const OPTIONAL_BROWSE_FOLDER_OPERATIONS = [
	...new Set([...ITEM_OPERATIONS, ...VERSION_OPERATIONS]),
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
		show: { operation: HUB_FIELD_OPERATIONS },
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
	displayOptions: { show: { operation: PROJECT_FIELD_OPERATIONS } },
};

function folderLocatorModes(searchListMethod: string): NonNullable<INodeProperties['modes']> {
	return [
		// eslint-disable-next-line n8n-nodes-base/node-param-default-missing
		{
			displayName: 'Browse',
			name: 'list',
			type: 'list',
			placeholder: 'Select a folder...',
			typeOptions: { searchListMethod, searchable: true },
		},
		// eslint-disable-next-line n8n-nodes-base/node-param-default-missing
		{
			displayName: 'By ID',
			name: 'id',
			type: 'string',
			placeholder: 'urn:adsk.wipprod:fs.folder:co....',
		},
	];
}

function lazyRootFolderProperty(
	operations: string[],
	required: boolean,
	displayNameValue: string,
): INodeProperties {
	return {
		displayName: displayNameValue,
		name: 'folderId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required,
		description: required
			? 'Select a top-level folder, continue through the subfolder fields, or supply the final folder ID/expression By ID'
			: 'Optional folder scope for lazy browsing. Leave empty when supplying the item or version By ID.',
		typeOptions: { loadOptionsDependsOn: ['hubId.value', 'projectId.value'] },
		modes: folderLocatorModes('searchFolders'),
		displayOptions: {
			show: { '@version': [LAZY_BROWSER_VERSION], operation: operations },
		},
	};
}

function lazySubfolderProperties(): INodeProperties[] {
	return SUBFOLDER_PARAMETER_NAMES.map((name, index) => {
		const previousName = FOLDER_PATH_PARAMETER_NAMES[index];
		const level = index + 1;
		return {
			displayName: `Subfolder Level ${level}`,
			name,
			type: 'resourceLocator',
			default: { mode: 'list', value: '' },
			description: 'Optional. Select a direct child of the folder above to continue deeper.',
			typeOptions: {
				loadOptionsDependsOn: ['hubId.value', 'projectId.value', `${previousName}.value`],
			},
			modes: folderLocatorModes(`searchSubfolders${level}`),
			displayOptions: {
				show: {
					'@version': [LAZY_BROWSER_VERSION],
					operation: BROWSE_FOLDER_OPERATIONS,
					[`${previousName}.value`]: [{ _cnd: { exists: true } }],
				},
			},
		};
	});
}

function itemLocatorProperty(operations: string[], required: boolean): INodeProperties {
	return {
		displayName: required ? 'Item ID' : 'File to Browse',
		name: 'itemId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required,
		description: required
			? 'Choose a file in the selected folder or supply an item/file ID or expression'
			: 'Choose a file to load its versions, or leave empty when supplying the Version ID directly',
		typeOptions: {
			loadOptionsDependsOn: [
				'hubId.value',
				'projectId.value',
				...FOLDER_PATH_PARAMETER_NAMES.map((name) => `${name}.value`),
			],
		},
		modes: [
			{
				displayName: 'Browse',
				name: 'list',
				type: 'list',
				placeholder: 'Select a file...',
				typeOptions: { searchListMethod: 'searchItems', searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'urn:adsk.wipprod:dm.lineage:...',
			},
		],
		displayOptions: {
			show: { '@version': [LAZY_BROWSER_VERSION], operation: operations },
		},
	};
}

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
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description:
			'Browse project folders and files by path, or supply a folder ID or expression from a previous node',
		typeOptions: { loadOptionsDependsOn: ['hubId.value', 'projectId.value'] },
		modes: [
			{
				displayName: 'Browse',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: 'searchFolders',
					searchable: true,
					slowLoadNotice: {
						message: 'Large projects can take time to scan. Use "By ID" when you already know the folder ID.',
						timeout: 10_000,
					},
				},
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'urn:adsk.wipprod:fs.folder:co....',
			},
		],
		displayOptions: { show: { '@version': [1], operation: FOLDER_FIELD_OPERATIONS } },
	},
	lazyRootFolderProperty(FOLDER_FIELD_OPERATIONS, true, 'Folder ID'),
	lazyRootFolderProperty(OPTIONAL_BROWSE_FOLDER_OPERATIONS, false, 'Browse Folder'),
	...lazySubfolderProperties(),
	{
		displayName: 'Load All Pages',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { operation: PAGINATED_OPERATIONS } },
	},
	{
		displayName: 'Scan Full Folder Tree',
		name: 'scanFullTree',
		type: 'boolean',
		default: false,
		description:
			'Whether to recursively scan every subfolder. All pages are loaded automatically and results include a nested tree plus flat folder and file lists.',
		displayOptions: { show: { operation: ['getFolderContents'] } },
	},
	{
		displayName: 'Item ID',
		name: 'itemId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: 'Browse project files by path, or supply an item/file ID or expression',
		typeOptions: { loadOptionsDependsOn: ['hubId.value', 'projectId.value'] },
		modes: [
			{
				displayName: 'Browse',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: 'searchItems',
					searchable: true,
					slowLoadNotice: {
						message: 'Large projects can take time to scan. Use "By ID" when you already know the item ID.',
						timeout: 10_000,
					},
				},
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'urn:adsk.wipprod:dm.lineage:...',
			},
		],
		displayOptions: { show: { '@version': [1], operation: ITEM_OPERATIONS } },
	},
	itemLocatorProperty(ITEM_OPERATIONS, true),
	itemLocatorProperty(VERSION_OPERATIONS, false),
	{
		displayName: 'Version ID',
		name: 'versionId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description:
			'Browse files and their versions by version number and date, or supply a version ID or expression',
		typeOptions: { loadOptionsDependsOn: ['hubId.value', 'projectId.value'] },
		modes: [
			{
				displayName: 'Browse',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: 'searchVersions',
					searchable: true,
					slowLoadNotice: {
						message: 'Loading versions requires scanning project files. Use "By ID" when you already know the version ID.',
						timeout: 10_000,
					},
				},
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'urn:adsk.wipprod:fs.file:vf....?version=1',
			},
		],
		displayOptions: { show: { '@version': [1], operation: VERSION_OPERATIONS } },
	},
	{
		displayName: 'Version ID',
		name: 'versionId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description:
			'Choose a version of the selected file, or supply a version ID or expression from a previous node',
		typeOptions: {
			loadOptionsDependsOn: ['hubId.value', 'projectId.value', 'itemId.value'],
		},
		modes: [
			{
				displayName: 'Browse',
				name: 'list',
				type: 'list',
				placeholder: 'Select a version...',
				typeOptions: { searchListMethod: 'searchVersions', searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'urn:adsk.wipprod:fs.file:vf....?version=1',
			},
		],
		displayOptions: {
			show: { '@version': [LAZY_BROWSER_VERSION], operation: VERSION_OPERATIONS },
		},
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
		displayName: 'Binary Input',
		name: 'binaryInputNotice',
		type: 'notice',
		default: '',
		description: 'This operation reads a binary file from the incoming n8n item. Connect a node that produces binary data (for example, Read/Write Files from Disk, a Form Trigger, or an HTTP Request), then enter that binary property name below. n8n node parameters do not include a local file picker.',
		displayOptions: { show: { operation: ['uploadFile'] } },
	},
	{
		displayName: 'Input Binary Property Name',
		name: 'inputBinaryField',
		type: 'string',
		default: 'data',
		required: true,
		placeholder: 'data',
		description: 'Name of the binary property on the incoming n8n item that contains the file',
		displayOptions: { show: { operation: ['uploadFile'] } },
	},
	{
		displayName: 'Existing Item ID',
		name: 'existingItemId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		description:
			'Choose an existing file in the selected folder to upload a new version, supply its item ID/expression, or leave empty to create a new item',
		typeOptions: {
			loadOptionsDependsOn: [
				'hubId.value',
				'projectId.value',
				...FOLDER_PATH_PARAMETER_NAMES.map((name) => `${name}.value`),
			],
		},
		modes: [
			{
				displayName: 'Browse',
				name: 'list',
				type: 'list',
				placeholder: 'Select an existing file...',
				typeOptions: { searchListMethod: 'searchItems', searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'urn:adsk.wipprod:dm.lineage:...',
			},
		],
		displayOptions: {
			show: { '@version': [LAZY_BROWSER_VERSION], operation: ['uploadFile'] },
		},
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
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		description:
			'Choose an existing file to upload a new version, supply its item ID/expression, or leave empty to create a new item',
		typeOptions: { loadOptionsDependsOn: ['hubId.value', 'projectId.value'] },
		modes: [
			{
				displayName: 'Browse',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: 'searchItems',
					searchable: true,
				},
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'urn:adsk.wipprod:dm.lineage:...',
			},
		],
		displayOptions: { show: { '@version': [1], operation: ['uploadFile'] } },
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

function paginateBrowserResults(
	entries: INodeListSearchResult['results'],
	filter?: string,
	paginationToken?: string,
	sort = true,
): INodeListSearchResult {
	const query = (filter ?? '').trim().toLowerCase();
	const filtered = entries.filter((entry) => entry.name.toLowerCase().includes(query));
	if (sort) filtered.sort((left, right) => left.name.localeCompare(right.name));
	const offset = Number.parseInt(paginationToken ?? '0', 10) || 0;
	const pageSize = 200;
	return {
		results: filtered.slice(offset, offset + pageSize),
		...(offset + pageSize < filtered.length
			? { paginationToken: String(offset + pageSize) }
			: {}),
	};
}

async function loadProjectBrowser(thisArg: ILoadOptionsFunctions) {
	const hubId = resourceValue(thisArg.getNodeParameter('hubId', undefined, { extractValue: true }));
	const projectId = resourceValue(
		thisArg.getNodeParameter('projectId', undefined, { extractValue: true }),
	);
	if (!hubId || !projectId) return undefined;
	const credentials = await thisArg.getCredentials('autodeskApsApi');
	const { client, accessToken, xUserId } = await createApsContext(credentials);
	const requestArgs = { accessToken, ...(xUserId ? { xUserId } : {}) };
	const topFolders = await client.getProjectTopFolders(hubId, projectId, requestArgs);
	const scan = await buildFolderTree(client, projectId, topFolders.data ?? [], requestArgs);
	return { client, projectId, requestArgs, scan };
}

function usesLazyBrowser(thisArg: ILoadOptionsFunctions | IExecuteFunctions): boolean {
	return thisArg.getNode().typeVersion >= LAZY_BROWSER_VERSION;
}

function resourceType(resource: unknown): string {
	if (!resource || typeof resource !== 'object') return '';
	return String((resource as { type?: unknown }).type ?? '');
}

function collectionHasNextPage(response: unknown): boolean {
	if (!response || typeof response !== 'object') return false;
	const links = (response as { links?: unknown }).links;
	if (!links || typeof links !== 'object') return false;
	const next = (links as { next?: unknown }).next;
	if (typeof next === 'string') return next.length > 0;
	return Boolean(next && typeof next === 'object' && (next as { href?: unknown }).href);
}

function selectedBrowseFolder(thisArg: ILoadOptionsFunctions): string {
	let selected = '';
	for (const parameterName of FOLDER_PATH_PARAMETER_NAMES) {
		const value = resourceValue(
			thisArg.getNodeParameter(parameterName, undefined, { extractValue: true }),
		).trim();
		if (!value) break;
		selected = value;
	}
	return selected;
}

function selectedExecutionFolder(thisArg: IExecuteFunctions, itemIndex: number): string {
	let selected = resourceValue(thisArg.getNodeParameter('folderId', itemIndex, '')).trim();
	if (!usesLazyBrowser(thisArg)) return selected;
	for (const parameterName of SUBFOLDER_PARAMETER_NAMES) {
		const value = resourceValue(thisArg.getNodeParameter(parameterName, itemIndex, '')).trim();
		if (!value) break;
		selected = value;
	}
	return selected;
}

async function loadLazyBrowserContext(thisArg: ILoadOptionsFunctions) {
	const hubId = resourceValue(thisArg.getNodeParameter('hubId', undefined, { extractValue: true }));
	const projectId = resourceValue(
		thisArg.getNodeParameter('projectId', undefined, { extractValue: true }),
	);
	if (!projectId) return undefined;
	const credentials = await thisArg.getCredentials('autodeskApsApi');
	const { client, accessToken, xUserId } = await createApsContext(credentials);
	const requestArgs = { accessToken, ...(xUserId ? { xUserId } : {}) };
	return { client, hubId, projectId, requestArgs };
}

async function searchTopFoldersLazy(
	thisArg: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const browser = await loadLazyBrowserContext(thisArg);
	if (!browser?.hubId) return { results: [] };
	const response = await browser.client.getProjectTopFolders(
		browser.hubId,
		browser.projectId,
		browser.requestArgs,
	);
	const entries = (response.data ?? []).map((folder) => ({
		name: `Folder — ${displayName(folder)}`,
		value: resourceId(folder),
	}));
	return paginateBrowserResults(entries, filter, paginationToken);
}

async function searchDirectFolderResources(
	thisArg: ILoadOptionsFunctions,
	parentFolderId: string,
	wantedType: 'folders' | 'items',
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const browser = await loadLazyBrowserContext(thisArg);
	if (!browser || !parentFolderId) return { results: [] };
	const query = (filter ?? '').trim();
	if (query) {
		const response = await loadAllPages(async (pageNumber) =>
			await browser.client.getFolderContents(browser.projectId, parentFolderId, {
				...browser.requestArgs,
				pageNumber,
				pageLimit: 200,
			}),
		);
		const entries = (response.data ?? [])
			.filter((resource) => resourceType(resource) === wantedType)
			.map((resource) => ({
				name: `${wantedType === 'folders' ? 'Folder' : 'File'} — ${displayName(resource)}`,
				value: resourceId(resource),
			}));
		return paginateBrowserResults(entries, query, paginationToken);
	}

	const pageNumber = Number.parseInt(paginationToken ?? '0', 10) || 0;
	const response = await browser.client.getFolderContents(browser.projectId, parentFolderId, {
		...browser.requestArgs,
		pageNumber,
		pageLimit: 200,
	});
	const results = (response.data ?? [])
		.filter((resource) => resourceType(resource) === wantedType)
		.map((resource) => ({
			name: `${wantedType === 'folders' ? 'Folder' : 'File'} — ${displayName(resource)}`,
			value: resourceId(resource),
		}))
		.sort((left, right) => left.name.localeCompare(right.name));
	return {
		results,
		...(collectionHasNextPage(response) ? { paginationToken: String(pageNumber + 1) } : {}),
	};
}

async function searchSubfolderLevel(
	thisArg: ILoadOptionsFunctions,
	level: number,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const parentName = FOLDER_PATH_PARAMETER_NAMES[level - 1];
	const parentFolderId = resourceValue(
		thisArg.getNodeParameter(parentName, undefined, { extractValue: true }),
	).trim();
	return await searchDirectFolderResources(
		thisArg,
		parentFolderId,
		'folders',
		filter,
		paginationToken,
	);
}

async function searchItemsLazy(
	thisArg: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	return await searchDirectFolderResources(
		thisArg,
		selectedBrowseFolder(thisArg),
		'items',
		filter,
		paginationToken,
	);
}

async function searchVersionsLazy(
	thisArg: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const browser = await loadLazyBrowserContext(thisArg);
	const itemId = resourceValue(
		thisArg.getNodeParameter('itemId', undefined, { extractValue: true }),
	).trim();
	if (!browser || !itemId) return { results: [] };
	const query = (filter ?? '').trim();
	if (query) {
		const response = await loadAllPages(async (pageNumber) =>
			await browser.client.getItemVersions(browser.projectId, itemId, {
				...browser.requestArgs,
				pageNumber,
				pageLimit: 200,
			}),
		);
		const entries = [...(response.data ?? [])]
			.sort(
				(left, right) =>
					Number(versionDisplay(right).number) - Number(versionDisplay(left).number),
			)
			.map((version) => {
				const details = versionDisplay(version);
				return {
					name: `Version ${details.number} — ${details.date}`,
					value: resourceId(version),
				};
			});
		return paginateBrowserResults(entries, query, paginationToken, false);
	}

	const pageNumber = Number.parseInt(paginationToken ?? '0', 10) || 0;
	const response = await browser.client.getItemVersions(browser.projectId, itemId, {
		...browser.requestArgs,
		pageNumber,
		pageLimit: 200,
	});
	const results = [...(response.data ?? [])]
		.sort(
			(left, right) =>
				Number(versionDisplay(right).number) - Number(versionDisplay(left).number),
		)
		.map((version) => {
			const details = versionDisplay(version);
			return {
				name: `Version ${details.number} — ${details.date}`,
				value: resourceId(version),
			};
		});
	return {
		results,
		...(collectionHasNextPage(response) ? { paginationToken: String(pageNumber + 1) } : {}),
	};
}

function versionDisplay(version: unknown): { number: string; date: string } {
	if (!version || typeof version !== 'object') return { number: '?', date: 'Unknown date' };
	const attributes = (version as { attributes?: unknown }).attributes;
	if (!attributes || typeof attributes !== 'object') return { number: '?', date: 'Unknown date' };
	const values = attributes as {
		versionNumber?: unknown;
		createTime?: unknown;
		lastModifiedTime?: unknown;
	};
	return {
		number: String(values.versionNumber ?? '?'),
		date: String(values.createTime ?? values.lastModifiedTime ?? 'Unknown date'),
	};
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
		version: [1, LAZY_BROWSER_VERSION],
		defaultVersion: LAZY_BROWSER_VERSION,
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
				for (let pageNumber = 0; ; pageNumber++) {
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
					const next = response.links?.next?.href;
					if (!next) break;
				}
				return { results };
			},
			async searchFolders(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				if (usesLazyBrowser(this)) {
					return await searchTopFoldersLazy(this, filter, paginationToken);
				}
				const browser = await loadProjectBrowser(this);
				if (!browser) return { results: [] };
				const entries = [
					...browser.scan.folders.map((folder) => ({
						name: `Folder — ${folder.path}`,
						value: folder.id,
					})),
					...browser.scan.files.map((file) => ({
						name: `File — ${file.path}`,
						value: file.id,
						disabled: true,
					})),
				];
				return paginateBrowserResults(entries, filter, paginationToken);
			},
			async searchItems(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				if (usesLazyBrowser(this)) {
					return await searchItemsLazy(this, filter, paginationToken);
				}
				const browser = await loadProjectBrowser(this);
				if (!browser) return { results: [] };
				const entries = [
					...browser.scan.folders.map((folder) => ({
						name: `Folder — ${folder.path}`,
						value: folder.id,
						disabled: true,
					})),
					...browser.scan.files.map((file) => ({
						name: `File — ${file.path}`,
						value: file.id,
					})),
				];
				return paginateBrowserResults(entries, filter, paginationToken);
			},
			async searchVersions(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				if (usesLazyBrowser(this)) {
					return await searchVersionsLazy(this, filter, paginationToken);
				}
				const browser = await loadProjectBrowser(this);
				if (!browser) return { results: [] };
				const entries: INodeListSearchResult['results'] = [];
				const files = [...browser.scan.files].sort((left, right) =>
					left.path.localeCompare(right.path),
				);
				for (const file of files) {
					entries.push({ name: `File — ${file.path}`, value: file.id, disabled: true });
					const versions = await loadAllPages(async (pageNumber) =>
						await browser.client.getItemVersions(browser.projectId, file.id, {
							...browser.requestArgs,
							pageNumber,
							pageLimit: 200,
						}),
					);
					const sortedVersions = [...(versions.data ?? [])].sort((left, right) =>
						Number(versionDisplay(right).number) - Number(versionDisplay(left).number),
					);
					for (const version of sortedVersions) {
						const details = versionDisplay(version);
						entries.push({
							name: `File — ${file.path} › Version ${details.number} — ${details.date}`,
							value: resourceId(version),
						});
					}
				}
				return paginateBrowserResults(entries, filter, paginationToken, false);
			},
			async searchSubfolders1(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
				return await searchSubfolderLevel(this, 1, filter, paginationToken);
			},
			async searchSubfolders2(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
				return await searchSubfolderLevel(this, 2, filter, paginationToken);
			},
			async searchSubfolders3(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
				return await searchSubfolderLevel(this, 3, filter, paginationToken);
			},
			async searchSubfolders4(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
				return await searchSubfolderLevel(this, 4, filter, paginationToken);
			},
			async searchSubfolders5(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
				return await searchSubfolderLevel(this, 5, filter, paginationToken);
			},
			async searchSubfolders6(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
				return await searchSubfolderLevel(this, 6, filter, paginationToken);
			},
			async searchSubfolders7(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
				return await searchSubfolderLevel(this, 7, filter, paginationToken);
			},
			async searchSubfolders8(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string) {
				return await searchSubfolderLevel(this, 8, filter, paginationToken);
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
				const hubId = HUB_FIELD_OPERATIONS.includes(operation)
					? resourceValue(this.getNodeParameter('hubId', itemIndex, ''))
					: '';
				const projectId = PROJECT_FIELD_OPERATIONS.includes(operation)
					? resourceValue(this.getNodeParameter('projectId', itemIndex, ''))
					: '';
				const folderId = FOLDER_FIELD_OPERATIONS.includes(operation)
					? selectedExecutionFolder(this, itemIndex)
					: '';
				const itemId = ITEM_OPERATIONS.includes(operation)
					? resourceValue(this.getNodeParameter('itemId', itemIndex, ''))
					: '';
				const versionId = VERSION_OPERATIONS.includes(operation)
					? resourceValue(this.getNodeParameter('versionId', itemIndex, ''))
					: '';
				const rawOptions = this.getNodeParameter('additionalOptions', itemIndex, '{}');
				const parsedOptions = typeof rawOptions === 'string' ? JSON.parse(rawOptions) : rawOptions;
				const optionalArgs = {
					...(parsedOptions as IDataObject),
					accessToken,
					...(xUserId ? { xUserId } : {}),
				};
				const returnAll = Boolean(this.getNodeParameter('returnAll', itemIndex, false));
				const allPageArgs: Record<string, unknown> = { ...optionalArgs };
				delete allPageArgs.pageNumber;
				delete allPageArgs.pageLimit;
				if (HUB_REQUIRED_OPERATIONS.includes(operation) && !hubId) {
					throw new NodeOperationError(this.getNode(), 'ACC Hub is required for this operation', {
						itemIndex,
					});
				}
				if (FOLDER_FIELD_OPERATIONS.includes(operation) && !folderId) {
					throw new NodeOperationError(this.getNode(), 'Folder ID is required for this operation', {
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
						const response = returnAll
							? await loadAllPages(async (pageNumber) =>
								await client.getHubProjects(hubId, {
									...allPageArgs,
									pageNumber,
									pageLimit: 200,
								}),
							)
							: await client.getHubProjects(hubId, optionalArgs);
						result = { ...response, data: (response.data ?? []).filter(isAccProject) };
						break;
					}
					case 'getProject': result = await client.getProject(hubId, projectId, optionalArgs); break;
					case 'getProjectHub': result = await client.getProjectHub(hubId, projectId, optionalArgs); break;
					case 'getProjectTopFolders': result = await client.getProjectTopFolders(hubId, projectId, optionalArgs); break;
					case 'getProjectTree': {
						const topFolders = await client.getProjectTopFolders(hubId, projectId, optionalArgs);
						const tree = await buildFolderTree(
							client,
							projectId,
							topFolders.data ?? [],
							allPageArgs,
						);
						result = {
							projectId,
							hubId,
							jsonapi: topFolders.jsonapi,
							links: topFolders.links,
							...tree,
						};
						break;
					}
					case 'getDownload': result = await client.getDownload(projectId, String(this.getNodeParameter('downloadId', itemIndex)), optionalArgs); break;
					case 'getDownloadJob': result = await client.getDownloadJob(projectId, String(this.getNodeParameter('jobId', itemIndex)), optionalArgs); break;
					case 'getFolder': result = await client.getFolder(projectId, folderId, optionalArgs); break;
					case 'getFolderContents': {
						const scanFullTree = Boolean(
							this.getNodeParameter('scanFullTree', itemIndex, false),
						);
						if (scanFullTree) {
							const root = await client.getFolder(projectId, folderId, optionalArgs);
							const tree = await buildFolderTree(
								client,
								projectId,
								root.data ? [root.data] : [],
								allPageArgs,
							);
							result = { projectId, root: root.data, ...tree };
						} else if (returnAll) {
							result = await loadAllPages(async (pageNumber) =>
								await client.getFolderContents(projectId, folderId, {
									...allPageArgs,
									pageNumber,
									pageLimit: 200,
								}),
							);
						} else {
							result = await client.getFolderContents(projectId, folderId, optionalArgs);
						}
						break;
					}
					case 'getFolderParent': result = await client.getFolderParent(projectId, folderId, optionalArgs); break;
					case 'getFolderRefs': result = await client.getFolderRefs(projectId, folderId, optionalArgs); break;
					case 'getFolderRelationshipsLinks': result = await client.getFolderRelationshipsLinks(projectId, folderId, optionalArgs); break;
					case 'getFolderRelationshipsRefs': result = await client.getFolderRelationshipsRefs(folderId, projectId, optionalArgs); break;
					case 'getFolderSearch':
						result = returnAll
							? await loadAllPages(async (pageNumber) =>
								await client.getFolderSearch(projectId, folderId, {
									...allPageArgs,
									pageNumber,
								}),
							)
							: await client.getFolderSearch(projectId, folderId, optionalArgs);
						break;
					case 'getItem': result = await client.getItem(projectId, itemId, optionalArgs); break;
					case 'getItemParentFolder': result = await client.getItemParentFolder(projectId, itemId, optionalArgs); break;
					case 'getItemRefs': result = await client.getItemRefs(projectId, itemId, optionalArgs); break;
					case 'getItemRelationshipsLinks': result = await client.getItemRelationshipsLinks(projectId, itemId, optionalArgs); break;
					case 'getItemRelationshipsRefs': result = await client.getItemRelationshipsRefs(projectId, itemId, optionalArgs); break;
					case 'getItemTip': result = await client.getItemTip(projectId, itemId, optionalArgs); break;
					case 'getItemVersions':
						result = returnAll
							? await loadAllPages(async (pageNumber) =>
								await client.getItemVersions(projectId, itemId, {
									...allPageArgs,
									pageNumber,
									pageLimit: 200,
								}),
							)
							: await client.getItemVersions(projectId, itemId, optionalArgs);
						break;
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
						const existingItemId = resourceValue(
							this.getNodeParameter('existingItemId', itemIndex, ''),
						).trim();
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
