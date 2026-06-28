---
name: Configurable email service + ICS reminders
description: How email sending is abstracted (Gmail connector OR SMTP) and how delivery reminders attach ICS calendar events.
---

# Configurable email service

There is a single generic email abstraction (`emailService.ts`, `sendEmail`) that
all senders go through. It reads a DB singleton (`impostazioni_email`) whose
`provider` field switches between two backends:
- `connector` → Gmail via `@replit/connectors-sdk` proxy (RFC2822 base64url raw).
- `smtp` → `nodemailer` transport built from the stored SMTP params.

**Why:** the association wanted a default zero-config option (Gmail connector) plus
the ability to self-host with their own SMTP server without code changes.

**How to apply:**
- New senders should call `sendEmail({to, subject, text, attachments?})`, never talk
  to a provider directly. It supports attachments (used for ICS).
- `smtpPassword` is WRITE-ONLY: `GET /impostazioni-email` returns `hasPassword` only,
  never the value; `PUT` updates it only when a non-empty value is sent.
- Sends are best-effort at the caller boundary: order submit and the manual
  send endpoints wrap `sendEmail` in try/catch and return `{sent, error?}` (HTTP 200
  even on failure) so the user-facing action never hard-fails on mail problems.

# ICS reminders for consegne

Delivery reminder endpoints (`POST /consegne/:id/invia-email-beneficiario` and
`/invia-email-volontario`) build an all-day RFC5545 VEVENT (`ics.ts` `buildIcs`)
and send it as a `text/calendar` attachment.

**Why:** the time slot (`fasciaOraria`) is free text, not a precise time, so an
all-day event (DTSTART/DTEND VALUE=DATE, DTEND = next day, exclusive) is correct.

**How to apply:**
- These endpoints reuse the same centro+città access checks (`canAccessCentro` +
  `canAccessCitta` via beneficiario) as the rest of the consegne router.
- `sent=false` (not an error status) is returned when the recipient has no email or
  no volontario is assigned — tests assert 404 / sent=false / 403 without ever
  hitting a real provider.
