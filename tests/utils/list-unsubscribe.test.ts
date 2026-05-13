import { describe, it, expect } from 'vitest';
import { parseListUnsubscribe } from '../../src/utils/snippet.js';

describe('parseListUnsubscribe', () => {
  it('parses mailto and http together', () => {
    const result = parseListUnsubscribe('<mailto:unsub@example.com>, <https://example.com/u/123>');
    expect(result.mailto).toBe('unsub@example.com');
    expect(result.http).toBe('https://example.com/u/123');
  });

  it('parses mailto only', () => {
    const result = parseListUnsubscribe('<mailto:unsub@example.com>');
    expect(result.mailto).toBe('unsub@example.com');
    expect(result.http).toBeUndefined();
  });

  it('parses http only', () => {
    const result = parseListUnsubscribe('<https://example.com/u/abc>');
    expect(result.http).toBe('https://example.com/u/abc');
    expect(result.mailto).toBeUndefined();
  });

  it('tolerates extra whitespace and lowercase scheme', () => {
    const result = parseListUnsubscribe('  < MAILTO:unsub@example.com > ,  <http://example.com/u> ');
    expect(result.mailto).toBe('unsub@example.com');
    expect(result.http).toBe('http://example.com/u');
  });

  it('returns empty object on undefined input', () => {
    expect(parseListUnsubscribe(undefined)).toEqual({});
  });

  it('returns empty object on malformed input', () => {
    expect(parseListUnsubscribe('garbage no brackets')).toEqual({});
  });
});
