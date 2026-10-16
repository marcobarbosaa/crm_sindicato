import { validCnpj } from '@/lib/pdf-company-matcher';
import { validRecipient } from '@/lib/smart-send-policy';

export type IdentificationDocument = {
  id: string; fileName: string; fileReady: boolean; fileDeletedAt: string | null; readable: boolean;
  companyId: number | null; companyName: string | null; companyCnpj: string | null; recipient: string | null;
  extractedCnpjs: string[]; candidates: number[];
  suggestions?: { id: number | string; name: string; cnpj?: string | null; primaryEmail: string | null }[];
  identificationMethod: string; reviewStatus: string; confirmedAt: string | null; excluded: boolean; error: string | null;
};
export const identificationGroups = {
  unique: 'Identificação única', review: 'Revisão necessária', unidentified: 'Não identificado', problem: 'Documento com problema',
} as const;
export type IdentificationGroup = keyof typeof identificationGroups;
export const readingErrors: Record<string, string> = {
  IMPORT_STORAGE_FAILED: 'Armazenamento não confirmado. Recupere a importação.',
  IMPORT_ANALYSIS_FAILED: 'Análise interrompida. Recupere a importação.',
  PDF_PASSWORD: 'PDF protegido por senha. Importe uma cópia desbloqueada.',
  PDF_CORRUPT: 'PDF corrompido ou incompatível.',
  PDF_SIGNATURE_INVALID: 'Arquivo sem assinatura PDF válida.',
  PDF_NO_TEXT: 'Texto insuficiente para identificar a empresa. Visualize o PDF antes de associar manualmente.',
  PDF_PAGE_LIMIT: 'PDF excede o limite de páginas.', PDF_TEXT_LIMIT: 'PDF excede o limite de texto analisável.',
};

// Presentation only: never turn these categories into persisted review statuses.
export function classifyIdentification(item: IdentificationDocument): { group: IdentificationGroup; reason: string } {
  if (item.reviewStatus === 'DUPLICATE') return { group: 'problem', reason: 'Documento duplicado; envio bloqueado.' };
  if (item.reviewStatus === 'UPLOADING') return { group: 'problem', reason: 'Importação ainda não concluída.' };
  if (!item.fileReady || item.fileDeletedAt) return { group: 'problem', reason: 'PDF indisponível. Consulte a importação.' };
  if (!item.readable || item.reviewStatus === 'READ_ERROR' || (item.error && readingErrors[item.error])) {
    return { group: 'problem', reason: readingErrors[item.error || ''] || 'Não foi possível analisar o documento adequadamente.' };
  }
  const cnpjs = [...new Set(item.extractedCnpjs)];
  if (cnpjs.length > 1) return { group: 'review', reason: 'Múltiplos CNPJs encontrados. A escolha da empresa exige revisão manual, mesmo quando apenas uma está cadastrada.' };
  if (item.identificationMethod === 'CNPJ' && cnpjs.length === 1 && validCnpj(cnpjs[0]) && item.companyId && item.candidates.length === 1) {
    return { group: 'unique', reason: 'Um CNPJ válido corresponde a uma única empresa cadastrada. O reconhecimento não substitui a confirmação explícita do destinatário.' };
  }
  if (item.companyId || item.candidates.length) return { group: 'review', reason: item.identificationMethod === 'MANUAL'
    ? 'Empresa associada manualmente. Confira o documento e o destinatário.'
    : item.identificationMethod === 'FILENAME' ? 'Sem CNPJ válido no texto. A semelhança do nome do arquivo é apenas uma sugestão.'
      : 'A correspondência encontrada é ambígua. Revise as empresas candidatas.' };
  return { group: 'unidentified', reason: cnpjs.length ? 'CNPJ encontrado sem correspondência confiável no cadastro.' : 'Nenhum CNPJ válido ou empresa correspondente foi identificado.' };
}

export function approvalState(item: IdentificationDocument) {
  if (item.excluded || !item.fileReady || item.fileDeletedAt || !item.readable || ['DUPLICATE', 'READ_ERROR', 'UPLOADING'].includes(item.reviewStatus)) return 'Bloqueado';
  if (!item.companyId || !validRecipient(item.recipient) || ['NO_EMAIL', 'INVALID_EMAIL', 'COMPANY_NOT_FOUND', 'REVIEW_REQUIRED'].includes(item.reviewStatus)) return 'Requer correção';
  if (item.reviewStatus === 'READY' && item.confirmedAt) return 'Confirmado';
  return 'Aguardando confirmação';
}

export function identificationOverview(items: IdentificationDocument[]) {
  const groups: Record<IdentificationGroup, IdentificationDocument[]> = { unique: [], review: [], unidentified: [], problem: [] };
  const companies = new Set<number>();
  let withoutRecipient = 0;
  for (const item of items) {
    groups[classifyIdentification(item).group].push(item);
    if (item.companyId) companies.add(item.companyId);
    if (!validRecipient(item.recipient) || ['NO_EMAIL', 'INVALID_EMAIL'].includes(item.reviewStatus)) withoutRecipient++;
  }
  return { groups, documents: items.length, companies: companies.size, withoutRecipient };
}

export type SmartStep = 'import' | 'identification' | 'review' | 'confirmation' | 'monitor';
export function initialSmartStep(status: string): SmartStep {
  return ['DRAFT', 'READY'].includes(status) ? 'import' : 'monitor';
}
