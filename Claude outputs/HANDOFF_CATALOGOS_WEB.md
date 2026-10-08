# Traspaso: gestión de catálogos del campo en la web (lotes, hileras, segmentos y marcadores)

Preparado el 07/10/2026 desde el chat de la app móvil (app v0.4.5). Es para el chat que trabaja en la carpeta de la
**plataforma web** (`agricola-riachuelo-platform`, rama `prueba2`, la que usa el VPS).

---

## 0. Pedido para pegar en el otro chat

> Lee `claude/HANDOFF_CATALOGOS_WEB.md` del proyecto y `CLAUDE.md` de la plataforma. Implementa en la web una
> página de **Catálogos** para crear, editar, desactivar y reactivar lotes, hileras, segmentos y marcadores. Tiene que
> ser fácil de usar (crear muchas hileras de una vez, segmento de hilera completa con un clic) y **no puede romper**
> la app móvil, la sincronización, la revisión de casos, el plano, los avisos ni la auditoría. Sigue las secciones 3 a
> 9 de este documento. Antes de programar, confírmame las preguntas de la sección 10.

---

## 1. Por qué

- La app necesita, para iniciar una pasada, lote → hilera → segmento → marcador de inicio. En el piloto solo había
  lotes e hileras: el operador no podía avanzar.
- Hoy los catálogos solo se editan en `/gestion/` (Django Admin, solo superusuarios), uno por uno, sin ver los
  segmentos dentro de la hilera y sin acciones en bloque. El 07/10 hubo que usar un script por SSH en el VPS para
  crear 83 segmentos «hilera completa» (ver 2.4).
- Meta: que un administrador lo haga desde la web en minutos, sin SSH y sin riesgo de romper datos.

## 2. Estado actual (verificar en el repositorio: la copia que vi puede estar desactualizada)

### 2.1 Modelos (`campo/models.py`)
| Modelo | Tabla | Clave | Campos clave | Restricciones |
|---|---|---|---|---|
| `FieldLot` | `field_lots` | `id` CharField(20), p. ej. `SWG1` | `code` (único, «SWG 1»), `name`, `active`, `geometry` (GeoJSON opcional, mapa) | — |
| `FieldRow` | `field_rows` | `id` CharField(30), p. ej. `SWG1-H01` | `lot`, `number`, `plant_count`, `active` | único (`lot`, `number`) |
| `FieldSegment` | `field_segments` | `id` CharField(40) | `row`, `code`, `start_plant`, `end_plant`, `is_pilot` | CHECK `start_plant <= end_plant`. **No tiene `active`** |
| `Marker` | `markers` | `id` CharField(40) | `row`, `segment` (opcional), `code`, `description`, `position` (INICIO/FIN/INTERMEDIO, con CHECK), `lat`, `lon` | **No tiene `active`** |

Los códigos de segmento y marcador **pueden repetirse entre hileras** (la app lo admite desde su migración 004).

### 2.2 Quién usa los catálogos (lo que NO se puede romper)
| Uso | Dónde | Cómo depende |
|---|---|---|
| Descarga de catálogos de la app | `api/v1/views.py` `BootstrapView` (`GET /api/v1/catalogs/bootstrap`) | Lotes `active=True`, hileras `active=True` de esos lotes, y TODOS los segmentos y marcadores de esas hileras. `catalogVersion` se calcula solo con un hash del contenido: cualquier cambio cambia la versión, no hay que tocarlo. La app **reemplaza** sus tablas de catálogo completas en cada descarga. |
| Sincronización de la app | `monitoreo/services.py` `upsert_pass`, secuencias | Valida que existan `lotId`, `rowId` (y que la hilera sea de ese lote), `markerId` y `segmentId`. **No mira `active`.** Si un ID no existe → `VALIDATION_ERROR` 400, que en la app es un error definitivo de esa sesión. |
| Pasadas, cambios de marcador y secuencias | `monitoreo/models.py` | `lot`/`row` con **PROTECT**; `start_marker`, `end_marker`, `marker`, `segment` con **SET_NULL** (¡borrar un marcador borra en silencio la ubicación de la evidencia ya registrada!). |
| Casos de revisión | `revision/models.py` | `lot`, `row`, `segment`, `marker` con **PROTECT**. `revision/services.py` lee `lat`/`lon` del marcador. |
| Plano del lote | `web/queries.py` `plano()` | Hileras `active=True` con sus segmentos y conteos de casos por segmento. |
| Mapa | `web/views.py` mapa | `FieldLot.geometry`. |
| Avisos | `notificaciones/models.py` | Destinatarios con M2M a `FieldLot`. |
| Diagnóstico y demo | `diagnostico/…`, `web/demo.py` (`sembrar_demo` prohibido en piloto, W-22) | Lectura. |

