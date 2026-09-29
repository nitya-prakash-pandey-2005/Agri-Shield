/**
 * Minimal RFC 5545 calendar file for a booked demo. Pure (no DOM) so it is
 * unit-tested; the book-demo page turns the string into a Blob download.
 */

export interface IcsEvent {
  uid: string;
  start: Date;
  durationMinutes: number;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  organizerEmail?: string;
  organizerName?: string;
  attendeeEmail?: string;
  attendeeName?: string;
  /** Defaults to now */
  stamp?: Date;
}

/** 20260929T083000Z */
export function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Escape TEXT values (RFC 5545 §3.3.11). */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold content lines longer than 75 octets (RFC 5545 §3.1). */
export function icsFold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curLen = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (curLen + n > limit) {
      out.push(cur);
      cur = "";
      curLen = 0;
    }
    cur += ch;
    curLen += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function buildIcs(e: IcsEvent): string {
  const end = new Date(e.start.getTime() + e.durationMinutes * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Agri-SHIELD//Demo booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${icsDate(e.stamp ?? new Date())}`,
    `DTSTART:${icsDate(e.start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(e.summary)}`,
    ...(e.description ? [`DESCRIPTION:${icsEscape(e.description)}`] : []),
    ...(e.location ? [`LOCATION:${icsEscape(e.location)}`] : []),
    ...(e.url ? [`URL:${e.url}`] : []),
    ...(e.organizerEmail ? [`ORGANIZER${e.organizerName ? `;CN=${icsEscape(e.organizerName)}` : ""}:mailto:${e.organizerEmail}`] : []),
    ...(e.attendeeEmail ? [`ATTENDEE;ROLE=REQ-PARTICIPANT${e.attendeeName ? `;CN=${icsEscape(e.attendeeName)}` : ""}:mailto:${e.attendeeEmail}`] : []),
    "STATUS:TENTATIVE",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Agri-SHIELD demo in 15 minutes",
    "TRIGGER:-PT15M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(icsFold).join("\r\n") + "\r\n";
}

/**
 * Bookable demo slots for the next `days` weekdays, 09:00–17:30 in the
 * visitor's own timezone (Date objects are absolute instants; the UI formats
 * them in the local zone). Slots less than `minLeadHours` away are skipped.
 */
export function demoSlots(now: Date, days = 10, minLeadHours = 18): { day: Date; slots: Date[] }[] {
  const out: { day: Date; slots: Date[] }[] = [];
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  while (out.length < days) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay();
    if (dow === 0 || dow === 6) continue;
    const slots: Date[] = [];
    for (let h = 9; h < 18; h++) {
      for (const m of [0, 30]) {
        const s = new Date(cursor);
        s.setHours(h, m, 0, 0);
        if (s.getTime() - now.getTime() >= minLeadHours * 3_600_000) slots.push(s);
      }
    }
    if (slots.length) out.push({ day: new Date(cursor), slots });
  }
  return out;
}
