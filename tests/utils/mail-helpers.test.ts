import { describe, it, expect } from 'vitest';
import { replySubject, forwardSubject, buildReplyRecipients, buildSearchCriteria, exactSenderUids } from '../../src/utils/mail-helpers.js';

describe('exactSenderUids', () => {
  const msgs = [
    { uid: 1, address: 'hit-reply@linkedin.com' },
    { uid: 2, address: 'inmail-hit-reply@linkedin.com' },
    { uid: 3, address: 'HIT-REPLY@linkedin.com' },
    { uid: 4, address: '' },
  ];

  it('returns only exact address matches, not superstring lookalikes', () => {
    expect(exactSenderUids(msgs, 'hit-reply@linkedin.com')).toEqual([1, 3]);
  });

  it('is case-insensitive', () => {
    expect(exactSenderUids(msgs, 'INMAIL-HIT-REPLY@LINKEDIN.COM')).toEqual([2]);
  });

  it('returns empty for no matches', () => {
    expect(exactSenderUids(msgs, 'nobody@example.com')).toEqual([]);
  });
});

describe('replySubject', () => {
  it('prefixes Re: when missing', () => {
    expect(replySubject('Hello')).toBe('Re: Hello');
  });

  it('keeps an existing Re: prefix regardless of case', () => {
    expect(replySubject('Re: Hello')).toBe('Re: Hello');
    expect(replySubject('RE: Hello')).toBe('RE: Hello');
  });
});

describe('forwardSubject', () => {
  it('prefixes Fwd: when missing', () => {
    expect(forwardSubject('Hello')).toBe('Fwd: Hello');
  });

  it('keeps an existing Fwd:/Fw: prefix regardless of case', () => {
    expect(forwardSubject('Fwd: Hello')).toBe('Fwd: Hello');
    expect(forwardSubject('FWD: Hello')).toBe('FWD: Hello');
    expect(forwardSubject('Fw: Hello')).toBe('Fw: Hello');
  });
});

describe('buildReplyRecipients', () => {
  const from = 'Alice <alice@example.com>';
  const self = 'me@pm.me';

  it('replies to sender only when replyAll is false', () => {
    const r = buildReplyRecipients(from, ['me@pm.me', 'bob@example.com'], [], self, false);
    expect(r).toEqual({ to: ['alice@example.com'] });
  });

  it('reply-all CCs other recipients, excluding self and sender', () => {
    const r = buildReplyRecipients(
      from,
      ['Me <me@pm.me>', 'bob@example.com', 'alice@example.com'],
      ['carol@example.com'],
      self,
      true,
    );
    expect(r.to).toEqual(['alice@example.com']);
    expect(r.cc).toEqual(['bob@example.com', 'carol@example.com']);
  });

  it('dedupes an address present in both To and Cc', () => {
    const r = buildReplyRecipients(from, ['bob@example.com'], ['Bob <bob@example.com>'], self, true);
    expect(r.cc).toEqual(['bob@example.com']);
  });

  it('omits cc entirely when there are no extra recipients', () => {
    const r = buildReplyRecipients(from, ['me@pm.me'], [], self, true);
    expect(r).toEqual({ to: ['alice@example.com'] });
  });
});

describe('buildSearchCriteria', () => {
  it('maps params to imapflow criteria', () => {
    expect(buildSearchCriteria({
      from: 'a@b.c',
      subject: 'hi',
      keyword: 'invoice',
      since: '2026-01-01T00:00:00Z',
      unreadOnly: true,
    })).toEqual({
      from: 'a@b.c',
      subject: 'hi',
      body: 'invoice',
      since: new Date('2026-01-01T00:00:00Z'),
      seen: false,
    });
  });

  it('returns an empty object when nothing is set', () => {
    expect(buildSearchCriteria({})).toEqual({});
  });

  it('throws on an invalid since date', () => {
    expect(() => buildSearchCriteria({ since: 'not-a-date' })).toThrow(/since/);
  });

  it('throws on an invalid before date', () => {
    expect(() => buildSearchCriteria({ before: 'yesterday-ish' })).toThrow(/before/);
  });
});
