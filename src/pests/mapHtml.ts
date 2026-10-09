// src/pests/mapHtml.ts — Página del mapa satelital de «Ubicar plaga» para el WebView (ADR 0009).
//
// QUÉ HACE:
//  - buildMapHtml(): arma una página con Leaflet 1.9.4 EMBEBIDO (src/pests/vendor/leaflet.ts, sin CDN) y la vista
//    satelital de Esri World Imagery con nombres de lugares y vías (sin clave; atribución obligatoria) o el mapa de
//    calles de Esri (World Street Map). Sin internet se siguen viendo los contornos, las hileras, las alertas y tu posición.
//  - La app le manda los datos con injectJavaScript: window.RIACHUELO.update({farm, reports, me, selectedId}),
//    fitAll(), centerMe(), toggleBase(). La página avisa con window.ReactNativeWebView.postMessage(JSON):
//    {type:'ready'} al cargar y {type:'select', caseId} al tocar una alerta (o el mapa vacío: caseId null).
//  - mapPayload(): datos mínimos que necesita la página (sin miniaturas ni observaciones).
// Los textos visibles (atribución) llegan desde src/ui/strings.ts. Los colores son los de la web (estado de revisión).

import { hasLocation, pestColor, type FarmLayers, type PestReport } from '../domain/pests';
import type { GpsFix } from '../domain/types';
import { LEAFLET_CSS, LEAFLET_JS } from './vendor/leaflet';

export interface MapPest {
  id: string;
  lat: number;
  lon: number;
  color: string;
  /** Ubicación aproximada (coordenadas del marcador): borde punteado, como en la web. */
  approx: boolean;
}

export interface MapPayload {
  farm: FarmLayers | null;
  reports: MapPest[];
  me: { lat: number; lon: number; acc: number | null } | null;
  selectedId: string | null;
}

export function mapPayload(
  farm: FarmLayers | null,
  reports: readonly PestReport[],
  me: GpsFix | null,
  selectedId: string | null,
): MapPayload {
  return {
    farm,
    reports: reports.filter(hasLocation).map((r) => ({
      id: r.caseId,
      lat: r.lat as number,
      lon: r.lon as number,
      color: pestColor(r.status),
      approx: r.locationSource === 'MARCADOR',
    })),
    me: me ? { lat: me.lat, lon: me.lon, acc: me.accuracyM } : null,
    selectedId,
  };
}

/** JSON seguro dentro de <script> y de injectJavaScript (sin </script> ni separadores de línea de JS). */
export function safeJson(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
}

/** Código JavaScript que la app inyecta para llamar a la página. */
export function mapCall(fn: 'update' | 'fitAll' | 'centerMe' | 'toggleBase', arg?: unknown): string {
  const a = arg === undefined ? '' : safeJson(arg);
  return `window.RIACHUELO && window.RIACHUELO.${fn}(${a}); true;`;
}

