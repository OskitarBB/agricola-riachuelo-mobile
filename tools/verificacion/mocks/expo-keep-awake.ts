// tools/verificacion/mocks/expo-keep-awake.ts — registra las etiquetas activas (solo pruebas de verificación).
export const __active = new Set<string>();
export async function activateKeepAwakeAsync(tag = 'default') { __active.add(tag); }
export async function deactivateKeepAwake(tag = 'default') { __active.delete(tag); }
export function useKeepAwake() {}
