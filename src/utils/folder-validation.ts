export function fuzzyFolderMatches(paths: string[], target: string): string[] {
  const t = target.toLowerCase();
  const scored = paths
    .map((p) => ({ path: p, score: similarity(t, p.toLowerCase()) }))
    .filter((m) => m.score > 0.3)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 5).map((m) => m.path);
}

export function assertFolderExists(paths: Set<string>, path: string): void {
  if (paths.has(path)) return;
  const matches = fuzzyFolderMatches([...paths], path);
  const hint = matches.length > 0
    ? ` Did you mean one of: ${matches.map((s) => `'${s}'`).join(', ')}?`
    : '';
  throw new Error(`Folder '${path}' not found.${hint}`);
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  // Dice coefficient on bigrams — adequate for folder-name fuzzy matching
  const ba = bigrams(a);
  const bb = bigrams(b);
  let overlap = 0;
  for (const g of ba) if (bb.has(g)) overlap++;
  return (2 * overlap) / (ba.size + bb.size);
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}
