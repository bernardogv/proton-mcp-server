import { simpleParser } from 'mailparser';

export interface ParsedListUnsubscribe {
  mailto?: string;
  http?: string;
}

export function parseListUnsubscribe(header: string | undefined): ParsedListUnsubscribe {
  if (!header) return {};
  const result: ParsedListUnsubscribe = {};
  // Match <...> tokens
  const tokens = header.match(/<[^>]+>/g);
  if (!tokens) return {};
  for (const raw of tokens) {
    const uri = raw.slice(1, -1).trim();
    const lower = uri.toLowerCase();
    if (lower.startsWith('mailto:')) {
      if (!result.mailto) result.mailto = uri.slice(7).trim();
    } else if (lower.startsWith('http://') || lower.startsWith('https://')) {
      if (!result.http) result.http = uri;
    }
  }
  return result;
}

export interface CleanSnippetResult {
  snippet: string;
  hasUnsubscribe: boolean;
  unsubscribeMailto?: string;
  unsubscribeHttp?: string;
  unsubscribeOneClick: boolean;
}

export async function buildCleanSnippet(
  source: Buffer,
  snippetLength: number,
): Promise<CleanSnippetResult> {
  const parsed = await simpleParser(source, { skipImageLinks: true });
  const text = (parsed.text || '').replace(/\s+/g, ' ').trim();
  const snippet = text.slice(0, snippetLength);

  const listUnsubHeader = parsed.headers.get('list-unsubscribe');
  const headerString = typeof listUnsubHeader === 'string'
    ? listUnsubHeader
    : listUnsubHeader && typeof listUnsubHeader === 'object' && 'text' in listUnsubHeader
      ? (listUnsubHeader as { text: string }).text
      : undefined;

  const { mailto, http } = parseListUnsubscribe(headerString);
  const oneClick = parsed.headers.has('list-unsubscribe-post');

  return {
    snippet,
    hasUnsubscribe: !!(mailto || http),
    unsubscribeMailto: mailto,
    unsubscribeHttp: http,
    unsubscribeOneClick: oneClick && !!mailto,
  };
}
