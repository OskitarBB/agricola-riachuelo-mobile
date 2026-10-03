# ADR 0005 — Elegir la función del celular después de cada login y RN-15 sin sincronización

**Estado:** aceptado · **Fecha:** 2026-10-03 · **Pedido por:** equipo del proyecto

## Contexto
1. PANT-08 (Función del dispositivo) solo aparecía en el primer login (maestro §7.9). Después, la app entraba
   siempre a la función guardada, así que un celular que se usó como Controlador nunca volvía a ver
   Cámara 1 / Cámara 2.
2. RN-15 bloquea el cambio de función con sincronizaciones pendientes. Como la sincronización con el backend
   (Fase 4) todavía no existe, la cola `sync_queue` de un controlador que cerró una sesión nunca se vacía: el
   cambio de función quedaba bloqueado para siempre ("Cambiar función" mostraba CAMBIO_FUNCION_BLOQUEADO).

## Decisión
- **PANT-08 después de cada inicio de sesión** (con o sin internet, y después del cambio obligatorio de una
  contraseña temporal). `authStore.roleChoicePending` se activa en el mismo `set()` que cambia el estado de
  autenticación (sin carreras con `Stack.Protected`) y `app/index.tsx` envía a `/role`. Al reabrir la app con la
  sesión guardada (7.11) y en la revalidación sin salir de la pantalla (`reauthenticate`) no se activa.
- **PANT-08 rediseñada:** tarjetas Controlador / Cámara 1 / Cámara 2 con lo que necesita cada función, marca
  *Actual*, selección y botón fijo «Usar como …». Recién iniciada la sesión no hay «Volver»: la cabecera muestra
  «Cerrar sesión». Al confirmar se pasa por PANT-07 solo si falta un permiso (§7.4 paso 6).
- **RN-15 con `decideRoleChange` (src/domain/rules.ts):**
  - la misma función siempre se puede confirmar;
  - sesión de monitoreo abierta → bloquea (`CAMBIO_FUNCION_SESION_ABIERTA`);
  - fotos por enviar al controlador (cámara) → bloquea (`CAMBIO_FUNCION_FOTOS_PENDIENTES`);
  - cola de sincronización pendiente → **solo avisa** (`SINCRONIZACION_PENDIENTE`) mientras
    `isSyncImplemented()` sea `false`; los datos se conservan en SQLite. Cuando la Fase 4 exista
    (`SYNC_IMPLEMENTED = true` en src/sync/syncService.ts) vuelve a bloquear como dice RN-15.
- **PANT-30 (cámara):** además del lector de QR, muestra batería, espacio y la IP del Wi-Fi (§8.2) y
  «Reintentar» para reiniciar el lector.

## Consecuencias
- Ajustes › Cambiar función abre PANT-08 directamente: si RN-15 impide el cambio, la pantalla lo explica.
- No cambia el esquema SQLite, el protocolo ni la configuración (CONFIG_VERSION sigue en CFG-2).
- Pruebas: `__tests__/roleChange.test.ts` (decideRoleChange y la bandera del store).
- Pendiente de reflejar en el Archivo Maestro: §7.4 paso 6, §7.9, §8.1 y RN-15.
