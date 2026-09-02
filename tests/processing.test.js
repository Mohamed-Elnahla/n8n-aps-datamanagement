const assert = require('node:assert/strict');
const test = require('node:test');

const {
	AutodeskApsDataManagement,
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
