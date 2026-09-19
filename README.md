# @zenland-dev/n8n-nodes-wazzup24

n8n community nodes for [Wazzup](https://wazzup24.com), the service that connects WhatsApp numbers,
WhatsApp Business API (WABA), Telegram accounts and bots, MAX, Viber, VK, Avito and Instagram to a
CRM. An action node with 27 operations across 10 resources, which together call every route of the
Wazzup API v3 a CRM integration uses, and a webhook trigger.

Written from scratch against the official API documentation
([wazzup24.ru/help/api-ru](https://wazzup24.ru/help/api-ru/), read on 19.09.2026). No code from any
other package.

**Status: 0.1.0.** Reading and sending ran against a live Wazzup account; the upserts and the trigger
ran only against a simulated API that answers the way the documentation describes. See
[What was checked](#what-was-checked). Where the documentation is silent, this README says so rather
than guessing.

- [Installation](#installation)
- [Credentials](#credentials)
- [Wazzup24 node](#wazzup24-node)
- [Wazzup24 Trigger](#wazzup24-trigger)
- [Rate limit](#rate-limit)
- [Not here, or not known](#not-here-or-not-known)
- [What was checked](#what-was-checked)

## Installation

In n8n: **Settings → Community Nodes → Install**, package name `@zenland-dev/n8n-nodes-wazzup24`.

For a self-hosted instance without the UI installer:

```bash
cd ~/.n8n/nodes
npm install @zenland-dev/n8n-nodes-wazzup24
```

and restart n8n.

## Credentials

**Wazzup24 API** takes one API key, from Wazzup → Integrations → More → API. A key pasted together
with `Bearer ` in front of it works too.

Not every key opens every route. Wazzup documents a *sidecar* key for accounts on its own amoCRM or
Bitrix24 integration: it reaches channels, sending messages, webhook settings and WABA templates,
and nothing else. On a live account a key taken from Integrations → More → API behaved exactly so:
contacts, deals, users, pipelines, the chat window and the unanswered counter answered `403
FORBIDDEN`. Sending through such a key works, and n8n runs alongside the CRM integration; **CRM
User ID** of a message is ignored with it, the documentation says. Contacts, deals and users need a
key without that limit.

**Requests per 5 Seconds** is how many calls the nodes may make with this key; see
[Rate limit](#rate-limit).

The API host is fixed at `https://api.wazzup24.com`: the documentation names no other, so the
credential has no address field at all. The credential cannot be picked in an HTTP Request node
either: its *Allowed HTTP Request Domains* setting is pinned to none, so the key cannot be sent to
another server by pointing a generic node at it. Use **Custom Request** of the Wazzup24 node for a
route the other operations lack.

## Wazzup24 node

| Resource | Operations | Route |
|---|---|---|
| Message | Send, Edit, Delete | `POST /v3/message`, `PATCH`/`DELETE /v3/message/{id}` |
| Channel | Get Many | `GET /v3/channels` |
| WABA Template | Get Many | `GET /v3/templates/whatsapp` |
| Contact | Create or Update, Get, Get Many, Delete, Delete Many | `/v3/contacts` |
| Deal | Create or Update, Get, Get Many, Delete, Delete Many | `/v3/deals` |
| User | Create or Update, Get, Get Many, Delete, Delete Many, Get Unanswered Count | `/v3/users`, `GET /v3/unanswered/{id}` |
| Pipeline | Get Many, Upload | `/v3/pipelines` |
| Chat Window | Get Link | `POST /v3/iframe` |
| Webhook Settings | Get, Set | `/v3/webhooks` |
| Custom Request | Request | any route |

### Sending a message

**Channel** is picked from the account's list, shown with its type and the name it has in Wazzup,
e.g. `WhatsApp: 79865784457 (Sales)` or `Telegram Bot: shop_bot`, with the state appended when a
channel is not active.

**Chat Type** defaults to **Automatic**: the node reads the channel list and takes the one-to-one chat
type of that channel. A WhatsApp or WABA number sends to `whatsapp`, a Telegram account or bot to
`telegram`, a MAX account or bot to `max`. Group chats (`whatsgroup`, `telegroup`, `maxgroup`) are
never guessed and have to be picked.

**Send To**:

- **Chat ID** is the phone number for WhatsApp and Viber. `+7 (901) 111-22-33` is sent as
  `79011112233`. For Instagram it is the account name (a leading `@` is dropped). For groups,
  Telegram, MAX, VK and Avito it is the `chatId` from a webhook or from an earlier send.
- **Phone Number** works for Telegram and MAX only, to start a chat whose ID is not known yet. The
  answer carries the `chatId` to use from then on.
- **Telegram Username**, likewise, Telegram only.

**Content** is a text, a file by URL, or a WABA template. Wazzup refuses text and a file in one
message, so the node offers one or the other. The file URL must be public and must answer without a
redirect; Wazzup downloads it the moment the request arrives, so a link that expires in a minute is
enough. Telegram sends `.mp3` and `.ogg` under 1 MB as voice notes.

Text limits from the documentation: 10,000 characters for WhatsApp, 4,096 for Telegram and MAX,
1,024 for WABA, 1,000 for Instagram, VK and Avito. The error table on the same page says 4,096 for
VK and adds 6,999 for Viber, so the node leaves the check to Wazzup.

Options:

- **Clear Unanswered Counter**, on by default, as in Wazzup. Turn it off for automatic replies:
  otherwise every auto-reply resets the counter, and the manager no longer sees that the client is
  waiting for a person.
- **CRM Message ID**. Sending is not idempotent: a repeated request is a second message. With this set,
  Wazzup refuses the same ID for 60 seconds (`REPEATED_CRM_MESSAGE_ID`). The node itself never
  repeats a send after a server error or a dropped connection, since the first one may have gone out.
- **Quote Message ID** quotes an earlier message of the same chat.
- **CRM User ID** shows a user added under **User** as the author in the Wazzup chat.

The output is Wazzup's answer, `messageId` and `chatId`, plus `channelId` and the resolved
`chatType`.

**Edit** replaces either the text or the file of a sent message, never both. **Delete** removes it.
Both work only where the messenger allows it and within a time Wazzup does not state; past it the
answer is `MESSAGES_EDITING_TIME_EXPIRED` or `MESSAGES_DELETION_TIME_EXPIRED`. A message with
buttons cannot be edited. A WABA channel allows neither: it answers
`CHANNEL_INVALID_TRANSPORT_FOR_EDITING` and `CHANNEL_INVALID_TRANSPORT_FOR_DELETION`.

### WABA templates

On a WABA channel a conversation can only be started, or reopened after 24 hours of silence, with a
template Meta approved. With **Content → WABA Template**:

- **Template** lists the templates bound to the selected channel by their Wazzup title, with the
  language and, unless approved, the status.
- **Variables** shows one field per variable of the chosen template, in the order Wazzup fills
  them. The order and the names come from the template's own `templateCode`
  (`@template: <id> { [[headerVar1]]; [[bodyVar1]] }`), with Meta's example values next to
  them. Without a `templateCode` the node counts `{{1}}` placeholders the way Meta does: header,
  then body, then URL buttons. An empty variable is refused before sending.
- **Button Payloads** attach data to the template's quick-reply buttons. The button texts belong
  to the approved template and cannot be changed. Without a payload the webhook of the answer
  carries the button text.

A template chosen by an expression has no fields to show; give the values under **Options →
Template Values** as a JSON array or a comma-separated list instead.

**WABA Template → Get Many** returns the templates with their components, filtered by channel,
status and a text in the title or Meta name.

### Buttons

For a text message, **Buttons** picks a layout; each fits one kind of channel:

| Layout | Channel | Buttons |
|---|---|---|
| WABA Quick Reply Buttons | WABA, inside the 24-hour window | up to 10, 20 characters each, optional payload |
| Telegram Bot Inline Keyboard | Telegram bot | in rows, each with a URL or callback data (1–64 bytes) |
| Telegram Bot Reply Keyboard | Telegram bot | in rows, text only; optional one-time |
| Remove Telegram Bot Keyboard | Telegram bot | takes away an earlier reply keyboard |
| MAX Bot Buttons | MAX bot | in rows: callback with a payload, link with a URL, message; intent default, positive or negative |
| JSON | any | a `buttonsObject` as the documentation writes it, sent unchanged |

Buttons with the same **Row** number sit side by side. Without a payload, the webhook of the
answer to a WABA interactive message carries the number of the button, counted from 0.

### Contacts, deals and users

These tell Wazzup who the employees are, which of them owns which client, and which deals a client
has. That decides who sees which dialogue in the Wazzup chats.

**Create or Update** matches by *your* ID: a new ID is added, an existing one updated. All input
items go out together, 100 per request, which is Wazzup's limit; 2,000 contacts are 20 calls. If
Wazzup rejects a request, it rejects all of it, so every item of those 100 fails together. For
`INVALID_CONTACTS_DATA` and `INVALID_USERS_DATA` the error names the input item Wazzup objected
to. Two items with the same ID in one request make Wazzup answer 500, so the last of them is
sent.

- A contact needs a responsible user and at least one chat: messenger and chat ID, and for Telegram
  or MAX optionally a phone or username instead. **Link in CRM** adds a button to the contact in
  the Deals list of the Wazzup chat.
- A deal needs a responsible user, the IDs of its contacts, a link to it in the CRM, and
  **Closed**.
- A user needs an ID and a name. The phone number is only for the Wazzup mobile app; two users
  cannot share one (`DUPLICATE_PHONE_NUMBER`), and the account holds at most 1,000 users.

**Get Many** of contacts and deals reads Wazzup's pages of 100 (sorted by ID) until they run out
or **Limit** is reached. **Delete Many** takes a list of IDs and returns the ones Wazzup did not
know as `notFound`. Deleting a contact leaves its dialogue in the shared chats.

**User → Get Unanswered Count** returns how many client messages of the last 7 days wait for the
user, whether they are red (the user is responsible) or grey (the user only supervises), and when
the last one came. A user without a role in the integration settings always reads 0.

### Pipelines

**Upload** sends the pipelines and stages of the CRM, from which Wazzup's integration settings pick
where deals for new clients are created. All input items go out in one request, one pipeline per
item from the fields or any number of them as JSON. A pipeline without stages sends no `stages`,
because Wazzup rejects an empty list.

### Chat window

**Get Link** returns the address of the Wazzup chat window for one employee, all their chats or
only those of one contact, for an iframe (with `allow="microphone *; clipboard-write *"`, as
Wazzup asks) or a new tab. A chat not yet in Wazzup is created when the window opens it. A Telegram
or MAX chat cannot be created this way by phone number; send a message first and use the chat ID
that comes back.

### Custom request

Any route, with the key, the rate limit and the error messages handled as everywhere else. The path
is relative to `https://api.wazzup24.com`; `/channels` means `/v3/channels`. A full URL is refused.
**Follow Pages** repeats a GET with `offset` 0, 100, 200… for the paged routes. A `POST
/v3/message` sent this way is not repeated after a server error either.

## Wazzup24 Trigger

Starts a workflow on what Wazzup posts to its webhook address:

| Event | Wazzup subscription |
|---|---|
| Message Received (a client wrote) | `messagesAndStatuses` |
| Message Sent (from Wazzup, the phone, the app or the API, this workflow's own sends included) | `messagesAndStatuses` |
| Message Edited, Message Deleted (`oldInfo` holds the previous text) | `messagesAndStatuses` |
| Message Status Changed (sent, delivered, read, edited, error) | `messagesAndStatuses` |
| Contact Creation Requested, Deal Creation Requested | `contactsAndDealsCreation` |
| Channel State Changed (incl. WABA tier) | `channelsUpdates` |
| Template Status Changed | `templateStatus` |

Each message, status or channel change becomes one item with `event` added, unless **Split Into
Items** is off. **Channels** narrows messages and channel changes to some channels; statuses,
creation requests and template changes name no channel and always pass. A delivery the workflow
did not ask for is answered `200` and dropped.

### One address per account

A Wazzup integration has exactly one webhook address. With **Registration → Automatic** the trigger
sets it when the workflow is activated, with the switches the selected events need, and on
deactivation puts back what was there before.

- If the address belongs to something else (another integration, a Make scenario, another
  workflow), activation stops with an error naming it. **Take Over the Webhook Address** replaces
  it until this workflow is deactivated, then restores it.
- **Listen for test event** takes the address too. An active production workflow of the same
  trigger receives nothing until the test ends, when its address goes back.
- Wazzup has no route to remove an address. When there was nothing to restore, deactivation switches
  every subscription off and leaves the address.
- Restoring can fail: Wazzup tests every address it is given with `{"test": true}` and refuses
  one that does not answer `200`. Deactivation goes on; the n8n log says why.

With **Registration → Manual** the trigger leaves Wazzup's settings alone. Put the **Production
URL** into Wazzup yourself, for example with **Webhook Settings → Set** of the Wazzup24 node.

### The secret in the address

Wazzup signs nothing it sends to an API integration: the address is the only thing that keeps
deliveries private. On Automatic the trigger adds `?token=` with a secret derived from the key and
the node, and answers `403` to anything without it. On Manual there is no such check.

A new API key changes the secret. Until the workflow is deactivated and activated again, Wazzup
keeps posting to the address with the old one, and gets `403`. On the next activation the trigger
recognises that address by its path and replaces it without asking for **Take Over**.

### Answering creation requests

Wazzup expects the answer to **Contact Creation Requested** and **Deal Creation Requested** to carry
the contact or deal the CRM created, and waits 30 seconds for it. Under **Options → Respond to
Creation Requests**:

- **Immediately** answers `200` at once. Load the new record with **Contact → Create or Update**
  or **Deal → Create or Update** later in the workflow.
- **With the Last Node's Data** waits for the workflow and answers with the first item of its last
  node. Shape that item the way **Create or Update** sends a record, for a contact:

  ```json
  {
    "id": "c-101",
    "responsibleUserId": "u-7",
    "name": "Anna",
    "contactData": [{ "chatType": "whatsapp", "chatId": "79011112233" }]
  }
  ```

  The trigger still answers every other delivery on the spot, so a slow workflow never holds up
  messages. A workflow that fails answers `500`.

## Rate limit

Wazzup allows 500 requests every 5 seconds per key and answers `429` above that. The nodes share one
window per key across all workflows of the n8n process, 400 by default (**Requests per 5 Seconds**
in the credential). A `429` is waited out and repeated for every route, since Wazzup refuses such a
call before doing anything. Server errors and dropped connections are repeated, up to four attempts,
for everything except sending a message.

The window lives in the memory of one n8n process. Several queue-mode workers, or several n8n
instances using the same key, each count on their own, so their sum is what Wazzup sees: with three
workers, for example, set about 160 in each. The field has no upper bound: if Wazzup support raises
the limit for an account, enter the new figure.

## Not here, or not known

- **The unanswered counter over websockets.** Wazzup pushes counter changes through socket.io, which
  a node cannot hold open. **User → Get Unanswered Count** is the REST form of the same number.
- **WAuth, the marketplace routes and `POST /v3/migration`** are for Wazzup's technology partners.
  **Custom Request** reaches them.
- **Media headers of WABA templates.** The documentation does not say how an image, video or
  document header is filled. When Wazzup lists such a variable in `templateCode`, it gets a field
  like any other; what value it wants there is unknown.
- **Whether Upload replaces pipelines.** The documentation does not say whether pipelines left out
  of a later upload are removed. The node sends all input items in one request, which is right either
  way.
- **Deleting a webhook address.** There is no such route; see
  [One address per account](#one-address-per-account).
- **Edit and delete time limits** are not published by Wazzup.
- **The name of the template-status switch.** `PATCH /v3/webhooks` is documented with
  `templateStatus`; `GET /v3/webhooks` on a live account reports the same switch as
  `wabaTemplatesStatus`. The nodes send the documented name and read both. Whether `PATCH` takes
  the documented one has not been tried: on a live account it would move the webhooks away from
  whatever receives them.

## What was checked

**On a live account**, with a key limited to channels, sending, webhook settings and templates, reads
only: the compiled node was run with a transport that
performs GET and refuses everything else. Channel → Get Many with its filters, WABA Template → Get
Many, Webhook Settings → Get, the channel and template dropdowns, and the template variable fields.
For every approved template of a WABA channel the fields came out in the same number and order as
the `[[…]]` of its `templateCode` and the `{{n}}` of its text. A contact read with that key
showed the `403` hint. What the live answers taught, beyond the documentation:

- `GET /v3/webhooks` answers booleans, not the `"true"` strings of the documentation, and names the
  template switch `wabaTemplatesStatus` (see above);
- channels carry a `name`, often the number with a note, which the dropdown shows;
- template statuses come in lower case, and besides the documented ones there is `archived`;
- a `403` for a closed route has no description, only `"error": "FORBIDDEN"`.

**Sending, on the same account**, through a WABA channel to a test number, in the 24-hour window the
number had opened: a formatted text, quick-reply buttons, a quote with the unanswered counter left
alone, an image and a PDF by URL, and a template with several variables filled from its fields. Wazzup
accepted each (`201` with a `messageId`); a repeated **CRM Message ID** was refused with
`REPEATED_CRM_MESSAGE_ID`, a VK chat type on the WABA channel with `WRONG_TRANSPORT`, and nothing went
out for either. Edit and delete on WABA were refused, as above.

**Quote Message ID** did not show: a text quoting an outgoing message of the same chat, sent five
seconds after it and again half an hour later, was accepted each time and arrived without the quote.
Quoting a message the client sent has not been tried. The node passes `refMessageId` as the
documentation describes; whether Wazzup quotes through WABA at all is not known.

The upserts, the chat window, the unanswered counter (all closed to that key), buttons of
Telegram and MAX bots, and the whole trigger have not met a live account.

An offline harness loaded the compiled nodes into a simulated n8n and a simulated API that answers
as the documentation describes, and checked the requests the nodes send and what they output: 40
checks, all passing. Among them:

- every button layout builds the `buttonsObject` of the documentation's examples;
- template variables go out in `templateCode` order; an empty one is refused;
- 250 contacts go out as requests of 100, 100 and 50; a rejected request names the input item;
- contacts and deals are read page by page until a short page or the limit;
- `POST /v3/message` is sent once even when the server fails, reads are repeated, `429` is waited out;
- a full URL in **Custom Request** is refused, and the key never appears in a URL;
- the trigger refuses to take a foreign address without **Take Over**, puts it back on
  deactivation, hands the address back to the production workflow after a test, answers Wazzup's
  `{"test": true}`, rejects deliveries without the secret, and in last-node mode waits for creation
  requests only.

What the harness cannot show: whether Wazzup's real answers match its documentation, how the
editor renders the template variables and button fields, and the questions under
[Not here, or not known](#not-here-or-not-known).

## License

[MIT](LICENSE.md). Wazzup is a trademark of its owner; this package is not affiliated with it.
