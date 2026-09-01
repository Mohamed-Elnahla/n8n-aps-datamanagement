import type { IDataObject } from 'n8n-workflow';

const APS_BASE_URL = 'https://developer.api.autodesk.com';
const MIN_PART_SIZE = 5 * 1024 * 1024;
const DEFAULT_PART_SIZE = 8 * 1024 * 1024;

interface StorageLocation {
	bucketKey: string;
	objectKey: string;
}

interface SignedUploadResponse {
	uploadKey: string;
	urls: string[];
}

function parseJson(text: string): unknown {
	if (!text) return {};
	try {
		return JSON.parse(text);
	} catch {
		return { message: text };
	}
}

async function apsRequest<T>(
	path: string,
	accessToken: string,
	init: RequestInit = {},
): Promise<T> {
	const response = await fetch(`${APS_BASE_URL}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json',
			...(init.headers ?? {}),
		},
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`APS transfer request failed (${response.status}): ${JSON.stringify(parseJson(text))}`);
	}
	return parseJson(text) as T;
}

export function parseStorageUrn(storageUrn: string): StorageLocation {
	const prefix = 'urn:adsk.objects:os.object:';
	if (!storageUrn.startsWith(prefix)) throw new Error('The version does not contain a valid APS storage URN');
	const location = storageUrn.slice(prefix.length);
	const slash = location.indexOf('/');
	if (slash < 1) throw new Error('The APS storage URN is missing its object key');
	return { bucketKey: location.slice(0, slash), objectKey: location.slice(slash + 1) };
}

export async function uploadBuffer(
	storageUrn: string,
	buffer: Buffer,
	accessToken: string,
): Promise<IDataObject> {
	const { bucketKey, objectKey } = parseStorageUrn(storageUrn);
	const partSize = Math.max(MIN_PART_SIZE, DEFAULT_PART_SIZE);
	const totalParts = Math.max(1, Math.ceil(buffer.length / partSize));
	let uploadKey = '';
	let firstPart = 1;

	while (firstPart <= totalParts) {
		const count = Math.min(25, totalParts - firstPart + 1);
		const query = new URLSearchParams({
			parts: String(count),
			firstPart: String(firstPart),
			minutesExpiration: '10',
		});
		if (uploadKey) query.set('uploadKey', uploadKey);
		const signed = await apsRequest<SignedUploadResponse>(
			`/oss/v2/buckets/${encodeURIComponent(bucketKey)}/objects/${encodeURIComponent(objectKey)}/signeds3upload?${query}`,
			accessToken,
		);
		uploadKey = signed.uploadKey;

		for (let offset = 0; offset < signed.urls.length; offset++) {
			const partNumber = firstPart + offset;
			const start = (partNumber - 1) * partSize;
			const end = Math.min(start + partSize, buffer.length);
			const response = await fetch(signed.urls[offset], {
				method: 'PUT',
				body: buffer.subarray(start, end),
			});
			if (!response.ok) throw new Error(`S3 upload failed for part ${partNumber} (${response.status})`);
		}
		firstPart += signed.urls.length;
	}

	return apsRequest<IDataObject>(
		`/oss/v2/buckets/${encodeURIComponent(bucketKey)}/objects/${encodeURIComponent(objectKey)}/signeds3upload`,
		accessToken,
		{ method: 'POST', body: JSON.stringify({ uploadKey }) },
	);
}

export async function downloadBuffer(
	storageUrn: string,
	accessToken: string,
): Promise<{ buffer: Buffer; contentType?: string }> {
	const { bucketKey, objectKey } = parseStorageUrn(storageUrn);
	const signed = await apsRequest<{ url: string }>(
		`/oss/v2/buckets/${encodeURIComponent(bucketKey)}/objects/${encodeURIComponent(objectKey)}/signeds3download?minutesExpiration=10`,
		accessToken,
	);
	const response = await fetch(signed.url);
	if (!response.ok) throw new Error(`S3 download failed (${response.status})`);
	return {
		buffer: Buffer.from(await response.arrayBuffer()),
		contentType: response.headers.get('content-type') ?? undefined,
	};
}
