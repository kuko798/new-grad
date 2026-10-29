import { useNavigate, useSearchParams } from 'react-router-dom';
import { CityField, CommuteFields, HomeFields, PriorityFields } from '../components/PreferenceFields.tsx';
import { CITY_NAMES, useCity } from '../state/data.ts';
import { useStore } from '../state/store.tsx';

const STEPS = [
  { title: 'Where are you moving?', help: 'Coverage is the city itself for each: no suburbs yet.' },
  { title: 'What can you spend on rent?', help: 'Your rent limit is always a hard limit. Everything else is optional and can be changed later.' },
  { title: 'Where will you commute?', help: 'Optional. Add a workplace or school, and a second destination if you split your week.' },
  { title: 'What matters day to day?', help: 'Optional. Rank what you care about; anything set to Off is left out of the score.' },
];

export function OnboardingPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { prefs, setPrefs } = useStore();
  const requested = Number(params.get('step') ?? 1);
  const step = !prefs.city ? 0 : Math.min(STEPS.length - 1, Math.max(0, Number.isFinite(requested) ? requested : 1));
  const city = useCity(prefs.city);
  const go = (n: number) => setParams({ step: String(n) });
  const finish = () => {
    setPrefs({ onboarded: true });
    navigate(`/${prefs.city}`);
  };
  const s = STEPS[step];

  return (
    <div className="onboard">
      <div className="steps" aria-hidden="true">
        {STEPS.map((_, i) => <span key={i} className={i <= step ? 'done' : ''} />)}
      </div>
      <p className="small muted">Step {step + 1} of {STEPS.length}{prefs.city && step > 0 ? ` · ${CITY_NAMES[prefs.city]}` : ''}</p>
      <h1 className="title" style={{ marginTop: 6 }}>{s.title}</h1>
      <p className="subtitle">{s.help}</p>

      <div style={{ marginTop: 24 }}>
        {step === 0 ? (
          <CityField
            prefs={prefs}
            // Choosing a city should not skip ahead: stay on this step until Continue.
            setPrefs={(u) => {
              setPrefs(u);
              if (!params.get('step')) setParams({ step: '0' }, { replace: true });
            }}
          />
        ) : null}
        {step === 1 ? <HomeFields prefs={prefs} setPrefs={setPrefs} /> : null}
        {step === 2 ? <CommuteFields prefs={prefs} setPrefs={setPrefs} dataset={city.status === 'ready' ? city.data : null} /> : null}
        {step === 3 ? <PriorityFields prefs={prefs} setPrefs={setPrefs} /> : null}
      </div>

      <div className="onboard-foot">
        <div>
          {step > 0 ? (
            <button type="button" className="btn btn-ghost" onClick={() => go(step - 1)}>Back</button>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {step > 0 && step < STEPS.length - 1 ? (
            <button type="button" className="btn" onClick={finish} disabled={!prefs.city}>Skip to results</button>
          ) : null}
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn btn-primary" onClick={() => go(step + 1)} disabled={!prefs.city}>Continue</button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={finish} disabled={!prefs.city}>See neighborhoods</button>
          )}
        </div>
      </div>
      {step === 1 && prefs.maxRent == null ? (
        <p className="small muted" style={{ marginTop: 12 }}>No rent limit yet: you will see every neighborhood ranked, with rent shown but not used to exclude any.</p>
      ) : null}
    </div>
  );
}
