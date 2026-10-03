# Riachuelo Monitoreo — guía para agentes y desarrolladores

**Antes de cambiar código lee:** `docs/referencia/MAESTRO_APP_MOVIL_v1.0.pdf` (reglas R-01..R-20, RN, protocolo,
anexos), `docs/referencia/CONTEXTO_ERRORES_Y_CONFIGURACION.txt` (cambios CFG-2 y errores ya resueltos) y `docs/adr/`.

Reglas del proyecto (resumen):
- SDK 57. Instalar módulos con `npx expo install` (en entornos sin acceso a api.expo.dev: `EXPO_OFFLINE=1`).
- Todo plugin de `app.json` debe estar instalado. Nada nativo fuera de Expo Go se carga sin `require()` diferido
  e `isRunningInExpoGo()` (ver `src/local-network/factory.ts`).
- Solo modos MANUAL y AUTOMÁTICO. Cambio de marcador manual; en AUTOMÁTICO solo en pausa.
- Textos de UI solo en `src/ui/strings.ts` / `src/ui/messages.ts`. Funciones no implementadas muestran "Pendiente".
- Parámetros solo en `src/config/defaults.ts` (CFG-2) y coherentes con `checkConfigCoherence()`.
- Cada archivo empieza con un comentario "QUÉ HACE" (+ "INTEGRACIÓN FUTURA" si cambia con la web/BD).
- Antes de terminar: `npm run validate` (typecheck + lint + jest).

---

This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `app/` (project root) — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) in `src/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
