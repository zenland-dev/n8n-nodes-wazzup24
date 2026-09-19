import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { upsertInBatches } from '../../../shared/batch';
import { idList, requiredText } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import type { Entity } from '../crud';
import { deleteManyOperation, deleteOperation, getAllOperation, getOperation } from '../crud';
import { userProperty } from '../props';

const deal: Entity = {
	path: '/deals',
	noun: 'deal',
	plural: 'deals',
	idName: 'dealId',
	idLabel: 'Deal ID',
	idDescription: 'The ID the deal was loaded under: your CRM’s ID of the deal',
	paged: true,
};

function buildDeal(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const contacts = idList(this.getNodeParameter('contacts', itemIndex, ''));
	if (contacts.length === 0) {
		throw new NodeOperationError(this.getNode(), 'A deal needs at least one contact ID', {
			itemIndex,
			description: 'Give the IDs of contacts loaded under Contact, comma-separated or as an array.',
		});
	}

	return {
		id: requiredText(this, 'id', itemIndex, 'Deal ID'),
		responsibleUserId: requiredText(this, 'responsibleUserId', itemIndex, 'Responsible User'),
		name: requiredText(this, 'name', itemIndex, 'Name'),
		uri: requiredText(this, 'uri', itemIndex, 'Link in CRM'),
		contacts,
		closed: this.getNodeParameter('closed', itemIndex, false) as boolean,
	};
}

export const dealResource: Resource = {
	value: 'deal',
	name: 'Deal',
	description: 'Deals of your CRM, shown in the Deals list of the Wazzup chat',
	operations: [
		{
			value: 'upsert',
			name: 'Create or Update',
			action: 'Create or update a deal',
			description: 'Create a new record, or update the current one if it already exists (upsert)',
			properties: [
				{
					displayName: 'Deal ID',
					name: 'id',
					type: 'string',
					required: true,
					default: '',
					description:
						'Your CRM’s ID of the deal, up to 100 characters. Wazzup matches on it: an existing ID is updated, a new one added. All input items go out together, 100 per request.',
				},
				{
					displayName: 'Name',
					name: 'name',
					type: 'string',
					required: true,
					default: '',
					description: 'Up to 200 characters',
				},
				userProperty(
					'Responsible User Name or ID',
					'responsibleUserId',
					'The employee who owns the deal; the dialogues of its contacts show up in their Wazzup chats',
				),
				{
					displayName: 'Contact IDs',
					name: 'contacts',
					type: 'string',
					required: true,
					default: '',
					placeholder: 'contact-1, contact-2',
					description:
						'IDs of the contacts of the deal, as loaded under Contact: comma-separated, a JSON array, or an expression returning an array',
				},
				{
					displayName: 'Link in CRM',
					name: 'uri',
					type: 'string',
					required: true,
					default: '',
					placeholder: 'https://crm.example.com/deals/101',
					description:
						'Up to 200 characters. The Deals list in the Wazzup chat opens the deal in your CRM through it.',
				},
				{
					displayName: 'Closed',
					name: 'closed',
					type: 'boolean',
					default: false,
					description:
						'Whether the deal is closed. Closed deals stay in the Deals list, marked as such.',
				},
			],
			async executeAll() {
				return await upsertInBatches.call(this, '/deals', buildDeal);
			},
		},
		getOperation(deal),
		getAllOperation(deal, 'Get the deals loaded into Wazzup; Wazzup hands them out 100 per page'),
		deleteOperation(deal, 'Delete a deal from Wazzup'),
		deleteManyOperation(deal),
	],
};
