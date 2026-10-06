// eslint.config.js — Configuración de ESLint (flat config) basada en eslint-config-expo.
// Se ejecuta con `npm run lint`. Las reglas adicionales refuerzan las reglas R-02/R-05 del maestro.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // tools/verificacion: pruebas de contrato que corren en Node (npx tsx), fuera del bundle de la app.
    ignores: ['dist/*', 'node_modules/*', '.expo/*', 'tools/**'],
  },
]);
