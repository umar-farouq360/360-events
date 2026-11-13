import { uuidv7 } from 'uuidv7';
import { auditEvents } from '../db/schema/audit-events.schema.js';
import type { Transaction } from './transitions.js';

// P2-T03: Metadata allow-list/block-list[cite: 4]
const FORBIDDEN_KEYS = new Set([
  'password', 
  'token', 
  'secret', 
  'authorization', 
  'cookie'
]);

/**
 * Validates metadata to ensure no sensitive fields are accidentally recorded[cite: 4].
 * Rejects the payload entirely if forbidden keys are present.
 */
export function validateMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(metadata)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      throw new Error(`Forbidden metadata key rejected: ${key}`);
    }
  }
  return metadata;
}

export interface AuditPayload {
  actorType: 'user' | 'system' | 'worker';
  actorId: string;
  action: string;
  entity: string;
  outcome: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Writes an immutable audit record securely within the provided database transaction[cite: 4].
 */
export async function recordAudit(
  tx: Transaction,
  payload: AuditPayload
): Promise<void> {
  const metadata = payload.metadata ? validateMetadata(payload.metadata) : {};

  await tx.insert(auditEvents).values({
    id: uuidv7(),
    actorType: payload.actorType,
    actorId: payload.actorId,
    action: payload.action,
    entity: payload.entity,
    outcome: payload.outcome,
    requestId: payload.requestId ?? null,
    metadata,
  });
}