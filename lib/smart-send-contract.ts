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
export function normalizeSmartApiIds(path: string, value: unknown): unknown {
  const route = path.split('?')[0].replace(/^\//, '');
  if (!route || route === 'templates' || route === 'companies') {
    return parseSmartContract(Array.isArray(value) ? z.array(recordId) : recordId, value, 'catalog-ids');
  }
  if (/^\d+(?:\/(?:prepare|control))?$/.test(route)) return parseSmartContract(detailIds, value, 'batch-detail-ids');
  return value;
}
