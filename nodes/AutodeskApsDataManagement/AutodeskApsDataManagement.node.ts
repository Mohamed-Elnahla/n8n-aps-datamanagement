import type {
	ICredentialDataDecryptedObject,
	ICredentialsDecrypted,
	ICredentialTestFunctions,
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeCredentialTestResult,
	INode,
	INodeListSearchResult,
	INodeProperties,
	INodePropertyOptions,
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
const MULTI_INPUT_VERSION = 3;
const OUTPUT_SOURCE_LEVELS = 10;
const CONTEXT_VALUE_PREFIX = 'apsctx:';
// Autodesk Docs supports up to 25 subfolder levels below a top-level folder.
const SUBFOLDER_LEVELS = 25;
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
		show: { '@version': [1, LAZY_BROWSER_VERSION], operation: HUB_FIELD_OPERATIONS },
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
	displayOptions: {
		show: { '@version': [1, LAZY_BROWSER_VERSION], operation: PROJECT_FIELD_OPERATIONS },
	},
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

function multiResourceProperty(
	displayNameValue: string,
	name: string,
	operations: string[],
	loadOptionsMethod: string,
	required: boolean,
	description: string,
	loadOptionsDependsOn: string[] = [],
): INodeProperties {
	return {
		displayName: displayNameValue,
		name,
		type: 'multiOptions',
		default: [],
		required,
		allowArbitraryValues: true,
		description,
		typeOptions: {
			loadOptionsMethod,
			...(loadOptionsDependsOn.length > 0 ? { loadOptionsDependsOn } : {}),
		},
		displayOptions: {
			show: { '@version': [MULTI_INPUT_VERSION], operation: operations },
		},
	};
}

function multiSubfolderProperties(): INodeProperties[] {
	return SUBFOLDER_PARAMETER_NAMES.map((_, index) => {
		const level = index + 1;
		const name = `subfolderIds${level}`;
		const previousName = level === 1 ? 'folderIds' : `subfolderIds${level - 1}`;
		const property = multiResourceProperty(
			`Subfolder Level ${level}`,
			name,
			BROWSE_FOLDER_OPERATIONS,
			`loadSubfolders${level}`,
			false,
			'Optional. Select one or more direct children of the folders above. The deepest non-empty level is used as the ordered target list.',
			['hubIds', 'projectIds', previousName],
		);
		property.displayOptions = {
			show: {
				'@version': [MULTI_INPUT_VERSION],
				operation: BROWSE_FOLDER_OPERATIONS,
				[previousName]: [{ _cnd: { exists: true } }],
			},
		};
		return property;
	});
}

function nestedSourceProperties(): INodeProperties[] {
	return Array.from({ length: OUTPUT_SOURCE_LEVELS }, (_, index) => {
		const level = index + 1;
		const name = `sourcePart${level}`;
		const previousName = level === 1 ? 'source' : `sourcePart${level - 1}`;
		return {
			displayName: `Nested Source Field ${level}`,
			name,
			type: 'string',
			default: '',
			placeholder: level === 1 ? 'e.g. displayName or storage' : 'e.g. data or id',
			description: 'Enter the next key in the nested source object. The following level appears after this is filled.',
			displayOptions: {
				show:
					level === 1
						? { source: ['attributes', 'relationships', 'links', 'resource'] }
						: { [previousName]: [{ _cnd: { exists: true } }] },
			},
		};
	});
}

const multiHubProperty = multiResourceProperty(
	'ACC Hubs',
	'hubIds',
	HUB_FIELD_OPERATIONS,
	'loadHubsMulti',
	false,
	'Choose one or more ACC accounts in execution order, or supply an array of hub IDs with an expression',
);

const multiProjectProperty = multiResourceProperty(
	'ACC Projects',
	'projectIds',
	PROJECT_FIELD_OPERATIONS,
	'loadProjectsMulti',
	true,
	'Choose one or more ACC projects in execution order. A single hub is broadcast across all selected projects.',
	['hubIds'],
);

const multiFolderProperty = multiResourceProperty(
	'Folders',
	'folderIds',
	FOLDER_FIELD_OPERATIONS,
	'loadFoldersMulti',
	true,
	'Choose one or more top-level folders, continue through the subfolder fields, or supply an ordered array of folder IDs with an expression',
	['hubIds', 'projectIds'],
);

const optionalMultiFolderProperty = multiResourceProperty(
	'Browse Folders',
	'folderIds',
	OPTIONAL_BROWSE_FOLDER_OPERATIONS,
	'loadFoldersMulti',
	false,
	'Optional folder scope for browsing files. Leave empty when supplying item or version IDs directly.',
	['hubIds', 'projectIds'],
);

const multiItemProperty = multiResourceProperty(
	'Items',
	'itemIds',
	ITEM_OPERATIONS,
	'loadItemsMulti',
	true,
	'Choose one or more files in execution order, or supply an array of item IDs with an expression',
	['hubIds', 'projectIds', 'folderIds', ...SUBFOLDER_PARAMETER_NAMES.map((_, index) => `subfolderIds${index + 1}`)],
);

const optionalMultiItemProperty = multiResourceProperty(
	'Files to Browse',
	'itemIds',
	VERSION_OPERATIONS,
	'loadItemsMulti',
	false,
	'Choose files to load their versions, or leave empty when supplying Version IDs directly',
	['hubIds', 'projectIds', 'folderIds', ...SUBFOLDER_PARAMETER_NAMES.map((_, index) => `subfolderIds${index + 1}`)],
);

const multiVersionProperty = multiResourceProperty(
	'Versions',
	'versionIds',
	VERSION_OPERATIONS,
	'loadVersionsMulti',
	true,
	'Choose one or more versions in execution order, or supply an array of version IDs with an expression',
	['hubIds', 'projectIds', 'itemIds'],
);

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
	multiHubProperty,
	multiProjectProperty,
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
	multiFolderProperty,
	optionalMultiFolderProperty,
	...multiSubfolderProperties(),
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
	multiItemProperty,
	optionalMultiItemProperty,
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
	multiVersionProperty,
	{
		displayName: 'Download ID',
		name: 'downloadId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: { '@version': [1, LAZY_BROWSER_VERSION], operation: ['getDownload'] },
		},
	},
	{
		displayName: 'Download IDs',
		name: 'downloadIds',
		type: 'json',
		default: '[]',
		required: true,
		description: 'Ordered JSON array of APS download IDs. A single string is also accepted.',
		displayOptions: {
			show: { '@version': [MULTI_INPUT_VERSION], operation: ['getDownload'] },
		},
	},
	{
		displayName: 'Job ID',
		name: 'jobId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: { '@version': [1, LAZY_BROWSER_VERSION], operation: ['getDownloadJob'] },
		},
	},
	{
		displayName: 'Job IDs',
		name: 'jobIds',
		type: 'json',
		default: '[]',
		required: true,
		description: 'Ordered JSON array of APS download-job IDs. A single string is also accepted.',
		displayOptions: {
			show: { '@version': [MULTI_INPUT_VERSION], operation: ['getDownloadJob'] },
		},
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
		displayOptions: {
			show: { '@version': [1, LAZY_BROWSER_VERSION], operation: ['uploadFile'] },
		},
	},
	{
		displayName: 'Input Binary Property Names',
		name: 'inputBinaryFields',
		type: 'multiOptions',
		default: ['data'],
		required: true,
		allowArbitraryValues: true,
		options: [{ name: 'Data', value: 'data' }],
		description: 'Ordered binary property names to upload. A single value is broadcast across all folder or item targets.',
		displayOptions: {
			show: { '@version': [MULTI_INPUT_VERSION], operation: ['uploadFile'] },
		},
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
	multiResourceProperty(
		'Existing Items',
		'existingItemIds',
		['uploadFile'],
		'loadItemsMulti',
		false,
		'Optionally choose existing files in execution order to create new versions. Empty entries create new items.',
		['hubIds', 'projectIds', 'folderIds', ...SUBFOLDER_PARAMETER_NAMES.map((_, index) => `subfolderIds${index + 1}`)],
	),
	{
		displayName: 'File Name',
		name: 'fileName',
		type: 'string',
		default: '',
		description: 'Leave empty to use the binary file name',
		displayOptions: {
			show: { '@version': [1, LAZY_BROWSER_VERSION], operation: ['uploadFile'] },
		},
	},
	{
		displayName: 'File Names',
		name: 'fileNames',
		type: 'json',
		default: '[]',
		description: 'Optional ordered JSON array of destination file names. Empty entries use the binary file name.',
		displayOptions: {
			show: { '@version': [MULTI_INPUT_VERSION], operation: ['uploadFile'] },
		},
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
		displayOptions: {
			show: { '@version': [1, LAZY_BROWSER_VERSION], operation: ['uploadFile'] },
		},
	},
	{
		displayName: 'ACC File Types',
		name: 'accFileTypes',
		type: 'multiOptions',
		default: ['File'],
		required: true,
		options: [
			{ name: 'Project File', value: 'File' },
			{ name: 'Plan Document', value: 'Document' },
		],
		description: 'Ordered file types. A single selection is broadcast across every upload target.',
		displayOptions: {
			show: { '@version': [MULTI_INPUT_VERSION], operation: ['uploadFile'] },
		},
	},
	{
		displayName: 'Output Binary Field',
		name: 'outputBinaryField',
		type: 'string',
		default: 'data',
		required: true,
		displayOptions: {
			show: { '@version': [1, LAZY_BROWSER_VERSION], operation: ['downloadFile'] },
		},
	},
	{
		displayName: 'Output Binary Fields',
		name: 'outputBinaryFields',
		type: 'multiOptions',
		default: ['data'],
		required: true,
		allowArbitraryValues: true,
		options: [{ name: 'Data', value: 'data' }],
		description: 'Ordered binary output field names. A single value is broadcast across every downloaded version.',
		displayOptions: {
			show: { '@version': [MULTI_INPUT_VERSION], operation: ['downloadFile'] },
		},
	},
	{
		displayName: 'Output',
		name: 'outputMode',
		type: 'options',
		default: 'full',
		options: [
			{ name: 'Return Full Response', value: 'full' },
			{ name: 'Return Only Data', value: 'data' },
			{ name: 'Select and Map Data Fields', value: 'fields' },
		],
		description: 'Choose whether each API call returns its full response, its data records, or mapped fields from every data record',
	},
	{
		displayName: 'Data Field Mappings',
		name: 'outputMappings',
		type: 'fixedCollection',
		default: {},
		placeholder: 'Add Field Mapping',
		typeOptions: { multipleValues: true, sortable: true },
		options: [
			{
				name: 'values',
				displayName: 'Field',
				values: [
					{
						displayName: 'Source Field Name or ID',
						name: 'source',
						type: 'options',
						default: 'id',
						description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							typeOptions: {
								loadOptionsMethod: 'loadCommonOutputFields',
								loadOptionsDependsOn: ['operation', 'scanFullTree'],
							},
						},
						...nestedSourceProperties(),
						{
						displayName: 'Output Field',
						name: 'target',
						type: 'string',
						default: '',
						placeholder: 'e.g. fileId',
						description: 'Output field name or dotted path. Leave empty to keep the source field name.',
					},
				],
			},
		],
		displayOptions: { show: { outputMode: ['fields'] } },
	},
	{
		displayName: 'Custom Data Field Mappings (JSON)',
		name: 'customOutputMappings',
		type: 'json',
		default: '{}',
		// eslint-disable-next-line n8n-nodes-base/node-param-description-miscased-id -- JSON paths must match APS response keys exactly.
		description: 'Optional object mapping output fields to source dotted paths, for example {"version":"attributes.versionNumber","storage":"relationships.storage.data.id"}',
		displayOptions: { show: { outputMode: ['fields'] } },
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
	const entries = (response.data ?? [])
		.filter((resource) => resourceType(resource) === 'folders')
		.map((folder) => ({
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

type FolderListSearchMethod = (
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
) => Promise<INodeListSearchResult>;

function createSubfolderSearchMethods(): Record<string, FolderListSearchMethod> {
	const methods: Record<string, FolderListSearchMethod> = {};
	for (let level = 1; level <= SUBFOLDER_LEVELS; level++) {
		methods[`searchSubfolders${level}`] = async function (
			this: ILoadOptionsFunctions,
			filter?: string,
			paginationToken?: string,
		) {
			return await searchSubfolderLevel(this, level, filter, paginationToken);
		};
	}
	return methods;
}

const subfolderSearchMethods = createSubfolderSearchMethods();

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
			.filter((resource) => resourceType(resource) === 'versions')
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
		.filter((resource) => resourceType(resource) === 'versions')
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

function parseParameterValue(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	const trimmed = value.trim();
	if (!trimmed || (!trimmed.startsWith('[') && !trimmed.startsWith('{'))) return value;
	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		return value;
	}
}

function parameterValues(value: unknown): unknown[] {
	const parsed = parseParameterValue(value);
	if (Array.isArray(parsed)) return parsed.flatMap((entry) => parameterValues(entry));
	if (parsed && typeof parsed === 'object' && 'value' in parsed) {
		return parameterValues((parsed as { value: unknown }).value);
	}
	return [parsed];
}

function stringParameterValues(value: unknown): string[] {
	return parameterValues(value)
		.map((entry) => String(entry ?? '').trim())
		.filter(Boolean);
}

export interface ContextualSelection {
	id: string;
	hubId?: string;
	projectId?: string;
	hubName?: string;
	projectName?: string;
}

export function encodeContextualSelection(selection: ContextualSelection): string {
	return `${CONTEXT_VALUE_PREFIX}${encodeURIComponent(JSON.stringify(selection))}`;
}

export function decodeContextualSelection(value: unknown): ContextualSelection {
	const text = String(value ?? '').trim();
	if (!text.startsWith(CONTEXT_VALUE_PREFIX)) return { id: text };
	try {
		const parsed = JSON.parse(
			decodeURIComponent(text.slice(CONTEXT_VALUE_PREFIX.length)),
		) as Partial<ContextualSelection>;
		if (typeof parsed.id !== 'string' || !parsed.id.trim()) return { id: text };
		return {
			id: parsed.id,
			...(typeof parsed.hubId === 'string' ? { hubId: parsed.hubId } : {}),
			...(typeof parsed.projectId === 'string' ? { projectId: parsed.projectId } : {}),
			...(typeof parsed.hubName === 'string' ? { hubName: parsed.hubName } : {}),
			...(typeof parsed.projectName === 'string' ? { projectName: parsed.projectName } : {}),
		};
	} catch {
		return { id: text };
	}
}

export function contextualExecutionValues(
	projectSelections: ContextualSelection[],
	targetSelections: ContextualSelection[],
): { hubIds: string[]; projectIds: string[] } {
	const contextualProjectIds =
		targetSelections.length > 0 && targetSelections.every((selection) => selection.projectId)
			? targetSelections.map((selection) => selection.projectId as string)
			: projectSelections.map((selection) => selection.id);
	const contextualHubIds =
		targetSelections.length > 0 && targetSelections.every((selection) => selection.hubId)
			? targetSelections.map((selection) => selection.hubId as string)
			: projectSelections.length > 0 && projectSelections.every((selection) => selection.hubId)
				? projectSelections.map((selection) => selection.hubId as string)
				: [];
	return { hubIds: contextualHubIds, projectIds: contextualProjectIds };
}

export function getMultiSelections(
	thisArg: ILoadOptionsFunctions | IExecuteFunctions,
	name: string,
	itemIndex?: number,
): ContextualSelection[] {
	return stringParameterValues(thisArg.getNodeParameter(name, itemIndex)).map(
		decodeContextualSelection,
	);
}

function getMultiParameter(
	thisArg: ILoadOptionsFunctions | IExecuteFunctions,
	name: string,
	itemIndex?: number,
): string[] {
	return getMultiSelections(thisArg, name, itemIndex).map((selection) => selection.id);
}

function broadcastValue<T>(values: T[], index: number): T | undefined {
	if (values.length === 1) return values[0];
	return values[index];
}

function uniqueOptions(options: INodePropertyOptions[]): INodePropertyOptions[] {
	const seen = new Set<string>();
	return options.filter((option) => {
		const key = String(option.value);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

type ApsDataClient = Awaited<ReturnType<typeof createApsContext>>['client'];
type ApsRequestArgs = { accessToken: string; xUserId?: string };

async function loadHubNameMap(
	client: ApsDataClient,
	requestArgs: ApsRequestArgs,
): Promise<Map<string, string>> {
	const names = new Map<string, string>();
	try {
		const response = await client.getHubs(requestArgs);
		for (const hub of response.data ?? []) names.set(resourceId(hub), displayName(hub));
	} catch {
		// The dependent resource request can still succeed, so IDs remain useful fallbacks.
	}
	return names;
}

async function projectContextName(
	client: ApsDataClient,
	hubId: string,
	projectId: string,
	requestArgs: ApsRequestArgs,
	cache: Map<string, string>,
): Promise<string> {
	const key = `${hubId}:${projectId}`;
	const cached = cache.get(key);
	if (cached) return cached;
	let name = projectId;
	if (hubId) {
		try {
			const response = await client.getProject(hubId, projectId, requestArgs);
			name = displayName(response.data);
		} catch {
			// Keep the project ID as context when its display name cannot be resolved.
		}
	}
	cache.set(key, name);
	return name;
}

async function hydrateProjectSelections(
	client: ApsDataClient,
	selections: ContextualSelection[],
	hubIds: string[],
	requestArgs: ApsRequestArgs,
	hubNames: Map<string, string>,
): Promise<ContextualSelection[]> {
	return await Promise.all(
		selections.map(async (selection, index) => {
			if (selection.hubId) return selection;
			const candidateHubIds =
				hubIds.length === 1
					? hubIds
					: [broadcastValue(hubIds, index), ...hubIds].filter(
							(hubId, candidateIndex, values): hubId is string =>
								Boolean(hubId) && values.indexOf(hubId) === candidateIndex,
						);
			for (const hubId of candidateHubIds) {
				try {
					const response = await client.getProject(hubId, selection.id, requestArgs);
					return {
						...selection,
						hubId,
						hubName: hubNames.get(hubId) ?? hubId,
						projectName: displayName(response.data),
					};
				} catch {
					// Try the next selected hub for a legacy/plain project ID.
				}
			}
			return selection;
		}),
	);
}

type ContextResourceKind = 'folder' | 'item' | 'version';

async function hydrateResourceSelections(
	client: ApsDataClient,
	selections: ContextualSelection[],
	projectSelections: ContextualSelection[],
	hubIds: string[],
	requestArgs: ApsRequestArgs,
	hubNames: Map<string, string>,
	kind: ContextResourceKind,
): Promise<{ resources: ContextualSelection[]; projects: ContextualSelection[] }> {
	const projects = await hydrateProjectSelections(
		client,
		projectSelections,
		hubIds,
		requestArgs,
		hubNames,
	);
	const resources: ContextualSelection[] = [];
	for (const selection of selections) {
		if (selection.projectId) {
			resources.push(selection);
			continue;
		}
		let hydrated = selection;
		for (const project of projects) {
			try {
				if (kind === 'folder') await client.getFolder(project.id, selection.id, requestArgs);
				else if (kind === 'item') await client.getItem(project.id, selection.id, requestArgs);
				else await client.getVersion(project.id, selection.id, requestArgs);
				hydrated = {
					...selection,
					hubId: project.hubId,
					projectId: project.id,
					hubName: project.hubName,
					projectName: project.projectName,
				};
				break;
			} catch {
				// Try the next selected project for a legacy/plain resource ID.
			}
		}
		resources.push(hydrated);
	}
	return { resources, projects };
}

export function contextualOptionName(
	showContext: boolean,
	hubName: string,
	projectName: string,
	resourceName: string,
): string {
	if (!showContext) return resourceName;
	return [hubName, projectName, resourceName].filter(Boolean).join(' › ');
}

async function loadHubsMulti(thisArg: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const credentials = await thisArg.getCredentials('autodeskApsApi');
	const { client, accessToken, xUserId } = await createApsContext(credentials);
	const response = await client.getHubs({ accessToken, xUserId });
	return (response.data ?? [])
		.filter((hub) => resourceId(hub).startsWith('b.'))
		.map((hub) => ({ name: displayName(hub), value: resourceId(hub) }));
}

async function loadProjectsMulti(thisArg: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const hubIds = getMultiParameter(thisArg, 'hubIds');
	if (hubIds.length === 0) return [];
	const credentials = await thisArg.getCredentials('autodeskApsApi');
	const { client, accessToken, xUserId } = await createApsContext(credentials);
	const requestArgs = { accessToken, ...(xUserId ? { xUserId } : {}) };
	const hubNames = await loadHubNameMap(client, requestArgs);
	const options: INodePropertyOptions[] = [];
	for (const hubId of hubIds) {
		const response = await loadAllPages(async (pageNumber) =>
			await client.getHubProjects(hubId, {
				accessToken,
				xUserId,
				pageNumber,
				pageLimit: 200,
			}),
		);
		options.push(
			...(response.data ?? [])
				.filter(isAccProject)
				.map((project) => {
					const hubName = hubNames.get(hubId) ?? hubId;
					const projectName = displayName(project);
					return {
						name: hubIds.length > 1 ? `${hubName} › ${projectName}` : projectName,
						value: encodeContextualSelection({
							id: resourceId(project),
							hubId,
							hubName,
							projectName,
						}),
					};
				}),
		);
	}
	return uniqueOptions(options);
}

async function loadFoldersMulti(thisArg: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const hubIds = getMultiParameter(thisArg, 'hubIds');
	const configuredProjects = getMultiSelections(thisArg, 'projectIds');
	if (configuredProjects.length === 0) return [];
	const credentials = await thisArg.getCredentials('autodeskApsApi');
	const { client, accessToken, xUserId } = await createApsContext(credentials);
	const requestArgs = { accessToken, ...(xUserId ? { xUserId } : {}) };
	const hubNames = await loadHubNameMap(client, requestArgs);
	const projectSelections = await hydrateProjectSelections(
		client,
		configuredProjects,
		hubIds,
		requestArgs,
		hubNames,
	);
	const projectNames = new Map<string, string>();
	const showContext = hubIds.length > 1 || projectSelections.length > 1;
	const options: INodePropertyOptions[] = [];
	for (let index = 0; index < projectSelections.length; index++) {
		const selection = projectSelections[index];
		const projectId = selection.id;
		const hubId = selection.hubId ?? broadcastValue(hubIds, index);
		if (!hubId) continue;
		const projectName =
			selection.projectName ??
			(await projectContextName(client, hubId, projectId, requestArgs, projectNames));
		const hubName = selection.hubName ?? hubNames.get(hubId) ?? hubId;
		const response = await client.getProjectTopFolders(hubId, projectId, {
			accessToken,
			xUserId,
		});
		options.push(
			...(response.data ?? [])
				.filter((folder) => resourceType(folder) === 'folders')
				.map((folder) => ({
					name: contextualOptionName(
						showContext,
						hubName,
						projectName,
						displayName(folder),
					),
					value: encodeContextualSelection({
						id: resourceId(folder),
						hubId,
						projectId,
						hubName,
						projectName,
					}),
				})),
		);
	}
	return uniqueOptions(options);
}

function selectedMultiBrowseSelections(
	thisArg: ILoadOptionsFunctions | IExecuteFunctions,
	itemIndex?: number,
): ContextualSelection[] {
	let selected = getMultiSelections(thisArg, 'folderIds', itemIndex);
	for (let level = 1; level <= SUBFOLDER_LEVELS; level++) {
		const current = getMultiSelections(thisArg, `subfolderIds${level}`, itemIndex);
		if (current.length === 0) break;
		selected = current;
	}
	return selected;
}

async function loadDirectResourcesMulti(
	thisArg: ILoadOptionsFunctions,
	parentSelections: ContextualSelection[],
	wantedType: 'folders' | 'items',
): Promise<INodePropertyOptions[]> {
	if (parentSelections.length === 0) return [];
	const hubIds = getMultiParameter(thisArg, 'hubIds');
	const configuredProjects = getMultiSelections(thisArg, 'projectIds');
	if (configuredProjects.length === 0) return [];
	const credentials = await thisArg.getCredentials('autodeskApsApi');
	const { client, accessToken, xUserId } = await createApsContext(credentials);
	const requestArgs = { accessToken, ...(xUserId ? { xUserId } : {}) };
	const hubNames = await loadHubNameMap(client, requestArgs);
	const hydrated = await hydrateResourceSelections(
		client,
		parentSelections,
		configuredProjects,
		hubIds,
		requestArgs,
		hubNames,
		'folder',
	);
	parentSelections = hydrated.resources;
	const projectSelections = hydrated.projects;
	const projectNames = new Map<string, string>();
	const showContext =
		hubIds.length > 1 || projectSelections.length > 1 || parentSelections.length > 1;
	const options: INodePropertyOptions[] = [];
	for (let index = 0; index < parentSelections.length; index++) {
		const parent = parentSelections[index];
		const fallbackProject = broadcastValue(projectSelections, index);
		const projectId = parent.projectId ?? fallbackProject?.id;
		if (!projectId) continue;
		const hubId = parent.hubId ?? fallbackProject?.hubId ?? broadcastValue(hubIds, index) ?? '';
		const projectName =
			parent.projectName ??
			fallbackProject?.projectName ??
			(await projectContextName(client, hubId, projectId, requestArgs, projectNames));
		const hubName = parent.hubName ?? fallbackProject?.hubName ?? hubNames.get(hubId) ?? hubId;
		const response = await loadAllPages(async (pageNumber) =>
			await client.getFolderContents(projectId, parent.id, {
				accessToken,
				xUserId,
				pageNumber,
				pageLimit: 200,
			}),
		);
		options.push(
			...(response.data ?? [])
				.filter((resource) => resourceType(resource) === wantedType)
				.map((resource) => ({
					name: contextualOptionName(
						showContext,
						hubName,
						projectName,
						displayName(resource),
					),
					value: encodeContextualSelection({
						id: resourceId(resource),
						hubId,
						projectId,
						hubName,
						projectName,
					}),
				})),
		);
	}
	return uniqueOptions(options);
}

async function loadSubfoldersMulti(
	thisArg: ILoadOptionsFunctions,
	level: number,
): Promise<INodePropertyOptions[]> {
	const parentName = level === 1 ? 'folderIds' : `subfolderIds${level - 1}`;
	return await loadDirectResourcesMulti(
		thisArg,
		getMultiSelections(thisArg, parentName),
		'folders',
	);
}

async function loadItemsMulti(thisArg: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return await loadDirectResourcesMulti(
		thisArg,
		selectedMultiBrowseSelections(thisArg),
		'items',
	);
}

async function loadVersionsMulti(thisArg: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const hubIds = getMultiParameter(thisArg, 'hubIds');
	const configuredProjects = getMultiSelections(thisArg, 'projectIds');
	let itemSelections = getMultiSelections(thisArg, 'itemIds');
	if (configuredProjects.length === 0 || itemSelections.length === 0) return [];
	const credentials = await thisArg.getCredentials('autodeskApsApi');
	const { client, accessToken, xUserId } = await createApsContext(credentials);
	const requestArgs = { accessToken, ...(xUserId ? { xUserId } : {}) };
	const hubNames = await loadHubNameMap(client, requestArgs);
	const hydrated = await hydrateResourceSelections(
		client,
		itemSelections,
		configuredProjects,
		hubIds,
		requestArgs,
		hubNames,
		'item',
	);
	itemSelections = hydrated.resources;
	const projectSelections = hydrated.projects;
	const projectNames = new Map<string, string>();
	const showContext =
		hubIds.length > 1 || projectSelections.length > 1 || itemSelections.length > 1;
	const options: INodePropertyOptions[] = [];
	for (let index = 0; index < itemSelections.length; index++) {
		const item = itemSelections[index];
		const fallbackProject = broadcastValue(projectSelections, index);
		const projectId = item.projectId ?? fallbackProject?.id;
		if (!projectId) continue;
		const hubId = item.hubId ?? fallbackProject?.hubId ?? broadcastValue(hubIds, index) ?? '';
		const projectName =
			item.projectName ??
			fallbackProject?.projectName ??
			(await projectContextName(client, hubId, projectId, requestArgs, projectNames));
		const hubName = item.hubName ?? fallbackProject?.hubName ?? hubNames.get(hubId) ?? hubId;
		const response = await loadAllPages(async (pageNumber) =>
			await client.getItemVersions(projectId, item.id, {
				accessToken,
				xUserId,
				pageNumber,
				pageLimit: 200,
			}),
		);
		const versions = [...(response.data ?? [])].sort(
			(left, right) => Number(versionDisplay(right).number) - Number(versionDisplay(left).number),
		);
		options.push(
			...versions.map((version) => {
				const details = versionDisplay(version);
				const versionName = `${displayName(version)} — Version ${details.number} — ${details.date}`;
				return {
					name: contextualOptionName(
						showContext,
						hubName,
						projectName,
						versionName,
					),
					value: encodeContextualSelection({
						id: resourceId(version),
						hubId,
						projectId,
						hubName,
						projectName,
					}),
				};
			}),
		);
	}
	return uniqueOptions(options);
}

function createMultiSubfolderLoadMethods(): Record<
	string,
	(this: ILoadOptionsFunctions) => Promise<INodePropertyOptions[]>
> {
	const methods: Record<
		string,
		(this: ILoadOptionsFunctions) => Promise<INodePropertyOptions[]>
	> = {};
	for (let level = 1; level <= SUBFOLDER_LEVELS; level++) {
		methods[`loadSubfolders${level}`] = async function (this: ILoadOptionsFunctions) {
			return await loadSubfoldersMulti(this, level);
		};
	}
	return methods;
}

const multiSubfolderLoadMethods = createMultiSubfolderLoadMethods();

interface BatchField {
	name: string;
	values: unknown[];
	required?: boolean;
	defaultValue?: unknown;
}

export function createOrderedBatches(node: INode, fields: BatchField[]): Array<Record<string, unknown>> {
	const batchSize = Math.max(1, ...fields.map((field) => field.values.length));
	for (const field of fields) {
		if (field.required && field.values.length === 0) {
			throw new NodeOperationError(node, `${field.name} requires at least one value`);
		}
		if (field.values.length > 1 && field.values.length !== batchSize) {
			throw new NodeOperationError(
				node,
				`${field.name} has ${field.values.length} values; expected 1 or ${batchSize} to preserve ordered list alignment`,
			);
		}
	}
	return Array.from({ length: batchSize }, (_, index) =>
		Object.fromEntries(
			fields.map((field) => [
				field.name,
				field.values.length === 0
					? field.defaultValue
					: field.values.length === 1
						? field.values[0]
						: field.values[index],
			]),
		),
	);
}

function executionParameterValues(
	thisArg: IExecuteFunctions,
	legacyName: string,
	multiName: string,
	itemIndex: number,
	defaultValue: unknown = '',
	preserveEmpty = false,
): unknown[] {
	const name = thisArg.getNode().typeVersion >= MULTI_INPUT_VERSION ? multiName : legacyName;
	const values = parameterValues(thisArg.getNodeParameter(name, itemIndex, defaultValue)).map(
		(value) =>
			typeof value === 'string' && value.startsWith(CONTEXT_VALUE_PREFIX)
				? decodeContextualSelection(value).id
				: value,
	);
	return preserveEmpty
		? values
		: values.filter((value) => String(value ?? '').trim() !== '');
}

function getPathValue(value: unknown, path: string): unknown {
	if (!path) return value;
	return path.split('.').reduce<unknown>((current, part) => {
		if (current === null || current === undefined || typeof current !== 'object') return undefined;
		if (Array.isArray(current)) {
			const index = Number.parseInt(part, 10);
			return Number.isNaN(index) ? undefined : current[index];
		}
		return (current as Record<string, unknown>)[part];
	}, value);
}

function setPathValue(target: IDataObject, path: string, value: unknown): void {
	const parts = path.split('.').filter(Boolean);
	const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
	if (parts.length === 0 || parts.some((part) => unsafeKeys.has(part))) return;
	let current: IDataObject = target;
	for (let index = 0; index < parts.length - 1; index++) {
		const part = parts[index];
		const next = current[part];
		if (!next || typeof next !== 'object' || Array.isArray(next)) current[part] = {};
		current = current[part] as IDataObject;
	}
	current[parts[parts.length - 1]] = value as IDataObject[string];
}

function operationData(operation: string, result: unknown): unknown[] {
	if (!result || typeof result !== 'object') return [result];
	const object = result as Record<string, unknown>;
	let data: unknown;
	if ('data' in object) data = object.data;
	else if (operation === 'getProjectTree' || operation === 'getFolderContents') data = object.tree;
	else if (operation === 'uploadFile') {
		const response = (object.item ?? object.version) as Record<string, unknown> | undefined;
		data = response?.data ?? response ?? result;
	} else data = result;
	return Array.isArray(data) ? data : [data];
}

function jsonForRecord(record: unknown): IDataObject {
	if (record && typeof record === 'object' && !Array.isArray(record)) return asJson(record);
	return { data: JSON.parse(JSON.stringify(record ?? null)) as IDataObject[string] };
}

function mappedRecord(
	record: unknown,
	mappingsValue: unknown,
	customMappingsValue: unknown,
): IDataObject {
	const result: IDataObject = {};
	const collection = mappingsValue as {
		values?: Array<{ source?: unknown; target?: unknown; [key: string]: unknown }>;
	};
	for (const mapping of collection?.values ?? []) {
		const rootSource = String(mapping.source ?? '').trim();
		const sourceParts = [rootSource];
		if (['attributes', 'relationships', 'links', 'resource'].includes(rootSource)) {
			for (let level = 1; level <= OUTPUT_SOURCE_LEVELS; level++) {
				const part = String(mapping[`sourcePart${level}`] ?? '').trim();
				if (!part) break;
				sourceParts.push(part);
			}
		}
		const source = sourceParts.filter(Boolean).join('.');
		if (!source) continue;
		const target = String(mapping.target ?? '').trim() || source;
		const value = getPathValue(record, source);
		if (value !== undefined) setPathValue(result, target, value);
	}
	const parsedCustom = parseParameterValue(customMappingsValue);
	if (parsedCustom && typeof parsedCustom === 'object' && !Array.isArray(parsedCustom)) {
		for (const [target, source] of Object.entries(parsedCustom as Record<string, unknown>)) {
			const value = getPathValue(record, String(source));
			if (value !== undefined) setPathValue(result, target, value);
		}
	}
	return result;
}

export function outputJsonRecords(
	operation: string,
	result: unknown,
	outputMode: string,
	mappingsValue: unknown,
	customMappingsValue: unknown,
): IDataObject[] {
	if (outputMode === 'full') return [asJson(result)];
	const records = operationData(operation, result);
	if (outputMode === 'fields') {
		return records.map((record) => mappedRecord(record, mappingsValue, customMappingsValue));
	}
	return records.map(jsonForRecord);
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
		version: [1, LAZY_BROWSER_VERSION, MULTI_INPUT_VERSION],
		defaultVersion: MULTI_INPUT_VERSION,
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
		loadOptions: {
			...multiSubfolderLoadMethods,
			async loadHubsMulti(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return await loadHubsMulti(this);
			},
			async loadProjectsMulti(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return await loadProjectsMulti(this);
			},
			async loadFoldersMulti(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return await loadFoldersMulti(this);
			},
			async loadItemsMulti(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return await loadItemsMulti(this);
			},
			async loadVersionsMulti(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return await loadVersionsMulti(this);
			},
			async loadCommonOutputFields(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				const operation = String(this.getNodeParameter('operation', undefined));
				const scanFullTree =
					operation === 'getFolderContents'
						? Boolean(this.getNodeParameter('scanFullTree', undefined))
						: false;
				if (operation === 'getProjectTree' || (operation === 'getFolderContents' && scanFullTree)) {
					return [
						{ name: 'ID', value: 'id' },
						{ name: 'Type', value: 'type' },
						{ name: 'Name', value: 'name' },
						{ name: 'Path', value: 'path' },
						{ name: 'Depth', value: 'depth' },
						{ name: 'Parent ID', value: 'parentId' },
						{ name: 'Original Resource', value: 'resource' },
					];
				}
				return [
					{ name: 'ID', value: 'id' },
					{ name: 'Type', value: 'type' },
					{ name: 'Attributes', value: 'attributes' },
					{ name: 'Relationships', value: 'relationships' },
					{ name: 'Links', value: 'links' },
				];
			},
		},
		listSearch: {
			...subfolderSearchMethods,
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
				const entries = browser.scan.folders
					.filter((folder) => folder.type === 'folders')
					.map((folder) => ({
						name: `Folder — ${folder.path}`,
						value: folder.id,
					}));
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
				const entries = browser.scan.files
					.filter((file) => file.type === 'items')
					.map((file) => ({
						name: `File — ${file.path}`,
						value: file.id,
					}));
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
				const files = [...browser.scan.files]
					.filter((file) => file.type === 'items')
					.sort((left, right) => left.path.localeCompare(right.path));
				for (const file of files) {
					const versions = await loadAllPages(async (pageNumber) =>
						await browser.client.getItemVersions(browser.projectId, file.id, {
							...browser.requestArgs,
							pageNumber,
							pageLimit: 200,
						}),
					);
					const sortedVersions = [...(versions.data ?? [])]
						.filter((resource) => resourceType(resource) === 'versions')
						.sort(
							(left, right) =>
								Number(versionDisplay(right).number) -
								Number(versionDisplay(left).number),
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
			const isMultiVersion = this.getNode().typeVersion >= MULTI_INPUT_VERSION;
			const configuredHubIds =
				isMultiVersion && HUB_FIELD_OPERATIONS.includes(operation)
					? getMultiParameter(this, 'hubIds', itemIndex)
					: [];
			let projectSelections =
				isMultiVersion && PROJECT_FIELD_OPERATIONS.includes(operation)
				? getMultiSelections(this, 'projectIds', itemIndex)
				: [];
			let folderSelections =
				isMultiVersion && FOLDER_FIELD_OPERATIONS.includes(operation)
					? selectedMultiBrowseSelections(this, itemIndex)
					: [];
			let itemSelections =
				isMultiVersion && ITEM_OPERATIONS.includes(operation)
					? getMultiSelections(this, 'itemIds', itemIndex)
					: [];
			let versionSelections =
				isMultiVersion && VERSION_OPERATIONS.includes(operation)
					? getMultiSelections(this, 'versionIds', itemIndex)
					: [];
			const selectedTargets =
				folderSelections.length > 0
					? folderSelections
					: itemSelections.length > 0
						? itemSelections
						: versionSelections;
			const needsContextHydration =
				isMultiVersion &&
				(projectSelections.some((selection) => !selection.hubId) ||
					selectedTargets.some((selection) => !selection.projectId));
			if (needsContextHydration) {
				const { client, accessToken, xUserId } = context;
				const requestArgs = { accessToken, ...(xUserId ? { xUserId } : {}) };
				const hubNames = await loadHubNameMap(client, requestArgs);
				projectSelections = await hydrateProjectSelections(
					client,
					projectSelections,
					configuredHubIds,
					requestArgs,
					hubNames,
				);
				if (folderSelections.some((selection) => !selection.projectId)) {
					folderSelections = (
						await hydrateResourceSelections(
							client,
							folderSelections,
							projectSelections,
							configuredHubIds,
							requestArgs,
							hubNames,
							'folder',
						)
					).resources;
				} else if (itemSelections.some((selection) => !selection.projectId)) {
					itemSelections = (
						await hydrateResourceSelections(
							client,
							itemSelections,
							projectSelections,
							configuredHubIds,
							requestArgs,
							hubNames,
							'item',
						)
					).resources;
				} else if (versionSelections.some((selection) => !selection.projectId)) {
					versionSelections = (
						await hydrateResourceSelections(
							client,
							versionSelections,
							projectSelections,
							configuredHubIds,
							requestArgs,
							hubNames,
							'version',
						)
					).resources;
				}
			}
			const contextualTargets =
				folderSelections.length > 0
					? folderSelections
					: itemSelections.length > 0
						? itemSelections
						: versionSelections.length > 0
							? versionSelections
							: projectSelections;
			const contextualValues = contextualExecutionValues(projectSelections, contextualTargets);
			const contextualHubValues =
				HUB_REQUIRED_OPERATIONS.includes(operation)
					? contextualValues.hubIds.length > 0
						? contextualValues.hubIds
						: executionParameterValues(this, 'hubId', 'hubIds', itemIndex)
					: [];
			const folderValues = FOLDER_FIELD_OPERATIONS.includes(operation)
				? isMultiVersion
					? folderSelections.map((selection) => selection.id)
					: [selectedExecutionFolder(this, itemIndex)].filter(Boolean)
				: [];
			let batches: Array<Record<string, unknown>>;
			try {
				batches = createOrderedBatches(this.getNode(), [
					{
						name: 'hubId',
						values: HUB_REQUIRED_OPERATIONS.includes(operation)
							? contextualHubValues
							: [],
						required: HUB_REQUIRED_OPERATIONS.includes(operation),
						defaultValue: '',
					},
					{
						name: 'projectId',
						values: PROJECT_FIELD_OPERATIONS.includes(operation)
							? isMultiVersion
								? contextualValues.projectIds
								: executionParameterValues(this, 'projectId', 'projectIds', itemIndex)
							: [],
						required: PROJECT_FIELD_OPERATIONS.includes(operation),
						defaultValue: '',
					},
					{
						name: 'folderId',
						values: folderValues,
						required: FOLDER_FIELD_OPERATIONS.includes(operation),
						defaultValue: '',
					},
					{
						name: 'itemId',
						values: ITEM_OPERATIONS.includes(operation)
							? isMultiVersion
								? itemSelections.map((selection) => selection.id)
								: executionParameterValues(this, 'itemId', 'itemIds', itemIndex)
							: [],
						required: ITEM_OPERATIONS.includes(operation),
						defaultValue: '',
					},
					{
						name: 'versionId',
						values: VERSION_OPERATIONS.includes(operation)
							? isMultiVersion
								? versionSelections.map((selection) => selection.id)
								: executionParameterValues(this, 'versionId', 'versionIds', itemIndex)
							: [],
						required: VERSION_OPERATIONS.includes(operation),
						defaultValue: '',
					},
					{
						name: 'downloadId',
						values:
							operation === 'getDownload'
								? executionParameterValues(this, 'downloadId', 'downloadIds', itemIndex)
								: [],
						required: operation === 'getDownload',
						defaultValue: '',
					},
					{
						name: 'jobId',
						values:
							operation === 'getDownloadJob'
								? executionParameterValues(this, 'jobId', 'jobIds', itemIndex)
								: [],
						required: operation === 'getDownloadJob',
						defaultValue: '',
					},
					{
						name: 'existingItemId',
						values:
							operation === 'uploadFile'
								? executionParameterValues(
										this,
										'existingItemId',
										'existingItemIds',
										itemIndex,
										[],
										true,
									)
								: [],
						defaultValue: '',
					},
					{
						name: 'inputBinaryField',
						values:
							operation === 'uploadFile'
								? executionParameterValues(
										this,
										'inputBinaryField',
										'inputBinaryFields',
										itemIndex,
										'data',
									)
								: [],
						required: operation === 'uploadFile',
						defaultValue: 'data',
					},
					{
						name: 'fileName',
						values:
							operation === 'uploadFile'
								? executionParameterValues(
										this,
										'fileName',
										'fileNames',
										itemIndex,
										[],
										true,
									)
								: [],
						defaultValue: '',
					},
					{
						name: 'fileType',
						values:
							operation === 'uploadFile'
								? executionParameterValues(
										this,
										'accFileType',
										'accFileTypes',
										itemIndex,
										'File',
									)
								: [],
						required: operation === 'uploadFile',
						defaultValue: 'File',
					},
					{
						name: 'outputBinaryField',
						values:
							operation === 'downloadFile'
								? executionParameterValues(
										this,
										'outputBinaryField',
										'outputBinaryFields',
										itemIndex,
										'data',
									)
								: [],
						required: operation === 'downloadFile',
						defaultValue: 'data',
					},
					{
						name: 'additionalOptions',
						values: parameterValues(
							this.getNodeParameter('additionalOptions', itemIndex, '{}'),
						),
						defaultValue: {},
					},
				]);
			} catch (error) {
				throw new NodeOperationError(
					this.getNode(),
					error instanceof Error ? error : new Error(String(error)),
					{ itemIndex },
				);
			}

			for (const batch of batches) {
				try {
					const { client, accessToken, xUserId } = context;
					const hubId = String(batch.hubId ?? '');
					const projectId = String(batch.projectId ?? '');
					const folderId = String(batch.folderId ?? '');
					const itemId = String(batch.itemId ?? '');
					const versionId = String(batch.versionId ?? '');
					const parsedOptions = batch.additionalOptions;
				const optionalArgs = {
					...(parsedOptions as IDataObject),
					accessToken,
					...(xUserId ? { xUserId } : {}),
				};
				const returnAll = Boolean(this.getNodeParameter('returnAll', itemIndex, false));
				const allPageArgs: Record<string, unknown> = { ...optionalArgs };
				delete allPageArgs.pageNumber;
				delete allPageArgs.pageLimit;
				let result: unknown;
				let binaryOutput: INodeExecutionData['binary'];
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
					case 'getDownload': result = await client.getDownload(projectId, String(batch.downloadId), optionalArgs); break;
					case 'getDownloadJob': result = await client.getDownloadJob(projectId, String(batch.jobId), optionalArgs); break;
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
						const binaryField = String(batch.inputBinaryField);
						const binary = inputItems[itemIndex].binary?.[binaryField];
						if (!binary) throw new NodeOperationError(this.getNode(), `Binary field "${binaryField}" was not found`, { itemIndex });
						const fileName = String(batch.fileName ?? '').trim() || binary.fileName || 'upload.bin';
						const existingItemId = String(batch.existingItemId ?? '').trim();
						const fileType = String(batch.fileType ?? 'File');
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
						const binaryField = String(batch.outputBinaryField);
						const prepared = await this.helpers.prepareBinaryData(downloaded.buffer, fileName, downloaded.contentType);
						result = version;
						binaryOutput = { [binaryField]: prepared };
						break;
					}
					default: throw new NodeOperationError(this.getNode(), `Unsupported operation: ${operation}`, { itemIndex });
				}

				const outputMode = String(this.getNodeParameter('outputMode', itemIndex, 'full'));
				const mappingsValue =
					outputMode === 'fields'
						? this.getNodeParameter('outputMappings', itemIndex, {})
						: {};
				const customMappingsValue =
					outputMode === 'fields'
						? this.getNodeParameter('customOutputMappings', itemIndex, '{}')
						: '{}';
				for (const json of outputJsonRecords(
					operation,
					result,
					outputMode,
					mappingsValue,
					customMappingsValue,
				)) {
					outputItems.push({
						json,
						...(binaryOutput ? { binary: binaryOutput } : {}),
						pairedItem: { item: itemIndex },
					});
				}
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
		}

		return [outputItems];
	}
}
