import type { IDataObject } from 'n8n-workflow';

import { cached, CONFIG_TTL_MS } from '../../shared/cache';
import type { WazzupContext } from '../../shared/transport';
import { accountKey, asList, wazzupRequest } from '../../shared/transport';

/** Page size of `GET /templates/whatsapp`. 100 is Wazzup's own default. */
const TEMPLATE_PAGE_SIZE = 100;

/** A safety stop: no account needs more than 50 pages of templates. */
const MAX_TEMPLATE_PAGES = 50;

/** Every WABA template of the account, page by page. */
export async function fetchTemplates(this: WazzupContext): Promise<IDataObject[]> {
	const templates: IDataObject[] = [];

	for (let page = 0; page < MAX_TEMPLATE_PAGES; page++) {
		const body = await wazzupRequest.call(this, 'GET', '/templates/whatsapp', {
			qs: { limit: TEMPLATE_PAGE_SIZE, offset: page * TEMPLATE_PAGE_SIZE },
		});
		const rows = asList(body);
		templates.push(...rows);
		if (rows.length < TEMPLATE_PAGE_SIZE) break;
	}

	return templates;
}

/** The same list, shared for a short while per key, for dropdowns and the mapper. */
export async function listTemplates(this: WazzupContext): Promise<IDataObject[]> {
	const key = await accountKey.call(this);
	return await cached(
		`templates:${key}`,
		async () => await fetchTemplates.call(this),
		CONFIG_TTL_MS,
	);
}

/** How a template reads in a dropdown: its Wazzup title, language and, unless approved, status. */
export function templateLabel(template: IDataObject): string {
	const title = String(template.title ?? '').trim() || String(template.name ?? '').trim();
	const language = String(template.language ?? '').trim();
	const status = String(template.status ?? '').trim();
	const approved = status === '' || status.toUpperCase() === 'APPROVED';
	return `${title || String(template.templateGuid)}${language ? ` (${language})` : ''}${approved ? '' : ` — ${status}`}`;
}

/** The text of a template component, e.g. its BODY; '' when the template has none. */
export function componentText(template: IDataObject, type: string): string {
	const components = Array.isArray(template.components)
		? (template.components as IDataObject[])
		: [];
	const component = components.find((c) => String(c.type ?? '').toUpperCase() === type);
	return String(component?.text ?? '');
}

/** One variable of a WABA template, in the order Wazzup expects `templateValues`. */
export interface TemplateVariable {
	/** Key of the mapper field: v1, v2, … in sending order. */
	id: string;
	/** What the mapper shows. */
	label: string;
}

/** Placeholders of one text in order of first appearance: {{1}}, {{2}} or named ones. */
function placeholders(value: string): string[] {
	const found: string[] = [];
	for (const match of value.matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)) {
		if (!found.includes(match[1])) found.push(match[1]);
	}
	return found;
}

/** Example values Meta keeps per component: header_text: [a], body_text: [[a, b]]. */
function examples(component: IDataObject | undefined): string[] {
	const example = component?.example;
	if (example === undefined || example === null || typeof example !== 'object') return [];

	const values = Object.values(example as IDataObject).flat(2);
	return values.map((v) => String(v ?? ''));
}

function withExample(label: string, example: string | undefined): string {
	const sample = (example ?? '').trim();
	if (sample === '') return label;
	return `${label} — e.g. ${sample.length > 40 ? `${sample.slice(0, 40)}…` : sample}`;
}

/**
 * The variables of a WABA template, in the order `templateValues` fills them.
 *
 * Wazzup's own answer is `templateCode` — the text form of the template, e.g.
 * `@template: <id> { [[headerVar1]]; [[bodyVar1]] }` — which lists every variable
 * in sending order, media headers included. That is used whenever it is there.
 * Without it the order is rebuilt the way Meta counts: header placeholders
 * first, then the body, then URL buttons.
 */
export function templateVariables(template: IDataObject): TemplateVariable[] {
	const components = Array.isArray(template.components)
		? (template.components as IDataObject[])
		: [];
	const byType = (type: string) =>
		components.find((c) => String(c.type ?? '').toUpperCase() === type);

	const header = byType('HEADER');
	const body = byType('BODY');
	const headerExamples = examples(header);
	const bodyExamples = examples(body);

	const code = String(template.templateCode ?? '');
	const inner = code.match(/\{([\s\S]*)\}\s*$/)?.[1] ?? '';
	const names = [...inner.matchAll(/\[\[([\s\S]*?)\]\]/g)].map((m) => m[1].trim());

	if (names.length > 0) {
		let headerIndex = 0;
		let bodyIndex = 0;
		return names.map((name, index) => {
			let example: string | undefined;
			if (/^header/i.test(name)) example = headerExamples[headerIndex++];
			else if (/^body/i.test(name)) example = bodyExamples[bodyIndex++];
			return { id: `v${index + 1}`, label: withExample(`${index + 1}. ${name}`, example) };
		});
	}

	const variables: TemplateVariable[] = [];
	const push = (label: string, example?: string) =>
		variables.push({
			id: `v${variables.length + 1}`,
			label: withExample(`${variables.length + 1}. ${label}`, example),
		});

	if (String(header?.format ?? 'TEXT').toUpperCase() === 'TEXT') {
		placeholders(String(header?.text ?? '')).forEach((p, i) =>
			push(`Header {{${p}}}`, headerExamples[i]),
		);
	}
	placeholders(String(body?.text ?? '')).forEach((p, i) => push(`Body {{${p}}}`, bodyExamples[i]));

	const buttons = byType('BUTTONS');
	const buttonList = Array.isArray(buttons?.buttons) ? (buttons?.buttons as IDataObject[]) : [];
	for (const button of buttonList) {
		for (const p of placeholders(String(button.url ?? ''))) {
			push(`Button "${String(button.text ?? '')}" URL {{${p}}}`);
		}
	}

	return variables;
}
