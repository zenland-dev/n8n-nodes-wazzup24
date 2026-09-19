import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
	IDataObject,
	IHookFunctions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { normalizeApiKey } from '../../credentials/Wazzup24Api.credentials';
import { channelLabel, listChannels } from '../../shared/chat';
import { CREDENTIAL, wazzupRequest } from '../../shared/transport';
import {
	collectEvents,
	EVENT_OPTIONS,
	isCreationRequest,
	reportedSubscriptions,
	sameSubscriptions,
	subscriptionsFor,
} from './events';

/** Addresses Wazzup cannot reach from its own servers. */
const UNREACHABLE_HOST = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::|\/|$)/i;

/** The query parameter carrying the delivery secret. */
const TOKEN_PARAMETER = 'token';

type Context = IHookFunctions | IWebhookFunctions;

/** Compares two secrets without leaking their contents through timing. */
function secretMatches(expected: string, received: string): boolean {
	const a = Buffer.from(expected, 'utf8');
	const b = Buffer.from(received, 'utf8');
	if (a.length === 0 || a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

/**
 * The secret put into the webhook address.
 *
 * Wazzup signs nothing it sends to an API integration: a delivery carries no
 * header of ours, so the address is the only thing standing between the
 * workflow and anyone who learns it. The secret is derived from the key and the
 * node's webhook ID rather than stored: the test and production addresses of
 * one node share it, which is how the node recognises its own address in either
 * form, and nothing has to survive between activation and delivery.
 */
async function deliveryToken(this: Context): Promise<string> {
	const credentials = await this.getCredentials(CREDENTIAL);
	const node = this.getNode();
	return createHmac('sha256', normalizeApiKey(credentials.apiKey))
		.update(`wazzup24-trigger:${node.webhookId ?? node.id}`)
		.digest('hex')
		.slice(0, 32);
}

function tokenOf(url: string): string {
	try {
		return new URL(url).searchParams.get(TOKEN_PARAMETER) ?? '';
	} catch {
		return '';
	}
}

/** An address without its query string, safe to show: another integration's secret may sit in it. */
function withoutQuery(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.origin}${parsed.pathname}`;
	} catch {
		return url.split('?')[0];
	}
}

/** The address Wazzup is told to post to: this node's URL with the secret added. */
async function destination(this: IHookFunctions): Promise<string> {
	const url = this.getNodeWebhookUrl('default');

	if (url === undefined || url === '') {
		throw new NodeOperationError(this.getNode(), 'This node has no webhook URL yet', {
			description: 'Save the workflow, then activate it so n8n can give Wazzup an address.',
		});
	}

	if (UNREACHABLE_HOST.test(url)) {
		throw new NodeOperationError(this.getNode(), `Wazzup cannot reach ${url}`, {
			description:
				'Webhooks come from Wazzup’s servers, so this n8n instance needs an address reachable from the internet. Set WEBHOOK_URL to the public address, or put a tunnel in front of n8n.',
		});
	}

	const parsed = new URL(url);
	parsed.searchParams.set(TOKEN_PARAMETER, await deliveryToken.call(this));
	return parsed.toString();
}

async function readSettings(this: IHookFunctions): Promise<IDataObject> {
	const body = await wazzupRequest.call(this, 'GET', '/webhooks');
	return body !== null && typeof body === 'object' && !Array.isArray(body)
		? (body as IDataObject)
		: {};
}

function selectedEvents(this: IHookFunctions | IWebhookFunctions): string[] {
	return (this.getNodeParameter('events', []) as string[]) ?? [];
}

function registersItself(this: IHookFunctions | IWebhookFunctions): boolean {
	return this.getNodeParameter('registration', 'automatic') === 'automatic';
}

export class Wazzup24Trigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Wazzup24 Trigger',
		name: 'wazzup24Trigger',
		icon: { light: 'file:../../icons/wazzup24.svg', dark: 'file:../../icons/wazzup24.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{ $parameter["events"].join(", ") }}',
		description:
			'Starts a workflow when a message comes in or goes out through Wazzup, changes status, or when Wazzup asks to create a contact or deal',
		defaults: { name: 'Wazzup24 Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: CREDENTIAL, required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				// Wazzup waits 30 seconds for an answer. Messages and statuses are answered on
				// receipt. Creation requests can instead wait for the workflow, whose last node
				// then hands Wazzup the contact or deal it created; the node answers every
				// other delivery itself even then, so a slow workflow never delays them.
				responseMode:
					'={{ ($parameter["options"] || {})["creationResponse"] === "lastNode" ? "lastNode" : "onReceived" }}',
				responseData: 'firstEntryJson',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'Wazzup sends all webhooks of an account to one address. On Automatic this node sets it to its own when the workflow is activated, and also while you listen for a test event; the active workflow gets nothing until the test ends.',
				name: 'addressNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: ['incomingMessage'],
				options: EVENT_OPTIONS,
				description:
					'What starts the workflow. Wazzup is subscribed to exactly the kinds these need.',
			},
			{
				displayName: 'Registration',
				name: 'registration',
				type: 'options',
				noDataExpression: true,
				default: 'automatic',
				options: [
					{
						name: 'Automatic',
						value: 'automatic',
						description:
							'Set Wazzup’s webhook address and switches when the workflow is activated, put the previous address back when it is deactivated, and refuse deliveries that lack the secret in the address',
					},
					{
						name: 'Manual',
						value: 'manual',
						description:
							'Leave Wazzup’s settings alone. You point Wazzup at this node yourself; deliveries are not checked for a secret.',
					},
				],
			},
			{
				displayName: 'Take Over the Webhook Address',
				name: 'takeOver',
				type: 'boolean',
				default: false,
				displayOptions: { show: { registration: ['automatic'] } },
				description:
					'Whether to replace an address that belongs to something else: another integration, a Make scenario, another workflow. Off, activation stops with an error naming that address. On, the address is replaced now and put back when this workflow is deactivated.',
			},
			{
				displayName:
					'Copy the Production URL above into Wazzup yourself, for example with the Webhook Settings → Set operation of the Wazzup24 node, and switch on the subscriptions the selected events need. Wazzup checks the address with {"test": true}; this node answers it.',
				name: 'manualNotice',
				type: 'notice',
				default: '',
				displayOptions: { show: { registration: ['manual'] } },
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Channel Names or IDs',
						name: 'channelIds',
						type: 'multiOptions',
						typeOptions: { loadOptionsMethod: 'getChannels' },
						default: [],
						description:
							'Only messages and channel changes of these channels. Statuses, creation requests and template changes name no channel and always pass. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
					{
						displayName: 'Respond to Creation Requests',
						name: 'creationResponse',
						type: 'options',
						default: 'immediately',
						options: [
							{
								name: 'Immediately',
								value: 'immediately',
								description:
									'Answer 200 at once; load the new contact or deal with the Wazzup24 node afterwards',
							},
							{
								name: 'With the Last Node’s Data',
								value: 'lastNode',
								description:
									'Wait for the workflow and answer with the first item of the last node: the contact or deal as the Contact and Deal operations shape it. Wazzup gives up after 30 seconds.',
							},
						],
						description: 'How to answer Contact Creation Requested and Deal Creation Requested',
					},
					{
						displayName: 'Split Into Items',
						name: 'splitIntoItems',
						type: 'boolean',
						default: true,
						description:
							'Whether to emit one item per message, status or change. Off, a delivery is one item with the list of events and the body as Wazzup sent it.',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getChannels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return (await listChannels.call(this))
					.map((channel) => ({ name: channelLabel(channel), value: String(channel.channelId) }))
					.sort((a, b) => a.name.localeCompare(b.name));
			},
		},
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				// On Manual there is nothing to register, and n8n must not try.
				if (!registersItself.call(this)) return true;

				const settings = await readSettings.call(this);
				return (
					settings.webhooksUri === (await destination.call(this)) &&
					sameSubscriptions(settings.subscriptions, subscriptionsFor(selectedEvents.call(this)))
				);
			},

			async create(this: IHookFunctions): Promise<boolean> {
				if (!registersItself.call(this)) return true;

				const events = selectedEvents.call(this);
				if (events.length === 0) {
					throw new NodeOperationError(this.getNode(), 'No events are selected', {
						description: 'Pick at least one entry under Events.',
					});
				}

				const staticData = this.getWorkflowStaticData('node');
				const target = await destination.call(this);
				const token = await deliveryToken.call(this);

				const settings = await readSettings.call(this);
				const current = String(settings.webhooksUri ?? '').trim();
				// Its own address is recognised by the secret, which the test and production
				// URLs share, or by the path, which survives a new API key changing the secret.
				const ours =
					current !== '' &&
					(secretMatches(token, tokenOf(current)) ||
						withoutQuery(current) === withoutQuery(target));

				// This node's own other address is the production one while a test runs, and
				// goes back when the test ends. Seen at activation it is a test address left
				// behind by an interrupted test, and is simply replaced.
				const restoreOwn = ours && this.getMode() === 'manual';

				if (current !== '' && current !== target && (!ours || restoreOwn)) {
					if (!ours && !(this.getNodeParameter('takeOver', false) as boolean)) {
						throw new NodeOperationError(
							this.getNode(),
							'Wazzup already sends webhooks to another address',
							{
								description: `The account has one webhook address, and it is ${withoutQuery(current)} now. Turn on Take Over the Webhook Address to replace it until this workflow is deactivated, or set Registration to Manual.`,
							},
						);
					}
					staticData.previous = {
						webhooksUri: current,
						subscriptions: settings.subscriptions ?? {},
					};
				} else {
					delete staticData.previous;
				}

				await wazzupRequest.call(this, 'PATCH', '/webhooks', {
					body: { webhooksUri: target, subscriptions: subscriptionsFor(events) },
				});
				staticData.registered = target;

				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				if (!registersItself.call(this)) return true;

				const staticData = this.getWorkflowStaticData('node');
				const previous = staticData.previous as IDataObject | undefined;
				delete staticData.previous;
				delete staticData.registered;

				// Deactivation must not fail over Wazzup being unreachable or the key
				// having been revoked; there is nothing to clean up then anyway.
				try {
					const settings = await readSettings.call(this);
					const current = String(settings.webhooksUri ?? '').trim();
					if (current === '' || current !== (await destination.call(this))) return true;

					if (previous !== undefined && String(previous.webhooksUri ?? '') !== '') {
						await wazzupRequest.call(this, 'PATCH', '/webhooks', {
							body: {
								webhooksUri: previous.webhooksUri,
								subscriptions: reportedSubscriptions(previous.subscriptions),
							},
							maxAttempts: 1,
						});
					} else {
						// Wazzup has no way to remove the address, so the switches are turned off.
						await wazzupRequest.call(this, 'PATCH', '/webhooks', {
							body: { webhooksUri: current, subscriptions: subscriptionsFor([]) },
							maxAttempts: 1,
						});
					}
				} catch (error) {
					// Wazzup tests the address it is given, and a previous address that no longer
					// answers 200 is refused. Deactivation goes on regardless; the log says why
					// the webhooks were left where they were.
					this.logger.warn(
						`Wazzup24 Trigger could not put the webhook settings back: ${error instanceof Error ? error.message : String(error)}`,
					);
				}

				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const response = this.getResponseObject();

		if (registersItself.call(this)) {
			const query = this.getQueryData() as IDataObject;
			if (!secretMatches(await deliveryToken.call(this), String(query[TOKEN_PARAMETER] ?? ''))) {
				response
					.status(403)
					.json({ error: 'The address lacks the secret this workflow registered.' });
				return { noWebhookResponse: true };
			}
		}

		const body = this.getBodyData();

		// Wazzup checks an address with {"test": true} before accepting it, and wants 200.
		if (body.test === true || body.test === 'true') return { webhookResponse: 'OK' };

		const events = selectedEvents.call(this);
		const options = this.getNodeParameter('options', {}) as IDataObject;
		const channelIds = (options.channelIds ?? []) as string[];

		const matched = collectEvents(body).filter(
			(event) =>
				events.includes(String(event.event)) &&
				(channelIds.length === 0 ||
					event.channelId === undefined ||
					channelIds.includes(String(event.channelId))),
		);

		// A delivery this workflow does not want is still acknowledged.
		if (matched.length === 0) return { webhookResponse: 'OK' };

		const workflowData =
			options.splitIntoItems === false
				? [[{ json: { events: [...new Set(matched.map((e) => e.event))], ...body } }]]
				: [matched.map((json) => ({ json }))];

		// With creation requests answered by the workflow, n8n waits for the last node
		// on every delivery. Only a creation request needs that; anything else is
		// answered here and now.
		if (options.creationResponse === 'lastNode' && !matched.some(isCreationRequest)) {
			response.status(200).send('OK');
			return { noWebhookResponse: true, workflowData };
		}

		return { workflowData };
	}
}
