/**
 * Minimal RFC 5545 ICS calendar generator for delivery reminders.
 * Produces an all-day VEVENT for a given calendar date (YYYY-MM-DD), since the
 * delivery time slot ("fascia oraria") is free text and not a precise time.
 */

export interface IcsEvent {
  uid: string;
  /** Calendar date in YYYY-MM-DD format (all-day event). */
  date: string;
  summary: string;
  description?: string;
  location?: string;
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function toStampUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Next calendar day in YYYYMMDD (DTEND for all-day events is exclusive). */
function nextDayCompact(date: string): string {
  const [y, m, d] = date.split("-").map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10).replace(/-/g, "");
}

export function buildIcs(event: IcsEvent): string {
  const dateCompact = event.date.replace(/-/g, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Magazzino Solidale AIM//Consegne//IT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${toStampUtc(new Date())}`,
    `DTSTART;VALUE=DATE:${dateCompact}`,
    `DTEND;VALUE=DATE:${nextDayCompact(event.date)}`,
    `SUMMARY:${escapeText(event.summary)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