### 2.3 Web y reglas
- Permisos en `web/permissions.py` (`PERMISOS`, `@web_view("permiso")`, W-07). Roles: A = administrador,
  E = especialista, S = supervisor.
- Páginas de administración existentes como patrón: `destinatarios`, `usuarios`, `dispositivos` (formulario Django +
  `audit.record(...)` + `messages.success` + redirect).
- Auditoría: `auditoria.services.record(entity_type, entity_id, action, user, before, after)`. `action` es texto
  libre (máx. 40). La tabla solo admite INSERT (trigger, ADR-W-004).
- Integridad en la base: `config/restricciones.py` (`@checks_de_opciones`) crea CHECK por campo con opciones
  (ADR-W-004). Un campo nuevo con opciones requiere `makemigrations`.
- Reglas de `CLAUDE.md`: sin frameworks ni CDN (HTMX y Leaflet en `web/static/web/vendor/`, W-01); **sin JavaScript
  en línea** (W-17, lo comprueba `web/tests/test_extras.py`); toda vista con `@web_view`; **la bandeja hace
  exactamente 6 consultas** (no tocar `base.html` ni los context processors con consultas); números en atributos/CSS
  sin localizar (W-16); accesibilidad W-23; responsive sin desplazamiento horizontal (RNF-W07).
- Al terminar: `python manage.py check`, `python manage.py makemigrations --check --dry-run`, `python manage.py test`,
  y el reporte 23.2 en `docs/REPORTE_AVANCE.md` (W-24).

### 2.4 Datos en producción al 07/10/2026
3 lotes, 83 hileras (Anexo D). Se ejecutó (o se va a ejecutar) en el VPS un script que creó en cada hilera sin
segmentos: segmento `<fila>-S1` código «Hxx completa» (planta 1 a `plant_count`) y marcadores `<fila>-INI`
(«Hxx inicio», INICIO) y `<fila>-FIN` («Hxx fin», FIN), sin coordenadas. La nueva función debe convivir con esos IDs.

## 3. Reglas de diseño que no se negocian

1. **«Eliminar» = desactivar.** Nada de borrar filas desde la web. Hay celulares que trabajan sin internet con el
   catálogo descargado: si un ID desaparece del servidor, su sincronización pendiente falla para siempre; y borrar un
   marcador o segmento pone en NULL la ubicación de pasadas y secuencias ya registradas. Desactivar lo oculta de la
   app (en la siguiente «Actualizar catálogos») y del plano, pero la historia y la sincronización siguen funcionando.
   Se puede reactivar.
2. **Los IDs no cambian nunca y no se reutilizan.** Se generan en el servidor (sección 5.2). Editar cambia código,
   nombre, plantas, posición, etc., nunca el `id`.
3. **El número de una hilera y el lote de una hilera no se editan** (el ID `SWG1-H01` los contiene y las pasadas ya
   apuntan a él). Para «renumerar», se desactiva y se crea otra.
4. **No cambiar el contrato `/api/v1`**: solo se puede agregar (p. ej. `"active": true` en segmentos y marcadores) y
   filtrar lo inactivo. No quitar ni renombrar campos (regla común con la app).
5. **No tocar** `monitoreo/services.py` (sincronización), los modelos de `monitoreo`/`revision`, ni la bandeja.
6. Todo cambio pasa por **servicios con `transaction.atomic()` y auditoría** (W-02: reglas en servicios, plantillas
   sin lógica de negocio).

## 4. Cambios de modelo (una migración nueva, `campo/00xx_catalogo_activo.py`)

- `FieldSegment.active = BooleanField(default=True)` y `Marker.active = BooleanField(default=True)`.
- `BootstrapView`: filtrar `active=True` en segmentos y marcadores (además de lo que ya filtra) y agregar
  `"active": true` a cada uno (campo nuevo, compatible).
- `web/queries.py` `plano()`: mostrar solo segmentos activos **pero** contar casos aunque el segmento esté inactivo
  (los casos viejos siguen existiendo). Verificar que la consulta no sume consultas extra.
