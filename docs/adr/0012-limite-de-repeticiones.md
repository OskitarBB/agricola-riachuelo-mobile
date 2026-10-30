# ADR 0012 — Límite de repeticiones por cámara y bloqueo de la captura (app 0.6.1, CFG-11)

29/10/2026 · Estado: propuesta para el equipo · Sin cambios en la plataforma · Autor: Claude

**Contexto.** En campo, cuando una cámara fallaba (foto borrosa u oscura, celular en movimiento, sin respuesta), la
pantalla de la pasada mostraba «Repetir CÁMARA 2 (secuencia N)» para siempre: se buscaba el último fallo de cada
cámara en TODAS las secuencias de la pasada, así que el aviso no desaparecía aunque se siguiera capturando. Además
se podía sacar una secuencia nueva sin haber repetido la que falló, y una cámara con problemas podía pedir
repeticiones sin fin. Pedido de Oscar: como máximo 2 intentos; después se sigue normal, el aviso desaparece y la
foto se envía y se evalúa.

**Decisión.**

1. **Solo la última secuencia** puede pedir repetición (`pendingRetakes` en `src/domain/sequence.ts`, puro y con
   pruebas). Cada cámara tiene como máximo `capture.maxRetakesPerCamera` repeticiones (CFG-11: **2**), contadas en
   `retake_requests` (`countRetakesBySequence`, sin migración).
2. **Bloqueo:** mientras una cámara de la última secuencia tenga una repetición pendiente no sale una secuencia
   nueva. En MANUAL el botón grande pasa a «REPETIR CÁMARA X · INTENTO a DE m» (dorado); en AUTOMÁTICO el
   temporizador repite solo antes de la siguiente secuencia. Si fallaron las dos cámaras, repiten juntas.
3. **Último intento:** la orden lleva `lastAttempt: true` (campo opcional de CAPTURE_COMMAND, protocolo v1). La
   cámara dispara aunque el celular se mueva y no rechaza por nitidez ni exposición: responde CAPTURE_OK con
   `PENDIENTE_REVISION_TECNICA` y conserva los motivos (`acceptOnLastAttempt`). Esa foto se transfiere, se sincroniza
   y la IA de la plataforma la analiza (la plataforma ya analiza `PENDIENTE_REVISION_TECNICA`). `ERROR_CAMARA` sigue
   siendo un fallo (no hay foto).
4. **Agotados los intentos** (error de cámara o sin respuesta también en el último) la cámara se da por terminada: la
   secuencia queda PARCIAL/INCOMPLETA, el aviso desaparece y CAPTURAR vuelve a sacar secuencias nuevas.
5. Se quitan los botones «Repetir CÁMARA X» por cámara y la repetición «en cola» del modo automático: ahora la
   repetición sale sola. En su lugar hay un aviso con la cámara, la secuencia y el intento.

**Alternativas.** Dejar repetir sin límite (el problema de campo). Contar el disparo original como uno de los 2
intentos (una sola repetición: muy poco para una cámara que se movió). Rechazar también el último intento y no
mandar la foto (se perdería el punto: mejor que la IA decida). Seguir sin bloquear (las repeticiones quedaban
atrás y el aviso confundía).

**Consecuencias.** Una cámara desconectada sigue pausando la pasada como antes (para reanudar hacen falta las dos).
Las fotos del último intento llegan a la web como «pendiente de revisión técnica» y la IA las evalúa igual que las
demás. El campo `lastAttempt` es opcional: una cámara 0.6.0 lo ignora (vuelve a rechazar por calidad, pero el
controlador 0.6.1 igual deja de pedir al agotar los intentos). Lo correcto es instalar 0.6.1 en los tres celulares
(RN-17).
