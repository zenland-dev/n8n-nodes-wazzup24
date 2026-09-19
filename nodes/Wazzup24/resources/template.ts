import type { IDataObject } from 'n8n-workflow';

import { returnAllProperties, take, wantedRows } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { fetchTemplates } from '../templates';

/**
 * Moderation statuses. The API answers them in lower case ("approved"); the filter
 * compares without case. ARCHIVED is not in the documentation; a live account
 * (19.09.2026) has templates in it.
 */
const STATUS_OPTIONS = [
	{ name: 'Approved', value: 'APPROVED', description: 'Approved by Meta and ready to send' },
	{ name: 'Archived', value: 'ARCHIVED', description: 'Archived in Wazzup' },
	{ name: 'Disabled', value: 'DISABLED', description: 'Blocked after complaints' },
	{ name: 'Paused', value: 'PAUSED', description: 'Under review by Meta after complaints' },
	{ name: 'Pending', value: 'PENDING', description: 'Waiting for Meta’s review' },
	{ name: 'Rejected', value: 'REJECTED', description: 'Rejected by Meta' },
];

export const templateResource: Resource = {
	value: 'template',
	name: 'WABA Template',
	description: 'WhatsApp Business API templates added in Wazzup',
	operations: [
		{
			value: 'getAll',
			name: 'Get Many',
			action: 'Get many WABA templates',
			description:
				'Get the WABA templates of the account with their ID, title, language, status and components (the text, header, footer and buttons)',
			properties: [
				...returnAllProperties('templates'),
				{
					displayName: 'Filters',
					name: 'filters',
					type: 'collection',
					placeholder: 'Add Filter',
					default: {},
					options: [
						{
							displayName: 'Channel Name or ID',
							name: 'channelId',
							type: 'options',
							typeOptions: { loadOptionsMethod: 'getChannels' },
							default: '',
							description:
								'Only templates bound to this channel. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
						},
						{
							displayName: 'Search',
							name: 'search',
							type: 'string',
							default: '',
							description:
								'Only templates whose title or Meta name contains this text, in any case',
						},
						{
							displayName: 'Status',
							name: 'status',
							type: 'multiOptions',
							default: [],
							options: STATUS_OPTIONS,
							description: 'Only templates with one of these moderation statuses',
						},
					],
				},
			],
			async execute(itemIndex) {
				const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
				const channelId = String(filters.channelId ?? '').trim();
				const search = String(filters.search ?? '')
					.trim()
					.toLowerCase();
				const statuses = ((filters.status ?? []) as string[]).map((s) => s.toUpperCase());

				const templates = (await fetchTemplates.call(this)).filter((template) => {
					const channels = Array.isArray(template.channels)
						? (template.channels as unknown[]).map(String)
						: [];
					const title =
						`${String(template.title ?? '')} ${String(template.name ?? '')}`.toLowerCase();
					return (
						(channelId === '' || channels.includes(channelId)) &&
						(search === '' || title.includes(search)) &&
						(statuses.length === 0 ||
							statuses.includes(String(template.status ?? '').toUpperCase()))
					);
				});

				return take(templates, wantedRows(this, itemIndex));
			},
		},
	],
};
