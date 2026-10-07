// src/ui/hooks/useCapturePictureSize.ts — Resolución de captura de <CameraView> (capture.maxMegapixels, Q-15).
//
// QUÉ HACE: la primera vez que la cámara avisa que está lista, pide los tamaños disponibles y fija `pictureSize` en la
// mayor resolución ≤ capture.maxMegapixels (src/domain/pictureSize.ts). Mientras la cámara aplica el tamaño nuevo no
// se dan órdenes de captura (cameraService queda «no lista» un momento). Si no se puede decidir, se usa la del sistema.
// Lo usan PANT-31 (cámara en sesión) y PANT-32 (modo prueba).

import type { CameraView } from 'expo-camera';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { CONFIG } from '../../config';
import { setCameraReady } from '../../device/cameraService';
import { logError, logEvent } from '../../diagnostics/eventLog';
import { choosePictureSize } from '../../domain/pictureSize';

/** Espera para que la cámara aplique el tamaño nuevo antes de aceptar órdenes. */
const APPLY_SIZE_MS = 700;

export function useCapturePictureSize(camRef: RefObject<CameraView | null>): {
  pictureSize: string | undefined;
  onCameraReady: () => void;
} {
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);
  const decided = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onCameraReady = useCallback(() => {
    if (decided.current) {
      setCameraReady(true);
      return;
    }
    decided.current = true;
    const cam = camRef.current;
    if (!cam) {
      setCameraReady(true);
      return;
    }
    cam
      .getAvailablePictureSizesAsync()
      .then((sizes) => {
        const chosen = choosePictureSize(sizes, CONFIG.capture.maxMegapixels);
        logEvent('INFO', 'CAPTURE', 'PICTURE_SIZE', {
          chosen,
          maxMegapixels: CONFIG.capture.maxMegapixels,
          available: sizes.slice(0, 40),
        });
        if (!chosen) {
          setCameraReady(true);
          return;
        }
        setPictureSize(chosen);
        timer.current = setTimeout(() => setCameraReady(true), APPLY_SIZE_MS);
      })
      .catch((err: unknown) => {
        logError('camera.pictureSize', err);
        setCameraReady(true);
      });
  }, [camRef]);

  return { pictureSize, onCameraReady };
}
