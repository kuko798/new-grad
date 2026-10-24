/** Rank each value from 0 (lowest) to 1 (highest); ties share their average rank. A lone value ranks 0.5. */
export function percentileRanks(values: Array<{ id: string; v: number }>): Map<string, number> {
  const sorted = [...values].sort((a, b) => a.v - b.v);
  const out = new Map<string, number>();
  const n = sorted.length;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sorted[j + 1].v === sorted[i].v) j++;
    const rank = n === 1 ? 0.5 : (i + j) / 2 / (n - 1);
    for (let k = i; k <= j; k++) out.set(sorted[k].id, rank);
    i = j + 1;
  }
  return out;
}

export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
