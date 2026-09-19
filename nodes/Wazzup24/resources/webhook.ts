import type { IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { requiredText } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { wazzupRequest } from '../../../shared/transport';

export const webhookResource: Resource = {
	value: 'webhook',
	name: 'Webhook Settings',
	description: 'Where Wazzup sends its webhooks, and which ones',
	operations: [
		{
			value: 'get',
			name: 'Get',
			action: 'Get the webhook settings',
			description: 'Get the address Wazzup sends webhooks to and which kinds are switched on',
			async execute(itemIndex) {
				return (await wazzupRequest.call(this, 'GET', '/webhooks', { itemIndex })) as IDataObject;
			},
		},
		{
			value: 'set',
			name: 'Set',
			action: 'Set the webhook settings',
			description:
				'Point Wazzup’s webhooks at an address and choose which kinds it sends. It replaces the address the account had: there is only one.',
			properties: [
				{
					displayName:
						'An account has one webhook address. Setting it here takes the webhooks away from whatever received them before, including a Wazzup24 Trigger. Wazzup first sends {"test": true} to the new address and refuses it unless the answer is 200.',
					name: 'setNotice',
					type: 'notice',
					default: '',
				},
				{
					displayName: 'Webhook URL',
					name: 'webhooksUri',
					type: 'string',
					required: true,
					default: '',
					placeholder: 'https://example.com/wazzup',
					description: 'Up to 200 characters; a query string is kept',
				},
				{
					displayName: 'Messages and Statuses',
					name: 'messagesAndStatuses',
					type: 'boolean',
					default: true,
					description:
						'Whether to send new, edited and deleted messages and the status changes of outgoing ones',
				},
				{
					displayName: 'Contact and Deal Creation',
					name: 'contactsAndDealsCreation',
					type: 'boolean',
					default: false,
					description: 'Whether to ask the CRM to create a contact or a deal for a new client',
				},
				{
					displayName: 'Channel Updates',
					name: 'channelsUpdates',
					type: 'boolean',
					default: false,
					description: 'Whether to send changes of channel state, and WABA tier changes',
				},
				{
					displayName: 'Template Status',
					name: 'templateStatus',
					type: 'boolean',
					default: false,
					description: 'Whether to send changes of the moderation status of WABA templates',
				},
			],
			async execute(itemIndex) {
				const webhooksUri = requiredText(this, 'webhooksUri', itemIndex, 'Webhook URL');
				if (!/^https?:\/\//i.test(webhooksUri)) {
					throw new NodeOperationError(
						this.getNode(),
						'Webhook URL must start with https:// or http://',
						{
							itemIndex,
						},
					);
				}

				const subscriptions: IDataObject = {};
				for (const name of [
					'messagesAndStatuses',
					'contactsAndDealsCreation',
					'channelsUpdates',
					'templateStatus',
				]) {
					subscriptions[name] = this.getNodeParameter(name, itemIndex, false) as boolean;
				}

				const response = await wazzupRequest.call(this, 'PATCH', '/webhooks', {
					body: { webhooksUri, subscriptions },
					itemIndex,
				});
				return {
					success: true,
					webhooksUri,
					subscriptions,
					...(response !== null && typeof response === 'object' && !Array.isArray(response)
						? (response as IDataObject)
						: {}),
				};
			},
		},
	],
};
