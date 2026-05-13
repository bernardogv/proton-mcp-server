import type { SubjectCluster } from './types.js';

export function normalizeSubject(subject: string): string {
  let s = subject;
  // Strip Re:/Fwd:/Fw: prefixes (possibly chained)
  while (/^\s*(re|fwd|fw):\s*/i.test(s)) {
    s = s.replace(/^\s*(re|fwd|fw):\s*/i, '');
  }
  // Lowercase
  s = s.toLowerCase();
  // Dollar amounts
  s = s.replace(/\$[\d,]+(?:\.\d+)?/g, '$amount');
  // ISO and slash dates
  s = s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, 'date');
  s = s.replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, 'date');
  // Month-name dates
  s = s.replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,?\s+\d{2,4})?\b/g, 'date');
  // Hex IDs (8+ chars, must contain a-f)
  s = s.replace(/\b(?=[a-z0-9]*[a-f])[a-f0-9]{8,}\b/g, 'id');
  // Bare integers 6+ digits (order numbers)
  s = s.replace(/\b\d{6,}\b/g, 'number');
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

interface ClusterOptions {
  minClusterSize?: number;
  maxClusters?: number;
  maxSamplePerCluster?: number;
}

export function clusterSubjects(
  messages: Array<{ uid: number; subject: string }>,
  opts: ClusterOptions = {},
): SubjectCluster[] {
  const minClusterSize = opts.minClusterSize ?? 2;
  const maxClusters = opts.maxClusters ?? 3;
  const maxSamplePerCluster = opts.maxSamplePerCluster ?? 3;

  const groups = new Map<string, number[]>();
  for (const m of messages) {
    const key = normalizeSubject(m.subject);
    if (!key) continue;
    const arr = groups.get(key) || [];
    arr.push(m.uid);
    groups.set(key, arr);
  }

  const clusters: SubjectCluster[] = [];
  for (const [pattern, uids] of groups) {
    if (uids.length < minClusterSize) continue;
    clusters.push({
      pattern,
      count: uids.length,
      sampleUids: uids.slice(0, maxSamplePerCluster),
    });
  }
  clusters.sort((a, b) => b.count - a.count);
  return clusters.slice(0, maxClusters);
}
