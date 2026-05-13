import { describe, it, expect } from 'vitest';
import { fuzzyFolderMatches, assertFolderExists } from '../../src/utils/folder-validation.js';

describe('fuzzyFolderMatches', () => {
  it('returns up to 5 close paths sorted by similarity', () => {
    const paths = [
      'Folders/Orders',
      'Folders/Orders & Receipts',
      'Folders/Order History',
      'Labels/Important',
      'Folders/Drafts',
    ];
    const matches = fuzzyFolderMatches(paths, 'Folders/Order');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.length).toBeLessThanOrEqual(5);
    expect(matches[0]).toMatch(/Folders\/Order/);
  });

  it('returns empty array when no path is close', () => {
    expect(fuzzyFolderMatches(['INBOX'], 'totally/unrelated/xyzzy')).toEqual([]);
  });

  it('is case-insensitive in matching but preserves original casing', () => {
    const paths = ['Folders/Orders & Receipts'];
    const matches = fuzzyFolderMatches(paths, 'folders/orders');
    expect(matches[0]).toBe('Folders/Orders & Receipts');
  });
});

describe('assertFolderExists', () => {
  it('returns silently when path is in the set', () => {
    const paths = new Set(['INBOX', 'Folders/Receipts']);
    expect(() => assertFolderExists(paths, 'INBOX')).not.toThrow();
  });

  it('throws with fuzzy hint when path is missing', () => {
    const paths = new Set(['Folders/Orders & Receipts']);
    expect(() => assertFolderExists(paths, 'Folders/Orders &amp; Receipts')).toThrow(
      /Folder 'Folders\/Orders &amp; Receipts' not found.*Folders\/Orders & Receipts/,
    );
  });

  it('throws without hint when no close match exists', () => {
    const paths = new Set(['INBOX']);
    expect(() => assertFolderExists(paths, 'xyz/qqq')).toThrow(/Folder 'xyz\/qqq' not found\.$/);
  });

  it('is case-sensitive and does not html-decode', () => {
    const paths = new Set(['Folders/Orders & Receipts']);
    expect(() => assertFolderExists(paths, 'folders/orders & receipts')).toThrow();
    expect(() => assertFolderExists(paths, 'Folders/Orders &amp; Receipts')).toThrow();
    expect(() => assertFolderExists(paths, 'Folders/Orders & Receipts')).not.toThrow();
  });
});
