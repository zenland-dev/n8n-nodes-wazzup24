import type { IDataObject, IExecuteFunctions, IHttpRequestMethods } from 'n8n-workflow';
import { jsonParse, NodeOperationError } from 'n8n-workflow';

import { API_ORIGIN } from '../../../credentials/Wazzup24Api.credentials';
import type { Resource } from '../../../shared/spec';
import { apiPath, asList, OFFSET_PAGE_SIZE, wazzupRequest } from '../../../shared/transport';

/**
 * The escape hatch: any call to the Wazzup API, through the same key, rate
 * limit and error messages as the modelled operations.
 *
 * It exists so that a route this node does not model — a new one, a partner
 * one such as /v3/migration — never forces a bare HTTP Request node, which the
 * credential is deliberately kept out of.
 */
const METHODS: IHttpRequestMethods[] = ['DELETE', 'GET', 'PATCH', 'POST', 'PUT'];

/** Methods whose request carries a body. Wazzup's bulk deletes use PATCH with an array. */
const METHODS_WITH_BODY = ['DELETE', 'PATCH', 'POST', 'PUT'];

/** Stops a Follow Pages run that never sees a short page. 1,000 pages is 100,000 rows. */
const MAX_PAGES = 1000;

function readMethod(ctx: IExecuteFunctions, itemIndex: number): IHttpRequestMethods {
	const method = String(ctx.getNodeParameter('method', itemIndex, 'GET')).toUpperCase();
	if (!METHODS.includes(method as IHttpRequestMethods)) {
		throw new NodeOperationError(ctx.getNode(), `"${method}" is not a method this node sends`, {
			itemIndex,
			description: `Pick one of ${METHODS.join(', ')}.`,
		});
	}
	return method as IHttpRequestMethods;
}

/**
 * The path, checked before it is sent. A full URL is refused rather than
 * stripped: the request always goes to the Wazzup API with the key attached,
 * and one that looks like it points elsewhere is a mistake worth stopping.
 */
function readPath(ctx: IExecuteFunctions, itemIndex: number): string {
	const path = String(ctx.getNodeParameter('path', itemIndex, '') ?? '').trim();

	if (path === '') {
		throw new NodeOperationError(ctx.getNode(), 'A custom request needs a path', {
			itemIndex,
			description: 'For example /v3/channels or just /channels.',
		});
	}

	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path) || path.startsWith('//')) {
		throw new NodeOperationError(ctx.getNode(), 'The path must not be a full URL', {
			itemIndex,
			description: `Keep only the path, as in /v3/channels. Every request goes to ${API_ORIGIN}; this node cannot call another host.`,
		});
	}

	return apiPath(path);
}

function readQuery(ctx: IExecuteFunctions, itemIndex: number): IDataObject {
	const ui = ctx.getNodeParameter('queryParameters', itemIndex, {}) as IDataObject;
	const qs: IDataObject = {};
	for (const row of (ui.parameter ?? []) as IDataObject[]) {
		const name = String(row.name ?? '').trim();
		if (name !== '') qs[name] = row.value;
	}
	return qs;
}

function readBody(ctx: IExecuteFunctions, itemIndex: number, method: IHttpRequestMethods): unknown {
	if (!METHODS_WITH_BODY.includes(method)) return undefined;

	const raw = ctx.getNodeParameter('body', itemIndex, '') as unknown;
	if (raw === undefined || raw === null || raw === '') return undefined;
	if (typeof raw === 'object') return raw;

	const value = String(raw).trim();
	if (value === '') return undefined;

	try {
		return jsonParse<unknown>(value);
	} catch (error) {
		throw new NodeOperationError(ctx.getNode(), 'The body is not valid JSON', {
			itemIndex,
			description: `${error instanceof Error ? error.message : String(error)}. Wazzup takes JSON only; an expression returning an object or an array works too.`,
		});
	}
}

