# ADR 0008 — Cerrar la sesión de usuario con una sesión de monitoreo abierta, y volver a elegir función al cerrar

**Fecha:** 2026-10-07 · **Estado:** aceptada · **Versión:** app 0.4.5 · Modifica RN-19, §7.8 y CP-32 del maestro v2.0.

## Contexto
En la prueba de campo con tres Android el equipo pidió poder cerrar la sesión de usuario sin terminar antes la sesión
de monitoreo, y que al cerrar una sesión de monitoreo cada celular vuelva a la pantalla de elegir su función (PANT-08).
RN-19 lo prohibía. El maestro ya admite una sesión de monitoreo abierta sin usuario: tras una revocación (7.8) la sesión
«queda guardada tal como estaba y se recupera (8.10) cuando alguien vuelve a iniciar sesión en ese celular».

## Decisión
- **Cerrar sesión** se permite siempre. Con una sesión de monitoreo abierta el aviso lo explica; en el controlador la
  pasada en curso se pausa (PAUSE a las cámaras) antes de cortar la red local. Nada se borra: sesión, pasadas, fotos y
  colas quedan en SQLite y se recuperan al volver a entrar (8.10). Evento `AUTH/LOGOUT_WITH_OPEN_SESSION`.
- **Al cerrar una sesión de monitoreo** (PANT-19 en el controlador; SESSION_CLOSED en las cámaras) se va a PANT-08 con
  `roleChoicePending`. RN-15 no cambia: con fotos por enviar o datos sin sincronizar, las otras funciones siguen
  bloqueadas. La sincronización automática del cierre se decide antes de ir a PANT-08.
- Se elimina `canLogout` (src/domain/rules.ts) y el mensaje `SESION_ABIERTA_IMPIDE_SALIR`.

## Consecuencias
- CP-32 cambia: «Cerrar sesión de usuario con una sesión de monitoreo abierta» → permitido con aviso; la pasada queda
  PAUSED y al volver a entrar se recupera.
- Si entra OTRO usuario en ese celular, encuentra la sesión abierta y puede continuarla o cerrarla (igual que tras una
  revocación). Las secuencias conservan el `userId` de quien las capturó.
