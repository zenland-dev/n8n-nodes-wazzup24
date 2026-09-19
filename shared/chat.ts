import type { IDataObject, INodePropertyOptions } from 'n8n-workflow';

import { cached, CONFIG_TTL_MS } from './cache';
import type { WazzupContext } from './transport';
import { accountKey, asList, wazzupRequest } from './transport';

/**
 * Chat types, the `chatType` of messages, contacts and the chat window. Sorted by
 * name, as n8n's linter wants option lists.
 */
export const CHAT_TYPE_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Avito', value: 'avito', description: 'Chat on Avito. The chat ID arrives in webhooks.' },
	{
		name: 'Instagram',
		value: 'instagram',
		description: 'Instagram direct chat. The chat ID is the account name without @.',
	},
	{ name: 'MAX', value: 'max', description: 'One-to-one chat in MAX' },
	{ name: 'MAX Group', value: 'maxgroup', description: 'Group chat in MAX' },
	{
		name: 'Telegram',
		value: 'telegram',
		description: 'One-to-one chat in Telegram, personal or bot',
	},
	{ name: 'Telegram Group', value: 'telegroup', description: 'Group chat in Telegram' },
	{
		name: 'Viber',
		value: 'viber',
		description: 'Chat in Viber. The chat ID is the phone number, digits only.',
	},
	{ name: 'VK', value: 'vk', description: 'Chat in VK. The chat ID arrives in webhooks.' },
	{
		name: 'WhatsApp',
		value: 'whatsapp',
		description:
			'One-to-one chat in WhatsApp, WABA included. The chat ID is the phone number, digits only, e.g. 79011112233.',
	},
	{
		name: 'WhatsApp Group',
		value: 'whatsgroup',
		description: 'Group chat in WhatsApp. The chat ID arrives in webhooks.',
	},
];

/** Every chat type Wazzup documents, for checks. */
export const CHAT_TYPES = CHAT_TYPE_OPTIONS.map((o) => String(o.value));

/** What each channel `transport` is called on screen. */
export const TRANSPORT_NAMES: Record<string, string> = {
	avito: 'Avito',
	instagram: 'Instagram',
	max: 'MAX',
	maxbot: 'MAX Bot',
	telegram: 'Telegram Bot',
	tgapi: 'Telegram',
	viber: 'Viber',
	vk: 'VK',
	wapi: 'WABA',
	whatsapp: 'WhatsApp',
};

export const TRANSPORT_OPTIONS: INodePropertyOptions[] = Object.entries(TRANSPORT_NAMES)
	.map(([value, name]) => ({ name, value }))
	.sort((a, b) => a.name.localeCompare(b.name));

/**
 * The one-to-one chat type of each channel transport. Group chats are never
 * guessed: a channel serves both, and only the person knows which one is meant.
 */
const DIRECT_CHAT_TYPE: Record<string, string> = {
	avito: 'avito',
	instagram: 'instagram',
	max: 'max',
	maxbot: 'max',
	telegram: 'telegram',
	tgapi: 'telegram',
	viber: 'viber',
	vk: 'vk',
	wapi: 'whatsapp',
	whatsapp: 'whatsapp',
};

export function directChatType(transport: string): string | undefined {
	return DIRECT_CHAT_TYPE[transport];
}

/** Channel states as `GET /channels` and the channel webhook spell them. */
export const CHANNEL_STATE_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Active', value: 'active' },
	{ name: 'Blocked', value: 'blocked', description: 'Facebook blocked the channel' },
	{ name: 'Disabled', value: 'disabled', description: 'Off, or no longer in the subscription' },
	{
		name: 'Foreign Phone',
		value: 'foreignphone',
		description: 'The QR code was scanned by another number',
	},
	{ name: 'Not Enough Money', value: 'notEnoughMoney', description: 'Not paid for' },
	{ name: 'On Moderation', value: 'onModeration', description: 'A WABA channel under review' },
	{
		name: 'Open Elsewhere',
		value: 'openelsewhere',
		description: 'Signed in to another Wazzup account',
	},
	{
		name: 'Phone Unavailable',
		value: 'phoneUnavailable',
		description: 'No connection to the phone',
	},
	{ name: 'QR Idle', value: 'qridle', description: 'The QR code has to be scanned' },
	{ name: 'Rejected', value: 'rejected', description: 'A WABA channel that failed review' },
	{ name: 'Starting', value: 'init' },
	{
		name: 'Unauthorized',
		value: 'unauthorized',
		description: 'The channel has to be signed in again',
	},
	{
		name: 'Wait for Password',
		value: 'waitForPassword',
		description: 'Two-factor password needed',
	},
];

/** The channels of the account, shared for a short while per key. */
export async function listChannels(this: WazzupContext): Promise<IDataObject[]> {
	const key = await accountKey.call(this);
	return await cached(
		`channels:${key}`,
		async () => asList(await wazzupRequest.call(this, 'GET', '/channels')),
		CONFIG_TTL_MS,
	);
}

/**
 * How a channel reads in a dropdown: "WhatsApp: Sales 79865784457", plus its state when
 * it is not active. `name`, the title given to the channel in Wazzup, is not in the
 * documentation, but a live account (19.09.2026) returns it for every channel.
 */
export function channelLabel(channel: IDataObject): string {
	const transport = String(channel.transport ?? '');
	const kind = TRANSPORT_NAMES[transport] ?? transport;
	const id = String(channel.plainId ?? channel.channelId ?? '');
	const name = String(channel.name ?? '').trim();
	// Wazzup often names a channel after its number with a note, "79865784457 (Sales)";
	// the number is then not repeated.
	const title = name === '' ? id : name.includes(id) ? name : `${name} ${id}`;
	const state = String(channel.state ?? '');
	return state !== '' && state !== 'active' ? `${kind}: ${title} (${state})` : `${kind}: ${title}`;
}
