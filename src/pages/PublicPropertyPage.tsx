import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { partnerRequest as api } from '../lib/partner-api.ts';
import { cityInfo } from '../lib/cities.ts';
export default function PublicPropertyPage() {
  const { slug } = useParams();
  const [property, setProperty] = useState<any>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    api(`public?slug=${encodeURIComponent(slug ?? '')}`)
      .then((rows) => {
        if (alive) {
          if (!rows[0]) setError('This property is not currently published.');
          else {
            setProperty(rows[0]);
            api('events', { id: rows[0].id, kind: 'detail', source: 'property' }).catch(() => {});
          }
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [slug]);
  useEffect(() => {
    if (!property) return;
    document.title = `${property.data.name} — ${cityInfo(property.data.city).name} | Your Next Corner`;
    const canonical = document.createElement('link');
    canonical.rel = 'canonical';
    canonical.href = `${location.origin}/properties/${property.slug}`;
    document.head.append(canonical);
    return () => canonical.remove();
  }, [property]);
  if (error)
    return (
      <div className="partner-page">
        <h1>Property unavailable</h1>
        <p role="status">{error}</p>
        <Link className="btn" to="/start">
          Explore neighborhoods
        </Link>
      </div>
    );
  if (!property)
    return (
      <div className="partner-page" role="status">
        Loading property…
      </div>
    );
  const d = property.data;
  const stale = Date.now() - Date.parse(d.verifiedAt) > 30 * 86400000;
  return (
    <div className="partner-page">
      <Link to={`/${d.city}/n/${d.neighborhood}`}>← Explore the neighborhood</Link>
      <p className="partner-eyebrow">Partner property · {cityInfo(d.city).name}</p>
      <h1>{d.name}</h1>
      <p>
        {d.address}, {cityInfo(d.city).name}, {d.state} {d.zip}
      </p>
      <div className="partner-gallery">
        {d.media.length ? (
          d.media.map((id: string, i: number) => (
            <img
              key={id}
              loading={i ? 'lazy' : 'eager'}
              src={`/api/partners/media/${id}`}
              alt={property.photos?.find((m: any) => m.id === id)?.alt ?? `${d.name} — photograph ${i + 1}`}
            />
          ))
        ) : (
          <div className="partner-photo-placeholder">Property photographs not provided</div>
        )}
      </div>
      <div className="partner-split">
        <div>
          <h2>About this community</h2>
          <p className="partner-description">{d.description}</p>
          <h2>Amenities</h2>
          <ul className="partner-amenities">
            {d.amenities.map((a: string) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          <p>
            Pets: {d.pets.replaceAll('_', ' ')} · Parking: {d.parking.replaceAll('_', ' ')}
          </p>
        </div>
        <aside className="partner-paper">
          <h2>
            ${d.rentMin.toLocaleString()}–${d.rentMax.toLocaleString()}
            <small> / month</small>
          </h2>
          <p>
            {d.bedrooms.map((n: number) => (n === 0 ? 'Studio' : `${n} bedroom`)).join(' · ')} · {d.bathrooms} bathrooms
          </p>
          {d.squareFeet && <p>Typical size: {d.squareFeet.toLocaleString()} sq ft</p>}
          <p>Lease options: {d.leaseOptions}</p>
          <p>
            Last verified: {d.verifiedAt}
            {stale ? ' · Verification is over 30 days old' : ''}
          </p>
          <p>
            Pricing and availability may change. A rent range does not guarantee a suitable unit. Confirm current
            availability, fees, and lease terms directly with the property manager.
          </p>
          <a className="btn btn-primary" href={`/api/out/${property.id}?source=property`} rel="nofollow">
            Visit Leasing Website ↗
          </a>
        </aside>
      </div>
    </div>
  );
}
