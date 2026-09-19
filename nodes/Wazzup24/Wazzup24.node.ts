import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import type { Resource } from '../../shared/spec';
import { buildProperties, executeResources } from '../../shared/spec';
import { CREDENTIAL } from '../../shared/transport';
import { loadOptions, resourceMapping } from './methods';
import { channelResource } from './resources/channel';
import { chatWindowResource } from './resources/chatWindow';
import { contactResource } from './resources/contact';
import { customRequestResource } from './resources/customRequest';
import { dealResource } from './resources/deal';
import { messageResource } from './resources/message';
import { pipelineResource } from './resources/pipeline';
import { templateResource } from './resources/template';
import { userResource } from './resources/user';
import { webhookResource } from './resources/webhook';

const resources: Resource[] = [
	messageResource,
	channelResource,
	templateResource,
	contactResource,
	dealResource,
	userResource,
	pipelineResource,
	chatWindowResource,
	webhookResource,
	customRequestResource,
];

export class Wazzup24 implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Wazzup24',
		name: 'wazzup24',
		icon: { light: 'file:../../icons/wazzup24.svg', dark: 'file:../../icons/wazzup24.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description:
			'Send messages through Wazzup to WhatsApp, WABA, Telegram, MAX, Viber, VK, Avito and Instagram, and keep its contacts, deals and users in step with your CRM',
		defaults: { name: 'Wazzup24' },
		usableAsTool: true,
		builderHint: {
			searchHint:
				'Wazzup (wazzup24) connects WhatsApp numbers, WABA, Telegram accounts and bots, MAX, Viber, VK, Avito and Instagram as channels. Message → Send needs a channel ID from Channel → Get Many and a chat ID: for WhatsApp and Viber the phone number in digits, for other messengers the chatId from a webhook; Telegram and MAX also accept a phone number, Telegram a username. Chat Type Automatic takes the messenger from the channel. On WABA only an approved template may start a conversation or reopen it after 24 hours; its variables are filled in order. Sending is not idempotent: set CRM Message ID to make a retry safe. Contacts, deals and users are upserted by your own IDs, 100 per request. A sidecar key opens only channels, sending, webhooks and templates. 500 requests per 5 seconds per key.',
			relatedNodes: [
				{
					nodeType: '@zenland-dev/n8n-nodes-wazzup24.wazzup24Trigger',
					relationHint:
						'Starts a workflow on incoming messages, statuses and requests to create a contact or deal',
				},
			],
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: CREDENTIAL, required: true }],
		properties: buildProperties(resources, 'message'),
	};

	methods = { loadOptions, resourceMapping };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await executeResources.call(this, resources);
	}
}
