export const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
export const money = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`);
export const int = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
export const dec1 = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(1));
export const pct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n * 100)}%`);

export function monthYear(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
export function dayMonthYear(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
/** "Oct 2025 – Sep 2026" for a half-open window [start, end). */
export function windowLabel(w: { start: string; end: string }) {
  const end = new Date(`${w.end}T00:00:00Z`);
  end.setUTCDate(0);
  return `${monthYear(w.start)} – ${monthYear(end.toISOString())}`;
}

/** City-relative position in words. p = 0 is the lowest rate in the city. */
export function relativeWords(p: number | null, city: string) {
  if (p == null) return 'No stable rate';
  if (p <= 0.2) return `Among the lowest fifth in ${city}`;
  if (p <= 0.4) return `Below the ${city} middle`;
  if (p < 0.6) return `Near the ${city} middle`;
  if (p < 0.8) return `Above the ${city} middle`;
  return `Among the highest fifth in ${city}`;
}

export function trendWords(count: number, prior: number, priorComplete = true) {
  if (!priorComplete) return 'No comparison with the previous 12 months: the published data does not reach back that far';
  if (prior === 0 && count === 0) return 'None reported in either year';
  if (prior === 0) return `${count} reported, none the year before`;
  const change = (count - prior) / prior;
  const sign = change > 0 ? '+' : '';
  return `${sign}${Math.round(change * 100)}% vs the previous 12 months (${int(prior)})`;
}

/** A geography label in running text: lowercased except acronyms ("ZIP code area", "statistical neighborhood"). */
export const labelText = (label: string) => label.replace(/^([A-Z])([a-z])/, (_, a: string, b: string) => a.toLowerCase() + b);
