import { createHash } from 'node:crypto';

export function hashPayload(payload: unknown): string {
  const stableStringify = (obj: unknown): string => {
    if (obj === null) return 'null';
    if (typeof obj !== 'object') return JSON.stringify(obj) ?? '';
    if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
    
    const keys = Object.keys(obj).sort();
    const joined = keys.map(k => `"${k}":${stableStringify((obj as Record<string, unknown>)[k])}`).join(',');
    return `{${joined}}`;
  };

  const normalized = stableStringify(payload);
  return createHash('sha256').update(normalized).digest('hex');
}