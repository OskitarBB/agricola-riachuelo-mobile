# ADR 0004 — CFG-3: ciclo de monitoreo, bloqueo de lo terminado, lateral B desde el final y áreas no hechas

**Estado:** aceptado · **Fecha:** 2026-10-02 · **Pedido por:** equipo del proyecto

## Contexto
1. En una sesión nueva se podía volver a elegir una hilera o lote ya terminado.
2. El lateral B se podía iniciar en cualquier dirección, aunque en campo el operador da la vuelta en el extremo
   donde terminó el lateral A.
3. Al cerrar una sesión no quedaba registro de lo planificado que no se hizo ni del porqué.

## Decisión
- **Ciclo de monitoreo** (`monitoring_cycles`): ronda de campo (p. ej. semanal). Cada sesión guarda su ciclo.
  - Un lateral está **terminado** si tiene una pasada `COMPLETED` en cualquier sesión del ciclo.
  - Hilera con ambos laterales terminados → **bloqueada**. Si falta un lateral, solo ese se puede elegir.
  - Lote con todas sus hileras activas completas → **bloqueado** en "Nueva sesión" y "Nueva pasada".
  - Un lateral `INCOMPLETE` no se bloquea: se repite con motivo (incidencia OPERADOR).
  - **Nuevo ciclo**: solo `ADMINISTRADOR` (y en el futuro `SUPERVISOR` desde la web), sin sesión abierta.
    Libera todo; lo anterior queda como historial. El ciclo 1 se crea solo y recibe las sesiones antiguas.
- **Lateral B**: dirección **siempre opuesta** a la del último lateral A cerrado (fija en pantalla y validada
  en `passService`, código `DIRECCION_LATERAL_B`). El punto de partida es el primer segmento en el sentido de
  avance y su marcador de entrada (descendente → `FIN` del último segmento).
- **Plan de la sesión** (`session_planned_lots`): en "Nueva sesión" se eligen los lotes a trabajar (al menos uno).
  Las pasadas solo se crean en lotes planificados (`LOTE_NO_PLANIFICADO`).
- **Áreas no hechas** (`uncovered_areas`): al cerrar la sesión se listan, para cada lote planificado no completo:
  - `LOTE`: no se hizo ninguna pasada en la sesión.
  - `LATERAL`: hilera trabajada a la que le falta un lateral (un ítem por lateral).
  - `HILERA`: hileras no iniciadas del lote trabajado (un ítem agrupado; se guarda una fila por hilera).
  Cada ítem exige un motivo: Clima, Falta de tiempo, Riego o aplicación, Labores en el campo, Falla de equipo,
  Acceso bloqueado, Indicación del supervisor u Otro (con descripción). Sin motivos no se cierra la sesión.
  El panel del controlador muestra los **Pendientes del ciclo** hasta que esas áreas se terminen.

## Consecuencias
- Migración 002 (tablas nuevas + columna `monitoring_sessions.cycle_id` + índices). No modifica datos.
- La cobertura es **local al controlador** hasta la Fase 4; entonces el backend publicará el ciclo y el avance
  de todos los controladores, y `uncovered_areas` viajará con `INCIDENT_BATCH`.
- El catálogo de motivos es provisional: se acuerda con Agrícola Riachuelo.
- Pruebas: `__tests__/coverage.test.ts` y RN-12 en `__tests__/domain.test.ts`.
