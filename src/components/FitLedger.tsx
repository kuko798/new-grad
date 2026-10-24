// The fit ledger: each weighted preference, its 0–1 fit, and the points it adds to the score.
import { COMPONENT_LABELS, displayPoints, type Evaluation } from '../lib/scoring.ts';
import { PRIORITY_LABELS } from '../lib/prefs.ts';

export function FitLedger({ ev, showUnweighted = false }: { ev: Evaluation; showUnweighted?: boolean }) {
  const rows = ev.components.filter((c) => showUnweighted || c.weight > 0).sort((a, b) => b.points - a.points || b.weight - a.weight);
  const totalWeight = ev.components.filter((c) => c.weight > 0 && c.value != null).reduce((s, c) => s + c.weight, 0);
  const points = displayPoints(ev);
  if (!rows.length) {
    return <div className="empty">No preferences are weighted, so there is no fit score. Set a priority to rank neighborhoods.</div>;
  }
  return (
    <div>
      <div className="ledger-row small muted" aria-hidden="true">
        <span>Preference and measured fact</span>
        <span>Fit on this measure</span>
        <span style={{ textAlign: 'right' }}>Points</span>
      </div>
      <ul className="ledger rows">
        {rows.map((c) => (
          <li key={c.id} className={`ledger-row ${c.status}`} style={{ padding: '8px 0' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500 }}>
                {COMPONENT_LABELS[c.id]}
                <span className="small muted" style={{ fontWeight: 400 }}> · {PRIORITY_LABELS[c.priority].toLowerCase()}{c.weight > 0 && totalWeight > 0 && c.value != null ? `, ${Math.round((c.weight / totalWeight) * 100)}% of the score` : ''}</span>
              </div>
              <div className="small muted" style={{ marginTop: 2 }}>
                {c.fact}
                {c.status === 'imputed' ? ' (imputed)' : ''}
                {c.status === 'missing' && c.weight > 0 ? '. Left out; the other weights are renormalized' : ''}
              </div>
            </div>
            <div className="bar" role="img" aria-label={c.value == null ? 'No data' : `${Math.round(c.value * 100)} out of 100`}>
              <span style={{ transform: `scaleX(${c.value ?? 0})` }} />
            </div>
            <div className="num" style={{ textAlign: 'right' }}>{c.weight > 0 && c.value != null ? points.get(c.id) : <span className="dash">—</span>}</div>
          </li>
        ))}
      </ul>
      <div className="cost-total" style={{ marginTop: 4 }}>
        <span>Preference fit</span>
        <span className="num" style={{ color: 'var(--hue-ink)' }}>{ev.score ?? '—'}</span>
      </div>
    </div>
  );
}
