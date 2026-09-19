import type {
	IDataObject,
	IExecuteFunctions,
	INodeProperties,
	ResourceMapperField,
} from 'n8n-workflow';
import { jsonParse, NodeOperationError } from 'n8n-workflow';

import { CHAT_TYPE_OPTIONS } from '../../../shared/chat';
import { compact, jsonParameter, requiredText, text } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { wazzupRequest } from '../../../shared/transport';
import {
	channelProperty,
	chatTypeOfChannel,
	checkedChatType,
	idSegment,
	normalizeChatId,
} from '../props';

// ── Send ────────────────────────────────────────────────────────────────────

const BUTTON_LAYOUTS_WITH_ROWS = ['max', 'telegramInline', 'telegramReply'];

const sendProperties: INodeProperties[] = [
	channelProperty(),
	{
		displayName: 'Chat Type',
		name: 'chatType',
		type: 'options',
		default: 'auto',
		options: [
			{
				name: 'Automatic (From Channel)',
				value: 'auto',
				description:
					'The one-to-one chat of the channel: WhatsApp for a WhatsApp or WABA number, Telegram for a Telegram account or bot, and so on. Pick a group type by hand.',
			},
			...CHAT_TYPE_OPTIONS,
		],
		description: 'Which messenger, and whether it is a one-to-one or a group chat',
	},
	{
		displayName: 'Send To',
		name: 'sendTo',
		type: 'options',
		default: 'chatId',
		options: [
			{
				name: 'Chat ID',
				value: 'chatId',
				description:
					'The phone number for WhatsApp and Viber; the ID from a webhook for everything else',
			},
			{
				name: 'Phone Number',
				value: 'phone',
				description:
					'Telegram and MAX only: start a chat by phone number when the chat ID is not known',
			},
			{
				name: 'Telegram Username',
				value: 'username',
				description: 'Telegram only: start a chat by username when the chat ID is not known',
			},
		],
	},
	{
		displayName: 'Chat ID',
		name: 'chatId',
		type: 'string',
		required: true,
		default: '',
		placeholder: '79011112233',
		displayOptions: { show: { sendTo: ['chatId'] } },
		description:
			'For WhatsApp and Viber the phone number with the country code; spaces, brackets and + are dropped. For Instagram the account name. For groups, Telegram, MAX, VK and Avito the chatId from a Wazzup webhook or from an earlier send.',
	},
	{
		displayName: 'Phone Number',
		name: 'phone',
		type: 'string',
		required: true,
		default: '',
		placeholder: '79011112233',
		displayOptions: { show: { sendTo: ['phone'] } },
		description:
			'International format with the country code; everything but digits is dropped. The answer carries the chatId to use from then on.',
	},
	{
		displayName: 'Username',
		name: 'username',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'durov',
		displayOptions: { show: { sendTo: ['username'] } },
		description: 'Telegram username; a leading @ is dropped',
	},
	{
		displayName: 'Content',
		name: 'content',
		type: 'options',
		default: 'text',
		options: [
			{
				name: 'Text',
				value: 'text',
				description: 'A text message, with buttons if the channel has them',
			},
			{
				name: 'File',
				value: 'file',
				description: 'A picture, video, audio, document or voice note by URL',
			},
			{
				name: 'WABA Template',
				value: 'template',
				description:
					'An approved WhatsApp Business template: the only way to write first, or after 24 hours of silence, from a WABA channel',
			},
		],
	},
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		displayOptions: { show: { content: ['text'] } },
		description:
			'Up to 10,000 characters for WhatsApp, 4,096 for Telegram and MAX, 1,024 for WABA, 1,000 for Instagram, VK and Avito. *bold*, _italic_, ~strikethrough~ and ```monospace``` work in WhatsApp, WABA, Viber and Telegram bots; a Telegram bot also takes <b>, <i>, <u> and <s>.',
	},
	{
		displayName: 'File URL',
		name: 'contentUri',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'https://example.com/price-list.pdf',
		displayOptions: { show: { content: ['file'] } },
		description:
			'A public link Wazzup downloads the file from as soon as the request arrives, so a short-lived link is fine. It must answer without a redirect. A text cannot go in the same message; send it separately. Telegram sends .mp3 and .ogg under 1 MB as voice notes.',
	},
	{
		displayName: 'Template Name or ID',
		name: 'templateId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getTemplates', loadOptionsDependsOn: ['channelId'] },
		required: true,
		default: '',
		displayOptions: { show: { content: ['template'] } },
		description:
			'The WABA template, listed by its title in Wazzup; only templates of the selected channel are shown. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Variables',
		name: 'templateVariables',
		type: 'resourceMapper',
		noDataExpression: true,
		default: { mappingMode: 'defineBelow', value: null },
		required: true,
		displayOptions: { show: { content: ['template'] } },
		typeOptions: {
			loadOptionsDependsOn: ['templateId'],
			resourceMapper: {
				resourceMapperMethod: 'getTemplateVariables',
				mode: 'add',
				fieldWords: { singular: 'variable', plural: 'variables' },
				addAllFields: true,
				multiKeyMatch: false,
				supportAutoMap: false,
			},
		},
	},
	{
		displayName: 'Button Payloads',
		name: 'templateButtonPayloads',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, sortable: true },
		placeholder: 'Add Payload',
		default: {},
		displayOptions: { show: { content: ['template'] } },
		description:
			'Optional data for the quick-reply buttons of the template, in the order of the buttons. It comes back in the webhook when the client taps one; without it the webhook carries the button text. The texts themselves are part of the approved template and cannot be changed.',
		options: [
			{
				name: 'payload',
				displayName: 'Payload',
				values: [
					{
						displayName: 'Payload',
						name: 'value',
						type: 'string',
						default: '',
					},
				],
			},
		],
	},
	{
		displayName: 'Buttons',
		name: 'buttonLayout',
		type: 'options',
		default: 'none',
		displayOptions: { show: { content: ['text'] } },
		options: [
			{
				name: 'JSON',
				value: 'json',
				description: 'A buttonsObject written by hand, as in the Wazzup documentation',
			},
			{
				name: 'MAX Bot Buttons',
				value: 'max',
				description: 'Callback, link and message buttons in rows, for a MAX bot channel',
			},
			{ name: 'None', value: 'none' },
			{
				name: 'Remove Telegram Bot Keyboard',
				value: 'telegramRemove',
				description: 'Takes away a reply keyboard the bot showed earlier',
			},
			{
				name: 'Telegram Bot Inline Keyboard',
				value: 'telegramInline',
				description: 'Buttons under the message that open a URL or send callback data',
			},
			{
				name: 'Telegram Bot Reply Keyboard',
				value: 'telegramReply',
				description: 'Buttons in place of the keyboard that send their text as the answer',
			},
			{
				name: 'WABA Quick Reply Buttons',
				value: 'waba',
				description:
					'Up to 10 buttons of up to 20 characters, allowed inside the 24-hour window of a WABA channel',
			},
		],
	},
	{
		displayName: 'Buttons',
		name: 'buttons',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, sortable: true },
		placeholder: 'Add Button',
		default: {},
		displayOptions: {
			show: { content: ['text'], buttonLayout: ['max', 'telegramInline', 'telegramReply', 'waba'] },
		},
		options: [
			{
				name: 'button',
				displayName: 'Button',
				values: [
					{
						displayName: 'Callback Data',
						name: 'callbackData',
						type: 'string',
						default: '',
						displayOptions: { show: { '/buttonLayout': ['telegramInline'] } },
						description:
							'1–64 bytes the bot receives when the button is tapped. An inline button needs either this or a URL.',
					},
					{
						displayName: 'Intent',
						name: 'intent',
						type: 'options',
						default: 'default',
						displayOptions: { show: { '/buttonLayout': ['max'] } },
						options: [
							{ name: 'Default', value: 'default' },
							{ name: 'Negative', value: 'negative' },
							{ name: 'Positive', value: 'positive' },
						],
						description: 'How MAX colours the button',
					},
					{
						displayName: 'Payload',
						name: 'payload',
						type: 'string',
						default: '',
						displayOptions: { show: { '/buttonLayout': ['max', 'waba'] } },
						description:
							'Data that comes back in the webhook when the client taps the button. For MAX only callback buttons carry it. Without it a WABA webhook carries the number of the button, counted from 0.',
					},
					{
						displayName: 'Row',
						name: 'row',
						type: 'number',
						typeOptions: { minValue: 1 },
						default: 1,
						displayOptions: { show: { '/buttonLayout': BUTTON_LAYOUTS_WITH_ROWS } },
						description: 'Buttons with the same row number sit side by side; rows go top to bottom',
					},
					{
						displayName: 'Text',
						name: 'text',
						type: 'string',
						default: '',
						description: 'The label. WABA allows 20 characters, Telegram 64.',
					},
					{
						displayName: 'Type',
						name: 'type',
						type: 'options',
						default: 'callback',
						displayOptions: { show: { '/buttonLayout': ['max'] } },
						options: [
							{ name: 'Callback', value: 'callback', description: 'Sends the payload to the bot' },
							{ name: 'Link', value: 'link', description: 'Opens the URL' },
							{
								name: 'Message',
								value: 'message',
								description: 'Sends its text as the client’s answer',
							},
						],
					},
					{
						displayName: 'URL',
						name: 'url',
						type: 'string',
						default: '',
						displayOptions: { show: { '/buttonLayout': ['max', 'telegramInline'] } },
						description: 'Opened when the button is tapped. For MAX only link buttons carry it.',
					},
				],
			},
		],
	},
	{
		displayName: 'One-Time Keyboard',
		name: 'oneTimeKeyboard',
		type: 'boolean',
		default: false,
		displayOptions: { show: { content: ['text'], buttonLayout: ['telegramReply'] } },
		description: 'Whether Telegram hides the keyboard after a button is tapped (it is not removed)',
	},
	{
		displayName: 'Buttons (JSON)',
		name: 'buttonsJson',
		type: 'json',
		default: '{\n  "buttons": []\n}',
		displayOptions: { show: { content: ['text'], buttonLayout: ['json'] } },
		description:
			'The buttonsObject as Wazzup documents it under Sending messages, sent unchanged. Useful for layouts the fields above do not cover.',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'Clear Unanswered Counter',
				name: 'clearUnanswered',
				type: 'boolean',
				default: true,
				description:
					'Whether this message resets the unanswered counter of the responsible user. Turn it off for automatic replies, so the manager still sees that the client is waiting for a person.',
			},
			{
				displayName: 'CRM Message ID',
				name: 'crmMessageId',
				type: 'string',
				default: '',
				description:
					'Your own ID of the message. Wazzup refuses a second message with the same value for 60 seconds, which protects against sending twice when a workflow is retried.',
			},
			{
				displayName: 'CRM User ID',
				name: 'crmUserId',
				type: 'string',
				default: '',
				description:
					'ID of a user added under User, shown in the Wazzup chat as the author. Ignored with a sidecar key.',
			},
			{
				displayName: 'Quote Message ID',
				name: 'refMessageId',
				type: 'string',
				default: '',
				description:
					'ID of a message in the same chat to quote, as Wazzup returned it or sent it in a webhook',
			},
			{
				displayName: 'Template Values',
				name: 'templateValues',
				type: 'string',
				default: '',
				placeholder: '["Anna", "12 March"]',
				description:
					'WABA templates only: the variable values in order, as a JSON array or a comma-separated list. Takes the place of Variables, for when the template is chosen by an expression and the fields cannot be loaded.',
			},
		],
	},
];

