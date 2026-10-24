import { useState } from 'react';
import type { CityDataset } from '../lib/types.ts';
import { useStore } from '../state/store.tsx';
import { Drawer } from './Drawer.tsx';
import { CommuteFields, Field, HomeFields, MoneyInput, PriorityFields, Segmented } from './PreferenceFields.tsx';

type Tab = 'priorities' | 'home' | 'commute' | 'costs';

export function PreferencesDrawer({ open, onClose, dataset, initialTab = 'priorities', onPickOnMap }: { open: boolean; onClose: () => void; dataset: CityDataset | null; initialTab?: Tab; onPickOnMap?: (index: number) => void }) {
  const { prefs, setPrefs } = useStore();
  const [tab, setTab] = useState<Tab>(initialTab);
  const a = prefs.assumptions;
  const setA = (k: keyof typeof a) => (v: number | null) => setPrefs((p) => ({ ...p, assumptions: { ...p.assumptions, [k]: v ?? 0 } }));
  return (
    <Drawer
      title="Your preferences"
      open={open}
      onClose={onClose}
      footer={<button type="button" className="btn btn-primary" onClick={onClose}>Show results</button>}
    >
      <Segmented<Tab>
        label="Preference section"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'priorities', label: 'Priorities' },
          { value: 'home', label: 'Rent' },
          { value: 'commute', label: 'Commute' },
          { value: 'costs', label: 'Costs' },
        ]}
      />
      <p className="field-help" style={{ marginTop: 12 }}>Results update as you change anything. Everything you enter stays on this device.</p>
      <div style={{ marginTop: 20 }}>
        {tab === 'priorities' ? <PriorityFields prefs={prefs} setPrefs={setPrefs} compact /> : null}
        {tab === 'home' ? <HomeFields prefs={prefs} setPrefs={setPrefs} /> : null}
        {tab === 'commute' ? <CommuteFields prefs={prefs} setPrefs={setPrefs} dataset={dataset} onPickOnMap={onPickOnMap} /> : null}
        {tab === 'costs' ? (
          <div>
            <h3 className="section-title">Monthly assumptions</h3>
            <p className="field-help" style={{ marginTop: 4 }}>Defaults are assumptions, labelled as such in every total. Replace them with your own figures.</p>
            <div className="assume-grid">
              <Field label="Internet, per household" htmlFor="as-net"><MoneyInput id="as-net" value={a.internet} onChange={setA('internet')} /></Field>
              <Field label="Renter's insurance" htmlFor="as-ins"><MoneyInput id="as-ins" value={a.rentersInsurance} onChange={setA('rentersInsurance')} /></Field>
              <Field label="Pet rent and fees" htmlFor="as-pet"><MoneyInput id="as-pet" value={a.petFees} onChange={setA('petFees')} /></Field>
              <Field label="Other recurring fees" htmlFor="as-oth" help="Amenity, trash or admin fees"><MoneyInput id="as-oth" value={a.otherFees} onChange={setA('otherFees')} /></Field>
              {prefs.hasCar ? (
                <>
                  <Field label="Car running cost per km" htmlFor="as-km" help="Fuel and maintenance"><MoneyInput id="as-km" value={a.carCostPerKm} onChange={setA('carCostPerKm')} /></Field>
                  <Field label="Fixed car costs per month" htmlFor="as-car" help="Insurance, payments. Not counted until entered.">
                    <MoneyInput id="as-car" value={a.carFixed} onChange={(v) => setPrefs((p) => ({ ...p, assumptions: { ...p.assumptions, carFixed: v } }))} placeholder="Not entered" />
                  </Field>
                </>
              ) : null}
            </div>
            <h3 className="section-title" style={{ marginTop: 28 }}>Move-in cash</h3>
            <div className="assume-grid">
              <Field label="Security deposit, months of rent" htmlFor="as-dep"><MoneyInput id="as-dep" prefix={null} value={a.depositMonths} onChange={setA('depositMonths')} max={3} /></Field>
              <Field label="Broker fee" htmlFor="as-brk"><MoneyInput id="as-brk" value={a.brokerFee} onChange={setA('brokerFee')} /></Field>
              <Field label="Application fees" htmlFor="as-app"><MoneyInput id="as-app" value={a.applicationFees} onChange={setA('applicationFees')} /></Field>
              <Field label="Moving" htmlFor="as-mov"><MoneyInput id="as-mov" value={a.movingCost} onChange={setA('movingCost')} /></Field>
              <Field label="Furniture and setup" htmlFor="as-fur"><MoneyInput id="as-fur" value={a.furnitureCost} onChange={setA('furnitureCost')} /></Field>
            </div>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
