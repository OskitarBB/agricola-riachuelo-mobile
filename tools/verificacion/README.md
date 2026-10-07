# Verificación de la Fase 4 (pruebas de contrato en Node)

Estas pruebas ejecutan en **Node** el código real de la app (`src/`: migraciones SQLite, repositorios, autenticación,
catálogos y el motor de sincronización). Los módulos nativos de Expo se reemplazan por los de `mocks/`
(SQLite de Node, disco local y `fetch`). No son parte del APK ni de `npm test`.

| Script | Qué prueba | Necesita |
|---|---|---|
| `integracion.ts` | La app contra la **plataforma Django real**: registro, login (cuenta pendiente, bloqueada, rol solo web), renovación de tokens simultánea, catálogos, una sesión completa (2 pasadas, repetición, incidencias), sincronización, idempotencia, foto tardía, firma inválida, padre faltante, error 409, servidor caído, modo multipart, cambio de contraseña y celular revocado (CP-26 a CP-29, CP-33, CP-35, CP-39, CP-42, CP-44). | La plataforma corriendo |
| `simulado.ts` | El mismo motor con el **backend simulado** de la app y fallos inyectados (ticket vencido, firma rechazada, Cloudinary caído, foto demasiado grande, 5xx al azar, sincronización automática solo con Wi-Fi, dos rondas a la vez, «Detener»). | Nada |
| `piloto.ts` | Prueba corta contra el **piloto real** (Django + Cloudinary reales) con una cuenta de operador aprobada: una sesión de prueba marcada «PRUEBA TÉCNICA» con 3 fotos sintéticas. CP-38 (subida directa con el ticket, `authenticated`, sin archivos a Django ni cabeceras de la API a Cloudinary), CP-41 (foto que ya estaba en Cloudinary → `existing: true`) y reenvío sin duplicados. | Internet y una cuenta de operador aprobada |
| `redlocal.ts` | La **red local real** del APK (servidor de control TCP + WebSocket, receptor HTTP de fotos y los clientes de la cámara) sobre el TCP de Node: conexión, mensajes en ambos sentidos, mensajes grandes, desconexión, foto de 2 MB con md5, metadatos inválidos y reinicio del servidor. | Nada |
| `actualizacion.ts` | Un celular con la v0.2/v0.3 (migración 001 con datos) abre la v0.4.0: migraciones 002–004, datos conservados, integridad. | Nada |

## Requisitos
- **Node 22.13 o superior** (usa `node:sqlite`; con Node 22.5–22.12 define antes `$env:NODE_OPTIONS="--experimental-sqlite"`) y
  `npm install` hecho en la carpeta de la app.
- Para `integracion.ts`: la plataforma en la laptop con los datos de demostración
  (`python manage.py sembrar_demo`, cuentas `@demo.pe` / `Demo2026`) y `python manage.py runserver 0.0.0.0:8000`.

## Cómo correr (desde la carpeta de la app)

```bash
npx tsx --tsconfig tools/verificacion/tsconfig.json tools/verificacion/simulado.ts
npx tsx --tsconfig tools/verificacion/tsconfig.json tools/verificacion/actualizacion.ts

# Plataforma en la laptop (por defecto http://127.0.0.1:8000):
npx tsx --tsconfig tools/verificacion/tsconfig.json tools/verificacion/integracion.ts
```

Prueba contra el piloto (PowerShell; crea una sesión de prueba pequeña, por eso pide `PERMITIR_PILOTO=1`):

```powershell
$env:PERMITIR_PILOTO="1"
$env:RIACHUELO_OPERADOR="correo-del-operador"
$env:RIACHUELO_CLAVE="su-contraseña"
# Solo si la cuenta tiene contraseña temporal: $env:RIACHUELO_CLAVE_NUEVA="contraseña-nueva"
npx tsx --tsconfig tools/verificacion/tsconfig.json tools/verificacion/piloto.ts
```

En Windows (PowerShell), las variables se fijan antes del comando, por ejemplo
`$env:PLATAFORMA_DB="C:\ruta\agricola-riachuelo-platform\db.sqlite3"`.

| Variable | Uso | Por defecto |
|---|---|---|
| `RIACHUELO_API` | URL de la plataforma (sin `/api/v1`) | `http://127.0.0.1:8000` (`piloto.ts`: el piloto) |
| `RIACHUELO_OPERADOR` / `RIACHUELO_CLAVE` | Cuenta de operador aprobada (nunca se imprime ni se guarda) | `operador@demo.pe` / `Demo2026` (`piloto.ts`: obligatorias) |
| `RIACHUELO_CLAVE_NUEVA` | Solo `piloto.ts`: si la cuenta tiene contraseña temporal, la cambia por esta antes de seguir | — |
| `PLATAFORMA_DB` | Archivo SQLite de la plataforma en la laptop: comprueba lo que quedó guardado en el servidor y permite probar la revocación del celular (CP-33). Sin ella esas comprobaciones se omiten. | — |
| `PERMITIR_PILOTO` | `1` permite correr `piloto.ts` (y, solo con permiso del responsable, `integracion.ts`) contra el piloto | — |

> **No correr `integracion.ts` contra el piloto** (`https://monitoreo.agricolariachuelo.org`) sin permiso: crea
> sesiones, fotos en Cloudinary y una cuenta pendiente de prueba. Por eso se niega a correr salvo con
> `PERMITIR_PILOTO=1`.

## Nota
La plataforma limita los registros a 20 por hora y los ingresos a 10 por minuto por IP. Si se corre la integración
muchas veces seguidas, el primer paso puede responder `TOO_MANY_ATTEMPTS` (la app lo muestra bien): esperar o limpiar
la caché de la plataforma.
