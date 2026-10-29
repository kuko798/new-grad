import { useEffect, useId, useState, type ReactNode } from 'react';
import {
  BEDROOM_LABELS,
  DEFAULT_UTILITIES,
  MODE_LABELS,
  PRIORITY_LABELS,
  type AmenityKey,
  type Destination,
  type Preferences,
  type Priority,
  type SafetyKey,
  type TravelMode,
} from '../lib/prefs.ts';
import { BEDROOM_KEYS, type CityDataset, type CityId, type LngLat } from '../lib/types.ts';
import { cityInfo } from '../lib/cities.ts';
import { CITY_NAMES, CITY_ORDER } from '../state/data.ts';

type SetPrefs = (update: Partial<Preferences> | ((p: Preferences) => Preferences)) => void;

export function Field({ label, help, children, htmlFor, className }: { label: string; help?: ReactNode; children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={`field ${className ?? ''}`}>
      <label className="field-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {help ? <p className="field-help">{help}</p> : null}
    </div>
  );
}

/** A number input that allows an empty value (null) and only commits finite, non-negative numbers. */
export function MoneyInput({ id, value, onChange, placeholder, suffix, prefix = '$', max }: { id: string; value: number | null; onChange: (v: number | null) => void; placeholder?: string; suffix?: string; prefix?: string | null; max?: number }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => setText(value == null ? '' : String(value)), [value]);
  const input = (
    <input
      id={id}
      className="input"
      inputMode="numeric"
      autoComplete="off"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^0-9.]/g, '');
        setText(raw);
        if (raw === '') onChange(null);
        else {
          const n = Number(raw);
          if (Number.isFinite(n) && n >= 0) onChange(max != null ? Math.min(n, max) : n);
        }
      }}
    />
  );
  if (suffix) return <div className="input-suffix">{input}<span>{suffix}</span></div>;
  return prefix ? <div className="input-prefix"><span>{prefix}</span>{input}</div> : input;
}