/** Buttons from the fixedCollection, in the order the user arranged them. */
function readButtons(ctx: IExecuteFunctions, itemIndex: number): IDataObject[] {
	const ui = ctx.getNodeParameter('buttons', itemIndex, {}) as IDataObject;
	return ((ui.button ?? []) as IDataObject[]).filter((b) => String(b.text ?? '').trim() !== '');
}

/** Buttons grouped into rows by their Row number, rows in ascending order. */
function inRows(buttons: IDataObject[], shape: (b: IDataObject) => IDataObject): IDataObject[][] {
	const rows = new Map<number, IDataObject[]>();
	for (const button of buttons) {
		const row = Math.max(1, Math.floor(Number(button.row) || 1));
		if (!rows.has(row)) rows.set(row, []);
		rows.get(row)?.push(shape(button));
	}
	return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
}

function buttonsObject(ctx: IExecuteFunctions, itemIndex: number): IDataObject | undefined {
	const layout = ctx.getNodeParameter('buttonLayout', itemIndex, 'none') as string;
	const fail = (message: string, description?: string) =>
		new NodeOperationError(ctx.getNode(), message, { itemIndex, description });

	if (layout === 'none') return undefined;
	if (layout === 'json')
		return jsonParameter<IDataObject>(ctx, 'buttonsJson', itemIndex, {}, 'Buttons (JSON)');
	if (layout === 'telegramRemove') return { replyMarkup: 'reply', removeKeyboard: true };

	const buttons = readButtons(ctx, itemIndex);
	if (buttons.length === 0) {
		throw fail(
			'No buttons with a text',
			'Add at least one button and give it a text, or set Buttons to None.',
		);
	}

	const label = (b: IDataObject) => String(b.text).trim();

	if (layout === 'waba') {
		return {
			buttons: buttons.map((b) =>
				compact({ text: label(b), type: 'text', payload: b.payload as string }),
			),
		};
	}

	if (layout === 'telegramInline') {
		for (const b of buttons) {
			if (String(b.url ?? '').trim() === '' && String(b.callbackData ?? '').trim() === '') {
				throw fail(
					`Button "${label(b)}" needs a URL or callback data`,
					'Telegram refuses inline buttons that do neither.',
				);
			}
		}
		return {
			replyMarkup: 'inline',
			buttons: inRows(buttons, (b) =>
				compact({
					text: label(b),
					url: String(b.url ?? '').trim(),
					callbackData: b.callbackData as string,
				}),
			),
		};
	}

	if (layout === 'telegramReply') {
		const object: IDataObject = {
			replyMarkup: 'reply',
			buttons: inRows(buttons, (b) => ({ text: label(b) })),
		};
		if (ctx.getNodeParameter('oneTimeKeyboard', itemIndex, false) as boolean)
			object.oneTimeKeyboard = true;
		return object;
	}

	// MAX bot
	for (const b of buttons) {
		const type = String(b.type ?? 'callback');
		if (type === 'callback' && String(b.payload ?? '').trim() === '') {
			throw fail(`Callback button "${label(b)}" needs a payload`);
		}
		if (type === 'link' && String(b.url ?? '').trim() === '') {
			throw fail(`Link button "${label(b)}" needs a URL`);
		}
	}
	return {
		chatType: 'max',
		buttons: inRows(buttons, (b) => {
			const type = String(b.type ?? 'callback');
			const button: IDataObject = { type, text: label(b) };
			if (type === 'callback') button.payload = b.payload;
			if (type === 'link') button.url = String(b.url).trim();
			if (b.intent !== undefined && b.intent !== 'default') button.intent = b.intent;
			return button;
		}),
	};
}

