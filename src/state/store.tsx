// Everything a person enters lives only in this browser's localStorage. Nothing here is sent to a server,
// written to a URL, or passed to analytics.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { defaultAssumptions, defaultPreferences, type Preferences } from '../lib/prefs.ts';
import type { CityId } from '../lib/types.ts';

const PREFS_KEY = 'landing.prefs.v1';
const SAVED_KEY = 'landing.saved.v1';
const COMPARE_KEY = 'landing.compare.v1';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function readArray<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or storage full: the session still works, it just will not be remembered */
  }
}

type Saved = Partial<Record<CityId, string[]>>;
type Compare = { city: CityId | null; ids: string[] };

interface Store {
  prefs: Preferences;
  setPrefs: (update: Partial<Preferences> | ((p: Preferences) => Preferences)) => void;
  resetPrefs: () => void;
  saved: Saved;
  toggleSaved: (city: CityId, id: string) => void;
  isSaved: (city: CityId, id: string) => boolean;
  compare: Compare;
  toggleCompare: (city: CityId, id: string) => 'added' | 'removed' | 'full';
  setCompare: (c: Compare) => void;
  toast: string | null;
  notify: (message: string) => void;
}

const Ctx = createContext<Store | null>(null);

function loadPrefs(): Preferences {
  const base = defaultPreferences();
  const stored = read<Preferences>(PREFS_KEY, base);
  // Merge nested objects so a stored preference set from an older version gains new keys.
  return {
    ...stored,
    safety: { ...base.safety, ...stored.safety },
    amenities: { ...base.amenities, ...stored.amenities },
    assumptions: { ...defaultAssumptions(stored.bedrooms), ...stored.assumptions },
    destinations: Array.isArray(stored.destinations) ? stored.destinations : [],
  };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefsState] = useState<Preferences>(loadPrefs);
  const [saved, setSaved] = useState<Saved>(() => readArray<Saved>(SAVED_KEY, {}));
  const [compare, setCompareState] = useState<Compare>(() => readArray<Compare>(COMPARE_KEY, { city: null, ids: [] }));
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => write(PREFS_KEY, prefs), [prefs]);
  useEffect(() => write(SAVED_KEY, saved), [saved]);
  useEffect(() => write(COMPARE_KEY, compare), [compare]);

  const setPrefs = useCallback<Store['setPrefs']>((update) => {
    setPrefsState((p) => (typeof update === 'function' ? update(p) : { ...p, ...update }));
  }, []);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const value = useMemo<Store>(
    () => ({
      prefs,
      setPrefs,
      resetPrefs: () => setPrefsState(defaultPreferences()),
      saved,
      toggleSaved: (city, id) =>
        setSaved((s) => {
          const list = s[city] ?? [];
          return { ...s, [city]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] };
        }),
      isSaved: (city, id) => (saved[city] ?? []).includes(id),
      compare,
      toggleCompare: (city, id) => {
        const same = compare.city === city ? compare.ids : [];
        if (same.includes(id)) {
          setCompareState({ city, ids: same.filter((x) => x !== id) });
          return 'removed';
        }
        if (same.length >= 3) return 'full';
        setCompareState({ city, ids: [...same, id] });
        return 'added';
      },
      setCompare: setCompareState,
      toast,
      notify,
    }),
    [prefs, setPrefs, saved, compare, toast, notify],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
