import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';

export default [
	...configWithoutCloudSupport,
	{
			rules: {
			// These rules cannot parse operation options generated from the SDK operation table.
			'n8n-nodes-base/node-param-operation-option-action-miscased': 'off',
			'n8n-nodes-base/node-param-operation-option-action-wrong-for-get-many': 'off',
			'n8n-nodes-base/node-param-operation-option-description-wrong-for-get-many': 'off',
			'n8n-nodes-base/node-param-operation-option-without-action': 'off',
			'n8n-nodes-base/node-param-default-wrong-for-options': 'off',
			// Autodesk's SDK is an explicit requirement; this package targets self-hosted n8n.
			'@n8n/community-nodes/no-runtime-dependencies': 'off',
			// The node CLI currently pins a vulnerable uuid through its development-only AI tooling.
			'@n8n/community-nodes/no-overrides-field': 'off',
		},
	},
];