/** The variable values of a WABA template, in sending order. */
function templateValues(
	ctx: IExecuteFunctions,
	itemIndex: number,
	options: IDataObject,
): string[] | undefined {
	const override = options.templateValues;
	if (override !== undefined && String(override).trim() !== '') return valueList(override);

	const values = ctx.getNodeParameter(
		'templateVariables.value',
		itemIndex,
		{},
	) as IDataObject | null;
	const schema = (ctx.getNodeParameter('templateVariables.schema', itemIndex, []) ??
		[]) as ResourceMapperField[];
	const ids = schema.length > 0 ? schema.map((f) => f.id) : Object.keys(values ?? {});

	// The fields are v1, v2, …; the order of the schema is the sending order.
	const ordered = ids
		.filter((id) => /^v\d+$/.test(id))
		.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
	if (ordered.length === 0) return undefined;

	const missing = ordered.filter((id) => String(values?.[id] ?? '').trim() === '');
	if (missing.length > 0) {
		throw new NodeOperationError(ctx.getNode(), 'Some template variables are empty', {
			itemIndex,
			description: `Fill in variable ${missing.map((id) => id.slice(1)).join(', ')}. Meta rejects a template with an empty variable.`,
		});
	}

	return ordered.map((id) => String(values?.[id]));
}

