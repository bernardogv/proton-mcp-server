import { describe, it, expect } from 'vitest';
import { clusterSubjects, normalizeSubject } from '../../src/utils/clustering.js';

describe('normalizeSubject', () => {
  it('replaces dollar amounts', () => {
    expect(normalizeSubject('Chase: $92.88 transaction')).toBe('chase: $amount transaction');
    expect(normalizeSubject('You spent $1,234.50 at Amazon')).toBe('you spent $amount at amazon');
  });

  it('replaces order numbers (6+ digits)', () => {
    expect(normalizeSubject('Order #123456 confirmed')).toBe('order #number confirmed');
  });

  it('replaces hex ids (8+ chars)', () => {
    expect(normalizeSubject('Receipt abc123def456')).toBe('receipt id');
  });

  it('replaces dates', () => {
    expect(normalizeSubject('Statement for 5/12/2026')).toBe('statement for date');
  });

  it('strips Re:/Fwd: prefixes', () => {
    expect(normalizeSubject('Re: hello')).toBe('hello');
    expect(normalizeSubject('Fwd: Re: foo')).toBe('foo');
  });

  it('lowercases and collapses whitespace', () => {
    expect(normalizeSubject('  HELLO   WORLD  ')).toBe('hello world');
  });
});

describe('clusterSubjects', () => {
  it('groups identical normalized subjects', () => {
    const msgs = [
      { uid: 1, subject: '$50.00 transaction from Amazon' },
      { uid: 2, subject: '$12.34 transaction from Amazon' },
      { uid: 3, subject: '$999.00 transaction from Amazon' },
      { uid: 4, subject: 'Unrelated subject' },
    ];
    const clusters = clusterSubjects(msgs);
    expect(clusters.length).toBe(1);
    expect(clusters[0].count).toBe(3);
    expect(clusters[0].sampleUids).toEqual([1, 2, 3]);
    expect(clusters[0].pattern).toContain('$amount transaction from amazon');
  });

  it('returns clusters in descending count order', () => {
    const msgs = [
      { uid: 1, subject: 'A' },
      { uid: 2, subject: 'A' },
      { uid: 3, subject: 'B' },
      { uid: 4, subject: 'B' },
      { uid: 5, subject: 'B' },
    ];
    const clusters = clusterSubjects(msgs);
    expect(clusters[0].pattern).toBe('b');
    expect(clusters[0].count).toBe(3);
    expect(clusters[1].pattern).toBe('a');
    expect(clusters[1].count).toBe(2);
  });

  it('respects minClusterSize option', () => {
    const msgs = [
      { uid: 1, subject: 'X' },
      { uid: 2, subject: 'X' },
      { uid: 3, subject: 'Y' },
    ];
    const clusters = clusterSubjects(msgs, { minClusterSize: 2 });
    expect(clusters.length).toBe(1);
    expect(clusters[0].pattern).toBe('x');
  });

  it('respects maxClusters option', () => {
    const msgs = [
      { uid: 1, subject: 'A' }, { uid: 2, subject: 'A' },
      { uid: 3, subject: 'B' }, { uid: 4, subject: 'B' },
      { uid: 5, subject: 'C' }, { uid: 6, subject: 'C' },
      { uid: 7, subject: 'D' }, { uid: 8, subject: 'D' },
    ];
    const clusters = clusterSubjects(msgs, { maxClusters: 2 });
    expect(clusters.length).toBe(2);
  });

  it('caps sampleUids at 3 per cluster', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => ({ uid: i + 1, subject: 'same' }));
    const clusters = clusterSubjects(msgs);
    expect(clusters[0].sampleUids.length).toBe(3);
    expect(clusters[0].count).toBe(10);
  });
});
