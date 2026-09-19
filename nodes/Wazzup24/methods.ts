import type {
	IDataObject,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	ResourceMapperFields,
} from 'n8n-workflow';

import { cached, CONFIG_TTL_MS } from '../../shared/cache';
import { channelLabel, listChannels, TRANSPORT_NAMES } from '../../shared/chat';
import { componentText, listTemplates, templateLabel, templateVariables } from './templates';
import { accountKey, asList, wazzupRequest } from '../../shared/transport';

function byName(a: INodePropertyOptions, b: INodePropertyOptions): number {
	return a.name.localeCompare(b.name);
}

/** A parameter of the node being edited, or '' when it is empty or an expression. */
function currentValue(ctx: ILoadOptionsFunctions, name: string): string {
	const value = String(ctx.getCurrentNodeParameter(name) ?? '').trim();
	return value.startsWith('=') ? '' : value;
}

function shorten(value: string, length: number): string {
	const flat = value.replace(/\s+/g, ' ').trim();
	return flat.length > length ? `${flat.slice(0, length)}…` : flat;
}

export const loadOptions = {
	async getChannels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		return (await listChannels.call(this))
			.map((channel) => ({
				name: channelLabel(channel),
				value: String(channel.channelId),
				description: `${TRANSPORT_NAMES[String(channel.transport)] ?? String(channel.transport)} channel ${String(channel.channelId)}`,
			}))
			.sort(byName);
	},

	async getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const channelId = currentValue(this, 'channelId');

		return (await listTemplates.call(this))
			.filter((template) => {
				if (channelId === '') return true;
				const channels = Array.isArray(template.channels)
					? (template.channels as unknown[]).map(String)
					: [];
				return channels.length === 0 || channels.includes(channelId);
			})
			.map((template) => ({
				name: templateLabel(template),
				value: String(template.templateGuid),
				description: shorten(componentText(template, 'BODY'), 150) || undefined,
			}))
			.sort(byName);
	},

	async getUsers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const key = await accountKey.call(this);
		const users = await cached(
			`users:${key}`,
			async () => asList(await wazzupRequest.call(this, 'GET', '/users')),
			CONFIG_TTL_MS,
		);
		return users
			.map((user: IDataObject) => ({
				name: String(user.name ?? user.id),
				value: String(user.id),
				description: `ID ${String(user.id)}`,
			}))
			.sort(byName);
	},
};

export const resourceMapping = {
	/** One field per variable of the chosen WABA template, in sending order. */
	async getTemplateVariables(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
		const templateId = currentValue(this, 'templateId');
		if (templateId === '') {
			return {
				fields: [],
				emptyFieldsNotice:
					'Pick a template from the list to see its variables. For a template chosen by an expression, give the values under Options → Template Values.',
			};
		}

		const template = (await listTemplates.call(this)).find(
			(t) => String(t.templateGuid) === templateId,
		);
		if (template === undefined) {
			return {
				fields: [],
				emptyFieldsNotice: 'This template is not in the account any more. Pick another one.',
			};
		}

		const variables = templateVariables(template);
		if (variables.length === 0) {
			return {
				fields: [],
				emptyFieldsNotice: 'This template has no variables; it is sent as it is.',
			};
		}

		return {
			fields: variables.map((variable) => ({
				id: variable.id,
				displayName: variable.label,
				required: true,
				defaultMatch: false,
				canBeUsedToMatch: false,
				display: true,
				type: 'string',
			})),
		};
	},
};
