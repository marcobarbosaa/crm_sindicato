// Shared by the upload route, reconciliation endpoint and browser queue.
export type ImportResult = {
  documentId: string;
  contentHash: string;
  persistence: 'persisted';
  storage: 'stored' | 'pending' | 'duplicate' | 'deleted';
  analysis: 'complete' | 'failed' | 'pending';
  code: string | null;
  message: string;
  recoverable: boolean;
};
export const IMPORT_LEASE_MS = 5 * 60_000;
type ImportRow = { id: string; contentHash: string; fileReady: boolean; fileDeletedAt: Date | null; removedAt: Date | null; duplicateOf: string | null; reviewStatus: string; error: string | null };
export function importResult(row: ImportRow): ImportResult {
  const deleted = !!(row.removedAt || row.fileDeletedAt);
  const interrupted = row.reviewStatus === 'UPLOADING' || (!row.fileReady && !row.duplicateOf) || ['IMPORT_STORAGE_FAILED', 'IMPORT_ANALYSIS_FAILED'].includes(row.error || '');
  const storage = deleted ? 'deleted' : row.duplicateOf ? 'duplicate' : row.fileReady ? 'stored' : 'pending';
  const analysis = interrupted ? 'pending' : row.reviewStatus === 'READ_ERROR' ? 'failed' : 'complete';
  return { documentId: row.id, contentHash: row.contentHash, persistence: 'persisted', storage, analysis,
    code: deleted ? 'IMPORT_REMOVED' : row.duplicateOf ? 'IMPORT_DUPLICATE' : row.error,
    message: deleted ? 'Documento removido ou expirado.' : row.duplicateOf ? 'Documento duplicado; envio bloqueado.'
      : interrupted ? (row.fileReady ? 'PDF salvo. Análise pendente de recuperação.' : 'Registro salvo. Armazenamento ainda não confirmado.')
      : analysis === 'failed' ? 'PDF salvo, mas a leitura falhou. Revise o documento.' : 'PDF salvo e analisado. Revise a associação.',
    recoverable: !deleted && !row.duplicateOf && interrupted };
}
