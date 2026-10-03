// src/local-network/factory.ts — Elige la red local REAL o el SIMULADOR (maestro §6.3, regla R-04).
//
// QUÉ HACE:
//  - En Expo Go (isRunningInExpoGo() = true): servidor y receptor del controlador = SIMULADOR con dos
//    cámaras virtuales. NUNCA se carga react-native-tcp-socket (no existe en Expo Go).
//  - En Development Build / APK: servidor TCP + WebSocket propio y receptor HTTP reales. El módulo nativo
//    se carga con require() DIFERIDO dentro de la función, así Metro no lo ejecuta en Expo Go.
//  - El cliente de la cámara (WebSocket) y el envío de fotos (File.upload) son APIs incluidas en Expo Go:
//    se usan reales en ambos casos (una cámara en Expo Go puede vincularse con un controlador APK).

import { isRunningInExpoGo } from 'expo';

import { CONFIG } from '../config';
import { localIp } from '../device/networkMonitor';
import { UploadFileSender } from './client/uploadFileSender';
import { WsControlClient } from './client/wsControlClient';
import { SimulatedControlServer, SimulatedFileReceiver, simulatedHub } from './simulator/simulatedNetwork';
import type { ControlServer, FileReceiver, LocalNetworkFactory } from './transport';

let selfDeviceId: () => string = () => '';

/** El arranque informa el deviceId propio (para los ERROR que emite el servidor real). */
export function setFactoryDeviceId(provider: () => string): void {
  selfDeviceId = provider;
}

function loadTcp() {
  // require diferido: solo se ejecuta fuera de Expo Go (Development Build / APK).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('react-native-tcp-socket') as { default: typeof import('react-native-tcp-socket').default };
  return mod.default;
}

const simulatorFactory: LocalNetworkFactory = {
  kind: 'SIMULADOR',
  createControlServer: (): ControlServer => new SimulatedControlServer(localIp),
  createFileReceiver: (): FileReceiver => new SimulatedFileReceiver(),
  createControlClient: () => new WsControlClient(),
  createFileSender: () => new UploadFileSender(),
  getLocalIp: localIp,
  simulator: simulatedHub,
};

const realFactory: LocalNetworkFactory = {
  kind: 'RED_REAL',
  createControlServer: (): ControlServer => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TcpControlServer } = require('./tcp/tcpControlServer') as typeof import('./tcp/tcpControlServer');
    return new TcpControlServer(loadTcp(), localIp, CONFIG.protocol.maxMessageBytes, selfDeviceId);
  },
  createFileReceiver: (): FileReceiver => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TcpFileReceiver } = require('./tcp/tcpFileReceiver') as typeof import('./tcp/tcpFileReceiver');
    return new TcpFileReceiver(loadTcp());
  },
  createControlClient: () => new WsControlClient(),
  createFileSender: () => new UploadFileSender(),
  getLocalIp: localIp,
  simulator: null,
};

/** Fábrica activa según el entorno. */
export function getNetworkFactory(): LocalNetworkFactory {
  return isRunningInExpoGo() ? simulatorFactory : realFactory;
}