/**
 * Values where order matters and repeats are legitimate: a JSON array, an array
 * from an expression, or a comma-separated list.
 */
function valueList(raw: unknown): string[] {
	if (Array.isArray(raw)) return raw.map((v) => String(v ?? ''));
	const value = String(raw).trim();
	if (value.startsWith('[')) {
		try {
			const parsed = jsonParse<unknown>(value);
			if (Array.isArray(parsed)) return parsed.map((v) => String(v ?? ''));
		} catch {
			// Not JSON after all — read it as a comma-separated list below.
		}
	}
	return value.split(',').map((v) => v.trim());
}

async function send(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const channelId = requiredText(this, 'channelId', itemIndex, 'Channel');
	const requested = text(this, 'chatType', itemIndex) || 'auto';
	const chatType =
		requested === 'auto'
			? await chatTypeOfChannel.call(this, channelId, itemIndex)
			: checkedChatType(this, requested, itemIndex);

	const body: IDataObject = { channelId, chatType };

	const sendTo = this.getNodeParameter('sendTo', itemIndex, 'chatId') as string;
	if (sendTo === 'phone') {
		if (chatType !== 'telegram' && chatType !== 'max') {
			throw new NodeOperationError(
				this.getNode(),
				'Sending by phone number works for Telegram and MAX only',
				{
					itemIndex,
					description:
						'For WhatsApp and Viber the phone number is the chat ID: set Send To to Chat ID.',
				},
			);
		}
		body.phone = requiredText(this, 'phone', itemIndex, 'Phone Number').replace(/\D/g, '');
	} else if (sendTo === 'username') {
		if (chatType !== 'telegram') {
			throw new NodeOperationError(this.getNode(), 'Sending by username works for Telegram only', {
				itemIndex,
			});
		}
		body.username = requiredText(this, 'username', itemIndex, 'Username').replace(/^@/, '');
	} else {
		body.chatId = normalizeChatId(chatType, requiredText(this, 'chatId', itemIndex, 'Chat ID'));
	}

	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const content = this.getNodeParameter('content', itemIndex, 'text') as string;

	if (content === 'file') {
		const url = requiredText(this, 'contentUri', itemIndex, 'File URL');
		if (!/^https?:\/\//i.test(url)) {
			throw new NodeOperationError(this.getNode(), 'File URL must start with http:// or https://', {
				itemIndex,
			});
		}
		body.contentUri = url;
	} else if (content === 'template') {
		body.templateId = requiredText(this, 'templateId', itemIndex, 'Template');
		const values = templateValues(this, itemIndex, options);
		if (values !== undefined && values.length > 0) body.templateValues = values;

		const payloadUi = this.getNodeParameter('templateButtonPayloads', itemIndex, {}) as IDataObject;
		const payloads = ((payloadUi.payload ?? []) as IDataObject[]).map((p) => String(p.value ?? ''));
		if (payloads.some((p) => p !== ''))
			body.buttonsObject = { buttons: payloads.map((payload) => ({ payload })) };
	} else {
		body.text = requiredText(this, 'text', itemIndex, 'Text');
		const buttons = buttonsObject(this, itemIndex);
		if (buttons !== undefined) body.buttonsObject = buttons;
	}

	if (options.clearUnanswered !== undefined)
		body.clearUnanswered = options.clearUnanswered === true;
	Object.assign(
		body,
		compact({
			crmMessageId: String(options.crmMessageId ?? '').trim(),
			crmUserId: String(options.crmUserId ?? '').trim(),
			refMessageId: String(options.refMessageId ?? '').trim(),
		}),
	);

	// Not repeated on a server error: a message that timed out may already be on the
	// client's phone, and Wazzup would deliver a second copy. CRM Message ID is the
	// way to make a retry safe.
	const response = (await wazzupRequest.call(this, 'POST', '/message', {
		body,
		itemIndex,
		retry: false,
	})) as IDataObject;

	return {
		...(typeof response === 'object' && response !== null ? response : {}),
		channelId,
		chatType,
	};
}

