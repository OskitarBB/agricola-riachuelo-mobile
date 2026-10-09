/** @jest-environment node */
// __tests__/pests.test.ts — «Ubicar plaga» (ADR 0009): distancia y rumbo, orden de las alertas, roles, enlace de
// Google Maps y página del mapa (JSON seguro dentro del WebView).

import { buildMockPestReports } from '../src/api/mock/mockPests';
import {
  arrowFor,
  bearingDeg,
  cardinal,
  distanceM,
  formatDistance,
  googleMapsPointUrl,
  googleMapsWalkingUrl,
  isValidLatLon,
} from '../src/domain/geo';
import {
  FARM_CENTER,
  filterReports,
  hasLocation,
  isConfirmed,
  labelText,
  pestColor,
  placeText,
  sortReports,
  withDistance,
  type PestReport,
} from '../src/domain/pests';
import { canDoFieldWork, FIELD_ROLES, MOBILE_ALLOWED_ROLES } from '../src/domain/types';
import { buildMapHtml, mapCall, mapPayload, safeJson } from '../src/pests/mapHtml';

const CENTER = { lat: FARM_CENTER[0], lon: FARM_CENTER[1] };

describe('geo', () => {
  test('distancia: 1/1000 de grado de latitud ≈ 111 m', () => {
    const d = distanceM(CENTER, { lat: CENTER.lat + 0.001, lon: CENTER.lon });
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
    expect(distanceM(CENTER, CENTER)).toBe(0);
  });

  test('rumbo y punto cardinal', () => {
    expect(Math.round(bearingDeg(CENTER, { lat: CENTER.lat + 0.001, lon: CENTER.lon }))).toBe(0);
    expect(Math.round(bearingDeg(CENTER, { lat: CENTER.lat, lon: CENTER.lon + 0.001 }))).toBe(90);
    expect(Math.round(bearingDeg(CENTER, { lat: CENTER.lat - 0.001, lon: CENTER.lon }))).toBe(180);
    expect(Math.round(bearingDeg(CENTER, { lat: CENTER.lat, lon: CENTER.lon - 0.001 }))).toBe(270);
    expect(cardinal(0)).toBe('N');
    expect(cardinal(44)).toBe('NE');
    expect(cardinal(225)).toBe('SO');
    expect(cardinal(359)).toBe('N');
    expect(cardinal(-90)).toBe('O');
    expect(arrowFor(90)).toBe('→');
  });

  test('formato de distancia con coma decimal', () => {
    expect(formatDistance(0.4)).toBe('1 m');
    expect(formatDistance(35.4)).toBe('35 m');
    expect(formatDistance(1234)).toBe('1,2 km');
    expect(formatDistance(15_600)).toBe('16 km');
    expect(formatDistance(null)).toBe('—');
  });

  test('coordenadas válidas', () => {
    expect(isValidLatLon(-14.02, -75.69)).toBe(true);
    expect(isValidLatLon(0, 0)).toBe(false);
    expect(isValidLatLon(null, -75)).toBe(false);
    expect(isValidLatLon(-95, 10)).toBe(false);
    expect(isValidLatLon(Number.NaN, 10)).toBe(false);
  });

  test('Google Maps: ruta a pie hasta el punto', () => {
    const url = googleMapsWalkingUrl(-14.027806, -75.699222);
    expect(url).toBe('https://www.google.com/maps/dir/?api=1&destination=-14.0278060%2C-75.6992220&travelmode=walking');
    expect(googleMapsPointUrl(-14.027806, -75.699222)).toContain('query=-14.0278060%2C-75.6992220');
  });
});

