// tools/verificacion/mocks/react-native.ts — lo mínimo de react-native que usan los servicios fuera de la UI.
export const Platform = { OS: 'android', Version: 34, select: (o: Record<string, unknown>) => o.android ?? o.default };
export const AppState = { currentState: 'active', addEventListener: () => ({ remove() {} }) };
export const NativeModules = {};
export const StyleSheet = { create: <T>(s: T) => s, absoluteFill: {} };
