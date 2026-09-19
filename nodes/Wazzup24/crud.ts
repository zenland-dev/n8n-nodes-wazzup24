import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { BATCH_LIMIT } from '../../shared/batch';
import { idList, returnAllProperties, take, wantedRows } from '../../shared/params';
import type { Operation } from '../../shared/spec';
import { asList, readOffsetPages, wazzupRequest } from '../../shared/transport';
import { idSegment } from './props';

/** What the shared operations need to know about one kind of record. */
export interface Entity {
	/** Route under /v3, e.g. /contacts. */
	path: string;
	/** Singular noun for texts, e.g. contact. */
	noun: string;
	/** Plural noun for texts, e.g. contacts. */
	plural: string;
	/** Name and label of the ID parameter, e.g. contactId / Contact ID. */
	idName: string;
	idLabel: string;
	idDescription: string;
	/** Whether the list route pages by offset (contacts, deals) or answers everything at once (users). */
	paged: boolean;
}

export function idProperty(entity: Entity): INodeProperties {
	return {
		displayName: entity.idLabel,
		name: entity.idName,
		type: 'string',
		required: true,
		default: '',
		description: entity.idDescription,
	};
}

export function getOperation(entity: Entity): Operation {
	return {
		value: 'get',
		name: 'Get',
		action: `Get a ${entity.noun}`,
		description: `Get one ${entity.noun} stored in Wazzup by its ID`,
		properties: [idProperty(entity)],
		async execute(itemIndex) {
			const id = idSegment(this, entity.idName, itemIndex, entity.idLabel);
			return (await wazzupRequest.call(this, 'GET', `${entity.path}/${id}`, {
				itemIndex,
			})) as IDataObject;
		},
	};
}

export function getAllOperation(entity: Entity, description: string): Operation {
	return {
		value: 'getAll',
		name: 'Get Many',
		action: `Get many ${entity.plural}`,
		description,
		properties: returnAllProperties(entity.plural),
		async execute(itemIndex) {
			const limit = wantedRows(this, itemIndex);
			if (entity.paged) return await readOffsetPages.call(this, entity.path, limit, itemIndex);
			return take(asList(await wazzupRequest.call(this, 'GET', entity.path, { itemIndex })), limit);
		},
	};
}

export function deleteOperation(entity: Entity, description: string): Operation {
	return {
		value: 'delete',
		name: 'Delete',
		action: `Delete a ${entity.noun}`,
		description,
		properties: [idProperty(entity)],
		async execute(itemIndex) {
			const id = idSegment(this, entity.idName, itemIndex, entity.idLabel);
			await wazzupRequest.call(this, 'DELETE', `${entity.path}/${id}`, { itemIndex });
			return { success: true, id: decodeURIComponent(id) };
		},
	};
}

export function deleteManyOperation(entity: Entity): Operation {
	return {
		value: 'deleteMany',
		name: 'Delete Many',
		action: `Delete many ${entity.plural}`,
		description: `Delete a list of ${entity.plural} by their IDs in one call; IDs Wazzup does not know come back as notFound`,
		properties: [
			{
				displayName: 'IDs',
				name: 'ids',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'c-101, c-102, c-103',
				description: `IDs of the ${entity.plural}: a comma-separated list, a JSON array, or an expression returning an array. More than 100 are sent in several calls.`,
			},
		],
		async execute(this: IExecuteFunctions, itemIndex: number) {
			const ids = idList(this.getNodeParameter('ids', itemIndex, ''));
			if (ids.length === 0) {
				throw new NodeOperationError(this.getNode(), 'No IDs to delete', { itemIndex });
			}

			const notFound: string[] = [];
			for (let start = 0; start < ids.length; start += BATCH_LIMIT) {
				const body = await wazzupRequest.call(this, 'PATCH', `${entity.path}/bulk_delete`, {
					body: ids.slice(start, start + BATCH_LIMIT),
					itemIndex,
				});
				if (Array.isArray(body)) notFound.push(...body.map((id) => String(id)));
			}

			return { ids, notFound };
		},
	};
}
