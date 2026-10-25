import maplibregl, { type GeoJSONSource, type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { bboxOf } from '../lib/geo.ts';
import type { CityDataset, LngLat } from '../lib/types.ts';

// OpenFreeMap serves OpenStreetMap vector tiles with no key and no usage limits; attribution is required and kept.
const BASEMAP = 'https://tiles.openfreemap.org/styles/positron';
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e9ede4' } }],
};

export type HoodState = 'match' | 'fail' | 'unverified';

export interface MapProps {
  dataset: CityDataset;
  states: Record<string, { state: HoodState; fit: number | null }>;
  selectedId: string | null;
  hoveredId: string | null;
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
  destinations?: LngLat[];
  /** When set, the next click on the map reports a point instead of selecting. */
  onPickPoint?: ((p: LngLat) => void) | null;
  /** Zoom to the selected neighborhood when the selection changes. */
  followSelection?: boolean;
  interactive?: boolean;
  /** Restrict the initial view to one neighborhood. */
  focusId?: string;
  label: string;
}

const reduceMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function NeighborhoodMap(props: MapProps) {
  const { dataset, states, selectedId, hoveredId, destinations = [], interactive = true, focusId, label } = props;
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const markers = useRef<maplibregl.Marker[]>([]);
  const [basemapFailed, setBasemapFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Build the map once per dataset.
  useEffect(() => {
    if (!el.current) return;
    let usedFallback = false;
    const focus = focusId ? dataset.neighborhoods.find((h) => h.id === focusId) : null;
    const box = focus ? bboxOf(focus.geometry) : [dataset.bounds[0][0], dataset.bounds[0][1], dataset.bounds[1][0], dataset.bounds[1][1]];
    const m = new maplibregl.Map({
      container: el.current,
      style: BASEMAP,
      bounds: [[box[0], box[1]], [box[2], box[3]]],
      fitBoundsOptions: { padding: focus ? 40 : 24 },
      interactive,
      attributionControl: { compact: true },
      cooperativeGestures: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    map.current = m;
    if (interactive) m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.getCanvas().setAttribute('aria-label', label);

    const addLayers = () => {
      if (m.getSource('hoods')) return;
      m.addSource('hoods', { type: 'geojson', data: featureCollection(latest.current), promoteId: 'id' });
      m.addSource('labels', { type: 'geojson', data: labelCollection(dataset) });
      const beforeLabels = m.getStyle().layers.find((l) => l.type === 'symbol')?.id;
      m.addLayer({
        id: 'hood-fill',
        type: 'fill',
        source: 'hoods',
        paint: {
          'fill-color': ['match', ['get', 'state'], 'match', '#3c7357', 'unverified', '#7d8899', '#9aa3af'],
          'fill-opacity': ['match', ['get', 'state'], 'match', ['interpolate', ['linear'], ['get', 'fit'], 0, 0.16, 100, 0.78], 'unverified', 0.32, 0.42],
        },
      }, beforeLabels);
      m.addLayer({ id: 'hood-line', type: 'line', source: 'hoods', paint: { 'line-color': '#ffffff', 'line-width': 1 } }, beforeLabels);
      m.addLayer({ id: 'hood-hover', type: 'line', source: 'hoods', filter: ['==', ['get', 'id'], ''], paint: { 'line-color': '#0a0a0a', 'line-width': 1.5 } });
      m.addLayer({ id: 'hood-selected', type: 'line', source: 'hoods', filter: ['==', ['get', 'id'], ''], paint: { 'line-color': '#0a0a0a', 'line-width': 3 } });
      if (!usedFallback) {
        m.addLayer({
          id: 'hood-labels',
          type: 'symbol',
          source: 'labels',
          minzoom: dataset.city === 'nyc' ? 12.2 : 11.4,
          layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-max-width': 8 },
          paint: { 'text-color': '#2a2e33', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
        });
      }
      ready.current = true;
      setLoaded(true);
      syncHighlight();
    };

    m.on('load', addLayers);
    m.on('error', (e) => {
      // A basemap failure before load: switch to a plain ground so boundaries still show.
      if (!ready.current && !usedFallback && /style|tiles|fetch|Failed/i.test(String(e.error?.message ?? ''))) {
        usedFallback = true;
        setBasemapFailed(true);
        m.setStyle(FALLBACK_STYLE);
        m.once('styledata', addLayers);
      }
    });
    const timeout = window.setTimeout(() => {
      if (!ready.current && !usedFallback) {
        usedFallback = true;
        setBasemapFailed(true);
        m.setStyle(FALLBACK_STYLE);
        m.once('styledata', addLayers);
      }
    }, 9000);

    m.on('mousemove', 'hood-fill', (e) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      m.getCanvas().style.cursor = latest.current.onPickPoint ? 'crosshair' : 'pointer';
      if (id && id !== latest.current.hoveredId) latest.current.onHover?.(id);
    });
    m.on('mouseleave', 'hood-fill', () => {
      m.getCanvas().style.cursor = latest.current.onPickPoint ? 'crosshair' : '';
      latest.current.onHover?.(null);
    });
    m.on('click', (e) => {
      const pick = latest.current.onPickPoint;
      if (pick) {
        pick([Math.round(e.lngLat.lng * 1e5) / 1e5, Math.round(e.lngLat.lat * 1e5) / 1e5]);
        return;
      }
      if (!ready.current) return;
      const f = m.queryRenderedFeatures(e.point, { layers: ['hood-fill'] })[0];
      const id = f?.properties?.id as string | undefined;
      if (id) latest.current.onSelect?.(id);
    });

    return () => {
      window.clearTimeout(timeout);
      ready.current = false;
      setLoaded(false);
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, interactive, focusId]);

  function syncHighlight() {
    const m = map.current;
    if (!m || !ready.current) return;
    m.setFilter('hood-hover', ['==', ['get', 'id'], latest.current.hoveredId ?? '']);
    m.setFilter('hood-selected', ['==', ['get', 'id'], latest.current.selectedId ?? '']);
  }

  // Data changes: recolour without rebuilding.
  useEffect(() => {
    if (!ready.current) return;
    (map.current?.getSource('hoods') as GeoJSONSource | undefined)?.setData(featureCollection(props));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [states, loaded]);

  useEffect(syncHighlight, [hoveredId, selectedId, loaded]);

  // Bring a newly selected neighborhood into view.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current || !selectedId || !props.followSelection) return;
    const h = dataset.neighborhoods.find((x) => x.id === selectedId);
    if (!h) return;
    const b = bboxOf(h.geometry);
    const view = m.getBounds();
    const inView = b[0] >= view.getWest() && b[2] <= view.getEast() && b[1] >= view.getSouth() && b[3] <= view.getNorth();
    if (!inView) m.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 80, maxZoom: 13.5, duration: reduceMotion() ? 0 : 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, loaded]);

  // Destination markers.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = destinations.map((p, i) => {
      const dot = document.createElement('div');
      dot.className = 'dest-marker';
      dot.textContent = String(i + 1);
      dot.setAttribute('aria-hidden', 'true');
      Object.assign(dot.style, {
        width: '22px', height: '22px', borderRadius: '6px', background: '#0a0a0a', color: '#fff', font: '500 12px/22px Geist, system-ui', textAlign: 'center', boxShadow: '0 0 0 2px #fff',
      });
      return new maplibregl.Marker({ element: dot }).setLngLat(p).addTo(m);
    });
  }, [destinations, loaded]);

  useEffect(() => {
    const c = map.current?.getCanvas();
    if (c) c.style.cursor = props.onPickPoint ? 'crosshair' : '';
  }, [props.onPickPoint]);

  return (
    <>
      <div className="map-root">
        <div ref={el} className="map-canvas" />
      </div>
      {basemapFailed ? (
        <div className="map-note notice" role="status">
          Street map tiles could not load. Boundaries are still shown; check your connection to see streets.
        </div>
      ) : null}
    </>
  );
}

function featureCollection(p: Pick<MapProps, 'dataset' | 'states'>): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: p.dataset.neighborhoods.map((h) => ({
      type: 'Feature',
      properties: { id: h.id, name: h.name, state: p.states[h.id]?.state ?? 'fail', fit: p.states[h.id]?.fit ?? 0 },
      geometry: h.geometry,
    })),
  };
}

function labelCollection(ds: CityDataset): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: ds.neighborhoods.map((h) => ({ type: 'Feature', properties: { name: h.name }, geometry: { type: 'Point', coordinates: h.centroid } })),
  };
}
