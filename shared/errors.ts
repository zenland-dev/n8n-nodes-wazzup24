import type { IDataObject, INode, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

/**
 * What a catch block rethrows. Errors from the transport and from parameter reading
 * are already n8n errors carrying a message the user can act on, and pass through
 * untouched; anything else is wrapped so n8n can show it against the node.
 */
export function asNodeError(
	node: INode,
	error: unknown,
	itemIndex?: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) return error;
	return new NodeOperationError(node, error instanceof Error ? error : String(error), {
		itemIndex,
	});
}

/** A Wazzup failure, read from the body and the status. */
export interface WazzupFailure {
	/** The error code, e.g. CHANNEL_NOT_FOUND; '' when the body names none. */
	code: string;
	/** Wazzup's own short English explanation, '' when there is none. */
	description: string;
	/** The `data` object Wazzup attaches for developers, when there is one. */
	data: unknown;
	status: number;
}

/**
 * Reads a failure out of a response, or returns undefined for a success.
 *
 * Wazzup answers an error with a 4xx status and a body that is either empty or
 * `{ error, description, data }` — some routes add `status` and `requestId`. The
 * chat window route is the odd one: it nests the code as `{ error: { code } }`.
 * A 2xx is a success whatever the body says, except for that same `error` key.
 */
export function readFailure(body: unknown, status: number): WazzupFailure | undefined {
	const object =
		body !== null && typeof body === 'object' && !Array.isArray(body)
			? (body as IDataObject)
			: undefined;
	const error = object?.error;

	if (status >= 200 && status < 300 && (error === undefined || error === null || error === '')) {
		return undefined;
	}

	if (error !== undefined && error !== null && typeof error === 'object') {
		const nested = error as IDataObject;
		return {
			code: String(nested.code ?? nested.error ?? ''),
			description: String(nested.description ?? nested.message ?? ''),
			data: nested.data ?? object?.data,
			status,
		};
	}

	return {
		code: error === undefined || error === null ? '' : String(error),
		description: String(object?.description ?? object?.message ?? ''),
		data: object?.data,
		status,
	};
}

/** What to tell a person, per error code. Codes not listed fall back to Wazzup's own text. */
const HINTS: Record<string, string> = {
	TOO_MANY_ENTITIES:
		'Wazzup takes at most 100 users, contacts or deals per request. These nodes split larger batches on their own; a custom request has to do it by hand.',
	INVALID_CONTACTS_DATA:
		'One of the contacts is incomplete: every contact needs an ID, a name, a responsible user ID and at least one chat.',
	INVALID_USERS_DATA: 'One of the users is incomplete: every user needs an ID and a name.',
	USER_LIMIT_EXCEEDED: 'The account already holds 1000 users, the most Wazzup allows.',
	DUPLICATE_PHONE_NUMBER:
		'Another user already has this phone number. Wazzup keeps phone numbers of users unique.',
	INVALID_MESSAGE_DATA:
		'Check the channel ID (a UUID from the channel list), the chat type and the chat ID. The field Wazzup objected to is named below.',
	WRONG_TRANSPORT:
		'The chat type does not belong to the channel, e.g. a VK chat sent from a WhatsApp channel. Pick the chat type of that channel, or leave Chat Type on Automatic.',
	REPEATED_CRM_MESSAGE_ID:
		'A message with the same CRM Message ID went out less than 60 seconds ago, so Wazzup did not send this one again.',
	REPEATEDCRMMESSAGEID:
		'A message with the same CRM Message ID went out less than 60 seconds ago, so Wazzup did not send this one again.',
	BALANCE_IS_EMPTY: 'The WABA balance of the account is empty. Top it up in Wazzup.',
	CHANNEL_NOT_FOUND: 'No channel with this ID is connected to the integration.',
	CHANNEL_BLOCKED: 'The channel is switched off in Wazzup.',
	CHANNEL_WAPI_REJECTED: 'The WABA channel is blocked.',
	CHANNEL_NO_MONEY: 'The channel is not paid for: it is neither in the subscription nor on trial.',
	MESSAGE_CHANNEL_UNAVAILABLE:
		'The channel is not reachable right now: its phone is offline or it is reconnecting. Check the channel state in Wazzup.',
	MESSAGES_NOT_TEXT_FIRST: 'The Inbox plan does not allow writing to a client first.',
	MESSAGES_IS_SPAM: 'WhatsApp rated this message as spam and did not deliver it.',
	MESSAGE_DOWNLOAD_CONTENT_ERROR:
		'Wazzup could not download the file. The URL must be public and must answer without a redirect; Wazzup fetches it at once.',
	MESSAGE_WRONG_CONTENT_TYPE:
		'Wazzup could not tell the file type or does not support it for this messenger.',
	MESSAGES_CONTENT_SIZE_EXCEEDED: 'The file is larger than the messenger accepts (10 MB for most).',
	MESSAGES_EDITING_TIME_EXPIRED: 'The message is too old to be edited.',
	MESSAGES_DELETION_TIME_EXPIRED: 'The message is too old to be deleted.',
	MESSAGES_CONTAIN_BUTTONS: 'A message with buttons cannot be edited.',
	CHANNEL_INVALID_TRANSPORT_FOR_EDITING: 'This messenger does not allow editing sent messages.',
	CHANNEL_INVALID_TRANSPORT_FOR_CONTENT_EDITING:
		'This messenger allows editing the text of a message but not replacing its file.',
	CHANNEL_INVALID_TRANSPORT_FOR_DELETION: 'This messenger does not allow deleting sent messages.',
	CHAT_NO_ACCESS: 'The integration has no access to this chat.',
	CHANNEL_LIMIT_EXCEEDED: 'The channel has reached its limit of active dialogues.',
	REFERENCE_MESSAGE_NOT_FOUND:
		'The quoted message was not found. Quote Message ID must be a message ID Wazzup returned or sent in a webhook.',
	TEMPLATE_REJECTED:
		'The WABA template is rejected. Use another template, or wait for the client to write first; for 24 hours after that, plain text is allowed.',
	BAD_CONTACT:
		'The number is not on WhatsApp, or its WhatsApp is too old. Wazzup suggests trying later.',
	NO_SUCH_ACCOUNT: 'Wazzup found no account for this key.',
	URINOTVALID:
		'Wazzup does not consider the webhook address a valid URL. It must be a full URL of at most 200 characters.',
	TESTPOSTNOTPASSED:
		'Wazzup sent a test POST with {"test": true} to the webhook address and did not get 200 back. The address must be reachable from the internet and answer 200.',
};

