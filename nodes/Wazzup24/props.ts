import type { IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { CHAT_TYPE_OPTIONS, CHAT_TYPES, directChatType, listChannels } from '../../shared/chat';
import { requiredText } from '../../shared/params';

/** A channel picked from the account's list, or given as an ID by expression. */
export function channelProperty(overrides: Partial<INodeProperties> = {}): INodeProperties {
	return {
		displayName: 'Channel Name or ID',
		name: 'channelId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getChannels' },
		required: true,
		default: '',
		description:
			'The Wazzup channel (a WhatsApp number, a Telegram bot, a VK group) the message goes out from. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		...overrides,
	};
}

/**
 * A Wazzup user (a CRM employee) picked from the list, or given as an ID by
 * expression. `description` is one sentence without its final period.
 */
export function userProperty(
	displayName: string,
	name: string,
	description: string,
	required = true,
): INodeProperties {
	return {
		displayName,
		name,
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getUsers' },
		required,
		default: '',
		description: `${description}. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.`,
	};
}

/** A chat type without the Automatic choice, for contacts and the chat window. */
export function chatTypeProperty(name = 'chatType', required = true): INodeProperties {
	return {
		displayName: 'Chat Type',
		name,
		type: 'options',
		required,
		default: 'whatsapp',
		options: CHAT_TYPE_OPTIONS,
		description: 'Which messenger, and whether it is a one-to-one or a group chat',
	};
}

/**
 * A chat ID as Wazzup wants it. WhatsApp and Viber take digits only, so a number
 * pasted as "+7 (901) 111-22-33" is reduced to 79011112233; an Instagram account
 * loses a leading @. Everything else is sent as typed.
 */
export function normalizeChatId(chatType: string, raw: string): string {
	const value = raw.trim();
	if (chatType === 'whatsapp' || chatType === 'viber') return value.replace(/\D/g, '');
	if (chatType === 'instagram') return value.replace(/^@/, '');
	return value;
}

/** A chat type that must be one Wazzup knows. */
export function checkedChatType(ctx: IExecuteFunctions, value: string, itemIndex: number): string {
	if (!CHAT_TYPES.includes(value)) {
		throw new NodeOperationError(ctx.getNode(), `"${value}" is not a Wazzup chat type`, {
			itemIndex,
			description: `Use one of ${CHAT_TYPES.join(', ')}.`,
		});
	}
	return value;
}

/**
 * The chat type of a channel, for Chat Type = Automatic.
 *
 * The channel list says what transport each channel is — WhatsApp, WABA, a
 * Telegram bot — and each has one one-to-one chat type. Group chats are never
 * guessed; they have to be picked by hand.
 */
export async function chatTypeOfChannel(
	this: IExecuteFunctions,
	channelId: string,
	itemIndex: number,
): Promise<string> {
	const channels = await listChannels.call(this);
	const channel = channels.find((c) => String(c.channelId) === channelId);

	if (channel === undefined) {
		throw new NodeOperationError(
			this.getNode(),
			`Channel ${channelId} is not in this Wazzup account`,
			{
				itemIndex,
				description:
					'Pick the channel from the list. A channel ID from another account, or of a deleted channel, cannot be used; setting Chat Type by hand does not help either.',
			},
		);
	}

	const transport = String(channel.transport ?? '');
	const chatType = directChatType(transport);

	if (chatType === undefined) {
		throw new NodeOperationError(
			this.getNode(),
			`Cannot tell the chat type of a "${transport}" channel`,
			{ itemIndex, description: 'Set Chat Type to the messenger of this channel by hand.' },
		);
	}

	return chatType;
}

/** A path segment made of an ID the user typed; the ID must not be empty. */
export function idSegment(
	ctx: IExecuteFunctions,
	name: string,
	itemIndex: number,
	label: string,
): string {
	return encodeURIComponent(requiredText(ctx, name, itemIndex, label));
}
