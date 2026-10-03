// src/storage/repositories/processedMessagesRepo.ts — Mensajes del protocolo ya procesados (idempotencia).
//
// QUÉ HACE: el receptor guarda cada messageId procesado con la respuesta enviada. Ante un duplicado
// (reenvío con el mismo messageId) NO vuelve a procesar y reenvía la respuesta guardada (maestro §14.3).

import { nowIso } from '../../domain/time';
import { getDb, type Db } from '../db';

export async function getProcessed(messageId: string, db: Db = getDb()): Promise<{ responseJson: string | null } | null> {
  const r = await db.getFirstAsync<{ response_json: string | null }>(
    'SELECT response_json FROM processed_messages WHERE message_id = ?',
    [messageId],
  );
  return r ? { responseJson: r.response_json } : null;
}

export async function saveProcessed(
  messageId: string,
  type: string,
  responseJson: string | null,
  db: Db = getDb(),
): Promise<void> {
  await db.runAsync(
    `INSERT INTO processed_messages (message_id, type, received_at, response_json) VALUES (?, ?, ?, ?)
     ON CONFLICT(message_id) DO UPDATE SET response_json = excluded.response_json`,
    [messageId, type, nowIso(), responseJson],
  );
}

export async function purgeProcessedBefore(iso: string, db: Db = getDb()): Promise<void> {
  await db.runAsync('DELETE FROM processed_messages WHERE received_at < ?', [iso]);
}
