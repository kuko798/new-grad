import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CITIES, cityInfo } from '../lib/cities.ts';
import { partnerRequest as api } from '../lib/partner-api.ts';
import { ErrorNotice, Field } from '../pages/PartnershipPage.tsx';
const amenities = [
  'In-unit laundry',
  'Laundry facilities',
  'Air conditioning',
  'Fitness center',
  'Elevator',
  'Pool',
  'Coworking space',
  'Bike storage',
  'Package lockers',
  'Outdoor space',
  'Accessible units',
  'Pet amenities',
];
const initial = {
  name: '',
  address: '',
  city: 'chicago',
  state: 'IL',
  zip: '',
  neighborhood: '',
  type: 'Apartment community',
  description: '',
  website: '',
  leasingUrl: '',
  rentMin: 0,
  rentMax: 0,
  bedrooms: [1],
  bathrooms: 1,
  squareFeet: null,
  leaseOptions: '12 months',
  pets: 'contact',
  parking: 'contact',
  availability: 'contact',
  verifiedAt: new Date().toISOString().slice(0, 10),
  amenities: [],
  media: [],
  advertisingPermission: false,
  photoRights: false,
};
export function PropertyEditor({ id, admin }: { id?: string; admin: boolean }) {
  const [data, setData] = useState<any>(initial),
    [record, setRecord] = useState<any>(null),
    [hoods, setHoods] = useState<any[]>([]),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(!!id),
    [progress, setProgress] = useState('');
  const navigate = useNavigate();
  const update = (key: string, value: any) => setData((d: any) => ({ ...d, [key]: value }));
  useEffect(() => {
    if (id)
      api(`properties/${id}`)
        .then((p) => {
          setRecord(p);
          setData(p.draft);
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
  }, [id]);
  useEffect(() => {
    api(`neighborhoods?city=${data.city}`)
      .then(setHoods)
      .catch(() => setHoods([]));
  }, [data.city]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api(`properties${id ? `/${id}` : ''}`, data);
      if (!id) navigate(`/partner/properties/${result.id}`);
      else {
        setMessage('Draft saved. Submit it for review when you’re ready.');
        setRecord(await api(`properties/${id}`));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(action: string, note = '', verified = false, neighborhood?: string) {
    setBusy(true);
    setError('');
    try {
      await api(`properties/${id}/action`, { action, note, verified, neighborhood });
      setRecord(await api(`properties/${id}`));
      setMessage(`Property ${action.replaceAll('_', ' ')} completed.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(files: FileList | File[] | null) {
    if (!files || !id) return;
    if (data.media.length + files.length > 12) {
      setError('Select at most 12 photographs per property.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      let i = 0;
      for (const file of Array.from(files)) {
        requirePhoto(file);
        setProgress(`Uploading ${++i} of ${files.length}: ${file.name}`);
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const result = await api(`properties/${id}/media`, {
          base64,
          alt: `${data.name} — ${file.name.replace(/\.[^.]+$/, '')}`,
          rights: data.photoRights,
        });
        setRecord((r: any) => ({ ...r, media: [...(r?.media ?? []), result] }));
        setData((d: any) => ({ ...d, media: [...d.media, result.id] }));
      }
      setMessage('Photos uploaded. Save the draft to keep this selection and order.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress('');
    }
  }
  if (loading) return <p role="status">Loading property…</p>;
  if (id && !record) return <ErrorNotice error={error || 'Property could not be loaded.'} />;
  const disabled = admin || record?.status === 'archived';
  return (
    <>
      <Link to={admin ? '/admin/properties' : '/partner/properties'}>
        ← {admin ? 'Property reviews' : 'My properties'}
      </Link>
      <div className="partner-title-row">
        <h1>{id ? data.name : 'Introduce your property.'}</h1>
        {record && <span className="partner-status">{record.status.replaceAll('_', ' ')}</span>}
      </div>
      {record?.published && (
        <p className="notice">
          A reviewed version is published, subject to your partnership’s active dates. Edits below remain private until
          approved. <Link to={`/properties/${record.slug}`}>View public page ↗</Link>
        </p>
      )}
      {record?.review_note && <p className="notice">Review note: {record.review_note}</p>}
      <ErrorNotice error={error} />
      <p role="status">{message}</p>
      <form onSubmit={save} className="partner-form">
        <fieldset disabled={disabled || busy}>
          <legend>Property information</legend>
          <div className="partner-fields">
            {[
              ['name', 'Property name'],
              ['address', 'Street address'],
              ['zip', 'ZIP code'],
            ].map(([key, label]) => (
              <Field key={key} label={label}>
                <input required maxLength={250} value={data[key]} onChange={(e) => update(key, e.target.value)} />
              </Field>
            ))}
            <Field label="City">
              <select
                value={data.city}
                onChange={(e) => {
                  update('city', e.target.value);
                  update('state', cityInfo(e.target.value).state);
                  update('neighborhood', '');
                }}
              >
                {CITIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}, {c.state}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Suggested neighborhood (administrator verifies)">
              <select value={data.neighborhood} onChange={(e) => update('neighborhood', e.target.value)}>
                <option value="">Needs administrator assignment</option>
                {hoods.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Property type">
              <select value={data.type} onChange={(e) => update('type', e.target.value)}>
                {['Apartment community', 'Condominium', 'Townhomes', 'Other'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
          </div>
          <p className="note">
            A neighborhood choice does not establish eligibility. Our administrator must verify the address against the
            neighborhood before publishing.
          </p>
          <Field label="Description">
            <textarea
              required
              minLength={20}
              maxLength={6000}
              value={data.description}
              onChange={(e) => update('description', e.target.value)}
            />
          </Field>
          <div className="partner-fields">
            {[
              ['website', 'Property website'],
              ['leasingUrl', 'Official leasing URL'],
            ].map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  type="url"
                  required
                  value={data[key]}
                  onChange={(e) => update(key, e.target.value)}
                  placeholder="https://"
                />
              </Field>
            ))}
          </div>
        </fieldset>
        <fieldset disabled={disabled || busy}>
          <legend>Rental details</legend>
          <div className="partner-fields">
            {[
              ['rentMin', 'Minimum monthly rent ($)'],
              ['rentMax', 'Maximum monthly rent ($)'],
              ['bathrooms', 'Bathrooms'],
              ['squareFeet', 'Typical square feet (optional)'],
            ].map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  type="number"
                  min={key === 'bathrooms' ? 0.5 : 1}
                  step={key === 'bathrooms' ? 0.5 : 1}
                  required={key !== 'squareFeet'}
                  value={data[key] ?? ''}
                  onChange={(e) => update(key, e.target.value === '' ? null : Number(e.target.value))}
                />
              </Field>
            ))}
            <Field label="Lease options">
              <input required value={data.leaseOptions} onChange={(e) => update('leaseOptions', e.target.value)} />
            </Field>
            <Field label="Last verified date">
              <input
                type="date"
                required
                max={new Date().toISOString().slice(0, 10)}
                value={data.verifiedAt}
                onChange={(e) => update('verifiedAt', e.target.value)}
              />
            </Field>
            {[
              ['pets', 'Pet policy', ['contact', 'allowed', 'not_allowed']],
              ['parking', 'Parking', ['contact', 'available', 'not_available']],
              ['availability', 'Availability', ['contact', 'available', 'unavailable']],
            ].map(([key, label, values]) => (
              <Field key={String(key)} label={String(label)}>
                <select value={data[String(key)]} onChange={(e) => update(String(key), e.target.value)}>
                  {(values as string[]).map((v) => (
                    <option key={v} value={v}>
                      {v.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          <fieldset>
            <legend>Bedroom configurations</legend>
            <div className="partner-actions">
              {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                <label className="partner-check" key={n}>
                  <input
                    type="checkbox"
                    checked={data.bedrooms.includes(n)}
                    onChange={(e) =>
                      update(
                        'bedrooms',
                        e.target.checked ? [...data.bedrooms, n] : data.bedrooms.filter((v: number) => v !== n),
                      )
                    }
                  />
                  {n === 0 ? 'Studio' : `${n} bed`}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Amenities</legend>
            <div className="partner-city-checks">
              {amenities.map((a) => (
                <label key={a}>
                  <input
                    type="checkbox"
                    checked={data.amenities.includes(a)}
                    onChange={(e) =>
                      update(
                        'amenities',
                        e.target.checked ? [...data.amenities, a] : data.amenities.filter((v: string) => v !== a),
                      )
                    }
                  />
                  {a}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Other amenities (comma separated)">
            <input
              value={data.amenities.filter((a: string) => !amenities.includes(a)).join(', ')}
              onChange={(e) =>
                update('amenities', [
                  ...data.amenities.filter((a: string) => amenities.includes(a)),
                  ...e.target.value
                    .split(',')
                    .map((a) => a.trim())
                    .filter(Boolean),
                ])
              }
            />
          </Field>
        </fieldset>
        <fieldset disabled={disabled || busy}>
          <legend>Property photographs</legend>
          <label className="partner-check">
            <input
              type="checkbox"
              checked={data.photoRights}
              onChange={(e) => update('photoRights', e.target.checked)}
            />
            I own these photographs or have permission to publish them here.
          </label>
          {!id ? (
            <p>Save your property details first to enable uploads.</p>
          ) : (
            !admin && (
              <div
                className="partner-upload"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (data.photoRights && !disabled) upload(e.dataTransfer.files);
                }}
              >
                <Field label="Drop photographs here or choose files (JPEG, PNG, WebP; 3 MB each)">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    disabled={!data.photoRights || data.media.length >= 12}
                    onChange={(e) => upload(e.target.files)}
                  />
                </Field>
              </div>
            )
          )}
          <p role="status">{progress}</p>
          <div className="partner-photo-grid">
            {data.media.map((m: string, i: number) => (
              <div key={m}>
                <img
                  src={`/api/partners/media/${m}`}
                  alt={record?.media?.find((v: any) => v.id === m)?.alt ?? data.name}
                />
                <PhotoCaption
                  id={m}
                  initial={record?.media?.find((v: any) => v.id === m)?.alt ?? data.name}
                  readOnly={admin}
                />
                <span>{i === 0 ? 'Cover photo' : `Photo ${i + 1}`}</span>
                {!admin && (
                  <div className="partner-actions">
                    <button
                      type="button"
                      className="btn"
                      disabled={i === 0}
                      onClick={() => {
                        const order = [...data.media];
                        [order[i - 1], order[i]] = [order[i], order[i - 1]];
                        update('media', order);
                      }}
                    >
                      Move earlier
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        update(
                          'media',
                          data.media.filter((v: string) => v !== m),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="note">
            The first photo is the cover. Removed photos stay in review history; changes to the public gallery require
            approval.
          </p>
        </fieldset>
        {!admin && (
          <>
            <label className="partner-check">
              <input
                required
                type="checkbox"
                checked={data.advertisingPermission}
                disabled={disabled}
                onChange={(e) => update('advertisingPermission', e.target.checked)}
              />
              I am authorized to advertise this property and confirm these details are accurate.
            </label>
            <button className="btn btn-primary" disabled={busy || disabled}>
              {busy ? 'Saving…' : 'Save draft'}
            </button>
          </>
        )}
      </form>
      {id && !admin && record?.status !== 'archived' && (
        <section className="partner-paper">
          <h2>Ready for review?</h2>
          <p>Save your latest changes before submitting. Every new or edited listing is reviewed before publication.</p>
          <div className="partner-actions">
            <button
              className="btn btn-primary"
              disabled={busy || !['draft', 'changes_requested', 'rejected'].includes(record.status)}
              onClick={() => action('submit')}
            >
              Submit for review
            </button>
            {record.published && (
              <button className="btn" disabled={busy} onClick={() => action('withdraw')}>
                Withdraw public listing now
              </button>
            )}
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                if (confirm('Archive this property? It will leave public pages and remain in your history.'))
                  action('archive');
              }}
            >
              Archive property
            </button>
          </div>
        </section>
      )}
      {admin && (
        <section className="partner-paper">
          <h2>Publication review</h2>
          <p>
            Check the address, neighborhood boundaries, advertising authorization, photographs, prices, and official
            leasing destination. Public edits remain on the last approved version until this review is complete.
          </p>
          <form
            className="partner-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              action(
                (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') ?? '',
                String(f.get('note')),
                f.get('verified') === 'on',
                String(f.get('neighborhood') ?? ''),
              );
            }}
          >
            <Field label="Verified neighborhood">
              <select name="neighborhood" defaultValue={data.neighborhood}>
                <option value="">Choose the verified neighborhood</option>
                {hoods.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Review note">
              <textarea name="note" maxLength={4000} />
            </Field>
            <label className="partner-check">
              <input type="checkbox" name="verified" />I verified that this street address is in the selected
              neighborhood.
            </label>
            <div className="partner-actions">
              {[
                ['approve', 'Approve & publish'],
                ['changes_requested', 'Request corrections'],
                ['reject', 'Reject'],
                ['withdraw', 'Unpublish'],
                ['archive', 'Archive'],
              ].map(([value, label]) => (
                <button
                  className="btn"
                  key={value}
                  value={value}
                  disabled={
                    busy ||
                    (['approve', 'reject', 'changes_requested'].includes(value) && record.status !== 'pending_review')
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </form>
        </section>
      )}
      {record?.revisions?.length > 0 && (
        <section>
          <h2>Revision history</h2>
          <ul className="partner-history">
            {record.revisions.map((r: any) => (
              <li key={r.id}>
                {r.action.replaceAll('_', ' ')} · {new Date(r.created_at).toLocaleString()}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
function requirePhoto(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 3_000_000)
    throw new Error('Choose JPEG, PNG or WebP photographs under 3 MB.');
}
function PhotoCaption({ id, initial, readOnly }: { id: string; initial: string; readOnly: boolean }) {
  const [alt, setAlt] = useState(initial),
    [message, setMessage] = useState('');
  return (
    <div>
      <Field label="Photo description for screen readers">
        <input maxLength={250} value={alt} readOnly={readOnly} onChange={(e) => setAlt(e.target.value)} />
      </Field>
      {!readOnly && (
        <button
          type="button"
          className="btn"
          onClick={async () => {
            try {
              await api(`media/${id}`, { alt });
              setMessage('Photo description saved.');
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          Save description
        </button>
      )}
      <p role="status">{message}</p>
    </div>
  );
}