- **Django Admin (`campo/admin.py`)**: quitar el borrado (`has_delete_permission` → `False`) en los cuatro modelos
  y `readonly_fields = ("id",)` al editar; agregar `active` a `list_display`/`list_filter`. Así `/gestion/` deja de
  ser una vía para romper datos. (La acción masiva «Eliminar seleccionados» desaparece con eso.)
- Si la base es Supabase/PostgreSQL: es solo `ADD COLUMN ... DEFAULT true`, no crea tablas (no hace falta RLS nuevo).

## 5. Reglas de negocio de los catálogos (en `campo/services.py`, nuevo)

### 5.1 Validaciones
| Entidad | Reglas |
|---|---|
| Lote | `code` obligatorio y único (ya hay UNIQUE), `name` obligatorio. `id` se genera del código (5.2). |
| Hilera | `number` ≥ 1, único dentro del lote (UNIQUE existente; dar mensaje claro, no un 500). `plant_count` ≥ 1. Bajar `plant_count` no puede dejar fuera a un segmento **activo** (`plant_count` ≥ mayor `end_plant` activo). |
| Segmento | `1 ≤ start_plant ≤ end_plant ≤ plant_count` de su hilera. Sin solaparse con otro segmento **activo** de la misma hilera. `code` obligatorio y único entre los activos de la hilera. |
| Marcador | `position` ∈ INICIO/FIN/INTERMEDIO. Si tiene `segment`, debe ser de la misma hilera. `lat` ∈ [-90, 90] y `lon` ∈ [-180, 180] o ambos vacíos. `code` único entre los activos de la hilera. |
| Desactivar | Lote → también deja de verse todo lo de adentro (ya lo hace el bootstrap). Hilera → igual con sus segmentos y marcadores. Segmento → desactiva también sus marcadores (preguntar en la confirmación). Reactivar un hijo de un padre inactivo: no permitido (mensaje). |

Avisar (no bloquear) si se desactiva algo usado por una pasada de una sesión que en el servidor no está `CLOSED` ni
`SYNCED`: «Hay una sesión en curso en esta hilera; los celulares que ya la tienen pueden terminarla».

### 5.2 IDs generados (máx. de la columna entre paréntesis)
- Lote (20): código en mayúsculas sin espacios ni tildes (`SWG 1` → `SWG1`); si existe, sufijo `-2`, `-3`…
- Hilera (30): `{lote.id}-H{number:02d}` (`SWG1-H07`).
- Segmento (40): `{fila.id}-S{k}` con el primer `k` libre (los del script del VPS ya usan `-S1`).
- Marcador (40): `{fila.id}-INI` / `-FIN` para los de hilera completa; el resto `{fila.id}-M{k}` con el primer `k`
  libre. Comprobar existencia **incluyendo inactivos** antes de crear.

### 5.3 Operaciones del servicio (todas atómicas y auditadas)
`crear_lote`, `editar_lote`, `crear_hileras(lote, desde, hasta, plantas, segmento_completo=True)` (salta números que
ya existen y devuelve cuáles), `editar_hilera`, `crear_segmento`, `dividir_hilera(fila, n_segmentos | cada_k_plantas,
con_marcador_inicio)`, `editar_segmento`, `crear_marcador`, `editar_marcador`, `completar_hileras_sin_segmento(lote)`
(lo mismo que el script del VPS, pero desde la web), `desactivar(entidad)`, `reactivar(entidad)`.
Auditoría: `entity_type` = `field_lot` / `field_row` / `field_segment` / `marker`; acciones `CATALOGO_CREADO`,
`CATALOGO_EDITADO`, `CATALOGO_DESACTIVADO`, `CATALOGO_REACTIVADO`, `CATALOGO_LOTE_HILERAS` (alta en bloque, con
el rango en `after`). `before`/`after` con los campos cambiados.

## 6. Pantallas (HTMX + plantillas, mismo estilo que Administración)

Menú: **Administración → Catálogos** (permiso nuevo `catalogos.gestionar`, ver 10).

1. **`/administracion/catalogos/`** — tarjetas de lotes: código, nombre, hileras activas, segmentos, marcadores,
   estado. Botón **«Nuevo lote»** (formulario corto: código y nombre). Filtro «mostrar inactivos».