export function Segmented<T extends string | number>({ value, options, onChange, label, small }: { value: T; options: Array<{ value: T; label: string; title?: string }>; onChange: (v: T) => void; label: string; small?: boolean }) {
  return (
    <div className={`segmented ${small ? 'small' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          aria-label={o.title ?? o.label}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const i = options.findIndex((x) => x.value === value);
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onChange(options[(i + 1) % options.length].value); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onChange(options[(i - 1 + options.length) % options.length].value); }
          }}
          tabIndex={o.value === value ? 0 : -1}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const PRIORITY_OPTIONS: Array<{ value: Priority; label: string; title: string }> = ([0, 1, 2, 3] as Priority[]).map((p) => ({
  value: p,
  label: ['Off', 'Low', 'Medium', 'High'][p],
  title: PRIORITY_LABELS[p],
}));

export function PriorityRow({ label, help, value, onChange }: { label: string; help?: string; value: Priority; onChange: (p: Priority) => void }) {
  return (
    <div className="priority-row">
      <div>
        <div className="label">{label}</div>
        {help ? <div className="help">{help}</div> : null}
      </div>
      <Segmented small label={`${label}: priority`} value={value} options={PRIORITY_OPTIONS} onChange={onChange} />
    </div>
  );
}

/** Forty cities: a dropdown, alphabetical with the state so same-named places stay clear. */
const CITY_OPTIONS = [...CITY_ORDER].sort((a, b) => CITY_NAMES[a].localeCompare(CITY_NAMES[b]));

export function CityField({ prefs, setPrefs }: { prefs: Preferences; setPrefs: SetPrefs }) {
  const id = useId();
  return (
    <Field label="Destination city" htmlFor={`${id}-city`} className="city-field">
      <select
        id={`${id}-city`}
        className="select"
        value={prefs.city ?? ''}
        onChange={(e) => {
          const c = (e.target.value || null) as CityId | null;
          setPrefs({ city: c, destinations: c === prefs.city ? prefs.destinations : [] });
        }}
      >
        <option value="" disabled>Choose a city</option>
        {CITY_OPTIONS.map((c) => <option key={c} value={c}>{CITY_NAMES[c]}, {cityInfo(c).state}</option>)}
      </select>
    </Field>
  );
}

export function HomeFields({ prefs, setPrefs }: { prefs: Preferences; setPrefs: SetPrefs }) {
  const id = useId();
  const sharing = prefs.people > 1;
  return (
    <>
      <div className="form-grid">
        <Field label="Maximum monthly rent" htmlFor={`${id}-rent`} help={sharing ? 'Your share, before utilities. Always treated as a limit.' : 'Before utilities. Always treated as a limit.'}>
          <MoneyInput id={`${id}-rent`} value={prefs.maxRent} onChange={(v) => setPrefs({ maxRent: v })} placeholder="2,000" />
        </Field>
        <Field label="Utilities you expect to pay" htmlFor={`${id}-util`} help="Benchmarks are gross rents that include utilities, so this is added to your limit. Default is an assumption.">
          <MoneyInput id={`${id}-util`} value={prefs.assumptions.utilities} onChange={(v) => setPrefs((p) => ({ ...p, assumptions: { ...p.assumptions, utilities: v ?? 0 } }))} />
        </Field>
        <Field label="Living situation" className="span-2">
          <Segmented
            label="Living situation"
            value={sharing ? 'share' : 'alone'}
            options={[{ value: 'alone', label: 'Living alone' }, { value: 'share', label: 'Sharing with roommates' }]}
            onChange={(v) => setPrefs((p) => {
              const people = v === 'alone' ? 1 : Math.max(2, p.people);
              const bedrooms = v === 'share' && p.bedrooms === 'studio' ? 'br2' : p.bedrooms;
              return { ...p, people, bedrooms, assumptions: { ...p.assumptions, utilities: DEFAULT_UTILITIES[bedrooms] } };
            })}
          />
        </Field>
        <Field label="Unit size" htmlFor={`${id}-beds`}>
          <select
            id={`${id}-beds`}
            className="select"
            value={prefs.bedrooms}
            onChange={(e) => {
              const bedrooms = e.target.value as Preferences['bedrooms'];
              setPrefs((p) => ({ ...p, bedrooms, assumptions: { ...p.assumptions, utilities: DEFAULT_UTILITIES[bedrooms] } }));
            }}
          >
            {BEDROOM_KEYS.map((b) => <option key={b} value={b}>{BEDROOM_LABELS[b]}</option>)}
          </select>
        </Field>
        {sharing ? (
          <Field label="People in the unit" htmlFor={`${id}-people`} help="Including you. Rent and shared bills are split evenly.">
            <select id={`${id}-people`} className="select" value={prefs.people} onChange={(e) => setPrefs({ people: Number(e.target.value) })}>
              {[2, 3, 4].map((n) => <option key={n} value={n}>{n} people</option>)}
            </select>
          </Field>
        ) : (
          <Field label="Move date" htmlFor={`${id}-move`} help="Optional. Used to flag data older than your move.">
            <input id={`${id}-move`} type="date" className="input" value={prefs.moveDate ?? ''} onChange={(e) => setPrefs({ moveDate: e.target.value || null })} />
          </Field>
        )}
        <Field label="Total housing budget" htmlFor={`${id}-total`} help="Optional limit on rent, utilities, internet, insurance, parking and fees together.">
          <MoneyInput id={`${id}-total`} value={prefs.totalHousingBudget} onChange={(v) => setPrefs({ totalHousingBudget: v })} placeholder="Optional" />
        </Field>
        <Field label="Monthly take-home pay" htmlFor={`${id}-pay`} help="Optional. Only used to show costs as a share of pay. Stays on this device.">
          <MoneyInput id={`${id}-pay`} value={prefs.takeHomePay} onChange={(v) => setPrefs({ takeHomePay: v })} placeholder="Optional" />
        </Field>
        {sharing ? (
          <Field label="Move date" htmlFor={`${id}-move2`} help="Optional.">
            <input id={`${id}-move2`} type="date" className="input" value={prefs.moveDate ?? ''} onChange={(e) => setPrefs({ moveDate: e.target.value || null })} />
          </Field>
        ) : null}
      </div>
    </>
  );
}

interface GeocodeHit {
  label: string;
  point: LngLat;
}

async function geocode(q: string, city: CityId): Promise<GeocodeHit[]> {
  const res = await fetch(`/api/geocode?city=${city}&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
  if (res.status === 429) throw new Error('Too many lookups in a short time. Wait a minute and try again.');
  if (!res.ok) throw new Error('The address lookup is unavailable right now.');
  // The Census geocoder answers in capitals ("233 S WACKER DR, CHICAGO, IL, 60606"); keep the street line, readable.
  return ((await res.json()) as { results: GeocodeHit[] }).results.map((r) => ({ ...r, label: tidyAddress(r.label) }));
}

function tidyAddress(s: string) {
  const [street, ...rest] = s.split(',').map((x) => x.trim());
  const nice = street.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Ne|Nw|Se|Sw)\b/g, (x) => x.toUpperCase());
  const zip = rest.find((x) => /^\d{5}$/.test(x));
  return zip ? `${nice} (${zip})` : nice;
}