/** What to tell a person when the body names no code, per HTTP status. */
const STATUS_HINTS: Record<number, string> = {
	401: 'Wazzup did not accept the API key. Copy it again from Integration with CRM in the Wazzup account.',
	403: 'This route is closed to this key. Some Wazzup keys, the sidecar key of the amoCRM or Bitrix24 integration among them, open only channels, sending messages, webhook settings and WABA templates; contacts, deals, users, pipelines and the chat window answer 403 to them.',
	404: 'Nothing with this ID exists in the account.',
	429: 'Wazzup counted more requests in five seconds with this key than it allows (500 unless its support raised it). Lower Requests per 5 Seconds in the credential; with several n8n workers or instances on one key, divide the limit between them.',
};

/** `data` of a failure, as one line a person can read, or undefined. */
function describeData(data: unknown): string | undefined {
	if (data === undefined || data === null) return undefined;

	if (Array.isArray(data)) {
		// INVALID_CONTACTS_DATA and INVALID_USERS_DATA: [{ index, fields }]
		const parts = data
			.map((entry) => {
				if (entry === null || typeof entry !== 'object') return String(entry);
				const record = entry as IDataObject;
				const fields = Array.isArray(record.fields) ? (record.fields as unknown[]).join(', ') : '';
				return record.index !== undefined
					? `entry ${String(record.index)}${fields ? `: ${fields}` : ''}`
					: JSON.stringify(record);
			})
			.filter((part) => part !== '');
		return parts.length > 0 ? `Wazzup points at ${parts.join('; ')}.` : undefined;
	}

	if (typeof data === 'object') {
		const record = data as IDataObject;
		if (Array.isArray(record.fields)) {
			return `Wazzup points at: ${(record.fields as unknown[]).join(', ')}.`;
		}
		const text = JSON.stringify(record);
		return text === '{}' ? undefined : `Details: ${text}`;
	}

	return `Details: ${String(data)}`;
}

/** Turns a Wazzup failure into the error n8n shows, with advice where there is any. */
export function toNodeApiError(
	node: INode,
	label: string,
	failure: WazzupFailure,
	body: unknown,
	itemIndex?: number,
): NodeApiError {
	const code = failure.code;
	const text = failure.description !== '' ? failure.description : code || `HTTP ${failure.status}`;
	const message = code !== '' && code !== text ? `${text} [${code}]` : text;

	const hint =
		HINTS[code] ??
		HINTS[code.toUpperCase()] ??
		HINTS[code.toUpperCase().replace(/_/g, '')] ??
		STATUS_HINTS[failure.status];
	const description = [hint, describeData(failure.data)]
		.filter((part) => part !== undefined)
		.join(' ');

	return new NodeApiError(
		node,
		(body !== null && typeof body === 'object' ? body : {}) as JsonObject,
		{
			message: `Wazzup ${label}: ${message}`,
			description: description === '' ? undefined : description,
			httpCode: String(failure.status),
			itemIndex,
		},
	);
}
