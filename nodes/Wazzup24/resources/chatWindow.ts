import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { CHAT_TYPE_OPTIONS } from '../../../shared/chat';
import { compact, requiredText, text } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { wazzupRequest } from '../../../shared/transport';
import { checkedChatType, normalizeChatId, userProperty } from '../props';

function chatRows(ctx: IExecuteFunctions, itemIndex: number): IDataObject[] {
	const ui = ctx.getNodeParameter('chats', itemIndex, {}) as IDataObject;
	return ((ui.chat ?? []) as IDataObject[])
		.filter((row) => String(row.chatId ?? '').trim() !== '')
		.map((row) => {
			const chatType = checkedChatType(ctx, String(row.chatType ?? ''), itemIndex);
			return compact({
				chatType,
				chatId: normalizeChatId(chatType, String(row.chatId)),
				name: String(row.name ?? '').trim(),
			});
		});
}

async function getLink(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const user = compact({
		id: requiredText(this, 'userId', itemIndex, 'User'),
		name: text(this, 'userName', itemIndex),
	});
	const scope = this.getNodeParameter('scope', itemIndex, 'global') as string;
	const body: IDataObject = { user, scope };

	if (scope === 'card') {
		const filter = chatRows(this, itemIndex);
		if (filter.length === 0) {
			throw new NodeOperationError(this.getNode(), 'A contact’s window needs at least one chat', {
				itemIndex,
				description:
					'Add the chats of the contact under Chats, e.g. WhatsApp and the phone number.',
			});
		}
		body.filter = filter;
	}

	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	const activeChatId = String(options.activeChatId ?? '').trim();
	if (activeChatId !== '') {
		const chatType = checkedChatType(this, String(options.activeChatType ?? 'whatsapp'), itemIndex);
		body.activeChat = compact({
			channelId: String(options.activeChannelId ?? '').trim(),
			chatType,
			chatId: normalizeChatId(chatType, activeChatId),
		});
	}

	const events = compact({
		clientType: String(options.clientType ?? '').trim(),
		useDealsEvents: options.useDealsEvents as boolean | undefined,
		useMessageEvents: options.useMessageEvents as boolean | undefined,
	});
	if (Object.keys(events).length > 0) body.options = events;

	return (await wazzupRequest.call(this, 'POST', '/iframe', { body, itemIndex })) as IDataObject;
}

export const chatWindowResource: Resource = {
	value: 'chatWindow',
	name: 'Chat Window',
	description: 'The Wazzup chat window to embed in your CRM',
	operations: [
		{
			value: 'getLink',
			name: 'Get Link',
			action: 'Get a chat window link',
			description:
				'Get a link that opens the Wazzup chat window for an employee (all their chats, or only the chats of one contact) for an iframe or a new tab',
			properties: [
				userProperty(
					'User Name or ID',
					'userId',
					'The employee who opens the window; they see the chats their role allows',
				),
				{
					displayName: 'User Display Name',
					name: 'userName',
					type: 'string',
					default: '',
					description:
						'Name to show for the employee; leave empty to use the name they were added with',
				},
				{
					displayName: 'Scope',
					name: 'scope',
					type: 'options',
					default: 'global',
					options: [
						{ name: 'All Chats', value: 'global', description: 'Every chat the employee may see' },
						{
							name: 'Chats of a Contact',
							value: 'card',
							description: 'Only the chats listed below, as opened from a contact or deal card',
						},
					],
				},
				{
					displayName: 'Chats',
					name: 'chats',
					type: 'fixedCollection',
					typeOptions: { multipleValues: true },
					placeholder: 'Add Chat',
					default: {},
					displayOptions: { show: { scope: ['card'] } },
					description:
						'The chats of the contact. A chat Wazzup does not know yet is created, named after Name or else the chat ID. A Telegram or MAX chat cannot be created here by phone number: send a message first and use the chat ID it returns.',
					options: [
						{
							name: 'chat',
							displayName: 'Chat',
							values: [
								{
									displayName: 'Chat ID',
									name: 'chatId',
									type: 'string',
									default: '',
									description: 'For WhatsApp and Viber the phone number, digits only',
								},
								{
									displayName: 'Chat Type',
									name: 'chatType',
									type: 'options',
									default: 'whatsapp',
									options: CHAT_TYPE_OPTIONS,
								},
								{
									displayName: 'Name',
									name: 'name',
									type: 'string',
									default: '',
									description: 'The contact’s name',
								},
							],
						},
					],
				},
				{
					displayName: 'Options',
					name: 'options',
					type: 'collection',
					placeholder: 'Add option',
					default: {},
					options: [
						{
							displayName: 'Active Channel Name or ID',
							name: 'activeChannelId',
							type: 'options',
							typeOptions: { loadOptionsMethod: 'getChannels' },
							default: '',
							description:
								'The channel of the chat to open first. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
						},
						{
							displayName: 'Active Chat ID',
							name: 'activeChatId',
							type: 'string',
							default: '',
							description: 'The chat to open first when the window loads',
						},
						{
							displayName: 'Active Chat Type',
							name: 'activeChatType',
							type: 'options',
							default: 'whatsapp',
							options: CHAT_TYPE_OPTIONS,
						},
						{
							displayName: 'CRM Type',
							name: 'clientType',
							type: 'string',
							default: '',
							description: 'A name for your CRM; Wazzup says it may be left empty',
						},
						{
							displayName: 'Send Deal Events',
							name: 'useDealsEvents',
							type: 'boolean',
							default: false,
							description:
								'Whether the window posts WZ_CREATE_ENTITY and WZ_OPEN_ENTITY to the page embedding it when the employee creates or opens a deal from its Deals list',
						},
						{
							displayName: 'Send Message Events',
							name: 'useMessageEvents',
							type: 'boolean',
							default: false,
							description:
								'Whether the window tells the page embedding it that a contact has to be created when the employee answers a new client',
						},
					],
				},
			],
			execute: getLink,
		},
	],
};
