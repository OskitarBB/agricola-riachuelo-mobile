// tools/verificacion/mocks/expo-network.ts — estado de red controlable desde las pruebas (__state).
export enum NetworkStateType { NONE = 'NONE', UNKNOWN = 'UNKNOWN', CELLULAR = 'CELLULAR', WIFI = 'WIFI', ETHERNET = 'ETHERNET', OTHER = 'OTHER' }
export const __state = { type: NetworkStateType.WIFI, isConnected: true, isInternetReachable: true };
export async function getNetworkStateAsync() { return { ...__state }; }
export async function getIpAddressAsync() { return '192.168.1.10'; }
export function addNetworkStateListener(_cb: unknown) { return { remove() {} }; }
