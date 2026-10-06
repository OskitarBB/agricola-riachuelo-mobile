# Verificación de la Fase 4 (pruebas de contrato en Node)

Estas pruebas ejecutan en **Node** el código real de la app (`src/`: migraciones SQLite, repositorios, autenticación,
catálogos y el motor de sincronización). Los módulos nativos de Expo se reemplazan por los de `mocks/`
(SQLite de Node, disco local y `fetch`). No son parte del APK ni de `npm test`.

| Script | Qué prueba | Necesita |
|---|---|---|
| `integracion.ts` | La app contra la **plataforma Django real**: registro, login (cuenta pendiente, bloqueada, rol solo web), renovación de tokens simultánea, catálogos, una sesión completa (2 pasadas, repetición, incidencias), sincronización, idempotencia, foto tardía, firma inválida, padre faltante, error 409, servidor caído, modo multipart, cambio de contraseña y celular revocado (CP-26 a CP-29, CP-33, CP-35, CP-39, CP-42, CP-44). | La plataforma corriendo |
| `simulado.ts` | El mismo motor con el **backend simulado** de la app y fallos inyectados (ticket vencido, firma rechazada, Cloudinary caído, foto demasiado grande, 5xx al azar, sincronización automática solo con Wi-Fi, dos rondas a la vez, «Detener»). | Nada |
| `actualizacion.ts` | Un celular con la v0.2/v0.3 (migración 001 con datos) abre la v0.4.0: migraciones 002–004, datos conservados, integridad. | Nada |

## Requisitos
- **Node 22.5 o superior** (usa `node:sqlite`) y `npm install` hecho en la carpeta de la app.
- Para `integracion.ts`: la plataforma en la laptop con los datos de demostración
  (`python manage.py sembrar_demo`, cuentas `@demo.pe` / `Demo2026`) y `python manage.py runserver 0.0.0.0:8000`.

## Cómo correr (desde la carpeta de la app)

```bash
npx tsx --tsconfig tools/verificacion/tsconfig.json tools/verificacion/simulado.ts
npx tsx --tsconfig tools/verificacion/tsconfig.json tools/verificacion/actualizacion.ts

# Plataforma en la laptop (por defecto http://127.0.0.1:8000):
npx tsx --tsconfig tools/verificacion/tsconfig.json tools/verificacion/integracion.ts
```

En Windows (PowerShell), las variables se fijan antes del comando, por ejemplo
`$env:PLATAFORMA_DB="C:\ruta\agricola-riachuelo-platform\db.sqlite3"`.

| Variable | Uso | Por defecto |
|---|---|---|
| `RIACHUELO_API` | URL de la plataforma (sin `/api/v1`) | `http://127.0.0.1:8000` |
| `RIACHUELO_OPERADOR` / `RIACHUELO_CLAVE` | Cuenta de operador aprobada | `operador@demo.pe` / `Demo2026` |
| `PLATAFORMA_DB` | Archivo SQLite de la plataforma en la laptop: comprueba lo que quedó guardado en el servidor y permite probar la revocación del celular (CP-33). Sin ella esas comprobaciones se omiten. | — |
| `PERMITIR_PILOTO` | `1` permite correr `integracion.ts` contra el piloto | — |

> **No correr `integracion.ts` contra el piloto** (`https://monitoreo.agricolariachuelo.org`) sin permiso: crea
> sesiones, fotos en Cloudinary y una cuenta pendiente de prueba. Por eso se niega a correr salvo con
> `PERMITIR_PILOTO=1`.

## Nota
La plataforma limita los registros a 20 por hora y los ingresos a 10 por minuto por IP. Si se corre la integración
muchas veces seguidas, el primer paso puede responder `TOO_MANY_ATTEMPTS` (la app lo muestra bien): esperar o limpiar
la caché de la plataforma.
