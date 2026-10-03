// src/ui/toast.ts — Avisos breves en pantalla (toast) con sonido.
//
// QUÉ HACE: showToast(code | texto) publica un aviso que <ToastHost/> muestra animado arriba de la pantalla.
// Los códigos se traducen con messageFor() (un código = un texto, maestro §19).

import { create } from 'zustand';

import { feedback } from './feedback';
import { messageFor } from './messages';

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

interface ToastState {
  id: number;
  text: string | null;
  kind: ToastKind;
}

export const useToast = create<ToastState>(() => ({ id: 0, text: null, kind: 'info' }));

let counter = 0;

/** `codeOrText`: un código de src/ui/messages.ts o un texto ya listo (de src/ui/strings.ts). */
export function showToast(codeOrText: string, kind: ToastKind = 'info', withSound = true): void {
  counter += 1;
  const looksLikeCode = /^[A-Z0-9_]+$/.test(codeOrText);
  const text = looksLikeCode ? messageFor(codeOrText) : codeOrText;
  useToast.setState({ id: counter, text, kind });
  if (withSound) feedback(kind === 'error' ? 'error' : kind === 'success' ? 'success' : 'tap');
}

export function hideToast(): void {
  useToast.setState({ text: null });
}
