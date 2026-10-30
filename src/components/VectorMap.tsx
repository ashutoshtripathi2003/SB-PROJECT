import maplibregl, { type GeoJSONSource, type LngLatLike, type Map as MLMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Box, Crosshair, Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { drawRoute, glide } from '@/lib/glide'
import type { LatLng } from '@/lib/types'
import { markerHtml, ROUTE_STYLE, trafficStretches, type MapViewProps } from './MapView'

/**
 * Vector map (MapLibre GL): sharp at every zoom, 3D buildings when zoomed in, smooth
 * rotation/tilt, and live traffic underneath the labels. Uses Ola Maps (with an Ola key),
 * MapTiler (with a MapTiler key) or the free OpenFreeMap style. If WebGL or the style
 * can't load, `onFail` switches MapView to the simple Leaflet map.
 */

const ll = (p: LatLng): [number, number] => [p.lng, p.lat]
const line = (coords: LatLng[]) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: coords.map(ll) } })
const EMPTY = { type: 'FeatureCollection' as const, features: [] }

export function webglAvailable() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

/** Add extruded 3D buildings if the style has building shapes but doesn't extrude them. */
function add3dBuildings(m: MLMap) {
  const layers = m.getStyle().layers ?? []
  if (layers.some((l) => l.type === 'fill-extrusion')) return
  const building = layers.find((l) => 'source-layer' in l && l['source-layer'] === 'building') as { source?: string } | undefined
  if (!building?.source) return
  const firstLabel = layers.find((l) => l.type === 'symbol')?.id
  m.addLayer(
    {
      id: 'rs-3d-buildings',
      type: 'fill-extrusion',
      source: building.source,
      'source-layer': 'building',
      minzoom: 14.5,
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 10], 0, '#e4e2ec', 60, '#d5d2e2', 200, '#c7c3d9'],
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14.5, 0, 15.5, ['coalesce', ['get', 'render_height'], 10]],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.85,
      },
    },
    firstLabel,
  )
}

