// A single, clearly labelled sponsorship slot. It appears only at the foot of a neighborhood page, never inside
// rankings, results or rental links, and renders nothing unless a sponsor is configured at build time.
// Sponsors receive no user inputs: the slot is static content with no tracking parameters added by Your Next Corner.
const text = import.meta.env.VITE_SPONSOR_TEXT as string | undefined;
const url = import.meta.env.VITE_SPONSOR_URL as string | undefined;
const name = import.meta.env.VITE_SPONSOR_NAME as string | undefined;

export function SponsorSlot() {
  if (!text || !url || !name) return null;
  return (
    <aside className="sponsor" aria-label="Sponsored">
      <div className="sponsor-label">Sponsored · not part of neighborhood rankings</div>
      <p style={{ marginTop: 6 }}>
        <b style={{ fontWeight: 500 }}>{name}</b>: {text}{' '}
        <a className="text-link" href={url} target="_blank" rel="sponsored noopener noreferrer">Visit {name}</a>
      </p>
    </aside>
  );
}