// ── Edit and delete ─────────────────────────────────────────────────────────

const messageIdProperty: INodeProperties = {
	displayName: 'Message ID',
	name: 'messageId',
	type: 'string',
	required: true,
	default: '',
	description: 'The messageId Wazzup returned when the message was sent, or sent in a webhook',
};

const editProperties: INodeProperties[] = [
	messageIdProperty,
	{
		displayName: 'Change',
		name: 'content',
		type: 'options',
		default: 'text',
		options: [
			{ name: 'Text', value: 'text', description: 'Replace the text of the message' },
			{
				name: 'File',
				value: 'file',
				description: 'Replace the attachment; not every messenger allows it',
			},
		],
		description: 'A message can change its text or its file, not both at once',
	},
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		displayOptions: { show: { content: ['text'] } },
	},
	{
		displayName: 'File URL',
		name: 'contentUri',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { content: ['file'] } },
		description: 'A public link Wazzup downloads the new file from, without a redirect',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'CRM User ID',
				name: 'crmUserId',
				type: 'string',
				default: '',
				description: 'ID of the user shown as the editor in the Wazzup chat',
			},
		],
	},
];

async function edit(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const messageId = idSegment(this, 'messageId', itemIndex, 'Message ID');
	const content = this.getNodeParameter('content', itemIndex, 'text') as string;
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	const body: IDataObject =
		content === 'file'
			? { contentUri: requiredText(this, 'contentUri', itemIndex, 'File URL') }
			: { text: requiredText(this, 'text', itemIndex, 'Text') };
	const crmUserId = String(options.crmUserId ?? '').trim();
	if (crmUserId !== '') body.crmUserId = crmUserId;

	const response = await wazzupRequest.call(this, 'PATCH', `/message/${messageId}`, {
		body,
		itemIndex,
	});
	return {
		success: true,
		messageId: decodeURIComponent(messageId),
		...(response !== null && typeof response === 'object' && !Array.isArray(response)
			? (response as IDataObject)
			: {}),
	};
}

async function remove(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const messageId = idSegment(this, 'messageId', itemIndex, 'Message ID');
	await wazzupRequest.call(this, 'DELETE', `/message/${messageId}`, { itemIndex });
	return { success: true, messageId: decodeURIComponent(messageId) };
}

export const messageResource: Resource = {
	value: 'message',
	name: 'Message',
	description: 'Send, edit and delete messages in the messengers connected to Wazzup',
	operations: [
		{
			value: 'send',
			name: 'Send',
			action: 'Send a message',
			description:
				'Send a text, a file or a WABA template from a Wazzup channel to a WhatsApp, Telegram, MAX, Viber, VK, Avito or Instagram chat, with buttons where the channel has them',
			properties: sendProperties,
			execute: send,
		},
		{
			value: 'edit',
			name: 'Edit',
			action: 'Edit a message',
			description:
				'Replace the text or the file of a message sent earlier, where the messenger allows editing and the time for it has not run out. WABA channels do not allow it.',
			properties: editProperties,
			execute: edit,
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a message',
			description:
				'Delete a message sent earlier, where the messenger allows it and the time for it has not run out. WABA channels do not allow it.',
			properties: [messageIdProperty],
			execute: remove,
		},
	],
};
