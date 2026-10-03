// src/auth/validation.ts — Validaciones de formularios (la API vuelve a validar). Maestro Anexo C.2.
//
// QUÉ HACE: valida login, registro, recuperación y cambio de contraseña ANTES de llamar a la API, y
// devuelve un error por campo para mostrarlo debajo de cada caja de texto.

export interface FieldError {
  field: string;
  message: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export function validatePassword(password: string, minLength: number): string | null {
  if (password.length < minLength) return `Debe tener al menos ${minLength} caracteres.`;
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(password) || !/\d/.test(password)) return 'Debe incluir letras y números.';
  if (password.trim() !== password) return 'No debe empezar ni terminar con espacios.';
  return null;
}

export function validateRegistration(
  input: { fullName: string; email: string; phone: string; password: string; confirm: string; accepted: boolean },
  minLength: number,
): FieldError[] {
  const errors: FieldError[] = [];
  if (input.fullName.trim().length < 5) errors.push({ field: 'fullName', message: 'Escribe tu nombre completo.' });
  if (!EMAIL_RE.test(input.email.trim())) errors.push({ field: 'email', message: 'Escribe un correo válido.' });
  if (input.phone.trim() !== '' && !/^\+?\d{9,15}$/.test(input.phone.replace(/\s/g, ''))) {
    errors.push({ field: 'phone', message: 'Escribe un celular válido (9 a 15 dígitos).' });
  }
  const pw = validatePassword(input.password, minLength);
  if (pw) errors.push({ field: 'password', message: pw });
  if (input.password !== input.confirm) errors.push({ field: 'confirm', message: 'Las contraseñas no coinciden.' });
  if (!input.accepted) errors.push({ field: 'accepted', message: 'Debes aceptar el aviso de privacidad.' });
  return errors;
}

export function validateLogin(input: { email: string; password: string }): FieldError[] {
  const errors: FieldError[] = [];
  if (!EMAIL_RE.test(input.email.trim())) errors.push({ field: 'email', message: 'Escribe un correo válido.' });
  if (input.password.length === 0) errors.push({ field: 'password', message: 'Escribe tu contraseña.' });
  return errors;
}

export function validateChangePassword(
  input: { current: string; next: string; confirm: string },
  minLength: number,
): FieldError[] {
  const errors: FieldError[] = [];
  if (input.current.length === 0) errors.push({ field: 'current', message: 'Escribe tu contraseña actual.' });
  const pw = validatePassword(input.next, minLength);
  if (pw) errors.push({ field: 'next', message: pw });
  else if (input.next === input.current) errors.push({ field: 'next', message: 'Debe ser distinta de la actual.' });
  if (input.next !== input.confirm) errors.push({ field: 'confirm', message: 'Las contraseñas no coinciden.' });
  return errors;
}

/** Convierte la lista de errores en un mapa campo → mensaje (para las pantallas). */
export function errorsByField(errors: FieldError[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of errors) if (!(e.field in out)) out[e.field] = e.message;
  return out;
}
