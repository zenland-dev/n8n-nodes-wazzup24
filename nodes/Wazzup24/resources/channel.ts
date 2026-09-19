import type { IDataObject } from 'n8n-workflow';

import { CHANNEL_STATE_OPTIONS, TRANSPORT_OPTIONS } from '../../../shared/chat';
import { returnAllProperties, take, wantedRows } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { asList, wazzupRequest } from '../../../shared/transport';

export const channelResource: Resource = {
	value: 'channel',
	name: 'Channel',
	description: 'Messenger accounts connected to Wazzup: WhatsApp numbers, bots, groups',
	operations: [
		{
			value: 'getAll',
			name: 'Get Many',
			action: 'Get many channels',
			description:
				'Get the channels of the account with their ID, type, number or username and state, for example to find the channel to send from, or to spot one that needs its QR code scanned',
			properties: [
				...returnAllProperties('channels'),
				{
					displayName: 'Filters',
					name: 'filters',
					type: 'collection',
					placeholder: 'Add Filter',
					default: {},
					options: [
						{
							displayName: 'State',
							name: 'state',
							type: 'multiOptions',
							default: [],
							options: CHANNEL_STATE_OPTIONS,
							description: 'Only channels in one of these states',
						},
						{
							displayName: 'Type',
							name: 'transport',
							type: 'multiOptions',
							default: [],
							options: TRANSPORT_OPTIONS,
							description: 'Only channels of these types',
						},
					],
				},
			],
			async execute(itemIndex) {
				const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
				const states = (filters.state ?? []) as string[];
				const transports = (filters.transport ?? []) as string[];

				const channels = asList(
					await wazzupRequest.call(this, 'GET', '/channels', { itemIndex }),
				).filter(
					(channel) =>
						(states.length === 0 || states.includes(String(channel.state))) &&
						(transports.length === 0 || transports.includes(String(channel.transport))),
				);

				return take(channels, wantedRows(this, itemIndex));
			},
		},
	],
};
