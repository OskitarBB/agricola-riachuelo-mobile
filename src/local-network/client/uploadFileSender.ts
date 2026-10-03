// src/local-network/client/uploadFileSender.ts — Envío de una foto de la CÁMARA al controlador (opción A, §14.8).
//
// QUÉ HACE: File.upload() de expo-file-system envía el archivo de forma NATIVA (no pasa por la memoria
// de JavaScript) como cuerpo binario a http://<host>:<filePort>/local/captures, con cabeceras:
//   Content-Type: image/jpeg · X-Capture-Meta: <LocalCaptureMeta JSON en base64url> · X-Device-Id
// Si se supera transfer.requestTimeoutMs se cancela (AbortController) y se considera error de red
// (la cola reintenta con el MISMO captureId: idempotente).

import { File, UploadType } from 'expo-file-system';

import type { LocalCaptureMeta, LocalCaptureResponse } from '../../protocol/messages';
import { encodeTextToBase64Url } from '../httpUpload';
import type { FileSender } from '../transport';

export class TransferNetworkError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'TransferNetworkError';
  }
}

export class UploadFileSender implements FileSender {
  async send(baseUrl: string, meta: LocalCaptureMeta, fileUri: string, timeoutMs: number): Promise<LocalCaptureResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await new File(fileUri).upload(`${baseUrl}/local/captures`, {
        httpMethod: 'POST',
        uploadType: UploadType.BINARY_CONTENT,
        headers: {
          'Content-Type': 'image/jpeg',
          'X-Capture-Meta': encodeTextToBase64Url(JSON.stringify(meta)),
          'X-Device-Id': meta.deviceId,
        },
        signal: controller.signal,
      });
      try {
        const body = JSON.parse(res.body) as LocalCaptureResponse;
        if (body && typeof body.result === 'string') return body;
      } catch {
        // cuerpo no JSON
      }
      if (res.status >= 500) return { result: 'REJECTED', reason: 'INTERNAL' };
      return { result: 'REJECTED', reason: null };
    } catch (err) {
      throw new TransferNetworkError(err instanceof Error ? err.message : 'network');
    } finally {
      clearTimeout(timer);
    }
  }
}
