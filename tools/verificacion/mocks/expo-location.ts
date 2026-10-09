// tools/verificacion/mocks/expo-location.ts — GPS falso para Node (pestService.watchMyPosition, ADR 0009).
export const Accuracy = { Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 };
export async function getForegroundPermissionsAsync() {
  return { status: 'denied', canAskAgain: false, granted: false };
}
export async function requestForegroundPermissionsAsync() {
  return { status: 'denied', canAskAgain: false, granted: false };
}
export async function watchPositionAsync() {
  return { remove() {} };
}