const PAGE_JS = String.raw`
(function () {
  var send = function (m) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
  var CFG = window.RIACHUELO_CFG;
  var map = L.map('map', { zoomControl: false, attributionControl: true, maxZoom: 21 });
  // Zoom y escala arriba a la izquierda: abajo la app muestra la alerta elegida (la atribución queda visible).
  L.control.zoom({ position: 'topleft' }).addTo(map);
  L.control.scale({ position: 'topleft', imperial: false }).addTo(map);
  map.attributionControl.setPrefix(false);

  var sat = L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxNativeZoom: 19, maxZoom: 21, attribution: CFG.attrSat }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { maxNativeZoom: 19, maxZoom: 21 }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
      { maxNativeZoom: 19, maxZoom: 21, opacity: 0.7 })
  ]);
  var streets = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    { maxNativeZoom: 19, maxZoom: 21, attribution: CFG.attrStreets });
  var base = 'sat';
  sat.addTo(map);

  var farmLayer = L.layerGroup().addTo(map);
  var pestLayer = L.layerGroup().addTo(map);
  var meLayer = L.layerGroup().addTo(map);
  var lineLayer = L.layerGroup().addTo(map);
  var state = { farm: null, reports: [], me: null, selectedId: null };
  var fitted = false;
  var farmKey = '';

  map.setView(CFG.center, 17);
  map.on('click', function () { send({ type: 'select', caseId: null }); });

  function drawFarm(farm) {
    farmLayer.clearLayers();
    if (!farm) return;
    (farm.lots || []).forEach(function (lot) {
      var g = lot.geometry;
      if (!g || g.type !== 'Polygon' || !g.coordinates || !g.coordinates[0]) return;
      var ring = g.coordinates[0].map(function (p) { return [p[1], p[0]]; });
      L.polygon(ring, { color: lot.color, weight: 2, fillColor: lot.color, fillOpacity: 0.16, interactive: false })
        .bindTooltip(lot.code, { permanent: true, direction: 'center', className: 'lote' })
        .addTo(farmLayer);
    });
    (farm.rows || []).forEach(function (r) {
      if (!r.ini || !r.fin) return;
      L.polyline([r.ini, r.fin], { color: '#f3d27a', weight: 2, opacity: 0.8, interactive: false }).addTo(farmLayer);
    });
    (farm.points || []).forEach(function (p) {
      L.circleMarker([p.lat, p.lon], { radius: 7, color: '#0e3b24', weight: 3, fillColor: '#f3d27a', fillOpacity: 1 })
        .bindTooltip(p.name, { direction: 'top', offset: [0, -6], className: 'punto' })
        .addTo(farmLayer);
    });
  }

  function drawPests() {
    pestLayer.clearLayers();
    state.reports.forEach(function (r) {
      var sel = r.id === state.selectedId;
      if (sel) {
        L.circleMarker([r.lat, r.lon], { radius: 22, color: r.color, weight: 3, opacity: 0.9, fill: false, interactive: false,
          className: 'pulso' }).addTo(pestLayer);
      }
      var m = L.circleMarker([r.lat, r.lon], {
        radius: sel ? 13 : 10, color: '#ffffff', weight: sel ? 4 : 3, fillColor: r.color, fillOpacity: 1,
        dashArray: r.approx ? '4 4' : null
      });
      m.on('click', function (e) { L.DomEvent.stop(e); send({ type: 'select', caseId: r.id }); });
      m.addTo(pestLayer);
    });
  }

  function drawMe() {
    meLayer.clearLayers();
    lineLayer.clearLayers();
    var me = state.me;
    if (!me) return;
    if (me.acc && me.acc > 3) {
      L.circle([me.lat, me.lon], { radius: me.acc, color: '#2f80ed', weight: 1, fillColor: '#2f80ed', fillOpacity: 0.12,
        interactive: false }).addTo(meLayer);
    }
    L.circleMarker([me.lat, me.lon], { radius: 8, color: '#ffffff', weight: 3, fillColor: '#2f80ed', fillOpacity: 1,
      interactive: false }).addTo(meLayer);
    var sel = state.reports.filter(function (r) { return r.id === state.selectedId; })[0];
    if (sel) {
      L.polyline([[me.lat, me.lon], [sel.lat, sel.lon]], { color: '#ffffff', weight: 3, dashArray: '8 8', opacity: 0.95,
        interactive: false }).addTo(lineLayer);
    }
  }

  function bounds(includeMe) {
    var b = L.latLngBounds([]);
    farmLayer.eachLayer(function (l) { if (l.getBounds) b.extend(l.getBounds()); else if (l.getLatLng) b.extend(l.getLatLng()); });
    state.reports.forEach(function (r) { b.extend([r.lat, r.lon]); });
    if (includeMe && state.me) b.extend([state.me.lat, state.me.lon]);
    return b;
  }

  window.RIACHUELO = {
    update: function (p) {
      var key = JSON.stringify(p.farm || null);
      if (key !== farmKey) { farmKey = key; drawFarm(p.farm); }
      var prevSel = state.selectedId;
      state.reports = p.reports || [];
      state.me = p.me || null;
      state.selectedId = p.selectedId || null;
      drawPests();
      drawMe();
      if (!fitted) {
        var b = bounds(false);
        if (b.isValid()) { map.fitBounds(b, { padding: [36, 36], maxZoom: 18 }); fitted = true; }
      }
      if (state.selectedId && state.selectedId !== prevSel) {
        var s = state.reports.filter(function (r) { return r.id === state.selectedId; })[0];
        if (s) map.panTo([s.lat, s.lon]);
      }
    },
    fitAll: function () {
      var b = bounds(true);
      if (b.isValid()) map.fitBounds(b, { padding: [36, 36], maxZoom: 18 }); else map.setView(CFG.center, 17);
    },
    centerMe: function () {
      if (state.me) map.setView([state.me.lat, state.me.lon], Math.max(map.getZoom(), 18));
    },
    toggleBase: function () {
      if (base === 'sat') { map.removeLayer(sat); streets.addTo(map); base = 'calles'; }
      else { map.removeLayer(streets); sat.addTo(map); base = 'sat'; }
      send({ type: 'base', base: base });
    }
  };
  send({ type: 'ready' });
})();
`;

const PAGE_CSS = `
html, body, #map { height: 100%; margin: 0; padding: 0; background: #1b2a22; }
.leaflet-container { font: 14px/1.3 -apple-system, Roboto, sans-serif; background: #1b2a22; }
.leaflet-tooltip.lote { background: rgba(14, 59, 36, .78); color: #fff; border: 0; box-shadow: none; font-weight: 800;
  font-size: 13px; padding: 2px 6px; border-radius: 8px; }
.leaflet-tooltip.lote:before { display: none; }
.leaflet-tooltip.punto { font-weight: 700; }
.leaflet-control-attribution { font-size: 10px; }
.leaflet-bar a { width: 40px; height: 40px; line-height: 40px; font-size: 22px; }
@keyframes pulso { 0% { stroke-opacity: .95; } 50% { stroke-opacity: .25; } 100% { stroke-opacity: .95; } }
.pulso { animation: pulso 1.4s ease-in-out infinite; }
`;

export interface MapTexts {
  attrSat: string;
  attrStreets: string;
}

export function buildMapHtml(texts: MapTexts, center: [number, number]): string {
  const cfg = safeJson({ center, attrSat: texts.attrSat, attrStreets: texts.attrStreets });
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>${LEAFLET_CSS}</style><style>${PAGE_CSS}</style></head>
<body><div id="map"></div>
<script>${LEAFLET_JS}</script>
<script>window.RIACHUELO_CFG = ${cfg};</script>
<script>${PAGE_JS}</script>
</body></html>`;
}
