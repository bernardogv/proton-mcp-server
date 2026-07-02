/** Prefix a subject with Re: unless it already has one (any case). */
export function replySubject(subject: string): string {
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}

/** Prefix a subject with Fwd: unless it already has Fwd:/Fw: (any case). */
export function forwardSubject(subject: string): string {
  return /^fwd?:/i.test(subject) ? subject : `Fwd: ${subject}`;
}

/** Extract the bare address from "Name <email>" or a bare address. */
export function extractEmail(addr: string): string {
  const match = addr.match(/<([^>]+)>/);
  return match ? match[1] : addr.trim();
}

/** Compute reply recipients: sender in To; on replyAll, everyone else (deduped, minus self and sender) in Cc. */
export function buildReplyRecipients(
  from: string,
  to: string[],
  cc: string[],
  self: string,
  replyAll: boolean,
): { to: string[]; cc?: string[] } {
  const sender = extractEmail(from);
  if (!replyAll) return { to: [sender] };

  const seen = new Set([self.toLowerCase(), sender.toLowerCase()]);
  const extra: string[] = [];
  for (const raw of [...to, ...cc]) {
    const addr = extractEmail(raw);
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    extra.push(addr);
  }
  return { to: [sender], ...(extra.length > 0 && { cc: extra }) };
}

/** Filter to UIDs whose envelope address matches the target exactly (IMAP FROM search is substring-based). */
export function exactSenderUids(messages: Array<{ uid: number; address: string }>, target: string): number[] {
  const t = target.toLowerCase();
  return messages.filter((m) => m.address.toLowerCase() === t).map((m) => m.uid);
}

export interface SearchParams {
  from?: string;
  to?: string;
  subject?: string;
  keyword?: string;
  since?: string;
  before?: string;
  unreadOnly?: boolean;
}

/** Build imapflow search criteria from tool params. Throws on unparseable dates. */
export function buildSearchCriteria(params: SearchParams): Record<string, unknown> {
  const criteria: Record<string, unknown> = {};
  if (params.from) criteria.from = params.from;
  if (params.to) criteria.to = params.to;
  if (params.subject) criteria.subject = params.subject;
  if (params.keyword) criteria.body = params.keyword;
  if (params.since) criteria.since = parseDate(params.since, 'since');
  if (params.before) criteria.before = parseDate(params.before, 'before');
  if (params.unreadOnly) criteria.seen = false;
  return criteria;
}

function parseDate(value: string, field: string): Date {
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid '${field}' date: ${value}. Expected ISO 8601.`);
  }
  return d;
}
