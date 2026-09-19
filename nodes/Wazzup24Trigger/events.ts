import type { IDataObject, INodePropertyOptions } from 'n8n-workflow';

/**
 * What the trigger can start on, and which Wazzup subscription delivers it.
 *
 * Wazzup has four switches, not nine: messages, edits, deletions and statuses all
 * come under messagesAndStatuses, both creation requests under
 * contactsAndDealsCreation. The finer split is made here, from the payload.
 */
export const EVENT_OPTIONS: INodePropertyOptions[] = [
	{
		name: 'Channel State Changed',
		value: 'channelUpdate',
		description:
			'A channel went active, lost its phone, needs its QR code scanned, ran out of money; WABA tier changes',
	},
	{
		name: 'Contact Creation Requested',
		value: 'createContact',
		description:
			'Wazzup asks the CRM to create a contact for a new client. It expects the contact back in the answer.',
	},
	{
		name: 'Deal Creation Requested',
		value: 'createDeal',
		description: 'Wazzup asks the CRM to create a deal. It expects the deal back in the answer.',
	},
	{
		name: 'Message Deleted',
		value: 'messageDeleted',
		description: 'A message was deleted; oldInfo holds what it said',
	},
	{
		name: 'Message Edited',
		value: 'messageEdited',
		description: 'A message was edited; oldInfo holds the text before',
	},
	{
		name: 'Message Received',
		value: 'incomingMessage',
		description: 'A client wrote to one of the channels',
	},
	{
		name: 'Message Sent',
		value: 'outgoingMessage',
		description:
			'A message went out from Wazzup, the phone, the mobile app or the API, including ones this workflow sent',
	},
	{
		name: 'Message Status Changed',
		value: 'messageStatus',
		description: 'An outgoing message was sent, delivered, read, edited or failed',
	},
	{
		name: 'Template Status Changed',
		value: 'templateStatus',
		description: 'Meta approved, rejected, paused or disabled a WABA template',
	},
];

export const SUBSCRIPTIONS = [
	'messagesAndStatuses',
	'contactsAndDealsCreation',
	'channelsUpdates',
	'templateStatus',
] as const;

const SUBSCRIPTION_OF: Record<string, (typeof SUBSCRIPTIONS)[number]> = {
	channelUpdate: 'channelsUpdates',
	createContact: 'contactsAndDealsCreation',
	createDeal: 'contactsAndDealsCreation',
	incomingMessage: 'messagesAndStatuses',
	messageDeleted: 'messagesAndStatuses',
	messageEdited: 'messagesAndStatuses',
	messageStatus: 'messagesAndStatuses',
	outgoingMessage: 'messagesAndStatuses',
	templateStatus: 'templateStatus',
};

/** The four Wazzup switches, on for every kind the selected events need. */
export function subscriptionsFor(events: string[]): IDataObject {
	const wanted = new Set(events.map((event) => SUBSCRIPTION_OF[event]));
	return Object.fromEntries(SUBSCRIPTIONS.map((name) => [name, wanted.has(name)]));
}

/** The documentation shows the switches as "true" strings; a live account answers booleans. */
function isOn(value: unknown): boolean {
	return value === true || value === 'true';
}

/**
 * Other names `GET /webhooks` reports a switch under. A live account (19.09.2026)
 * answered `wabaTemplatesStatus` where the documentation of `PATCH /webhooks`
 * names the same switch `templateStatus`.
 */
const REPORTED_AS: Record<string, string[]> = {
	templateStatus: ['templateStatus', 'wabaTemplatesStatus'],
};

/**
 * The switches as Wazzup reports them, under the names `PATCH /webhooks` takes —
 * what is needed to put another integration's settings back as they were.
 */
export function reportedSubscriptions(reported: unknown): IDataObject {
	const current = (
		reported !== null && typeof reported === 'object' ? reported : {}
	) as IDataObject;
	return Object.fromEntries(
		SUBSCRIPTIONS.map((name) => [
			name,
			(REPORTED_AS[name] ?? [name]).some((alias) => isOn(current[alias])),
		]),
	);
}

/** Whether the switches Wazzup reports are exactly the ones wanted. */
export function sameSubscriptions(reported: unknown, wanted: IDataObject): boolean {
	const current = reportedSubscriptions(reported);
	return SUBSCRIPTIONS.every((name) => current[name] === isOn(wanted[name]));
}

function list(value: unknown): IDataObject[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry) => entry !== null && typeof entry === 'object') as IDataObject[];
}

function object(value: unknown): IDataObject | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as IDataObject)
		: undefined;
}

/**
 * Which event a message entry is. A deletion and an edit arrive as messages with
 * isDeleted or isEdited set; otherwise isEcho tells an outgoing message from an
 * incoming one.
 */
function messageEvent(message: IDataObject): string {
	if (isOn(message.isDeleted)) return 'messageDeleted';
	if (isOn(message.isEdited)) return 'messageEdited';
	return isOn(message.isEcho) ? 'outgoingMessage' : 'incomingMessage';
}

/**
 * Every event of one delivery, each as `{ event, ...fields }`.
 *
 * One delivery may carry messages and statuses together, several of each; a
 * creation request or a template status comes alone.
 */
export function collectEvents(body: IDataObject): IDataObject[] {
	const events: IDataObject[] = [];

	for (const message of list(body.messages))
		events.push({ event: messageEvent(message), ...message });
	for (const status of list(body.statuses)) events.push({ event: 'messageStatus', ...status });

	const createContact = object(body.createContact);
	if (createContact !== undefined) events.push({ event: 'createContact', ...createContact });

	const createDeal = object(body.createDeal);
	if (createDeal !== undefined) events.push({ event: 'createDeal', ...createDeal });

	for (const update of list(body.channelsUpdates))
		events.push({ event: 'channelUpdate', ...update });

	const templateStatus = object(body.templateStatus);
	if (templateStatus !== undefined) events.push({ event: 'templateStatus', ...templateStatus });

	return events;
}

export function isCreationRequest(event: IDataObject): boolean {
	return event.event === 'createContact' || event.event === 'createDeal';
}
