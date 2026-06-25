---
name: Sending email via the Replit Gmail connector
description: How to actually send transactional email from server code using the google-mail connector + connectors-sdk.
---

To send email from server code, use the **Replit Gmail connector** (`google-mail`) via `@replit/connectors-sdk`, not raw SMTP.

- Install the SDK into the specific workspace package (e.g. `pnpm --filter @workspace/api-server add @replit/connectors-sdk`), NOT the workspace root (root `pnpm add` errors with `ERR_PNPM_ADDING_TO_ROOT`).
- `new ReplitConnectors().proxy("google-mail", "/gmail/v1/users/me/messages/send", { method, headers, body })` returns a fetch `Response` (check `.ok`, parse with `.json()`/`.text()`). The SDK injects+refreshes OAuth automatically — do NOT cache the client.
- Gmail `messages.send` wants `{ raw: <base64url of an RFC 2822 message> }`. Build the MIME yourself: encoded-word subject (`=?UTF-8?B?...?=`), `Content-Transfer-Encoding: base64` body folded at 76-char CRLF lines, then base64url the whole thing (`+`→`-`, `/`→`_`, strip `=`). An explicit `From:` is optional (Gmail infers the connected account) but improves clarity.
- The connected sending account is whatever the user authorized during OAuth (here info@angeliinmoto.it); the recipient is independent.

**Why:** order-submission email was a deliberate no-op until a real sender was wired; SMTP/API-key flows were avoided in favor of the managed connector so no secrets are handled.

**How to apply:** keep best-effort sends inside the caller's try/catch so a send failure never breaks the business action (e.g. order submit still succeeds). Verify the connection is live with `listConnections("google-mail")` (status `healthy`) instead of sending a real test email to a production inbox.
