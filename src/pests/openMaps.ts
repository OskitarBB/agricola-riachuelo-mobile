// src/pests/openMaps.ts — «Cómo llegar»: abre Google Maps con la ruta a pie hasta la alerta (ADR 0009).
//
// QUÉ HACE: usa la URL universal de Google Maps (src/domain/geo.ts): abre la app de Google Maps si está instalada y,
// si no, el navegador. No necesita clave ni SDK de mapas. Si no se puede abrir, devuelve false (la pantalla avisa).

import { Linking } from 'react-native';

import { googleMapsPointUrl, googleMapsWalkingUrl } from '../domain/geo';
import { logEvent } from '../diagnostics/eventLog';

export async function openWalkingDirections(lat: number, lon: number, caseId: string): Promise<boolean> {
  try {
    await Linking.openURL(googleMapsWalkingUrl(lat, lon));
    logEvent('INFO', 'PESTS', 'DIRECTIONS_OPENED', { caseId });
    return true;
  } catch {
    logEvent('WARN', 'PESTS', 'DIRECTIONS_FAIL', { caseId });
    return false;
  }
}

export async function openPointInMaps(lat: number, lon: number): Promise<boolean> {
  try {
    await Linking.openURL(googleMapsPointUrl(lat, lon));
    return true;
  } catch {
    return false;
  }
}
