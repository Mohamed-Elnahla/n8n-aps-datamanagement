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

interface JsonApiResource {
	id?: unknown;
	type?: unknown;
	attributes?: {
		displayName?: unknown;
		name?: unknown;
	};
}

interface JsonApiCollection {
	data?: unknown[];
	included?: unknown[];
	links?: {
		next?: unknown;
	};
	[key: string]: unknown;
}

export interface ApsTreeNode {
	id: string;
	type: string;
	name: string;
	path: string;
	depth: number;
	parentId: string | null;
	resource: unknown;
	children?: ApsTreeNode[];
}

export interface ApsTreeResult {
	tree: ApsTreeNode[];
	folders: ApsTreeNode[];
	files: ApsTreeNode[];
	included: unknown[];
	summary: {
		folderCount: number;
		fileCount: number;
		totalCount: number;
	};
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

function resourceType(resource: unknown): string {
	if (!resource || typeof resource !== 'object') return '';
	return String((resource as JsonApiResource).type ?? '');
}

function nextPageHref(response: JsonApiCollection): string {
	const next = response.links?.next;
	if (typeof next === 'string') return next;
	if (!next || typeof next !== 'object') return '';
	return String((next as { href?: unknown }).href ?? '');
}

function appendUnique(target: unknown[], values: unknown[], seen: Set<string>): void {
	for (const value of values) {
		const key = `${resourceType(value)}:${resourceId(value)}`;
		if (key !== ':' && seen.has(key)) continue;
		if (key !== ':') seen.add(key);
		target.push(value);
	}
}

/** Loads a JSON:API collection until APS stops returning a next-page link. */
export async function loadAllPages(
	fetchPage: (pageNumber: number) => Promise<unknown>,
): Promise<JsonApiCollection & { pagination: { allPagesLoaded: true; pagesLoaded: number } }> {
	let pageNumber = 0;
	let pagesLoaded = 0;
	let merged: JsonApiCollection | undefined;
	const data: unknown[] = [];
	const included: unknown[] = [];
	const seenData = new Set<string>();
	const seenIncluded = new Set<string>();
	const seenNextLinks = new Set<string>();

	while (true) {
		const response = (await fetchPage(pageNumber)) as JsonApiCollection;
		merged ??= { ...response };
		if (response.links) merged.links = response.links;
		appendUnique(data, response.data ?? [], seenData);
		appendUnique(included, response.included ?? [], seenIncluded);
		pagesLoaded++;
		const nextHref = nextPageHref(response);
		if (!nextHref) break;
		if (seenNextLinks.has(nextHref)) {
			throw new Error(`APS returned a repeated next-page link after page ${pageNumber}`);
		}
		seenNextLinks.add(nextHref);
		pageNumber++;
		if (pageNumber > 100_000) {
			throw new Error('APS pagination exceeded 100,000 pages; stopping to prevent an infinite loop');
		}
	}

	const result = {
		...(merged ?? {}),
		data,
		pagination: { allPagesLoaded: true as const, pagesLoaded },
	};
	if (included.length > 0 || merged?.included) result.included = included;
	return result;
}

function withoutPagination<T extends Record<string, unknown>>(optionalArgs: T): T {
	const result = { ...optionalArgs };
	delete result.pageNumber;
	delete result.pageLimit;
	return result;
}

async function getAllFolderContents(
	client: DataManagementClient,
	projectId: string,
	folderId: string,
	optionalArgs: Record<string, unknown>,
): Promise<JsonApiCollection> {
	const baseArgs = withoutPagination(optionalArgs);
	// A recursive scan must always be able to see folders. Applying collection
	// filters here could hide a branch and silently make the tree incomplete.
	delete baseArgs.filterType;
	delete baseArgs.filterId;
	delete baseArgs.filterExtensionType;
	delete baseArgs.filterLastModifiedTimeRollup;
	return await loadAllPages(async (pageNumber) =>
		await client.getFolderContents(projectId, folderId, {
			...baseArgs,
			pageNumber,
			pageLimit: 200,
		}),
	);
}

/**
 * Walks folders breadth-first. Each resource remains available verbatim under
 * `resource`, while commonly needed traversal fields are promoted onto nodes.
 */
export async function buildFolderTree(
	client: DataManagementClient,
	projectId: string,
	rootResources: unknown[],
	optionalArgs: Record<string, unknown>,
): Promise<ApsTreeResult> {
	const tree: ApsTreeNode[] = [];
	const folders: ApsTreeNode[] = [];
	const files: ApsTreeNode[] = [];
	const included: unknown[] = [];
	const seenFolders = new Set<string>();
	const seenIncluded = new Set<string>();
	const queue: Array<{ node: ApsTreeNode; folderId: string }> = [];

	for (const resource of rootResources) {
		const id = resourceId(resource);
		if (!id || seenFolders.has(id)) continue;
		seenFolders.add(id);
		const name = displayName(resource);
		const node: ApsTreeNode = {
			id,
			type: resourceType(resource) || 'folders',
			name,
			path: name,
			depth: 0,
			parentId: null,
			resource,
			children: [],
		};
		tree.push(node);
		folders.push(node);
		queue.push({ node, folderId: id });
	}

	for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
		const current = queue[queueIndex];
		const response = await getAllFolderContents(client, projectId, current.folderId, optionalArgs);
		appendUnique(included, response.included ?? [], seenIncluded);

		for (const resource of response.data ?? []) {
			const id = resourceId(resource);
			const type = resourceType(resource);
			if (!id) continue;
			const name = displayName(resource);
			const node: ApsTreeNode = {
				id,
				type,
				name,
				path: `${current.node.path}/${name}`,
				depth: current.node.depth + 1,
				parentId: current.folderId,
				resource,
				...(type === 'folders' ? { children: [] } : {}),
			};
			current.node.children?.push(node);
			if (type === 'folders') {
				if (seenFolders.has(id)) continue;
				seenFolders.add(id);
				folders.push(node);
				queue.push({ node, folderId: id });
			} else {
				files.push(node);
			}
		}
	}

	return {
		tree,
		folders,
		files,
		included,
		summary: {
			folderCount: folders.length,
			fileCount: files.length,
			totalCount: folders.length + files.length,
		},
	};
}
