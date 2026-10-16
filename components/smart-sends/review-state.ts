import { normalizeName } from '@/lib/pdf-company-matcher';
import { validRecipient } from '@/lib/smart-send-policy';
import { reviewState, type ReviewState } from '@/lib/smart-review-policy';
import type { IdentificationDocument } from './identification-state';

export type ReviewCompany = { id: number | string; name: string; tradeName?: string | null; cnpj?: string | null; primaryEmail: string | null; primaryEmailStatus?: string };
export type ReviewDocument = Omit<IdentificationDocument, 'suggestions'> & { fileSize: number; duplicateOf?: string | null; suggestions?: ReviewCompany[] };
export type ReviewFilter = 'all' | ReviewState | 'no-email' | 'invalid-email' | 'duplicate';
export function filterReview(items: ReviewDocument[], documentQuery: string, companyQuery: string, filter: ReviewFilter) {
  const filename = normalizeName(documentQuery), company = normalizeName(companyQuery), digits = companyQuery.replace(/\D/g, '');
  return items.filter(item => {
    if (filename && !normalizeName(item.fileName).includes(filename)) return false;
    if (company && !normalizeName(`${item.companyName || ''} ${item.companyCnpj || ''} ${(item.suggestions || []).map(c => `${c.name} ${c.tradeName || ''} ${c.cnpj || ''}`).join(' ')}`).includes(company)
      && !(digits.length >= 2 && [item.companyCnpj, ...(item.suggestions || []).map(c => c.cnpj)].some(cnpj => cnpj?.replace(/\D/g, '').includes(digits)))) return false;
    if (filter === 'all') return true;
    if (filter === 'duplicate') return !!item.duplicateOf || item.reviewStatus === 'DUPLICATE';
    if (filter === 'no-email') return !item.recipient?.trim();
    if (filter === 'invalid-email') return item.reviewStatus === 'INVALID_EMAIL' || (!!item.recipient && !validRecipient(item.recipient));
    return reviewState(item) === filter;
  });
}
export function canAssociate(item: ReviewDocument) {
  return item.fileReady && !item.fileDeletedAt && item.readable && !item.duplicateOf && !['DUPLICATE', 'UPLOADING', 'READ_ERROR'].includes(item.reviewStatus);
}
export function canConfirm(item: ReviewDocument) {
  return canAssociate(item) && !item.excluded && !!item.companyId && validRecipient(item.recipient) && item.reviewStatus === 'IDENTIFIED';
}
