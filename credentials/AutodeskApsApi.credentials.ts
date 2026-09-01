import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class AutodeskApsApi implements ICredentialType {
	name = 'autodeskApsApi';
	displayName = 'Autodesk APS 2-Legged OAuth Community API';
	icon = 'file:AutodeskApsApi.svg' as const;
	documentationUrl = 'https://aps.autodesk.com/en/docs/oauth/v2/developers_guide/overview/';

	properties: INodeProperties[] = [
		{
			displayName: 'Client ID',
			name: 'clientId',
			type: 'string',
			default: '',
			required: true,
			description: 'APS application client ID. n8n stores this inside the encrypted credential.',
		},
		{
			displayName: 'Client Secret',
			name: 'clientSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'APS application client secret. It is never written to workflow JSON.',
		},
		{
			displayName: 'Act as User ID',
			name: 'xUserId',
			type: 'string',
			default: '',
			description:
				'Optional ACC user ID for the x-user-id header. Leave empty to use the service account context configured in ACC.',
		},
	];
}
