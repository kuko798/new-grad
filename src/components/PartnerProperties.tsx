import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { partnerRequest as api } from '../lib/partner-api.ts';
import { cityInfo } from '../lib/cities.ts';
export function PartnerPropertyCard({ property: p }: { property: any }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          api('events', { id: p.id, kind: 'impression', source: 'neighborhood' }).catch(() => {});
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [p.id]);
  return (
    <article ref={ref} className="partner-public-card">
      {p.data.media[0] ? (
        <img
          loading="lazy"
          src={`/api/partners/media/${p.data.media[0]}`}
          alt={p.photos?.find((m: any) => m.id === p.data.media[0])?.alt ?? `${p.data.name} property photograph`}
        />
      ) : (
        <div className="partner-photo-placeholder">Property photograph not provided</div>
      )}
      <div>
        <p className="partner-eyebrow">Partner property · {cityInfo(p.data.city).name}</p>
        <h3>
          <Link to={`/properties/${p.slug}`}>{p.data.name}</Link>
        </h3>
        <p>{p.data.address}</p>
        <strong>
          ${p.data.rentMin.toLocaleString()}–${p.data.rentMax.toLocaleString()} / month
        </strong>
        <p>{p.data.bedrooms.map((n: number) => (n === 0 ? 'Studio' : `${n} bed`)).join(' · ')}</p>
        <p>{p.data.amenities.slice(0, 3).join(' · ')}</p>
        <p className="note">
          Verified {p.data.verifiedAt}. Rent ranges do not guarantee a suitable unit is available. Confirm details with
          the property.
        </p>
        <div className="partner-actions">
          <Link className="btn" to={`/properties/${p.slug}`}>
            Property details
          </Link>
          <a href={`/api/out/${p.id}?source=neighborhood`} rel="nofollow">
            Leasing website ↗
          </a>
        </div>
      </div>
    </article>
  );
}
export function PartnerProperties({
  city,
  neighborhood,
  maxRent,
  bedrooms,
  pets,
  parking,
  eligible = true,
}: {
  city: string;
  neighborhood: string;
  maxRent?: number;
  bedrooms: number;
  pets: boolean;
  parking: boolean;
  eligible?: boolean;
}) {
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    if (!eligible) return;
    let alive = true;
    api(
      `public?${new URLSearchParams({ city, neighborhood, ...(maxRent ? { maxRent: String(maxRent) } : {}), bedrooms: String(bedrooms), pets: String(pets), parking: String(parking) })}`,
    )
      .then((v) => {
        if (alive) {
          setRows(v);
          setError('');
        }
      })
      .catch(() => {
        if (alive) setError('Partner listings are temporarily unavailable.');
      });
    return () => {
      alive = false;
    };
  }, [city, neighborhood, maxRent, bedrooms, pets, parking, eligible]);
  return (
    <section className="partner-neighborhood">
      <h2 className="section-title">Properties in this neighborhood</h2>
      <p className="note">Partner listings are separate from your neighborhood fit score.</p>
      {!eligible ? (
        <p>
          We cannot verify every housing, move-date, or commute limit for these listings, so no property suggestions are
          shown.
        </p>
      ) : rows.length ? (
        <div className="partner-public-grid">
          {rows.map((p) => (
            <PartnerPropertyCard key={p.id} property={p} />
          ))}
        </div>
      ) : (
        <p>
          {error ||
            'We don’t have matching partner properties here yet. That doesn’t mean housing is unavailable—continue exploring local rental listings.'}
        </p>
      )}
    </section>
  );
}
