# Changelog

## 0.1.0

The first version: the Wazzup24 node, the Wazzup24 Trigger and the Wazzup24 API credential.

- **Message**: send a text, a file by URL or a WABA template, with the chat type taken from the
  channel, to a chat ID, a Telegram or MAX phone number, or a Telegram username; buttons for WABA,
  Telegram bots and MAX bots; edit and delete sent messages.
- **WABA Template**: a dropdown of the channel's templates and one field per template variable, in
  the order Wazzup fills them.
- **Contact**, **Deal**, **User**: create or update by your own IDs, 100 per request; get, list page
  by page, delete, delete many; the unanswered counter of a user.
- **Channel**, **Pipeline**, **Chat Window**, **Webhook Settings**, **Custom Request**.
- **Wazzup24 Trigger**: nine events, registers its own address with a secret in it and restores the
  previous one on deactivation, can answer contact and deal creation requests with the workflow's
  result.

Reading and sending were checked on a live Wazzup account; the upserts and the trigger only against
a simulated API. See "What was checked" in the README.