export function DestinationEditor({ index, prefs, setPrefs, dataset, onPickOnMap }: { index: number; prefs: Preferences; setPrefs: SetPrefs; dataset: CityDataset | null; onPickOnMap?: () => void }) {
  const id = useId();
  const dest = prefs.destinations[index];
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<GeocodeHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (d: Destination | null) =>
    setPrefs((p) => {
      const list = [...p.destinations];
      if (d) list[index] = d;
      else list.splice(index, 1);
      return { ...p, destinations: list.filter(Boolean) };
    });

  async function search() {
    if (!prefs.city || query.trim().length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const r = await geocode(query.trim(), prefs.city);
      setHits(r);
      if (!r.length) setError(`No match in ${CITY_NAMES[prefs.city]}. Add a street number and ZIP, or choose a neighborhood instead.`);
    } catch (e) {
      setError(`${(e as Error).message} You can choose a neighborhood instead.`);
    } finally {
      setBusy(false);
    }
  }

  const title = index === 0 ? 'Work or school' : 'Second destination';
  if (dest) {
    return (
      <div className="dest">
        <div className="dest-set">
          <div style={{ minWidth: 0 }}>
            <div className="small muted">{title}</div>
            <div style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{dest.label}</div>
          </div>
          <button type="button" className="btn btn-small" onClick={() => set(null)}>Remove</button>
        </div>
        <Field label="Days a week" htmlFor={`${id}-days`}>
          <Segmented label={`${title}: days a week`} small value={dest.daysPerWeek} options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} onChange={(n) => set({ ...dest, daysPerWeek: n })} />
        </Field>
      </div>
    );
  }
  return (
    <div className="dest">
      <Field label={title} htmlFor={`${id}-q`} help="Looked up with the U.S. Census Bureau geocoder. The address stays on this device and is never put in links.">
        <form
          style={{ display: 'flex', gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <input id={`${id}-q`} className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="233 S Wacker Dr" autoComplete="off" disabled={!prefs.city} />
          <button className="btn" type="submit" disabled={busy || !prefs.city || query.trim().length < 4}>{busy ? 'Finding…' : 'Find'}</button>
        </form>
      </Field>
      {error ? <p className="small" role="alert">{error}</p> : null}
      {hits && hits.length ? (
        <div className="suggestions" role="list">
          {hits.map((h) => (
            <button key={h.label} type="button" role="listitem" onClick={() => { set({ label: h.label, point: h.point, daysPerWeek: 5 }); setHits(null); setQuery(''); }}>
              {h.label}
            </button>
          ))}
        </div>
      ) : null}
      {dataset ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="small muted" htmlFor={`${id}-nb`}>Or use the centre of a neighborhood</label>
          <select
            id={`${id}-nb`}
            className="select"
            style={{ height: 36, width: 'auto', maxWidth: '100%' }}
            value=""
            onChange={(e) => {
              const h = dataset.neighborhoods.find((x) => x.id === e.target.value);
              if (h) set({ label: `${h.name} (centre)`, point: h.centroid, daysPerWeek: 5 });
            }}
          >
            <option value="">Choose…</option>
            {dataset.neighborhoods.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          {onPickOnMap ? <button type="button" className="btn btn-small" onClick={onPickOnMap}>Pick on the map</button> : null}
        </div>
      ) : null}
    </div>
  );
}

export function CommuteFields({ prefs, setPrefs, dataset, onPickOnMap }: { prefs: Preferences; setPrefs: SetPrefs; dataset: CityDataset | null; onPickOnMap?: (index: number) => void }) {
  const id = useId();
  const modes: TravelMode[] = prefs.hasCar ? ['transit', 'drive', 'bike', 'walk'] : ['transit', 'bike', 'walk'];
  return (
    <>
      <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        <DestinationEditor index={0} prefs={prefs} setPrefs={setPrefs} dataset={dataset} onPickOnMap={onPickOnMap ? () => onPickOnMap(0) : undefined} />
        {prefs.destinations.length >= 1 ? (
          <DestinationEditor index={1} prefs={prefs} setPrefs={setPrefs} dataset={dataset} onPickOnMap={onPickOnMap ? () => onPickOnMap(1) : undefined} />
        ) : null}
        {prefs.destinations.length === 2 ? (
          <Field label="Balance between the two" htmlFor={`${id}-bal`} help={`${Math.round(prefs.destinationBalance * 100)}% ${prefs.destinations[0].label.split(',')[0]} · ${Math.round((1 - prefs.destinationBalance) * 100)}% ${prefs.destinations[1].label.split(',')[0]}`}>
            <input id={`${id}-bal`} type="range" min={0} max={1} step={0.1} value={prefs.destinationBalance} onChange={(e) => setPrefs({ destinationBalance: Number(e.target.value) })} />
          </Field>
        ) : null}
      </div>
      <div className="form-grid">
        <Field label="Getting there" className="span-2">
          <Segmented label="Travel mode" value={modes.includes(prefs.mode) ? prefs.mode : 'transit'} options={modes.map((m) => ({ value: m, label: MODE_LABELS[m] }))} onChange={(m) => setPrefs({ mode: m })} />
        </Field>
        <Field label="Longest acceptable commute" htmlFor={`${id}-max`}>
          <MoneyInput id={`${id}-max`} prefix={null} suffix="min" value={prefs.maxCommute} onChange={(v) => setPrefs({ maxCommute: Math.max(10, v ?? 45) })} max={180} />
        </Field>
        <Field label="Treat it as" >
          <Segmented label="Commute limit type" value={prefs.commuteHard ? 'hard' : 'soft'} options={[{ value: 'hard', label: 'A limit' }, { value: 'soft', label: 'A preference' }]} onChange={(v) => setPrefs({ commuteHard: v === 'hard' })} />
        </Field>
        <div className="span-2" style={{ display: 'grid', gap: 4 }}>
          <label className="check"><input type="checkbox" checked={prefs.hasCar} onChange={(e) => setPrefs((p) => ({ ...p, hasCar: e.target.checked, needsParking: e.target.checked ? p.needsParking : false, mode: !e.target.checked && p.mode === 'drive' ? 'transit' : p.mode }))} /> I'll have a car</label>
          {prefs.hasCar ? (
            <label className="check"><input type="checkbox" checked={prefs.needsParking} onChange={(e) => setPrefs({ needsParking: e.target.checked })} /> I need parking at home</label>
          ) : null}
        </div>
        {prefs.hasCar && prefs.needsParking ? (
          <Field label="Monthly parking at home" htmlFor={`${id}-park`} help="Not counted until you enter it; parking prices vary block by block.">
            <MoneyInput id={`${id}-park`} value={prefs.assumptions.parking} onChange={(v) => setPrefs((p) => ({ ...p, assumptions: { ...p.assumptions, parking: v } }))} placeholder="Not entered" />
          </Field>
        ) : null}
      </div>
    </>
  );
}

const SAFETY_ROWS: Array<{ key: SafetyKey; label: string; help: string }> = [
  { key: 'violent', label: 'Prioritize lower reported violent-incident rates', help: 'Homicide, sexual assault, robbery and aggravated assault, per 1,000 residents' },
  { key: 'property', label: 'Prioritize lower reported property-incident rates', help: 'Burglary, theft, motor vehicle theft and arson, per 1,000 residents' },
  { key: 'vehicle', label: 'Prioritize lower reported vehicle-related incidents', help: 'Vehicle theft and thefts from vehicles' },
];

const AMENITY_ROWS: Array<{ key: AmenityKey; label: string; help: string }> = [
  { key: 'transit', label: 'Transit access', help: 'Distance to rail, density of bus stops' },
  { key: 'grocery', label: 'Grocery access', help: 'Supermarkets and greengrocers per km²' },
  { key: 'parks', label: 'Parks', help: 'Parks per km²' },
  { key: 'restaurants', label: 'Restaurants and cafés', help: 'Per km²' },
  { key: 'nightlife', label: 'Nightlife', help: 'Bars, pubs and clubs per km²' },
  { key: 'quiet', label: 'Quieter surroundings', help: 'Fewer bars and lower residential density' },
  { key: 'pets', label: 'Pet-friendly spaces', help: 'Dog parks and parks' },
  { key: 'stepFree', label: 'Step-free rail stations', help: 'Where stations carry accessibility tags in OpenStreetMap' },
];

export function PriorityFields({ prefs, setPrefs, compact }: { prefs: Preferences; setPrefs: SetPrefs; compact?: boolean }) {
  return (
    <div style={{ display: 'grid', gap: compact ? 16 : 24 }}>
      <div>
        <h3 className="section-title">Cost and commute</h3>
        <div style={{ marginTop: 4 }}>
          <PriorityRow label="Rent headroom" help="More room under your limit ranks higher" value={prefs.affordability} onChange={(p) => setPrefs({ affordability: p })} />
          <PriorityRow label="Shorter commute" help={prefs.destinations.length ? 'Against your longest acceptable commute' : 'Add a destination to use this'} value={prefs.commute} onChange={(p) => setPrefs({ commute: p })} />
        </div>
      </div>
      <div>
        <h3 className="section-title">Reported incidents</h3>
        <p className="field-help" style={{ marginTop: 4 }}>Compared within the city only. These reflect reported incidents, not a prediction of anyone's personal safety.</p>
        <div style={{ marginTop: 4 }}>
          {SAFETY_ROWS.map((r) => (
            <PriorityRow key={r.key} label={r.label} help={r.help} value={prefs.safety[r.key]} onChange={(p) => setPrefs((x) => ({ ...x, safety: { ...x.safety, [r.key]: p } }))} />
          ))}
        </div>
      </div>
      <div>
        <h3 className="section-title">Day to day</h3>
        <div style={{ marginTop: 4 }}>
          {AMENITY_ROWS.map((r) => (
            <PriorityRow key={r.key} label={r.label} help={r.help} value={prefs.amenities[r.key]} onChange={(p) => setPrefs((x) => ({ ...x, amenities: { ...x.amenities, [r.key]: p } }))} />
          ))}
        </div>
        <label className="check" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={prefs.pets} onChange={(e) => setPrefs((x) => ({ ...x, pets: e.target.checked, amenities: { ...x.amenities, pets: e.target.checked && x.amenities.pets === 0 ? 2 : x.amenities.pets } }))} />
          I'm moving with a pet
        </label>
      </div>
    </div>
  );
}