export default function VectorMap({
  styleUrl,
  olaKey,
  traffic,
  onFail,
  markers = [],
  routes = [],
  fit,
  padding,
  center = { lat: 19.0222, lng: 72.8711 },
  zoom = 12,
  interactive = true,
  animateRoutes = true,
  follow,
}: MapViewProps & { styleUrl: string; olaKey?: string; traffic?: boolean; onFail: () => void }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<MLMap | null>(null)
  const markerRefs = useRef(new Map<string, { marker: maplibregl.Marker; sig: string; pos: LatLng }>())
  const gliding = useRef(new Map<string, () => void>())
  const stopDraw = useRef<() => void>(undefined)
  const [ready, setReady] = useState(false)
  const [tilted, setTilted] = useState(false)

  // Create the map once.
  useEffect(() => {
    if (!el.current) return
    if (!webglAvailable()) return onFail()
    let loaded = false
    let m: MLMap
    try {
      m = new maplibregl.Map({
        container: el.current,
        style: styleUrl,
        center: ll(center),
        zoom,
        interactive,
        attributionControl: { compact: true },
        pitchWithRotate: true,
        dragRotate: interactive,
        maxPitch: 60,
        fadeDuration: 150,
        // Ola Maps needs its key on every style, tile, font and icon request.
        transformRequest: (url) =>
          olaKey && url.startsWith('https://api.olamaps.io/') && !url.includes('api_key=') ? { url: `${url}${url.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(olaKey)}` } : { url },
      })
    } catch {
      return onFail()
    }
    // A style that never loads (bad key, offline) → fall back to the simple map.
    const t = window.setTimeout(() => !loaded && onFail(), 15_000)
    // Also give up if the map's own tiles keep failing right after it opens (e.g. a rejected key).
    let tileErrors = 0
    const opened = Date.now()
    m.on('error', (e) => {
      const ours = (e as { sourceId?: string }).sourceId?.startsWith('rs-')
      if (!loaded || (!ours && Date.now() - opened < 20_000 && ++tileErrors === 8)) {
        console.warn('[ridesync] vector map failed, trying the next map', e.error?.message)
        onFail()
      }
    })
    m.on('load', () => {
      loaded = true
      window.clearTimeout(t)
      try {
        add3dBuildings(m)
      } catch {
        /* style without buildings */
      }
      const firstLabel = m.getStyle().layers?.find((l) => l.type === 'symbol')?.id
      if (traffic) {
        m.addSource('rs-traffic', { type: 'raster', tiles: [`${location.origin}/api/traffic/{z}/{x}/{y}.png`], tileSize: 256, minzoom: 10, maxzoom: 18, attribution: 'Traffic © TomTom' })
        m.addLayer({ id: 'rs-traffic', type: 'raster', source: 'rs-traffic', minzoom: 10, paint: { 'raster-opacity': 0.85 } }, firstLabel)
      }
      // Route layers: alternatives and dashed ones below, the main route on top; all under labels so street names stay readable.
      for (const kind of ['muted', 'alt', 'primary'] as const) {
        const s = ROUTE_STYLE[kind]
        m.addSource(`rs-route-${kind}`, { type: 'geojson', data: EMPTY })
        m.addLayer({ id: `rs-route-${kind}-casing`, type: 'line', source: `rs-route-${kind}`, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': s.casing.color, 'line-width': s.casing.weight + 1, 'line-opacity': s.casing.opacity } }, firstLabel)
        m.addLayer({
          id: `rs-route-${kind}`,
          type: 'line',
          source: `rs-route-${kind}`,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': s.line.color, 'line-width': s.line.weight + 1, 'line-opacity': s.line.opacity, ...(kind === 'muted' ? { 'line-dasharray': [0.5, 2.5] } : {}) },
        }, firstLabel)
      }
      // Live traffic on the main route: orange / red / dark red stretches over the blue line.
      m.addSource('rs-route-traffic', { type: 'geojson', data: EMPTY })
      m.addLayer({ id: 'rs-route-traffic', type: 'line', source: 'rs-route-traffic', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ROUTE_STYLE.primary.line.weight + 1 } }, firstLabel)
      setReady(true)
    })
    map.current = m
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(el.current)
    // Refresh traffic every 2 minutes so the colours follow real traffic.
    const refresh = window.setInterval(() => {
      const src = m.getSource('rs-traffic') as maplibregl.RasterTileSource | undefined
      src?.setTiles([`${location.origin}/api/traffic/{z}/{x}/{y}.png?t=${Math.floor(Date.now() / 120_000)}`])
    }, 120_000)
    return () => {
      window.clearTimeout(t)
      window.clearInterval(refresh)
      ro.disconnect()
      stopDraw.current?.()
      for (const stop of gliding.current.values()) stop()
      markerRefs.current.clear()
      m.remove()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl, traffic])

  // Routes
  const routeSig = routes.map((r) => `${r.id}:${r.kind}:${r.coords.length}:${r.coords[0]?.lat.toFixed(4)}:${r.coords.at(-1)?.lat.toFixed(4)}:${JSON.stringify(r.traffic ?? [])}`).join('|')
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    stopDraw.current?.()
    const trafficSrc = m.getSource('rs-route-traffic') as GeoJSONSource | undefined
    const stretches = routes.filter((r) => (r.kind ?? 'primary') === 'primary').flatMap(trafficStretches)
    const showTraffic = () => trafficSrc?.setData({ type: 'FeatureCollection', features: stretches.map((t) => ({ ...line(t.coords), properties: { color: t.color } })) })
    trafficSrc?.setData(EMPTY)
    for (const kind of ['muted', 'alt', 'primary'] as const) {
      const list = routes.filter((r) => (r.kind ?? 'primary') === kind && r.coords.length > 1)
      const src = m.getSource(`rs-route-${kind}`) as GeoJSONSource | undefined
      if (!src) continue
      if (kind === 'primary' && animateRoutes && list.length === 1) {
        // The main route draws itself from start to destination.
        // Traffic colours appear once the route has finished drawing.
        stopDraw.current = drawRoute(list[0].coords, (partial) => {
          src.setData(line(partial))
          if (partial.length === list[0].coords.length) showTraffic()
        })
      } else {
        src.setData({ type: 'FeatureCollection', features: list.map((r) => line(r.coords)) })
        if (kind === 'primary') showTraffic()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSig, ready])

  // Markers — HTML markers (same look as the other maps), moved in place so the car glides.
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    const seen = new Set<string>()
    for (const mk of markers) {
      seen.add(mk.id)
      const sig = `${mk.kind}|${mk.label}|${mk.sublabel}|${mk.darkLabel}|${mk.tone}`
      const existing = markerRefs.current.get(mk.id)
      if (existing && existing.sig === sig) {
        if (mk.kind === 'car') {
          gliding.current.get(mk.id)?.()
          gliding.current.set(
            mk.id,
            glide(existing.pos, mk.at, (p) => {
              existing.pos = p
              existing.marker.setLngLat(ll(p))
            }),
          )
          const arrow = existing.marker.getElement().querySelector<HTMLElement>('.mk-car__arrow')
          if (arrow) arrow.style.transform = `rotate(${(mk.heading ?? 0) - m.getBearing()}deg)`
        } else {
          existing.pos = mk.at
          existing.marker.setLngLat(ll(mk.at))
        }
        continue
      }
      existing?.marker.remove()
      const { html, size } = markerHtml(mk)
      const node = document.createElement('div')
      node.className = 'mk'
      node.style.width = node.style.height = `${size}px`
      node.style.zIndex = mk.kind === 'car' ? '3' : mk.kind === 'eta' ? '2' : '1'
      node.innerHTML = html
      const marker = new maplibregl.Marker({ element: node, anchor: 'center' }).setLngLat(ll(mk.at)).addTo(m)
      markerRefs.current.set(mk.id, { marker, sig, pos: mk.at })
    }
    for (const [id, ref] of markerRefs.current) {
      if (!seen.has(id)) {
        ref.marker.remove()
        markerRefs.current.delete(id)
        gliding.current.get(id)?.()
        gliding.current.delete(id)
      }
    }
  }, [markers, ready])

  // Fit to the given points, leaving room for the sheet and header.
  const fitSig = fit?.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|') + JSON.stringify(padding ?? {})
  useEffect(() => {
    const m = map.current
    if (!m || !ready || !fit || fit.length === 0) return
    const pad = { top: 80, bottom: 56, left: 56, right: 56, ...padding }
    if (fit.length === 1) {
      m.easeTo({ center: ll(fit[0]), zoom: 15, padding: pad, duration: 700 })
      return
    }
    const b = new maplibregl.LngLatBounds(ll(fit[0]), ll(fit[0]))
    for (const p of fit) b.extend(ll(p) as LngLatLike)
    m.fitBounds(b, { padding: pad, maxZoom: 15.5, duration: 800, pitch: follow ? 45 : 0, bearing: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSig, ready])

  // Follow a moving marker when it nears the edge (tilted, like turn-by-turn apps).
  const followed = follow ? markers.find((x) => x.id === follow) : undefined
  useEffect(() => {
    const m = map.current
    if (!m || !ready || !followed) return
    const pt = m.project(ll(followed.at))
    const { clientWidth: w, clientHeight: h } = m.getContainer()
    if (pt.x < w * 0.2 || pt.x > w * 0.8 || pt.y < h * 0.2 || pt.y > h * 0.7) m.easeTo({ center: ll(followed.at), duration: 900 })
  }, [followed?.at.lat, followed?.at.lng, followed, ready])

  const recenter = () => {
    const m = map.current
    if (!m || !fit?.length) return
    const b = new maplibregl.LngLatBounds(ll(fit[0]), ll(fit[0]))
    for (const p of fit) b.extend(ll(p) as LngLatLike)
    m.fitBounds(b, { padding: { top: 80, bottom: 56, left: 56, right: 56, ...padding }, maxZoom: 15.5, duration: 700, pitch: tilted ? 55 : 0, bearing: tilted ? -20 : 0 })
  }

  return (
    <div className="map map--vector">
      <div className="map__fallback" aria-hidden />
      <div ref={el} style={{ position: 'absolute', inset: 0 }} role="img" aria-label="Map showing the route" />
      {interactive && ready && (
        <div className="vmap-controls" style={{ bottom: (padding?.bottom ?? 0) + 16 }}>
          <button type="button" aria-label="Zoom in" onClick={() => map.current?.zoomIn()}>
            <Plus />
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => map.current?.zoomOut()}>
            <Minus />
          </button>
          <button
            type="button"
            aria-label={tilted ? 'Flat view' : '3D view'}
            aria-pressed={tilted}
            className={tilted ? 'is-on' : undefined}
            onClick={() => {
              const m = map.current
              if (!m) return
              const next = !tilted
              setTilted(next)
              // 3D: tilt and zoom in enough for buildings to rise.
              m.easeTo({ pitch: next ? 55 : 0, bearing: next ? -20 : 0, zoom: next ? Math.max(m.getZoom(), 15.2) : m.getZoom(), duration: 900 })
            }}
          >
            <Box />
          </button>
          {fit && fit.length > 0 && (
            <button type="button" aria-label="Show whole route" onClick={recenter}>
              <Crosshair />
            </button>
          )}
        </div>
      )}
      {traffic && ready && (
        <div className="vmap-legend" aria-label="Traffic colours" style={{ bottom: (padding?.bottom ?? 0) + 16 }}>
          <span>Route</span>
          <i style={{ background: '#1a73e8' }} /> Clear
          <i style={{ background: '#f29900' }} /> Slow
          <i style={{ background: '#e3242b' }} /> Heavy
          <i style={{ background: '#8b1a1a' }} /> Standstill
        </div>
      )}
    </div>
  )
}