2. **`/administracion/catalogos/<lote>/`** — tabla de hileras: número, plantas, segmentos (chips con código y
   rango), marcadores, estado, acciones **Editar · Desactivar/Reactivar**. Arriba:
   - **«Agregar hileras»**: desde N hasta M, plantas por hilera, casilla marcada «Crear segmento de hilera completa
     con marcadores de inicio y fin». Muestra cuántas se crearán antes de confirmar.
   - **«Completar hileras sin segmento»** (aparece solo si hay alguna): un clic, con confirmación y conteo.
   - Editar nombre/código del lote y desactivarlo.
3. **`/administracion/catalogos/hilera/<id>/`** — plantas (editable), lista de segmentos (crear/editar en línea con
   HTMX, desactivar) y de marcadores (crear/editar, posición, segmento, descripción, lat/lon opcionales). Ayuda
   **«Dividir en segmentos»**: N partes iguales o cada K plantas, vista previa de los rangos.
4. Mensajes claros en español, sin códigos técnicos. Confirmación para desactivar. Debe verse bien en celular.

Al pie de cada pantalla: «Los cambios llegan a la app cuando el controlador toca *Actualizar* en Catálogos».

### Fase B (opcional, después de lo anterior): importar CSV
Plantilla descargable (`lote, hilera, plantas, segmento, planta_inicio, planta_fin, marcador, posicion, lat, lon`),
**vista previa con errores por línea** y botón «Aplicar» que hace todo en una transacción (todo o nada). Solo crea o
actualiza; nunca borra.

## 7. Pruebas a escribir (en `campo/tests/` y `web/tests/`)
- Servicios: cada validación de 5.1 (incluido solapamiento y `plant_count` menor que un segmento), IDs de 5.2
  (incluye choque con inactivos y con `-S1/-INI/-FIN` existentes), alta en bloque que salta números repetidos,
  desactivar/reactivar en cascada, auditoría registrada en cada operación.
- API: el bootstrap **no** devuelve lotes, hileras, segmentos ni marcadores inactivos; `catalogVersion` cambia
  al desactivar; los campos existentes no cambian (prueba de contrato).
- Sincronización: `upsert_pass` y las secuencias **siguen aceptando** IDs de hileras/marcadores/segmentos
  desactivados (datos de celulares sin internet). Ninguna pasada pierde su marcador.
- Admin: no se puede borrar desde `/gestion/`.
- Web: permisos (403 para quien no tenga `catalogos.gestionar`), sin JS en línea (`test_extras`), la bandeja sigue
  en 6 consultas, el plano sigue mostrando conteos de casos de segmentos desactivados.
- Correr toda la batería existente (`python manage.py test`) sin fallas.

## 8. Verificación con la app (pedírsela a Oscar al final)
1. Desplegar (`git push` → en el VPS `cd /srv/riachuelo && git pull && bash deploy/actualizar.sh`).
2. En la web: crear un lote de prueba con 3 hileras y segmento completo; dividir una hilera en 2 segmentos.
3. En el controlador (app 0.4.5): Catálogos → Actualizar → Nueva pasada: aparecen las hileras, segmentos y
   marcadores nuevos.
4. Desactivar ese lote → Actualizar en la app → ya no aparece. Las sesiones viejas siguen sincronizando.

## 9. Entrega
- Código, migración, pruebas, ADR **`docs/adr/ADR-W-006-gestion-de-catalogos.md`** (formato 23.3; afecta RN-W08
  solo en que catálogos sí se administran desde la web: no son datos de campo) y reporte 23.2 en
  `docs/REPORTE_AVANCE.md`.
- Una línea en `docs/INTEGRACION_APP.md` (bootstrap: segmentos y marcadores traen `active` y se excluyen los
  inactivos).
- Actualizar `claude/DESPLIEGUE_VPS.md` del proyecto: los catálogos se administran en Administración → Catálogos.

## 10. Preguntas para Oscar antes de programar (W-04: no inventar permisos)
1. ¿Quién puede editar catálogos: solo **administrador**, o también **supervisor**? (Propuesta: administrador y
   supervisor; ambos ya ven sesiones y mapa.)
2. ¿Se necesita editar el contorno del lote (`geometry`, para el mapa) desde esta pantalla, o se deja en `/gestion/`?
   (Propuesta: dejarlo fuera por ahora.)
3. ¿Hace falta la importación CSV (Fase B) ya, o cuando tengan los marcadores reales del campo (Q-01)?

## 11. Fuera de alcance
Cambios en la app móvil (no hacen falta: la app ya lee el bootstrap y admite códigos repetidos), cambios en la
sincronización, borrar datos físicamente, y cargar coordenadas reales de marcadores (pendiente Q-01).
