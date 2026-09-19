import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import { asNodeError } from './errors';
import { errorItem } from './spec';
import { wazzupRequest } from './transport';

/** The most users, contacts or deals Wazzup takes in one request. */
export const BATCH_LIMIT = 100;

interface Entry {
	itemIndex: number;
	payload: IDataObject;
}

/**
 * Sends one record per input item to an upsert route, 100 records per request.
 *
 * `POST /users`, `/contacts` and `/deals` take an array, add what is new and
 * update what exists, matching by `id`. Packing items saves requests — a sync of
 * 2,000 contacts is 20 calls, not 2,000 — and costs error granularity: when
 * Wazzup rejects a request, it rejects all of it, so every item of that request
 * fails together. The error says which entry Wazzup objected to and which input
 * item that is.
 *
 * Two items with the same ID in one request make Wazzup answer 500, so within a
 * request the last item with an ID wins; the earlier ones are reported as sent,
 * which for an upsert is what they are.
 */
export async function upsertInBatches(
	this: IExecuteFunctions,
	path: string,
	build: (this: IExecuteFunctions, itemIndex: number) => IDataObject,
): Promise<INodeExecutionData[]> {
	const items = this.getInputData();
	const output: INodeExecutionData[] = [];
	const entries: Entry[] = [];

	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		try {
			entries.push({ itemIndex, payload: build.call(this, itemIndex) });
		} catch (error) {
			if (!this.continueOnFail()) throw asNodeError(this.getNode(), error, itemIndex);
			output.push(errorItem(error, itemIndex));
		}
	}

	for (let start = 0; start < entries.length; start += BATCH_LIMIT) {
		const chunk = entries.slice(start, start + BATCH_LIMIT);

		const byId = new Map<string, Entry>();
		for (const entry of chunk) byId.set(String(entry.payload.id), entry);
		const sent = [...byId.values()];

		try {
			await wazzupRequest.call(this, 'POST', path, {
				body: sent.map((e) => e.payload),
				itemIndex: chunk[0].itemIndex,
			});
		} catch (error) {
			pointAtItems(error, sent);
			if (!this.continueOnFail()) throw asNodeError(this.getNode(), error, chunk[0].itemIndex);
			for (const entry of chunk) output.push(errorItem(error, entry.itemIndex));
			continue;
		}

		for (const entry of chunk) {
			output.push({ json: entry.payload, pairedItem: { item: entry.itemIndex } });
		}
	}

	return output.sort(
		(a, b) =>
			((a.pairedItem as { item: number }).item ?? 0) -
			((b.pairedItem as { item: number }).item ?? 0),
	);
}

/**
 * Adds the input item numbers to an INVALID_*_DATA error. Wazzup counts entries
 * from 0 within the request it was sent; a person thinks in input items.
 */
function pointAtItems(error: unknown, sent: Entry[]): void {
	if (!(error instanceof NodeApiError)) return;

	const data = ((error.errorResponse ?? {}) as IDataObject).data;
	if (!Array.isArray(data)) return;

	const items = data
		.map((entry) => Number((entry as IDataObject)?.index))
		.filter((index) => Number.isInteger(index) && sent[index] !== undefined)
		.map((index) => sent[index].itemIndex + 1);

	if (items.length === 0) return;
	const note = `Input item${items.length > 1 ? 's' : ''} ${items.join(', ')} (counting from 1).`;
	error.description = error.description ? `${error.description} ${note}` : note;
}
