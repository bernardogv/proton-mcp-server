import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildCleanSnippet } from '../../src/utils/snippet.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturePath = (name: string) => join(__dirname, '..', 'fixtures', name);

describe('buildCleanSnippet', () => {
  it('decodes quoted-printable and yields clean text from multipart/alternative', async () => {
    const source = readFileSync(fixturePath('qp-html.eml'));
    const result = await buildCleanSnippet(source, 200);
    expect(result.snippet).toContain('Hello');
    expect(result.snippet).toContain('special chars');
    expect(result.snippet).not.toContain('=E2=80=94');
    expect(result.snippet).not.toContain('=CD=8F=C2=A0');
    expect(result.snippet).not.toContain('@media');
    expect(result.snippet).not.toContain('&zwnj;');
    expect(result.snippet).not.toContain('<');
    expect(result.snippet).not.toContain('>');
  });

  it('surfaces List-Unsubscribe mailto and http with one-click flag', async () => {
    const source = readFileSync(fixturePath('qp-html.eml'));
    const result = await buildCleanSnippet(source, 200);
    expect(result.hasUnsubscribe).toBe(true);
    expect(result.unsubscribeMailto).toBe('unsub@example.com');
    expect(result.unsubscribeHttp).toBe('https://example.com/u/123');
    expect(result.unsubscribeOneClick).toBe(true);
  });

  it('handles plain text with mailto-only List-Unsubscribe and no one-click', async () => {
    const source = readFileSync(fixturePath('plain-with-unsub.eml'));
    const result = await buildCleanSnippet(source, 200);
    expect(result.snippet).toContain('Just a plain text message');
    expect(result.hasUnsubscribe).toBe(true);
    expect(result.unsubscribeMailto).toBe('goodbye@example.com');
    expect(result.unsubscribeHttp).toBeUndefined();
    expect(result.unsubscribeOneClick).toBe(false);
  });

  it('truncates snippet to requested length', async () => {
    const source = readFileSync(fixturePath('plain-with-unsub.eml'));
    const result = await buildCleanSnippet(source, 10);
    expect(result.snippet.length).toBeLessThanOrEqual(10);
  });

  it('returns hasUnsubscribe=false when no List-Unsubscribe header', async () => {
    const minimal = Buffer.from(
      'From: a@b.com\r\nTo: c@d.com\r\nSubject: hi\r\nContent-Type: text/plain\r\n\r\nBody.\r\n',
    );
    const result = await buildCleanSnippet(minimal, 100);
    expect(result.hasUnsubscribe).toBe(false);
    expect(result.snippet).toBe('Body.');
  });
});
