// src/device/deviceIdentity.ts — Identidad del celular (RF-11).
//
// QUÉ HACE: genera UNA sola vez por instalación un deviceId (UUID) y lo guarda en SecureStore
// (device.id) y en app_meta.device_id. Reúne plataforma, modelo, sistema y versión de la app,
// datos que viajan en el login (DeviceInfoDto) y en el protocolo (PAIR_REQUEST).

import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { Platform as RNPlatform } from 'react-native';

import { APP_VERSION } from '../config';
import type { DeviceIdentity, Platform } from '../domain/types';
import { getMeta, setMeta } from '../storage/repositories/appMetaRepo';
import { SECURE_KEYS, secureGet, secureSet } from '../storage/secureStore';

let cached: DeviceIdentity | null = null;

export async function loadDeviceIdentity(): Promise<DeviceIdentity> {
  if (cached) return cached;
  let deviceId = await secureGet(SECURE_KEYS.deviceId);
  if (!deviceId) deviceId = await getMeta('device_id');
  if (!deviceId) deviceId = Crypto.randomUUID().toLowerCase();
  await secureSet(SECURE_KEYS.deviceId, deviceId);
  await setMeta('device_id', deviceId);
  cached = {
    deviceId,
    platform: (RNPlatform.OS === 'ios' ? 'ios' : 'android') as Platform,
    model: Device.modelName ?? Device.brand ?? 'Desconocido',
    osVersion: Device.osVersion ?? String(RNPlatform.Version),
    // Se usa la versión de app.json: en Expo Go, nativeApplicationVersion sería la de Expo Go.
    appVersion: APP_VERSION,
    buildNumber: Application.nativeBuildVersion ?? '0',
  };
  return cached;
}

/** Identidad ya cargada (después del arranque). */
export function getDeviceIdentity(): DeviceIdentity {
  if (!cached) throw new Error('Identidad del equipo no cargada');
  return cached;
}

export function deviceInfoDto(id: DeviceIdentity) {
  return { deviceId: id.deviceId, platform: id.platform, model: id.model, osVersion: id.osVersion, appVersion: id.appVersion };
}
