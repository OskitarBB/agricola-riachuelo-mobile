# ADR 0009 — «Ubicar plaga»: mapa satelital, «Cómo llegar» y el especialista en la app

**Fecha:** 2026-10-08 · **Estado:** aceptada · **Versión:** app 0.5.0 (CFG-8) · Requiere la plataforma web **v1.3**
(ADR-W-007: `GET /api/v1/mobile/pest-reports`, estados `CONFIRMADO_POR_IA` y `POSIBLE_PLAGA`).

## Contexto
El equipo pidió que, cuando la IA (o el especialista) confirme una plaga, el encargado la vea en la app y pueda
**buscarla y llegar** hasta el lugar. Las alertas que llegan a la app son: confirmadas por la IA, confirmadas por el
especialista, posibles plagas (decididas por el especialista) y casos aún en revisión. Los descartes no salen.
Roles de la app: operador, administrador y **especialista fitosanitario** (este último solo para ubicar plagas).
Hasta la v0.4.6 la API nunca devolvía a la app resultados de IA ni URLs de fotos (maestro §28.10).

## Decisión
- **PANT-40 «Ubicar plaga»** (`app/pests/index.tsx`): mapa satelital o lista. Filtros Todas / Confirmadas / Posibles.
  Orden de la lista: primero lo confirmado (IA o especialista), luego posible plaga y en revisión; dentro de cada grupo
  lo más cerca de tu posición (sin posición, lo más reciente). Cada alerta: estado (color = estado de revisión, igual
  que la web), clase sugerida o confirmada, lote · hilera · lado · plantas, hora y «35 m al noreste ↗».
  Debajo de 15 m (`pests.arrivedRadiusM`, calibrar) dice «Estás en el lugar».
- **PANT-41 Detalle** (`app/pests/[id].tsx`): miniatura firmada por Django (se ve con internet), indicio de la IA en
  %, lugar, de dónde viene la ubicación (GPS del controlador con su precisión, o «aproximada»: marcador de la hilera),
  observación del especialista. Botones «Cómo llegar (Google Maps)», «Ver en el mapa» y «Ver punto en Google Maps».
- **Mapa** (`src/ui/components/PestMap.tsx` + `src/pests/mapHtml.ts`): WebView (`react-native-webview` 13.16.1, incluido
  en Expo Go SDK 57) con **Leaflet 1.9.4 embebido** como texto (`src/pests/vendor/leaflet.ts`, misma copia que la web;
  sin CDN). Fondo Esri World Imagery con nombres y vías (sin clave, atribución visible) o Esri World Street Map.
  Dibuja contornos de lotes, hileras (inicio→fin), puntos del fundo, alertas y tu posición con su precisión, y una
  línea punteada hasta la alerta elegida. Sin datos móviles se ve todo menos la imagen (las teselas ya vistas salen de
  la caché del WebView). La app manda los datos con `injectJavaScript` y la página avisa con `postMessage`.
- **Cómo llegar:** URL universal de Google Maps con ruta **a pie**
  (`https://www.google.com/maps/dir/?api=1&destination=<lat>,<lon>&travelmode=walking`): abre la app de Google Maps o
  el navegador. Sin SDK ni clave de mapas.
- **Datos** (`src/pests/pestService.ts`): `GET /mobile/pest-reports?days=30` con `callWithToken`; la respuesta se
  guarda en `app_meta.pest_reports_json` (sin migración nueva) para verla sin internet. Se actualiza al abrir, cada
  2 min con internet y con «Actualizar». Un 403 de cuenta o celular revoca la sesión como en 7.8. GPS propio de la
  pantalla (`watchPositionAsync`, pide el permiso si falta); no toca el GPS del controlador.
- **Especialista:** `MOBILE_ALLOWED_ROLES` lo incluye (login con y sin internet), pero `FIELD_ROLES` no:
  `canDoFieldWork()` decide las guardas de `(setup)`, `gallery`, `controller` y `camera`, la vinculación como cámara
  (`USER_NOT_ALLOWED`) y la sincronización (manual y automática: la plataforma respondería 403 `ROLE_NOT_ALLOWED` y la
  app revocaría la sesión). Al entrar va directo a PANT-40 (con Ajustes y Cerrar sesión arriba). Los datos de
  monitoreo que haya en el celular quedan guardados para el operador.
- **Entradas para operador y administrador:** Controlador (botón «🐞 Ubicar plaga»), Ajustes y PANT-08.
- **CFG-8:** `pests.windowDays` (30; 1–90), `requestTimeoutMs` (30 s), `autoRefreshMs` (2 min; ≥ 30 s y mayor que la
  espera), `locationIntervalMs` (2 s), `arrivedRadiusM` (15 m; 3–50).

## Consecuencias
- Excepción explícita a §28.10, solo lectura y solo en esta pantalla (la sincronización no cambia). La IA «sugiere
  indicios»: la app muestra la clase y el % como indicio, nunca como diagnóstico.
- Nuevas salidas a internet además de Django y Cloudinary: teselas de Esri (con atribución) y Google Maps por URL.
- El APK crece ~0,2 MB (Leaflet) y necesita compilarse de nuevo (`react-native-webview` es nativo). Las tres
  versiones deben coincidir (RN-17): instalar la 0.5.0 en los tres celulares.
- Desplegar primero la plataforma v1.3: con la v1.2 el especialista recibe `ROLE_NOT_ALLOWED` al iniciar sesión y la
  pantalla no encuentra `pest-reports`.
