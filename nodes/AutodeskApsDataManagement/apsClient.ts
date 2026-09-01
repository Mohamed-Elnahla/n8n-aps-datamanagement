import { AuthenticationClient, Scopes } from '@aps_sdk/authentication';
import { SdkManagerBuilder } from '@aps_sdk/autodesk-sdkmanager';
import { DataManagementClient } from '@aps_sdk/data-management';
import type { ICredentialDataDecryptedObject } from 'n8n-workflow';

const sdkManager = SdkManagerBuilder.create().build();
const authenticationClient = new AuthenticationClient({ sdkManager });

export interface ApsContext {
	client: DataManagementClient;
	accessToken: string;
	xUserId?: string;
}

export async function createApsContext(
	credentials: ICredentialDataDecryptedObject,
	write = false,
): Promise<ApsContext> {
	const clientId = String(credentials.clientId ?? '');
	const clientSecret = String(credentials.clientSecret ?? '');
	const xUserIdValue = String(credentials.xUserId ?? '').trim();
	const scopes = write
		? [Scopes.DataRead, Scopes.DataWrite, Scopes.DataCreate]
		: [Scopes.DataRead, Scopes.DataSearch];
	const token = await authenticationClient.getTwoLeggedToken(clientId, clientSecret, scopes);

	return {
		client: new DataManagementClient({ sdkManager }),
		accessToken: token.access_token,
		xUserId: xUserIdValue || undefined,
	};
}

export function resourceValue(value: unknown): string {
	if (typeof value === 'string') return value;
	if (value && typeof value === 'object' && 'value' in value) {
		return String((value as { value: unknown }).value ?? '');
	}
	return '';
}

export function isAccProject(project: unknown): boolean {
	if (!project || typeof project !== 'object') return false;
	const attributes = (project as { attributes?: unknown }).attributes;
	if (!attributes || typeof attributes !== 'object') return false;
	const extension = (attributes as { extension?: unknown }).extension;
	if (!extension || typeof extension !== 'object') return false;
	const data = (extension as { data?: unknown }).data;
	if (!data || typeof data !== 'object') return false;
	return String((data as { projectType?: unknown }).projectType ?? '').toUpperCase() === 'ACC';
}

export function displayName(resource: unknown): string {
	if (!resource || typeof resource !== 'object') return 'Unnamed';
	const attributes = (resource as { attributes?: unknown }).attributes;
	if (!attributes || typeof attributes !== 'object') return 'Unnamed';
	const values = attributes as { displayName?: unknown; name?: unknown };
	return String(values.displayName ?? values.name ?? 'Unnamed');
}

export function resourceId(resource: unknown): string {
	if (!resource || typeof resource !== 'object') return '';
	return String((resource as { id?: unknown }).id ?? '');
}
