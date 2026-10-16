import { validRecipient } from './smart-send-policy';

export type ReviewRecord = {
  fileReady: boolean; fileDeletedAt: unknown; readable: boolean; duplicateOf?: string | null;
  companyId: number | null; recipient: string | null; reviewStatus: string; confirmedAt: unknown; excluded: boolean;
};
export const reviewLabels = { confirmed: 'Confirmado', pending: 'Pendente', blocked: 'Bloqueado', excluded: 'Excluído' } as const;
export type ReviewState = keyof typeof reviewLabels;
export function reviewState(item: ReviewRecord): ReviewState {
  if (item.excluded) return 'excluded';
  if (!item.fileReady || item.fileDeletedAt || !item.readable || item.duplicateOf || ['DUPLICATE', 'READ_ERROR', 'UPLOADING', 'NO_EMAIL', 'INVALID_EMAIL'].includes(item.reviewStatus)
    || (item.companyId && !validRecipient(item.recipient))) return 'blocked';
  if (item.companyId && item.reviewStatus === 'READY' && item.confirmedAt && validRecipient(item.recipient)) return 'confirmed';
  return 'pending';
}
export function reviewOverview(items: ReviewRecord[]) {
  const counts = { total: items.length, confirmed: 0, pending: 0, blocked: 0, excluded: 0 };
  for (const item of items) counts[reviewState(item)]++;
  return counts;
}
export type ReviewInput = { companyId?: number; confirm?: boolean; excluded?: boolean; remove?: boolean; expectedRevision?: number; expectedRecipient?: string };

// Internal database IDs only. Never derive an ID from a CNPJ or a label.
export function reviewCompanyId(value: unknown): number {
  const id = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw new Error('Identificador de empresa inválido. Pesquise e selecione novamente.');
  return id;
}
