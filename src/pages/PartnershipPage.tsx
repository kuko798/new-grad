import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CITIES, cityInfo } from '../lib/cities.ts';
import { partnerRequest as api } from '../lib/partner-api.ts';
import { PropertyEditor } from '../components/PropertyEditor.tsx';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="partner-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function ErrorNotice({ error }: { error: string }) {
  return error ? (
    <p role="alert" className="partner-error">
      {error}
    </p>
  ) : null;
}
export function useResource(path: string) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    setError('');
    setData(null);
    api(path)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [path, revision]);
  return { data, error, reload: () => setRevision((v) => v + 1) };
}
const date = (v: string | null) =>
  v
    ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Starts at first publication';
function AsyncPanel({
  resource,
  children,
}: {
  resource: ReturnType<typeof useResource>;
  children: (data: any) => ReactNode;
}) {
  return resource.error ? (
    <div>
      <ErrorNotice error={resource.error} />
      <button className="btn" onClick={resource.reload}>
        Try again
      </button>
    </div>
  ) : resource.data === null ? (
    <p role="status">Loading partnership information…</p>
  ) : (
    <>{children(resource.data)}</>
  );
}

export default function PartnershipPage() {
  const { pathname } = useLocation();
  const publicPage = pathname === '/partners';
  useEffect(() => {
    document.title = publicPage ? 'Property partnerships — Your Next Corner' : 'Partner workspace — Your Next Corner';
    const tag = document.createElement('meta');
    tag.name = 'robots';
    tag.content = publicPage ? 'index,follow' : 'noindex,nofollow';
    document.head.append(tag);
    return () => tag.remove();
  }, [publicPage]);
  if (publicPage) return <PartnerLanding />;
  if (pathname === '/partners/apply') return <Application />;
  if (['/partners/login', '/partners/accept', '/partners/recover'].includes(pathname))
    return <Authentication mode={pathname.split('/').pop()!} />;
  if (pathname === '/partners/terms' || pathname === '/partners/privacy')
    return <PartnerTerms privacy={pathname.endsWith('privacy')} />;
  return <Workspace key={pathname} path={pathname} />;
}
function PartnerLanding() {
  return (
    <div className="partner-page partner-marketing">
      <div className="partner-intro">
        <p className="partner-eyebrow">Your Next Corner · Founding partnerships</p>
        <h1>Connect Your Properties With Renters Finding Their Next Neighborhood</h1>
        <p>
          Partner with Your Next Corner to help people relocating across the United States discover apartment
          communities that fit their budget, lifestyle, and location preferences.
        </p>
        <div className="partner-actions">
          <Link className="btn btn-primary" to="/partners/apply">
            Become a Founding Partner ↗
          </Link>
          <Link to="/partners/login">Partner login</Link>
        </div>
      </div>
      <section className="partner-offer">
        <div>
          <strong>90 days</strong>
          <span>Free, from your first published property</span>
        </div>
        <div>
          <strong>5 properties</strong>
          <span>One place to manage your communities</span>
        </div>
        <div>
          <strong>No automatic billing</strong>
          <span>No obligation to continue</span>
        </div>
      </section>
      <section className="partner-split">
        <h2>
          A useful introduction.
          <br />
          At the neighborhood level.
        </h2>
        <div>
          <p>
            Renters come here to understand the places they could call home. Your approved properties appear alongside
            relevant neighborhood information, with a direct link to your official leasing website.
          </p>
          <p>
            Partnerships never influence neighborhood fit scores. You manage your property information; our team reviews
            it before publication.
          </p>
          <p>
            See property impressions, detail views, and outbound clicks. These measure interest—not rental applications
            or signed leases.
          </p>
        </div>
      </section>
      <section>
        <h2>From application to first listing</h2>
        <ol className="partner-steps">
          <li>
            <h3>Apply as a company</h3>
            <p>Tell us about your communities and the cities you serve.</p>
          </li>
          <li>
            <h3>Receive your invitation</h3>
            <p>Our team reviews your application. Approved representatives receive a secure account invitation.</p>
          </li>
          <li>
            <h3>Build your property pages</h3>
            <p>Accept your invitation, add accurate details and your own photographs, and submit for review.</p>
          </li>
          <li>
            <h3>Meet neighborhood explorers</h3>
            <p>
              Once approved, your first published property starts your 90-day pilot. Follow engagement in your
              dashboard.
            </p>
          </li>
        </ol>
      </section>
      <section className="partner-split">
        <h2>Common questions</h2>
        <div>
          {[
            [
              'Is there a cost?',
              'The founding pilot is free for 90 days. There are no upfront fees, automatic charges, or obligations to continue.',
            ],
            ['When does the pilot begin?', 'On the first publication of an approved property, not when you apply.'],
            [
              'What counts toward the five-property limit?',
              'All properties except archived properties, including drafts and submissions awaiting review. Replacement activity is limited and recorded.',
            ],
            [
              'Are inquiries or leases guaranteed?',
              'No. We report impressions, detail views, and clicks to your official leasing site. We do not promise qualified leads, applications, or leases.',
            ],
            [
              'Do we need to promote the partnership?',
              'Co-marketing is optional. We can discuss a launch announcement, backlink, social post, or relocation resource.',
            ],
            [
              'Which cities are supported?',
              'All cities listed below are supported. Each property must belong to a supported city and a verified neighborhood.',
            ],
            [
              'How are listings displayed?',
              'Reviewed properties appear on their neighborhood pages, filtered by available budget, bedroom, pet, and parking information. They never change neighborhood rankings.',
            ],
            [
              'Can I update my listings?',
              'Yes. Save an edited draft and submit it for review. The previous approved version stays public until approval; you can withdraw it immediately.',
            ],
            [
              'How is performance measured?',
              'We count visible property cards, detail-page visits, and clicks to official leasing sites. Known bots are excluded and repeated events are deduplicated within 30 minutes.',
            ],
            [
              'What happens after 90 days?',
              'Public listings pause unless the administrator extends your partnership. Your account and records remain available. No automatic billing applies.',
            ],
          ].map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>
      <section>
        <h2>Built for a move across town—or across the country.</h2>
        <p>Apply for properties in any of our supported cities.</p>
        <div className="partner-city-list">
          {CITIES.map((c) => (
            <span key={c.id}>
              {c.name}, {c.state}
            </span>
          ))}
        </div>
      </section>
      <section className="partner-cta">
        <h2>Give your next residents a place to start.</h2>
        <Link className="btn btn-primary" to="/partners/apply">
          Become a Founding Partner ↗
        </Link>
      </section>
      <p className="note">
        <Link to="/partners/terms">Pilot terms</Link> · <Link to="/partners/privacy">Partner privacy</Link>
      </p>
    </div>
  );
}
function Application() {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      await api('apply', {
        ...Object.fromEntries(f),
        communityCount: Number(f.get('communityCount')),
        cities: f.getAll('cities'),
        terms: f.get('terms') === 'on',
        comarketing: f.get('comarketing') === 'on',
      });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (done)
    return (
      <div className="partner-page partner-narrow">
        <h1>Application received.</h1>
        <p>Our team will review your company and contact your representative. Your pilot has not started yet.</p>
        <p>A confirmation email is queued for delivery. If delivery is unavailable, your application is still saved.</p>
        <Link className="btn" to="/partners">
          Back to partnerships
        </Link>
      </div>
    );
  return (
    <div className="partner-page partner-narrow">
      <Link to="/partners">← Founding partnerships</Link>
      <h1>Let’s meet your communities.</h1>
      <p>Free for 90 days. Up to five properties. Every listing reviewed before publication.</p>
      <form onSubmit={submit} className="partner-form">
        <h2>Company information</h2>
        <div className="partner-fields">
          {[
            ['company', 'Company name', 'text'],
            ['website', 'Company website', 'url'],
            ['businessEmail', 'Business email', 'email'],
            ['operatingLocations', 'Operating cities and states', 'text'],
            ['communityCount', 'Number of communities', 'number'],
          ].map(([name, label, type]) => (
            <Field key={name} label={label}>
              <input name={name} type={type} required maxLength={250} min={1} max={100000} />
            </Field>
          ))}
        </div>
        <Field label="Company description">
          <textarea name="description" required minLength={20} maxLength={4000} />
        </Field>
        <h2>Primary contact</h2>
        <div className="partner-fields">
          {[
            ['contactName', 'Full name', 'text'],
            ['contactRole', 'Role or title', 'text'],
            ['contactEmail', 'Contact email', 'email'],
            ['phone', 'Phone (optional)', 'tel'],
          ].map(([name, label, type]) => (
            <Field key={name} label={label}>
              <input name={name} type={type} required={name !== 'phone'} maxLength={name === 'phone' ? 40 : 250} />
            </Field>
          ))}
        </div>
        <fieldset>
          <legend>Cities you’re interested in</legend>
          <div className="partner-city-checks">
            {CITIES.map((c) => (
              <label key={c.id}>
                <input type="checkbox" name="cities" value={c.id} />
                {c.name}, {c.state}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="partner-check">
          <input type="checkbox" name="comarketing" />
          I’m interested in optional co-marketing.
        </label>
        <Field label="Additional notes (optional)">
          <textarea name="notes" maxLength={4000} />
        </Field>
        <div className="partner-honeypot" aria-hidden="true">
          <label>
            Leave blank
            <input name="websiteConfirm" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        <label className="partner-check">
          <input type="checkbox" name="terms" required />I agree to the{' '}
          <Link to="/partners/terms" target="_blank">
            pilot terms
          </Link>{' '}
          and{' '}
          <Link to="/partners/privacy" target="_blank">
            privacy notice
          </Link>
          .
        </label>
        <ErrorNotice error={error} />
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Submitting…' : 'Submit application ↗'}
        </button>
      </form>
    </div>
  );
}
function Authentication({ mode }: { mode: string }) {
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const result = await api(mode, {
        ...f,
        ...(mode === 'accept' ? { token: new URLSearchParams(location.hash.slice(1)).get('token') ?? '' } : {}),
      });
      if (mode === 'recover') setMessage(result.message);
      else {
        history.replaceState(null, '', location.pathname);
        const me = await api('me');
        navigate(me.platform_admin ? '/admin/partners' : '/partner/dashboard');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="partner-page partner-auth">
      <p className="partner-eyebrow">Your Next Corner · Partner workspace</p>
      <h1>
        {mode === 'login' ? 'Welcome back.' : mode === 'accept' ? 'Make yourself at home.' : 'Recover your account.'}
      </h1>
      <p>
        {mode === 'accept'
          ? 'Set a password of at least 12 characters. Your invitation is single-use.'
          : 'Manage the places your next residents will discover.'}
      </p>
      <form onSubmit={submit} className="partner-form">
        {mode !== 'accept' && (
          <Field label="Email">
            <input name="email" type="email" autoComplete="username" required />
          </Field>
        )}
        {mode !== 'recover' && (
          <Field label="Password">
            <input
              name="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={mode === 'accept' ? 12 : 1}
              maxLength={200}
              required
            />
          </Field>
        )}
        <ErrorNotice error={error} />
        {message && <p role="status">{message}</p>}
        <button className="btn btn-primary" disabled={busy}>
          {busy
            ? 'Please wait…'
            : mode === 'login'
              ? 'Sign in'
              : mode === 'accept'
                ? 'Activate account'
                : 'Send recovery link'}
        </button>
      </form>
      <div className="partner-actions">
        <Link to="/partners/recover">Forgot password?</Link>
        <Link to="/partners/apply">Apply for a partnership</Link>
      </div>
    </div>
  );
}
function Workspace({ path }: { path: string }) {
  const me = useResource('me');
  const navigate = useNavigate();
  const admin = path.startsWith('/admin/');
  return (
    <div className="partner-page">
      <AsyncPanel resource={me}>
        {(user) => {
          if (admin && !user.platform_admin) return <ErrorNotice error="Administrator access is required." />;
          const links = admin
            ? [
                ['/admin/partners', 'Partners'],
                ['/admin/properties', 'Property reviews'],
                ['/admin/partner-analytics', 'Analytics'],
                ['/admin/notifications', 'Notifications'],
                ['/admin/audit', 'Audit history'],
              ]
            : [
                ['/partner/dashboard', 'Overview'],
                ['/partner/properties', 'My properties'],
                ['/partner/analytics', 'Analytics'],
                ['/partner/profile', 'Company profile'],
                ['/partner/partnership', 'Partnership'],
              ];
          return (
            <>
              <header className="partner-workspace-head">
                <div>
                  <p className="partner-eyebrow">{admin ? 'Platform administration' : 'Partner workspace'}</p>
                  <span>{user.email}</span>
                </div>
                <button
                  className="btn"
                  onClick={async () => {
                    await api('logout', {});
                    navigate('/partners/login');
                  }}
                >
                  Sign out
                </button>
              </header>
              <nav className="partner-tabs" aria-label="Partner workspace">
                {links.map(([href, label]) => (
                  <Link key={href} to={href} aria-current={path === href ? 'page' : undefined}>
                    {label}
                  </Link>
                ))}
              </nav>
              {path.includes('/properties/') ? (
                <PropertyEditor
                  id={path.split('/').pop() === 'new' ? undefined : path.split('/').pop()}
                  admin={admin}
                />
              ) : path.endsWith('analytics') ? (
                <Analytics admin={admin} />
              ) : admin ? (
                <AdminScreen path={path} />
              ) : (
                <PartnerOverview path={path} />
              )}
            </>
          );
        }}
      </AsyncPanel>
      {me.error && (
        <Link className="btn btn-primary" to="/partners/login">
          Sign in to your account
        </Link>
      )}
    </div>
  );
}
function PartnerOverview({ path }: { path: string }) {
  const resource = useResource('dashboard');
  return (
    <AsyncPanel resource={resource}>
      {({ org, properties, campaigns }) => {
        const used = properties.filter((p: any) => p.status !== 'archived').length;
        if (path.endsWith('/profile')) return <Profile org={org} />;
        if (path.endsWith('/partnership'))
          return (
            <>
              <h1>Your founding partnership</h1>
              <div className="partner-paper">
                <h2>{org.name}</h2>
                <p>
                  Status: <strong>{org.partnership_status}</strong>
                </p>
                <p>Pilot begins: {date(org.starts_at)}</p>
                <p>Pilot ends: {org.ends_at ? date(org.ends_at) : '90 days after your first property is published'}</p>
                <p>No upfront fees. No automatic billing. No obligation to continue.</p>
                <p>Agreement: {org.agreement_version}</p>
              </div>
              <h2>Share your launch</h2>
              <p>Optional co-marketing is managed in your company profile.</p>
              <Field label="Partner referral link">
                <input
                  readOnly
                  value={`${location.origin}/?utm_source=partner&utm_medium=referral&utm_campaign=${campaigns[0]?.code ?? ''}`}
                />
              </Field>
              <p className="partner-paper">
                We’re joining Your Next Corner to help renters explore neighborhoods and discover our communities. Find
                a place for your next chapter.
              </p>
              <p>
                Only use this announcement after your first property is approved. Logo use requires the owner’s
                permission.
              </p>
            </>
          );
        return (
          <>
            <div className="partner-title-row">
              <div>
                <p className="partner-eyebrow">{org.name}</p>
                <h1>{path.endsWith('/properties') ? 'Your properties.' : 'A place for your next residents.'}</h1>
              </div>
              {used < 5 ? (
                <Link className="btn btn-primary" to="/partner/properties/new">
                  Add property ↗
                </Link>
              ) : (
                <button className="btn" disabled>
                  All five slots used
                </button>
              )}
            </div>
            <section className="partner-offer">
              <div>
                <strong>{used} of 5</strong>
                <span>Property slots used · {5 - used} remaining</span>
              </div>
              <div>
                <strong>{properties.filter((p: any) => p.published && p.status !== 'archived').length}</strong>
                <span>Reviewed public versions</span>
              </div>
              <div>
                <strong>{properties.filter((p: any) => p.status === 'pending_review').length}</strong>
                <span>Awaiting review</span>
              </div>
              <div>
                <strong>{properties.filter((p: any) => p.status === 'draft').length}</strong>
                <span>Drafts</span>
              </div>
              <div>
                <strong>{org.partnership_status}</strong>
                <span>{org.ends_at ? `Pilot ends ${date(org.ends_at)}` : 'Pilot starts at first publication'}</span>
              </div>
            </section>
            {used === 5 && (
              <p className="notice">
                All five property slots are used. Contact the administrator to discuss replacements.
              </p>
            )}
            {properties.length ? (
              <div className="partner-list">
                {properties.map((p: any) => (
                  <Link className="partner-property-row" key={p.id} to={`/partner/properties/${p.id}`}>
                    <div>
                      <h2>{p.draft.name}</h2>
                      <p>
                        {p.draft.address} · {cityInfo(p.draft.city).name}
                      </p>
                    </div>
                    <span className="partner-status">{p.status.replaceAll('_', ' ')}</span>
                    <span aria-hidden="true">↗</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="partner-empty">
                <h2>Your first community starts here.</h2>
                <p>
                  Add the address, rental details, and your photographs. Submit when you’re ready; our team reviews
                  every property before it appears publicly.
                </p>
                <Link className="btn" to="/partner/properties/new">
                  Add your first property
                </Link>
              </div>
            )}
            <p className="note">
              Drafts, pending reviews, and rejected listings count toward your limit. Archived properties remain in your
              history.
            </p>
            {path.endsWith('/dashboard') && <Analytics admin={false} compact />}
          </>
        );
      }}
    </AsyncPanel>
  );
}
function Profile({ org }: { org: any }) {
  const [message, setMessage] = useState(''),
    [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      await api('profile', {
        description: f.get('description'),
        phone: f.get('phone'),
        logoPermission: f.get('logoPermission') === 'on',
        commitments: f.getAll('commitments'),
      });
      setMessage('Company profile saved.');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <h1>Company profile</h1>
      <h2>{org.name}</h2>
      <form className="partner-form partner-narrow" onSubmit={submit}>
        <Field label="Description">
          <textarea name="description" defaultValue={org.profile.description} maxLength={4000} />
        </Field>
        <Field label="Phone">
          <input name="phone" defaultValue={org.profile.phone} maxLength={40} />
        </Field>
        <label className="partner-check">
          <input type="checkbox" name="logoPermission" defaultChecked={org.logo_permission} />I authorize use of our
          company logo for this partnership.
        </label>
        <fieldset>
          <legend>Optional co-marketing commitments</legend>
          {['Launch announcement', 'Social post', 'Backlink', 'Newsletter', 'Relocation resources'].map((c) => (
            <label className="partner-check" key={c}>
              <input type="checkbox" name="commitments" value={c} defaultChecked={org.commitments.includes(c)} />
              {c}
            </label>
          ))}
        </fieldset>
        <ErrorNotice error={error} />
        <p role="status">{message}</p>
        <button className="btn btn-primary">Save profile</button>
      </form>
    </>
  );
}
function Analytics({ admin, compact = false }: { admin: boolean; compact?: boolean }) {
  const [days, setDays] = useState(30);
  const resource = useResource(`${admin ? 'admin/' : ''}analytics?days=${days}`);
  return (
    <section className="partner-analytics">
      <div className="partner-title-row">
        {compact ? <h2>Property engagement</h2> : <h1>Property engagement</h1>}
        <Field label="Reporting period">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 30, 90].map((n) => (
              <option key={n} value={n}>
                Last {n} days
              </option>
            ))}
          </select>
        </Field>
      </div>
      <AsyncPanel resource={resource}>
        {({ rows, daily }) => {
          const total = (kind: string) =>
            rows.filter((r: any) => r.kind === kind).reduce((sum: number, r: any) => sum + r.count, 0);
          const impressions = total('impression'),
            clicks = total('outbound');
          const props = Array.from(new Set(rows.map((r: any) => r.property_id)));
          const max = Math.max(1, ...daily.map((d: any) => d.count));
          return (
            <>
              {admin && <AdminAnalyticsSummary days={days} />}
              <section className="partner-offer">
                {[
                  [impressions, 'Impressions'],
                  [total('detail'), 'Detail views'],
                  [clicks, 'Outbound clicks'],
                  [`${impressions ? ((100 * clicks) / impressions).toFixed(1) : '0.0'}%`, 'Clicks / impressions'],
                ].map(([n, l]) => (
                  <div key={l}>
                    <strong>{n}</strong>
                    <span>{l}</span>
                  </div>
                ))}
              </section>
              <p className="note">
                Engagement measures browsing activity, not leads or leases. Repeat events are deduplicated within 30
                minutes. Known bots are excluded.
              </p>
              {!rows.length ? (
                <div className="partner-empty">
                  <h2>Your report starts with real visits.</h2>
                  <p>
                    No tracked activity in this period. Publish a reviewed property and share its page to get started.
                  </p>
                </div>
              ) : (
                <>
                  <div className="partner-bars" aria-label="Daily engagement">
                    {daily.map((d: any) => (
                      <div key={`${d.day}${d.kind}`}>
                        <span>
                          {d.day} · {d.kind}
                        </span>
                        <meter min={0} max={max} value={d.count}>
                          {d.count}
                        </meter>
                        <strong>{d.count}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="partner-table-wrap">
                    <table>
                      <caption>Engagement by property</caption>
                      <thead>
                        <tr>
                          <th>Property</th>
                          <th>City</th>
                          <th>Impressions</th>
                          <th>Detail views</th>
                          <th>Outbound clicks</th>
                          <th>CTR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {props.map((id: any) => {
                          const r = rows.filter((v: any) => v.property_id === id),
                            n = (kind: string) =>
                              r.filter((v: any) => v.kind === kind).reduce((s: number, v: any) => s + v.count, 0);
                          return (
                            <tr key={id ?? 'referrals'}>
                              <th>{r[0].name}</th>
                              <td>{r[0].city ? cityInfo(r[0].city).name : 'All cities'}</td>
                              <td>{n('impression')}</td>
                              <td>{n('detail')}</td>
                              <td>{n('outbound')}</td>
                              <td>{n('impression') ? ((100 * n('outbound')) / n('impression')).toFixed(1) : '0.0'}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          );
        }}
      </AsyncPanel>
    </section>
  );
}
function AdminAnalyticsSummary({ days }: { days: number }) {
  const resource = useResource(`admin/summary?days=${days}`);
  return (
    <AsyncPanel resource={resource}>
      {({ counts, organizations, cities }) => (
        <>
          <section className="partner-offer">
            {Object.entries(counts).map(([key, count]) => (
              <div key={key}>
                <strong>{String(count)}</strong>
                <span>
                  {
                    {
                      applications: `Applications in ${days} days`,
                      approved: 'Approved applications',
                      active: 'Active partners',
                      expired: 'Expired pilots',
                      published: 'Published properties',
                      pending: 'Properties awaiting review',
                    }[key]
                  }
                </span>
              </div>
            ))}
          </section>
          <div className="partner-split">
            <div>
              <h2>Partner activity</h2>
              {organizations.length ? (
                organizations.map((r: any) => (
                  <p key={`${r.name}${r.kind}`}>
                    {r.name} · {r.kind}: <strong>{r.count}</strong>
                  </p>
                ))
              ) : (
                <p>No partner activity in this period.</p>
              )}
            </div>
            <div>
              <h2>Activity by city</h2>
              {cities.length ? (
                cities.map((r: any) => (
                  <p key={`${r.city}${r.kind}`}>
                    {r.city ? cityInfo(r.city).name : 'Campaign referrals'} · {r.kind}: <strong>{r.count}</strong>
                  </p>
                ))
              ) : (
                <p>No city activity in this period.</p>
              )}
            </div>
          </div>
        </>
      )}
    </AsyncPanel>
  );
}
function AdminScreen({ path }: { path: string }) {
  const [query, setQuery] = useState(''),
    [status, setStatus] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const type =
    path === '/admin/partners'
      ? 'applications'
      : path === '/admin/properties'
        ? 'properties'
        : path === '/admin/notifications'
          ? 'mail'
          : 'audit';
  const resource = useResource(`admin/${type}?q=${encodeURIComponent(query)}&status=${status}&from=${from}&to=${to}`);
  const orgs = useResource('admin/organizations');
  async function action(endpoint: string, data: unknown) {
    setBusy(true);
    setError('');
    try {
      await api(endpoint, data);
      resource.reload();
      orgs.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1>
        {type === 'applications'
          ? 'Partnership applications'
          : type === 'properties'
            ? 'Property review queue'
            : type === 'mail'
              ? 'Email delivery'
              : 'Audit history'}
      </h1>
      <ErrorNotice error={error} />
      {type === 'applications' && (
        <div className="partner-actions">
          <Field label="Search company, contact, or city">
            <input value={query} onChange={(e) => setQuery(e.target.value)} />
          </Field>
          <Field label="Application status">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {['pending', 'under_review', 'approved', 'rejected'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Applied from">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Applied through">
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      )}
      {type === 'mail' && (
        <button className="btn" disabled={busy} onClick={() => action('admin/mail/retry', {})}>
          Retry undelivered email
        </button>
      )}
      <AsyncPanel resource={resource}>
        {(rows) =>
          !rows.length ? (
            <div className="partner-empty">
              <h2>
                {type === 'applications'
                  ? 'No applications to review.'
                  : type === 'properties'
                    ? 'No properties submitted yet.'
                    : 'Nothing recorded yet.'}
              </h2>
            </div>
          ) : (
            <div className="partner-list">
              {rows.map((r: any) =>
                type === 'applications' ? (
                  <details className="partner-review" key={r.id}>
                    <summary>
                      <strong>{r.data.company}</strong>
                      <span>
                        {r.status.replaceAll('_', ' ')} · {date(r.created_at)}
                      </span>
                    </summary>
                    <p>{r.data.description}</p>
                    <p>
                      {r.data.contactName} · {r.data.contactRole} · <a href={`mailto:${r.email}`}>{r.email}</a>
                    </p>
                    <p>
                      {r.data.operatingLocations} · {r.data.communityCount} communities
                    </p>
                    <a href={r.data.website} target="_blank" rel="noreferrer">
                      Company website ↗
                    </a>
                    <p>Requested cities: {r.data.cities.map((c: string) => cityInfo(c).name).join(', ')}</p>
                    <p>Applicant notes: {r.data.notes || 'None'}</p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        action(`admin/applications/${r.id}`, {
                          action: (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value'),
                          note: f.get('note'),
                        });
                      }}
                    >
                      <Field label="Administrator note / message to applicant">
                        <textarea name="note" defaultValue={r.notes} maxLength={4000} />
                      </Field>
                      <div className="partner-actions">
                        {[
                          ['approve', 'Approve & invite'],
                          ['request_info', 'Request information'],
                          ['reject', 'Reject'],
                          ['note', 'Save private note'],
                        ].map(([v, label]) => (
                          <button
                            key={v}
                            className="btn"
                            value={v}
                            disabled={busy || (r.status === 'approved' && v !== 'note')}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </form>
                  </details>
                ) : type === 'properties' ? (
                  <Link className="partner-property-row" key={r.id} to={`/admin/properties/${r.id}`}>
                    <div>
                      <h2>{r.draft.name}</h2>
                      <p>
                        {r.company} · {cityInfo(r.draft.city).name}
                      </p>
                    </div>
                    <span>{r.status.replaceAll('_', ' ')}</span>
                    <span>Review ↗</span>
                  </Link>
                ) : (
                  <article className="partner-paper" key={r.id}>
                    <strong>{r.subject ?? r.action}</strong>
                    <p>{r.recipient ?? r.target}</p>
                    <p>
                      {r.status ?? JSON.stringify(r.detail)} · {date(r.created_at)}
                    </p>
                    {r.error && (
                      <p role="status">
                        {r.error} · {r.attempts} attempts
                      </p>
                    )}
                  </article>
                ),
              )}
            </div>
          )
        }
      </AsyncPanel>
      {type === 'applications' && (
        <>
          <h2>Partner organizations</h2>
          <AsyncPanel resource={orgs}>
            {(rows) =>
              rows.map((o: any) => (
                <article className="partner-paper" key={o.id}>
                  <h3>{o.name}</h3>
                  <p>
                    {o.status} · {o.partnership_status} · {o.property_count} of 5 slots · Pilot end: {date(o.ends_at)}
                  </p>
                  <div className="partner-actions">
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() =>
                        action(`admin/organizations/${o.id}`, {
                          action: o.status === 'active' ? 'suspend' : 'reactivate',
                        })
                      }
                    >
                      {o.status === 'active' ? 'Suspend' : 'Reactivate'}
                    </button>
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => action(`admin/organizations/${o.id}`, { action: 'extend', days: 90 })}
                    >
                      Extend 90 days
                    </button>
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => action(`admin/organizations/${o.id}`, { action: 'invite' })}
                    >
                      Send new invitation
                    </button>
                  </div>
                </article>
              ))
            }
          </AsyncPanel>
        </>
      )}
    </>
  );
}
function PartnerTerms({ privacy }: { privacy: boolean }) {
  return (
    <div className="partner-page partner-narrow">
      <h1>{privacy ? 'Partner privacy notice' : 'Founding pilot terms'}</h1>
      <p>Version founding-2026-11-v1</p>
      {privacy ? (
        <>
          <p>
            We store your company application, contact details, account information, uploaded property content, and
            review history to operate the partnership. Passwords are stored as salted hashes. Invitation and recovery
            tokens expire and can be used once.
          </p>
          <p>
            Property engagement records use an anonymous session identifier, property, city, neighborhood, source, and
            timestamp. We do not collect rental applications, deposits, or lease details. Event records are retained for
            180 days. Rate-limit identifiers are hashed and expire.
          </p>
          <p>
            Approved property content is public. Applications, private drafts, account information, and administrator
            notes are restricted. Hosting, database, email, and object-storage providers process data to operate these
            services.
          </p>
          <p>
            Contact the administrator by replying to your partnership email for access, corrections, or account deletion
            requests. Audit and application records may need to be retained to resolve disputes or prevent abuse.
          </p>
        </>
      ) : (
        <>
          <p>
            The founding partnership is free for 90 days beginning with the first published property. There are no
            upfront fees, automatic charges, or obligations to continue. Publication is subject to administrator review.
          </p>
          <p>
            Each organization may have up to five nonarchived properties. Drafts, rejected properties, and pending
            reviews count toward this limit. Replacement activity is recorded and limited to prevent repeated rotation.
          </p>
          <p>
            You must be authorized to advertise each property and license its photographs for display here. Keep
            descriptions, rent ranges, and availability accurate. Immediately withdraw inaccurate listings. Content must
            comply with applicable housing and advertising requirements.
          </p>
          <p>
            We do not guarantee views, inquiries, applications, or leases. Partnerships do not affect neighborhood
            scores. Your organization handles leasing through its official website.
          </p>
          <p>
            Listings pause at pilot expiry unless an administrator extends the partnership. We may suspend inaccurate or
            unauthorized content. Co-marketing is optional; logo use requires permission.
          </p>
        </>
      )}
      <Link to="/partners">Back to partnerships</Link>
    </div>
  );
}
