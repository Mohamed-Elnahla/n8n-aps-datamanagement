const assert = require('node:assert/strict');
const test = require('node:test');
const { displayParameter } = require('n8n-workflow');

const {
	AutodeskApsDataManagement,
	contextualOptionName,
	createOrderedBatches,
	outputJsonRecords,
} = require('../dist/nodes/AutodeskApsDataManagement/AutodeskApsDataManagement.node.js');

const node = {
	id: 'test-node',
	name: 'Autodesk APS test',
	type: 'test',
	typeVersion: 3,
	position: [0, 0],
	parameters: {},
};

test('ordered batches preserve list order and broadcast scalar values', () => {
	assert.deepEqual(
		createOrderedBatches(node, [
			{ name: 'projectId', values: ['project-a', 'project-b'], required: true },
			{ name: 'hubId', values: ['hub-one'] },
		]),
		[
			{ projectId: 'project-a', hubId: 'hub-one' },
			{ projectId: 'project-b', hubId: 'hub-one' },
		],
	);
});

test('node version 3 exposes native multi-select resource inputs and keeps full output by default', () => {
	const description = new AutodeskApsDataManagement().description;
	assert.equal(description.defaultVersion, 3);
	for (const name of ['hubIds', 'projectIds', 'folderIds', 'itemIds', 'versionIds']) {
		assert.ok(
			description.properties.some(
				(property) => property.name === name && property.type === 'multiOptions',
			),
			`${name} should be a multiOptions input`,
		);
	}
	assert.equal(
		description.properties.find((property) => property.name === 'outputMode').default,
		'full',
	);
});

test('only the next multi-select subfolder level is shown', () => {
	const description = new AutodeskApsDataManagement().description;
	const subfolder1 = description.properties.find((property) => property.name === 'subfolderIds1');
	const subfolder2 = description.properties.find((property) => property.name === 'subfolderIds2');
	const version = { typeVersion: 3 };

	assert.equal(
		displayParameter({ operation: 'getFolder', folderIds: [] }, subfolder1, version, description),
		false,
	);
	assert.equal(
		displayParameter(
			{ operation: 'getFolder', folderIds: ['root'] },
			subfolder1,
			version,
			description,
		),
		true,
	);
	assert.equal(
		displayParameter(
			{ operation: 'getFolder', folderIds: ['root'], subfolderIds1: [] },
			subfolder2,
			version,
			description,
		),
		false,
	);
	assert.equal(
		displayParameter(
			{ operation: 'getFolder', folderIds: ['root'], subfolderIds1: ['child'] },
			subfolder2,
			version,
			description,
		),
		true,
	);
});

test('dependent option labels add hub and project context only when needed', () => {
	assert.equal(contextualOptionName(false, 'Hub A', 'Project A', 'Folder A'), 'Folder A');
	assert.equal(
		contextualOptionName(true, 'Hub A', 'Project A', 'Folder A'),
		'Hub A › Project A › Folder A',
	);
});

test('ordered batches reject ambiguous list lengths instead of making a Cartesian product', () => {
	assert.throws(
		() =>
			createOrderedBatches(node, [
				{ name: 'projectId', values: ['a', 'b', 'c'] },
				{ name: 'folderId', values: ['one', 'two'] },
			]),
		/expected 1 or 3/,
	);
});

test('data output expands collections in API order', () => {
	const response = {
		jsonapi: { version: '1.0' },
		data: [
			{ id: 'first', type: 'items' },
			{ id: 'second', type: 'items' },
		],
	};
	assert.deepEqual(outputJsonRecords('getFolderContents', response, 'data', {}, '{}'), response.data);
});

test('field output maps common and custom dotted paths for every data record', () => {
	const response = {
		data: [
			{
				id: 'item-1',
				type: 'items',
				attributes: { displayName: 'First.rvt' },
			},
		],
	};
	assert.deepEqual(
		outputJsonRecords(
			'getFolderContents',
			response,
			'fields',
			{ values: [{ source: 'id', target: 'aps.id' }] },
			'{"fileName":"attributes.displayName"}',
		),
		[{ aps: { id: 'item-1' }, fileName: 'First.rvt' }],
	);
});

test('field output builds nested source paths from progressive source controls', () => {
	assert.deepEqual(
		outputJsonRecords(
			'getVersion',
			{
				data: {
					relationships: { storage: { data: { id: 'storage-1' } } },
				},
			},
			'fields',
			{
				values: [
					{
						source: 'relationships',
						sourcePart1: 'storage',
						sourcePart2: 'data',
						sourcePart3: 'id',
						target: 'storageId',
					},
				],
			},
			'{}',
		),
		[{ storageId: 'storage-1' }],
	);
});

test('hidden stale nested controls do not affect a non-object source', () => {
	assert.deepEqual(
		outputJsonRecords(
			'getItem',
			{ data: { id: 'item-1' } },
			'fields',
			{
				values: [
					{ source: 'id', sourcePart1: 'stale', sourcePart2: 'value', target: 'itemId' },
				],
			},
			'{}',
		),
		[{ itemId: 'item-1' }],
	);
});

test('field output omits missing paths and blocks unsafe target paths', () => {
	assert.deepEqual(
		outputJsonRecords(
			'getItem',
			{ data: { id: 'safe' } },
			'fields',
			{},
			'{"missing":"attributes.unknown","__proto__.polluted":"id"}',
		),
		[{}],
	);
	assert.equal({}.polluted, undefined);
});

test('full output remains backward compatible', () => {
	const response = { data: { id: 'item-1', type: 'items' }, links: { self: 'example' } };
	assert.deepEqual(outputJsonRecords('getItem', response, 'full', {}, '{}'), [response]);
});
