import { z } from 'zod';

// Only decimal digit strings and positive safe integers are numeric IDs.
// Do not accept Number()'s conversions of blanks, booleans, hex or exponents.
export const smartNumericId = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
  .pipe(z.number().int().positive().safe());

const recordId = z.object({ id: smartNumericId }).passthrough();
const detailIds = z.object({
  batch: recordId.extend({ templateId: smartNumericId.nullable().optional(), accountId: smartNumericId.nullable().optional() }),
  items: z.array(z.object({
    companyId: smartNumericId.nullable(), candidates: z.array(smartNumericId),
    batchId: smartNumericId.optional(), messageId: smartNumericId.nullable().optional(),
    suggestions: z.array(recordId).optional(),
  }).passthrough()),
}).passthrough();

export class SmartContractError extends Error {}
export function rejectSmartContract(contract: string, issues: { path: (string | number)[]; code: string }[]): never {
  // Never log Zod messages/expected/received, response bodies or field values.
  const fields = new Set(['id', 'batch', 'batchId', 'items', 'companyId', 'candidates', 'suggestions', 'templateId', 'accountId', 'messageId',
    'documentId', 'contentHash', 'persistence', 'storage', 'analysis', 'code', 'message', 'recoverable']);
  const safe = issues.slice(0, 8).map(issue => ({
    field: issue.path.map(p => typeof p === 'number' ? '[]' : fields.has(p) ? p : 'field').join('.') || '$', code: issue.code,
  }));
  console.warn('smart-sends.contract-rejected', { contract, issues: safe });
  throw new SmartContractError(`Contrato ${contract} inválido (${safe.map(i => i.field).join(', ')}).`);
}
export function parseSmartContract<S extends z.ZodTypeAny>(schema: S, value: unknown, contract: string): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) rejectSmartContract(contract, parsed.error.issues);
  return parsed.data;
}

// Validate the same ID shapes without Zod's recursive passthrough copies of every
// item/preview. Invalid payloads still use the schema and sanitized diagnostics.
const invalidIds = Symbol('invalid IDs');
function numericId(value: unknown): number {
  const id = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw invalidIds;
  return id;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Date || value instanceof Map || value instanceof Set) throw invalidIds;
  return value as Record<string, unknown>;
}
function record(value: unknown) {
  const row = object(value); return { ...row, id: numericId(row.id) };
}
function optionalIds(row: Record<string, unknown>, fields: string[]) {
  const result = { ...row };
  for (const field of fields) if (row[field] !== undefined && row[field] !== null) result[field] = numericId(row[field]);
  return result;
}
function detail(value: unknown) {
  const data = object(value);
  if (!Array.isArray(data.items)) throw invalidIds;
  return { ...data, batch: optionalIds(record(data.batch), ['templateId', 'accountId']), items: data.items.map(value => {
    const row = object(value);
    if (!Array.isArray(row.candidates) || (row.batchId === null)) throw invalidIds;
    const item = optionalIds(row, ['batchId', 'messageId']);
    item.companyId = row.companyId === null ? null : numericId(row.companyId);
    item.candidates = row.candidates.map(numericId);
    if (row.suggestions !== undefined) {
      if (!Array.isArray(row.suggestions)) throw invalidIds;
      item.suggestions = row.suggestions.map(record);
    }
    return item;
  }) };
}
export function normalizeSmartApiIds(path: string, value: unknown): unknown {
  const route = path.split('?')[0].replace(/^\//, '');
  if (!route || route === 'templates' || route === 'companies') {
    try { return Array.isArray(value) ? value.map(record) : record(value); }
    catch (error) { if (error !== invalidIds) throw error; }
    return parseSmartContract(Array.isArray(value) ? z.array(recordId) : recordId, value, 'catalog-ids');
  }
  if (/^\d+(?:\/(?:prepare|control))?$/.test(route)) {
    try { return detail(value); }
    catch (error) { if (error !== invalidIds) throw error; }
    return parseSmartContract(detailIds, value, 'batch-detail-ids');
  }
  return value;
}