/** One output row per list entry in Automatic mode; the body as it came otherwise. */
function toRows(body: unknown, format: string): IDataObject[] {
	if (body === undefined || body === null || body === '') return [{ success: true }];
	if (typeof body !== 'object') return [{ data: body as string }];

	if (format === 'auto') {
		const record = body as IDataObject;
		const list = Array.isArray(body) ? body : Array.isArray(record.data) ? record.data : undefined;
		if (list !== undefined) {
			return (list as unknown[]).map((row) =>
				row !== null && typeof row === 'object' && !Array.isArray(row)
					? (row as IDataObject)
					: { value: row as string },
			);
		}
	}

	return Array.isArray(body) ? [{ data: body as IDataObject[] }] : [body as IDataObject];
}

async function request(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
	const method = readMethod(this, itemIndex);
	const path = readPath(this, itemIndex);
	const qs = readQuery(this, itemIndex);
	const body = readBody(this, itemIndex, method);
	const format = String(this.getNodeParameter('responseFormat', itemIndex, 'auto'));

	// Sending a message is the one call that must not be repeated after a server
	// error: it may already have gone out.
	const retry = !(method === 'POST' && path.replace(/\/+$/, '') === '/v3/message');

	const followPages =
		method === 'GET' && (this.getNodeParameter('followPages', itemIndex, false) as boolean);
	if (!followPages) {
		return toRows(
			await wazzupRequest.call(this, method, path, { qs, body, itemIndex, retry }),
			format,
		);
	}

	const rows: IDataObject[] = [];
	for (let page = 0; page < MAX_PAGES; page++) {
		const answer = await wazzupRequest.call(this, 'GET', path, {
			qs: { ...qs, offset: page * OFFSET_PAGE_SIZE },
			itemIndex,
		});
		const list = asList(answer);
		rows.push(...list);
		if (list.length < OFFSET_PAGE_SIZE) break;
	}
	return rows;
}

export const customRequestResource: Resource = {
	value: 'customRequest',
	name: 'Custom Request',
	description:
		'Any Wazzup API call the other operations do not cover, with the same key and rate limit',
	operations: [
		{
			value: 'request',
			name: 'Request',
			action: 'Make a custom API call',
			description:
				'Send any request to the Wazzup API, such as a route added after this node was written or a partner route, with authentication, the rate limit and error messages handled as everywhere else',
			properties: [
				{
					displayName: 'Method',
					name: 'method',
					type: 'options',
					default: 'GET',
					options: METHODS.map((m) => ({ name: m, value: m })),
				},
				{
					displayName: 'Path',
					name: 'path',
					type: 'string',
					required: true,
					default: '',
					placeholder: '/v3/channels',
					description: `Path on ${API_ORIGIN}, as in the Wazzup documentation. /v3 may be left out: /channels means /v3/channels.`,
				},
				{
					displayName: 'Query Parameters',
					name: 'queryParameters',
					type: 'fixedCollection',
					typeOptions: { multipleValues: true },
					placeholder: 'Add Query Parameter',
					default: {},
					options: [
						{
							name: 'parameter',
							displayName: 'Parameter',
							values: [
								{
									displayName: 'Name',
									name: 'name',
									type: 'string',
									default: '',
									placeholder: 'offset',
								},
								{ displayName: 'Value', name: 'value', type: 'string', default: '' },
							],
						},
					],
				},
				{
					displayName: 'Body',
					name: 'body',
					type: 'json',
					default: '',
					displayOptions: { show: { method: METHODS_WITH_BODY } },
					description:
						'JSON sent exactly as written. Several Wazzup routes take an array: POST /v3/contacts takes contacts, PATCH /v3/deals/bulk_delete takes IDs. Leave empty for no body.',
				},
				{
					displayName: 'Follow Pages',
					name: 'followPages',
					type: 'boolean',
					default: false,
					displayOptions: { show: { method: ['GET'] } },
					description:
						'Whether to repeat the request with offset = 0, 100, 200… until a page has fewer than 100 rows, as GET /v3/contacts and /v3/deals need. Each row becomes an item.',
				},
				{
					displayName: 'Response Format',
					name: 'responseFormat',
					type: 'options',
					default: 'auto',
					displayOptions: { show: { followPages: [false] } },
					options: [
						{
							name: 'Automatic',
							value: 'auto',
							description:
								'One item per row when the answer is a list or holds one under data; otherwise one item',
						},
						{
							name: 'Whole Response',
							value: 'whole',
							description: 'One item holding the answer as Wazzup sent it',
						},
					],
				},
			],
			execute: request,
		},
	],
};
