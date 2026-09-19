import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { upsertInBatches } from '../../../shared/batch';
import { requiredText, text } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import type { Entity } from '../crud';
import { deleteManyOperation, deleteOperation, getAllOperation, getOperation } from '../crud';
import { chatTypeProperty, checkedChatType, normalizeChatId, userProperty } from '../props';

const contact: Entity = {
	path: '/contacts',
	noun: 'contact',
	plural: 'contacts',
	idName: 'contactId',
	idLabel: 'Contact ID',
	idDescription: 'The ID the contact was loaded under: your CRM’s ID of the client',
	paged: true,
};

function buildContact(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const chatsUi = this.getNodeParameter('chats', itemIndex, {}) as IDataObject;
	const rows = (chatsUi.chat ?? []) as IDataObject[];

	const contactData = rows
		.filter((row) => String(row.chatId ?? '').trim() !== '')
		.map((row) => {
			const chatType = checkedChatType(this, String(row.chatType ?? ''), itemIndex);
			const entry: IDataObject = {
				chatType,
				chatId: normalizeChatId(chatType, String(row.chatId)),
			};
			const username = String(row.username ?? '')
				.trim()
				.replace(/^@/, '');
			const phone = String(row.phone ?? '').replace(/\D/g, '');
			if (username !== '' && chatType === 'telegram') entry.username = username;
			if (phone !== '' && (chatType === 'telegram' || chatType === 'max')) entry.phone = phone;
			return entry;
		});

	if (contactData.length === 0) {
		throw new NodeOperationError(this.getNode(), 'A contact needs at least one chat', {
			itemIndex,
			description:
				'Add a chat under Chats: the messenger and the chat ID, e.g. WhatsApp and the phone number.',
		});
	}

	const payload: IDataObject = {
		id: requiredText(this, 'id', itemIndex, 'Contact ID'),
		responsibleUserId: requiredText(this, 'responsibleUserId', itemIndex, 'Responsible User'),
		name: requiredText(this, 'name', itemIndex, 'Name'),
		contactData,
	};
	const uri = text(this, 'uri', itemIndex);
	if (uri !== '') payload.uri = uri;
	return payload;
}

export const contactResource: Resource = {
	value: 'contact',
	name: 'Contact',
	description: 'Clients of your CRM, with their chats and the employee responsible for them',
	operations: [
		{
			value: 'upsert',
			name: 'Create or Update',
			action: 'Create or update a contact',
			description: 'Create a new record, or update the current one if it already exists (upsert)',
			properties: [
				{
					displayName: 'Contact ID',
					name: 'id',
					type: 'string',
					required: true,
					default: '',
					description:
						'Your CRM’s ID of the client, up to 64 characters. Wazzup matches on it: an existing ID is updated, a new one added. All input items go out together, 100 per request.',
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
					'The employee who owns the client; the dialogue shows up in their Wazzup chats',
				),
				{
					displayName: 'Chats',
					name: 'chats',
					type: 'fixedCollection',
					typeOptions: { multipleValues: true },
					placeholder: 'Add Chat',
					required: true,
					default: {},
					options: [
						{
							name: 'chat',
							displayName: 'Chat',
							values: [
								{
									...chatTypeProperty(),
									description: 'Which messenger the chat is in',
								},
								{
									displayName: 'Chat ID',
									name: 'chatId',
									type: 'string',
									default: '',
									placeholder: '79011112233',
									description:
										'For WhatsApp and Viber the phone number, digits only; for Instagram the account name; for the rest the chatId from a Wazzup webhook',
								},
								{
									displayName: 'Phone',
									name: 'phone',
									type: 'string',
									default: '',
									description:
										'Telegram and MAX only: the phone number, when the chat ID is not known yet',
								},
								{
									displayName: 'Username',
									name: 'username',
									type: 'string',
									default: '',
									description:
										'Telegram only: the username without @, when the chat ID is not known yet',
								},
							],
						},
					],
				},
				{
					displayName: 'Link in CRM',
					name: 'uri',
					type: 'string',
					default: '',
					placeholder: 'https://crm.example.com/contacts/42',
					description:
						'Up to 200 characters. When set, the Deals list in the Wazzup chat shows a button that opens the contact in your CRM.',
				},
			],
			async executeAll() {
				return await upsertInBatches.call(this, '/contacts', buildContact);
			},
		},
		getOperation(contact),
		getAllOperation(
			contact,
			'Get the contacts loaded into Wazzup, sorted by ID; Wazzup hands them out 100 per page',
		),
		deleteOperation(
			contact,
			'Delete a contact from Wazzup. A dialogue with the client stays in the shared chats.',
		),
		deleteManyOperation(contact),
	],
};
