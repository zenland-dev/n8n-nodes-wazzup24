import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * The one host Wazzup serves its API on.
 *
 * Every account of every customer is reached at this address and told apart by
 * the key alone, so the credential has no address field at all. There is
 * nothing to type, and therefore nothing that could point the key at another
 * server. The documentation names no second host and no regional one.
 */
export const API_ORIGIN = 'https://api.wazzup24.com';

/** The API version every documented route lives under. */
export const API_VERSION_PATH = '/v3';

/**
 * The key as it is sent, as an n8n expression. Whitespace from a careless copy
 * and a pasted "Bearer " prefix are dropped, so a key copied together with the
 * header name from the Wazzup documentation still works.
 */
const KEY_EXPRESSION = 'String($credentials.apiKey || "").trim().replace(/^Bearer\\s+/i, "")';

/** The same normalisation in plain TypeScript, for the transport and the trigger. */
export function normalizeApiKey(raw: unknown): string {
	return String(raw ?? '')
		.trim()
		.replace(/^Bearer\s+/i, '');
}

export class Wazzup24Api implements ICredentialType {
	name = 'wazzup24Api';

	displayName = 'Wazzup24 API';

	documentationUrl = 'https://wazzup24.ru/help/api-ru/avtorizaciya/';

	icon: Icon = { light: 'file:../icons/wazzup24.svg', dark: 'file:../icons/wazzup24.dark.svg' };

	properties: INodeProperties[] = [
		{
			displayName:
				'The key is in Wazzup under Integrations → More → API. Not every key opens every route: some reach only channels, sending messages, webhook settings and WABA templates, and answer 403 to contacts, deals, users, pipelines and the chat window. Wazzup documents that limit for the sidecar key of its own amoCRM and Bitrix24 integrations.',
			name: 'keyNotice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: '33a817cbc1504bd5885574d8f0290cd3',
			description:
				'The API key of the Wazzup account. It acts for the whole account, so treat it as an account-wide secret.',
		},
		{
			displayName: 'Requests per 5 Seconds',
			name: 'requestsPerFiveSeconds',
			type: 'number',
			typeOptions: { minValue: 1 },
			default: 400,
			description:
				'How many calls these nodes may make with this key in any five seconds. Wazzup allows 500 per key and answers 429 above that. The count is kept inside one n8n process: with several queue-mode workers or instances on the same key, divide the limit between them. If Wazzup support raises the limit for the account, enter the new figure.',
		},
		{
			// n8n injects this field into every credential with an `authenticate` block,
			// defaulting to "all" — enough for anyone who can edit a workflow to pick
			// this credential in an HTTP Request node, type any URL and have n8n attach
			// the key to it. Declaring it here skips the injection, so there is no
			// switch to flip. The nodes' own calls go through
			// httpRequestWithAuthentication, which never reads it.
			displayName: 'Allowed HTTP Request Domains',
			name: 'allowedHttpRequestDomains',
			type: 'hidden',
			default: 'none',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: `=Bearer {{ ${KEY_EXPRESSION} }}`,
			},
		},
	};

	/**
	 * `GET /v3/channels` is the one route open to both kinds of key, and it
	 * answers an account without channels with an empty list rather than an
	 * error.
	 */
	test: ICredentialTestRequest = {
		request: {
			baseURL: `${API_ORIGIN}${API_VERSION_PATH}`,
			url: '/channels',
			method: 'GET',
		},
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 401,
					message:
						'Wazzup did not accept the key. Copy it again from Integration with CRM in the Wazzup account; a key stops working when that integration is switched off or connected anew.',
				},
			},
			{
				type: 'responseCode',
				properties: {
					value: 429,
					message:
						'Wazzup refused the test for the rate limit (500 requests in 5 seconds per key). Wait a few seconds and test again.',
				},
			},
		],
	};
}
