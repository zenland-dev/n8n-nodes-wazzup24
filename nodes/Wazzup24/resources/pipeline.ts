import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { asNodeError } from '../../../shared/errors';
import { jsonParameter, requiredText } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { errorItem } from '../../../shared/spec';
import { asList, wazzupRequest } from '../../../shared/transport';

function buildPipelines(this: IExecuteFunctions, itemIndex: number): IDataObject[] {
	const source = this.getNodeParameter('source', itemIndex, 'fields') as string;

	if (source === 'json') {
		const value = jsonParameter<IDataObject | IDataObject[]>(
			this,
			'pipelinesJson',
			itemIndex,
			[],
			'Pipelines (JSON)',
		);
		return Array.isArray(value) ? value : [value];
	}

	const stagesUi = this.getNodeParameter('stages', itemIndex, {}) as IDataObject;
	const stages = ((stagesUi.stage ?? []) as IDataObject[])
		.filter((s) => String(s.id ?? '').trim() !== '')
		.map((s) => ({ id: String(s.id).trim(), name: String(s.name ?? '').trim() }));

	const pipeline: IDataObject = {
		id: requiredText(this, 'pipelineId', itemIndex, 'Pipeline ID'),
		name: requiredText(this, 'pipelineName', itemIndex, 'Pipeline Name'),
	};
	// Wazzup rejects an empty `stages` array; a pipeline without stages sends none.
	if (stages.length > 0) pipeline.stages = stages;
	return [pipeline];
}

/**
 * Collects the pipelines of every input item and sends them in one request.
 *
 * One request rather than one per item because the documentation describes the
 * route as loading the pipelines of the CRM, and does not say whether pipelines
 * left out of a later request survive it. Sending them together is correct
 * either way.
 */
async function upload(this: IExecuteFunctions): Promise<INodeExecutionData[]> {
	const items = this.getInputData();
	const pipelines: IDataObject[] = [];
	const failed: INodeExecutionData[] = [];
	const sent: number[] = [];

	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		try {
			pipelines.push(...buildPipelines.call(this, itemIndex));
			sent.push(itemIndex);
		} catch (error) {
			if (!this.continueOnFail()) throw asNodeError(this.getNode(), error, itemIndex);
			failed.push(errorItem(error, itemIndex));
		}
	}

	if (pipelines.length === 0) {
		if (failed.length > 0) return failed;
		throw new NodeOperationError(this.getNode(), 'No pipelines to upload');
	}

	try {
		await wazzupRequest.call(this, 'POST', '/pipelines', { body: pipelines, itemIndex: sent[0] });
	} catch (error) {
		if (!this.continueOnFail()) throw asNodeError(this.getNode(), error, sent[0]);
		return [...failed, ...sent.map((itemIndex) => errorItem(error, itemIndex))];
	}

	return [
		...failed,
		{
			json: { success: true, pipelines },
			pairedItem: sent.map((item) => ({ item })),
		},
	];
}

export const pipelineResource: Resource = {
	value: 'pipeline',
	name: 'Pipeline',
	description: 'Sales pipelines of your CRM, where Wazzup creates deals for new clients',
	operations: [
		{
			value: 'getAll',
			name: 'Get Many',
			action: 'Get many pipelines',
			description: 'Get the pipelines and stages loaded into Wazzup',
			async execute(itemIndex) {
				return asList(await wazzupRequest.call(this, 'GET', '/pipelines', { itemIndex }));
			},
		},
		{
			value: 'upload',
			name: 'Upload',
			action: 'Upload pipelines',
			description:
				'Load the pipelines and stages of your CRM into Wazzup, to pick where deals for new clients go. All input items are sent together in one request.',
			properties: [
				{
					displayName: 'Source',
					name: 'source',
					type: 'options',
					default: 'fields',
					options: [
						{
							name: 'Fields',
							value: 'fields',
							description: 'One pipeline per input item, from the fields below',
						},
						{
							name: 'JSON',
							value: 'json',
							description:
								'A pipeline object or an array of them per input item, as the Wazzup documentation shows',
						},
					],
				},
				{
					displayName: 'Pipeline ID',
					name: 'pipelineId',
					type: 'string',
					required: true,
					default: '',
					displayOptions: { show: { source: ['fields'] } },
					description: 'Your CRM’s ID of the pipeline, up to 100 characters',
				},
				{
					displayName: 'Pipeline Name',
					name: 'pipelineName',
					type: 'string',
					required: true,
					default: '',
					displayOptions: { show: { source: ['fields'] } },
					description: 'Shown in the Wazzup integration settings, up to 100 characters',
				},
				{
					displayName: 'Stages',
					name: 'stages',
					type: 'fixedCollection',
					typeOptions: { multipleValues: true, sortable: true },
					placeholder: 'Add Stage',
					default: {},
					displayOptions: { show: { source: ['fields'] } },
					description:
						'In the order of the pipeline. Leave empty when the CRM has pipelines without stages.',
					options: [
						{
							name: 'stage',
							displayName: 'Stage',
							values: [
								{
									displayName: 'Stage ID',
									name: 'id',
									type: 'string',
									default: '',
									description: 'Up to 100 characters',
								},
								{
									displayName: 'Stage Name',
									name: 'name',
									type: 'string',
									default: '',
									description: 'Up to 100 characters',
								},
							],
						},
					],
				},
				{
					displayName: 'Pipelines (JSON)',
					name: 'pipelinesJson',
					type: 'json',
					default:
						'[\n  {\n    "id": "1",\n    "name": "Sales",\n    "stages": [{ "id": "10", "name": "New" }]\n  }\n]',
					displayOptions: { show: { source: ['json'] } },
				},
			],
			executeAll: upload,
		},
	],
};
