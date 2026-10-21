# ADR 0011 — Segmentos fijos por hilera y sentido de la pasada (app 0.6.0, CFG-10)

20/10/2026 · Estado: propuesta para el equipo · Requiere la plataforma **v1.4** (ADR-W-010) · Autor: Claude

**Contexto.** La web ahora define una cantidad FIJA de segmentos por hilera (10, ≈20 m cada uno en hileras de 200 m)
que comparten los dos laterales, y la envía en el bootstrap (`segmentRules.perRow`, `rows[].lengthM`). En la app el
cambio de segmento es manual (PANT-17, contexto §25.2) y la lista de marcadores no decía cuál era el siguiente.
Además PANT-15 registraba toda pasada como ASCENDENTE desde que se quitó el selector de dirección (v0.4.x), aunque
la regla de ADR 0004 dice que el LATERAL B va de vuelta: con 10 segmentos, el B quedaba con el orden al revés.
Y los marcadores de la web están al INICIO de cada segmento: yendo de vuelta, el poste que se cruza al pasar de S4 a
S3 es «S4 inicio», cuyo segmento en el catálogo es S4; tomar el segmento del marcador dejaba las fotos en S4.

**Decisión.**

1. `src/domain/segments.ts` (puro, con pruebas): `rowLayout` (n de N, huecos, solapes: aviso, nunca bloquea),
   `segmentPosition`/`segmentLabel` («H05 S3 · 3 de 10»), `approxMeters`, `nextSegmentStep` (siguiente segmento en el
   sentido de la pasada y el marcador del límite que se cruza) y `passDirectionFor`.
2. **Sentido de la pasada deducido, sin selector:** A ascendente; B contrario al último A cerrado del ciclo
   (`rowCoverage().directionB`) o descendente. PANT-15 propone el segmento y el marcador de entrada de ese extremo
   (`startPointOf`) y muestra «Recorrido: de la planta 133 a la 1 (de vuelta) · empieza en H05 S10».
3. **PANT-17 Cambiar marcador:** arriba, «Siguiente segmento» ya seleccionado (basta «Confirmar»: el cambio sigue
   siendo manual). La selección guarda marcador y segmento por separado; el servidor ya los acepta así
   (`markerChanges[].markerId/segmentId`). La lista muestra «S3 (3 de 10) · plantas 27–40».
4. Catálogos: `cat_rows.length_m` (migración **005**, una columna), `app_meta.segments_per_row`,
   `CatalogInfo.segmentsPerRow/rowsOffStandard`; PANT-11 muestra la cantidad fija y cuántas hileras no la cumplen.
   CFG-10: `catalog.segmentsPerRow = 10` si la plataforma no la envía.

**Alternativas.** Volver a poner el selector de dirección (más toques, y el error de elegirla mal). Cambio de
segmento automático por GPS (el GPS del celular tiene 5–15 m de error, igual que medio segmento). Marcadores al
inicio y al fin de cada segmento (duplica los postes en campo).

**Consecuencias.** Las pasadas B quedan registradas como DESCENDENTE (la web y la cobertura ya lo esperaban). Las
hileras antiguas con un solo segmento siguen funcionando, con aviso. Los tres celulares deben tener la misma versión
(RN-17): instalar 0.6.0 en todos.
