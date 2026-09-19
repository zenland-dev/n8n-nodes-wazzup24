import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';

import { upsertInBatches } from '../../../shared/batch';
import { requiredText, text } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { wazzupRequest } from '../../../shared/transport';
import type { Entity } from '../crud';
import { deleteManyOperation, deleteOperation, getAllOperation, getOperation } from '../crud';
import { idSegment, userProperty } from '../props';

const user: Entity = {
	path: '/users',
	noun: 'user',
	plural: 'users',
	idName: 'userId',
	idLabel: 'User ID',
	idDescription: 'The ID the user was added under: your CRM’s ID of the employee',
	paged: false,
};

function buildUser(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const payload: IDataObject = {
		id: requiredText(this, 'id', itemIndex, 'User ID'),
		name: requiredText(this, 'name', itemIndex, 'Name'),
	};
	const phone = text(this, 'phone', itemIndex).replace(/\D/g, '');
	if (phone !== '') payload.phone = phone;
	return payload;
}

export const userResource: Resource = {
	value: 'user',
	name: 'User',
	description: 'Employees of your CRM who answer chats in Wazzup',
	operations: [
		{
			value: 'upsert',
			name: 'Create or Update',
			action: 'Create or update a user',
			description: 'Create a new record, or update the current one if it already exists (upsert)',
			properties: [
				{
					displayName: 'User ID',
					name: 'id',
					type: 'string',
					required: true,
					default: '',
					description:
						'Your CRM’s ID of the employee, up to 64 characters. Wazzup matches on it: an existing ID is updated, a new one added. All input items go out together, 100 per request.',
				},
				{
					displayName: 'Name',
					name: 'name',
					type: 'string',
					required: true,
					default: '',
					description: 'Shown in Wazzup, up to 150 characters',
				},
				{
					displayName: 'Phone',
					name: 'phone',
					type: 'string',
					default: '',
					placeholder: '79261234567',
					description:
						'Only needed to add the employee to the Wazzup mobile app. International format; a malformed number is silently dropped by Wazzup, and two users cannot share one.',
				},
			],
			async executeAll() {
				return await upsertInBatches.call(this, '/users', buildUser);
			},
		},
		getOperation(user),
		getAllOperation(user, 'Get the users of the Wazzup account, sorted by name'),
		deleteOperation(user, 'Remove an employee from Wazzup'),
		deleteManyOperation(user),
		{
			value: 'getUnanswered',
			name: 'Get Unanswered Count',
			action: 'Get the unanswered count of a user',
			description:
				'Get how many client messages of the last 7 days wait for this user’s answer, and when the last one came',
			properties: [
				userProperty(
					'User Name or ID',
					'userId',
					'The employee whose counter to read; a user without a role in the integration settings always reads 0',
				),
			],
			async execute(itemIndex) {
				const id = idSegment(this, 'userId', itemIndex, 'User');
				const counter = (await wazzupRequest.call(this, 'GET', `/unanswered/${id}`, {
					itemIndex,
				})) as IDataObject;
				return { userId: decodeURIComponent(id), ...counter };
			},
		},
	],
};
