import { createHash } from 'node:crypto';
import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IN8nHttpFullResponse,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, randomInt, sleep } from 'n8n-workflow';

import {
	API_ORIGIN,
	API_VERSION_PATH,
	normalizeApiKey,
} from '../credentials/Wazzup24Api.credentials';
import { readFailure, toNodeApiError } from './errors';
import { acquireSlot } from './rateLimiter';

/** Every context these nodes make API calls from. */
export type WazzupContext =
	| IExecuteFunctions
	| ILoadOptionsFunctions
	| IHookFunctions
	| IWebhookFunctions;

export const CREDENTIAL = 'wazzup24Api';

/**
 * Wazzup's window: 500 requests in every five seconds, per key. How many of them
 * the nodes may use is the credential's setting, deliberately without a ceiling:
 * Wazzup's support can raise the limit for an account.
 */
const WINDOW_MS = 5000;

/** What an empty or unreadable setting means: the credential's default. */
const DEFAULT_BUDGET = 400;

export interface WazzupRequestOptions {
	qs?: IDataObject;
	body?: unknown;
	/** Item the call is made for, so an error points at it. */
	itemIndex?: number;
	/**
	 * Whether a server error or a dropped connection may be repeated. True for
	 * everything except sending a message: the upserts, deletes and reads are safe
	 * to repeat, while a message that timed out may already be on the client's
	 * phone, and Wazzup would send a second copy.
	 */
	retry?: boolean;
	/** Total attempts, including the first one. */
	maxAttempts?: number;
}

/**
 * A path under the API, as it is sent. `/contacts` becomes `/v3/contacts`; a
 * path that already names a version, such as `/v3/migration`, is kept.
 */
export function apiPath(path: string): string {
	const trimmed = path.trim();
	const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
	return /^\/v\d+(\/|$)/.test(withSlash) ? withSlash : `${API_VERSION_PATH}${withSlash}`;
}

/** A short, stable name for a key, for caches and the rate limiter. Never the key itself. */
export function keyFingerprint(apiKey: string): string {
	return createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
}

/** The fingerprint of the key in the credential. */
export async function accountKey(this: WazzupContext): Promise<string> {
	const credentials = await this.getCredentials(CREDENTIAL);
	return keyFingerprint(normalizeApiKey(credentials.apiKey));
}

function backoffDelay(attempt: number): number {
	return Math.min(2 ** (attempt - 1) * 1000, 8000) + randomInt(250);
}

function isEmpty(value: unknown): boolean {
	if (value === undefined || value === null) return true;
	return typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;
}

/**
 * One call to the Wazzup API, rate-limited and retried where that is safe.
 *
 * 429 is repeated for every route after the window has passed: Wazzup counts
 * the request and refuses it before doing anything. Server errors and network
 * failures are repeated unless `retry` is false. Anything else becomes a
 * NodeApiError carrying Wazzup's code and, where there is one, advice.
 *
 * Returns the body as Wazzup sent it: an object, an array, or '' for the routes
 * that answer 200 with nothing.
 */
export async function wazzupRequest(
	this: WazzupContext,
	method: IHttpRequestMethods,
	path: string,
	options: WazzupRequestOptions = {},
): Promise<unknown> {
	const credentials = await this.getCredentials(CREDENTIAL);
	const apiKey = normalizeApiKey(credentials.apiKey);

	if (apiKey === '') {
		throw new NodeOperationError(this.getNode(), 'The Wazzup credential has no API key', {
			description:
				'Open the credential and paste the key from Integration with CRM in the Wazzup account.',
			itemIndex: options.itemIndex,
		});
	}

	const setting = Math.floor(Number(credentials.requestsPerFiveSeconds));
	const budget = Number.isFinite(setting) && setting >= 1 ? setting : DEFAULT_BUDGET;
	const limiterKey = `wazzup24:${keyFingerprint(apiKey)}`;
	const route = apiPath(path);
	const label = `${method} ${route}`;

	const request: IHttpRequestOptions = {
		method,
		url: `${API_ORIGIN}${route}`,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		headers: { Accept: 'application/json' },
	};
	if (!isEmpty(options.qs)) request.qs = options.qs;
	if (options.body !== undefined) request.body = options.body as IDataObject;

	const retry = options.retry !== false;
	const maxAttempts = options.maxAttempts ?? 4;

	for (let attempt = 1; ; attempt++) {
		// The limit is the key's, so every workflow on this instance using the same
		// key draws from one window.
		await acquireSlot(limiterKey, budget, WINDOW_MS);

		let response: IN8nHttpFullResponse;
		try {
			response = (await this.helpers.httpRequestWithAuthentication.call(
				this,
				CREDENTIAL,
				request,
			)) as IN8nHttpFullResponse;
		} catch (error) {
			if (retry && attempt < maxAttempts) {
				await sleep(backoffDelay(attempt));
				continue;
			}
			throw new NodeApiError(this.getNode(), { message: 'Network error' } as JsonObject, {
				message: `Wazzup ${label}: the API could not be reached`,
				description: error instanceof Error ? error.message : undefined,
				itemIndex: options.itemIndex,
			});
		}

		const status = Number(response.statusCode) || 0;
		const body = response.body;
		const failure = readFailure(body, status);

		if (failure === undefined) return body;

		const retryable = status === 429 || (retry && status >= 500);
		if (retryable && attempt < maxAttempts) {
			await sleep(status === 429 ? WINDOW_MS + randomInt(500) : backoffDelay(attempt));
			continue;
		}

		throw toNodeApiError(this.getNode(), label, failure, body, options.itemIndex);
	}
}

/** An array out of whatever a list route answered; a lone object becomes a list of one. */
export function asList(body: unknown): IDataObject[] {
	if (Array.isArray(body)) return body as IDataObject[];
	if (body !== null && typeof body === 'object') {
		const record = body as IDataObject;
		if (Array.isArray(record.data)) return record.data as IDataObject[];
		return Object.keys(record).length === 0 ? [] : [record];
	}
	return [];
}

/** How many rows one page of contacts or deals holds. Fixed by Wazzup. */
export const OFFSET_PAGE_SIZE = 100;

/**
 * Reads `GET /contacts` or `GET /deals` page by page.
 *
 * Both answer `{ count, data }` with up to 100 rows sorted by ID and take only
 * `offset`. A short page is the end; so is reaching `count`. `limit` stops early.
 */
export async function readOffsetPages(
	this: IExecuteFunctions,
	path: string,
	limit: number | undefined,
	itemIndex: number,
): Promise<IDataObject[]> {
	const rows: IDataObject[] = [];

	for (let offset = 0; ; offset += OFFSET_PAGE_SIZE) {
		const body = (await wazzupRequest.call(this, 'GET', path, {
			qs: { offset },
			itemIndex,
		})) as unknown;
		const page = asList(body);
		rows.push(...page);

		const total = Number((body as IDataObject | undefined)?.count);
		if (limit !== undefined && rows.length >= limit) return rows.slice(0, limit);
		if (page.length < OFFSET_PAGE_SIZE) return rows;
		if (Number.isFinite(total) && rows.length >= total) return rows;
	}
}
