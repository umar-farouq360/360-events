import { uuidv7 } from 'uuidv7';
import { auditEvents } from '../db/schema/audit-events.schema.js';
import type { Transaction } from './transitions.js';

/**
 * Only actions represented by the current application contract are accepted.
 * Add an action here together with its metadata shape and validation before
 * recording that action from an application workflow.
 */
export interface AuditMetadataByAction {
  approve_event: {
    reason?: string;
  };
  payout: Record<string, never>;
}

export type AuditAction = keyof AuditMetadataByAction;

interface AuditPayloadBase {
  actorType: 'user' | 'system' | 'worker';
  actorId: string;
  entity: string;
  outcome: string;
  requestId?: string;
}

export type AuditPayload = {
  [Action in AuditAction]: AuditPayloadBase & {
    action: Action;
    metadata?: AuditMetadataByAction[Action];
  };
}[AuditAction];

const FORBIDDEN_KEY_PATTERN =
  /(?:^|_)(?:password|token|secret|authorization|auth|cookie|credential|api_key|access_key|private_key|session)(?:$|_)/;

const MAX_METADATA_DEPTH = 8;
const MAX_REASON_LENGTH = 500;

function normalizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[-\s]/g, '_');
}

function assertSafeJsonValue(value: unknown, path: string, depth: number): void {
  if (depth > MAX_METADATA_DEPTH) {
    throw new Error(`Audit metadata exceeds maximum nesting depth at ${path}`);
  }

  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Audit metadata contains a non-finite number at ${path}`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertSafeJsonValue(item, `${path}[${index}]`, depth + 1);
    });
    return;
  }

  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`Audit metadata contains a non-plain object at ${path}`);
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      if (FORBIDDEN_KEY_PATTERN.test(normalizeKey(key))) {
        throw new Error(`Forbidden metadata key rejected: ${key}`);
      }
      assertSafeJsonValue(nestedValue, `${path}.${key}`, depth + 1);
    }
    return;
  }

  throw new Error(`Audit metadata contains an unsupported value at ${path}`);
}

function assertMetadataObject(metadata: unknown): asserts metadata is Record<string, unknown> {
  if (
    typeof metadata !== 'object'
    || metadata === null
    || Array.isArray(metadata)
    || (Object.getPrototypeOf(metadata) !== Object.prototype
      && Object.getPrototypeOf(metadata) !== null)
  ) {
    throw new Error('Audit metadata must be a plain object');
  }
}

/**
 * Validates JSON safety and the action-specific metadata contract.
 * Unknown actions and fields fail closed.
 */
function assertNever(value: never): never {
  throw new Error(`Unsupported audit action: ${String(value)}`);
}

export function validateMetadata(
  action: AuditAction,
  metadata: unknown
): AuditMetadataByAction[AuditAction] {
  assertMetadataObject(metadata);
  assertSafeJsonValue(metadata, 'metadata', 0);

  switch (action) {
    case 'approve_event': {
      const allowedKeys = new Set(['reason']);
      for (const key of Object.keys(metadata)) {
        if (!allowedKeys.has(key)) {
          throw new Error(`Unknown metadata key for approve_event: ${key}`);
        }
      }

      const { reason } = metadata;
      if (reason !== undefined && (
        typeof reason !== 'string'
        || reason.trim().length === 0
        || reason.length > MAX_REASON_LENGTH
      )) {
        throw new Error('approve_event metadata.reason must be a non-empty string of at most 500 characters');
      }

      return metadata as AuditMetadataByAction[AuditAction];
    }

    case 'payout':
      if (Object.keys(metadata).length > 0) {
        throw new Error('payout does not accept metadata fields');
      }
      return metadata as AuditMetadataByAction[AuditAction];

    default: {
      return assertNever(action);
    }
  }
}

/**
 * Writes an immutable audit record within the caller's database transaction.
 */
export async function recordAudit(
  tx: Transaction,
  payload: AuditPayload
): Promise<void> {
  const metadata = validateMetadata(payload.action, payload.metadata ?? {});

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
