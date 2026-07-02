import { describe, it, expect } from 'vitest';
import { buildSenderRoutes } from '../../src/utils/sender-routes.js';

function dist(entries: Array<[string, { name: string; total: number; byFolder: Record<string, number> }]>) {
  return new Map(entries);
}

const SAMPLE = dist([
  ['big@promo.com', { name: 'Big Promo', total: 100, byFolder: { 'Folders/Promotions': 90, INBOX: 10 } }],
  ['pure@finance.com', { name: 'Pure Finance', total: 50, byFolder: { 'Folders/Finance': 50 } }],
  ['low-vol@x.com', { name: 'LowVol', total: 2, byFolder: { 'Folders/Tech': 2 } }],
  ['mixed@y.com', { name: 'Mixed', total: 10, byFolder: { 'Folders/Jobs': 5, INBOX: 5 } }],
  ['inboxy@z.com', { name: 'Inboxy', total: 20, byFolder: { INBOX: 18, 'Folders/Tech': 2 } }],
]);

describe('buildSenderRoutes', () => {
  it('filters by minVolume and minConfidence, skips INBOX-dominant senders', () => {
    const routes = buildSenderRoutes(SAMPLE, { minConfidence: 0.8, minVolume: 3 });
    expect(routes.map((r) => r.address)).toEqual(['big@promo.com', 'pure@finance.com']);
  });

  it('sorts by totalMessages descending', () => {
    const routes = buildSenderRoutes(SAMPLE, { minConfidence: 0.5, minVolume: 1 });
    const totals = routes.map((r) => r.totalMessages);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
  });

  it('inboxOnly keeps only senders with mail currently in INBOX', () => {
    const routes = buildSenderRoutes(SAMPLE, { minConfidence: 0.8, minVolume: 3, inboxOnly: true });
    expect(routes.map((r) => r.address)).toEqual(['big@promo.com']);
  });

  it('limit caps the number of suggestions', () => {
    const routes = buildSenderRoutes(SAMPLE, { minConfidence: 0.5, minVolume: 1, limit: 2 });
    expect(routes).toHaveLength(2);
  });

  it('excludes the dominant folder from otherFolders and computes confidence', () => {
    const [big] = buildSenderRoutes(SAMPLE, { minConfidence: 0.8, minVolume: 3 });
    expect(big.dominantFolder).toBe('Folders/Promotions');
    expect(big.confidence).toBeCloseTo(0.9);
    expect(big.otherFolders).toEqual({ INBOX: 10 });
  });
});