describe('alertas', () => {
  const data = buildMockPestReports(30);

  test('el backend simulado trae un caso de cada estado visible en la app', () => {
    expect(data.reports.map((r) => r.status).sort()).toEqual(
      ['CONFIRMADO_POR_ESPECIALISTA', 'CONFIRMADO_POR_IA', 'PENDIENTE_REVISION', 'POSIBLE_PLAGA'].sort(),
    );
    expect(data.reports.every(hasLocation)).toBe(true);
    expect(data.farm.center).toEqual(FARM_CENTER);
  });

  test('orden: primero lo confirmado y, dentro, lo más cerca; sin posición, lo más reciente', () => {
    const me = { lat: data.reports[1].lat as number, lon: data.reports[1].lon as number }; // junto al confirmado por IA
    const sorted = sortReports(withDistance(data.reports, me));
    expect(isConfirmed(sorted[0].status)).toBe(true);
    expect(sorted[0].status).toBe('CONFIRMADO_POR_IA');
    expect(sorted[0].distanceM).toBeLessThan(1);
    expect(isConfirmed(sorted[1].status)).toBe(true);
    expect(sorted[2].status).toBe('POSIBLE_PLAGA');
    expect(sorted[3].status).toBe('PENDIENTE_REVISION');

    const noMe = sortReports(withDistance(data.reports, null));
    expect(noMe.every((r) => r.distanceM === null)).toBe(true);
    // Los dos confirmados: el más reciente primero (IA hace 2 h; especialista hace 5 h).
    expect(noMe[0].status).toBe('CONFIRMADO_POR_IA');
  });

  test('una alerta sin coordenadas va después de las que tienen distancia', () => {
    const a = { ...data.reports[0], caseId: 'a', lat: null, lon: null } as PestReport;
    const b = { ...data.reports[0], caseId: 'b' } as PestReport;
    const sorted = sortReports(withDistance([a, b], CENTER));
    expect(sorted.map((r) => r.caseId)).toEqual(['b', 'a']);
    expect(sorted[1].distanceM).toBeNull();
  });

  test('filtros', () => {
    expect(filterReports(data.reports, 'TODAS')).toHaveLength(4);
    expect(filterReports(data.reports, 'CONFIRMADAS').every((r) => isConfirmed(r.status))).toBe(true);
    expect(
      filterReports(data.reports, 'POSIBLES')
        .map((r) => r.status)
        .sort(),
    ).toEqual(['PENDIENTE_REVISION', 'POSIBLE_PLAGA']);
  });

  test('textos y colores (mismos que la web; un estado desconocido no rompe)', () => {
    expect(labelText('chanchito_blanco')).toBe('Chanchito blanco');
    expect(labelText('melaza_fumagina')).toBe('Melaza / fumagina');
    expect(labelText('arana_roja')).toBe('Arana roja');
    expect(labelText(null)).toBeNull();
    expect(pestColor('CONFIRMADO_POR_IA')).toBe('#c11574');
    expect(pestColor('ESTADO_NUEVO')).toBe(pestColor('PENDIENTE_REVISION'));
    expect(placeText(data.reports[0])).toBe('Lote SWG 1 · Hilera 3 · Lateral A · plantas 1–25');
  });
});

describe('roles', () => {
  test('el especialista entra a la app pero no hace trabajo de campo', () => {
    expect(MOBILE_ALLOWED_ROLES).toContain('ESPECIALISTA_FITOSANITARIO');
    expect(FIELD_ROLES).not.toContain('ESPECIALISTA_FITOSANITARIO');
    expect(canDoFieldWork(['ESPECIALISTA_FITOSANITARIO'])).toBe(false);
    expect(canDoFieldWork(['OPERADOR_CAMPO'])).toBe(true);
    expect(canDoFieldWork(['ESPECIALISTA_FITOSANITARIO', 'ADMINISTRADOR'])).toBe(true);
    expect(canDoFieldWork(undefined)).toBe(false);
  });
});

describe('página del mapa', () => {
  test('JSON seguro dentro de <script> e injectJavaScript', () => {
    const s = safeJson({ t: '</script><b>', l: 'a b' });
    expect(s).not.toContain('</script');
    expect(s).not.toContain(' ');
    expect(JSON.parse(s)).toEqual({ t: '</script><b>', l: 'a b' });
    expect(mapCall('fitAll')).toBe('window.RIACHUELO && window.RIACHUELO.fitAll(); true;');
  });

  test('la página lleva Leaflet embebido (sin CDN) y la vista satelital', () => {
    const html = buildMapHtml({ attrSat: 'Imágenes © Esri', attrStreets: 'Mapa © Esri' }, FARM_CENTER);
    expect(html).toContain('Leaflet 1.9.4');
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
    expect(html).toContain('World_Imagery');
    expect((html.match(/<\/script>/g) ?? []).length).toBe(3);
  });

  test('datos del mapa: solo alertas con coordenadas y borde punteado si son aproximadas', () => {
    const data = buildMockPestReports(30);
    const sinGps = { ...data.reports[0], caseId: 'x', lat: null, lon: null } as PestReport;
    const p = mapPayload(data.farm, [...data.reports, sinGps], null, data.reports[0].caseId);
    expect(p.reports).toHaveLength(4);
    expect(p.reports.find((r) => r.approx)?.id).toBe(data.reports[3].caseId);
    expect(p.me).toBeNull();
    expect(p.selectedId).toBe(data.reports[0].caseId);
  });
});
