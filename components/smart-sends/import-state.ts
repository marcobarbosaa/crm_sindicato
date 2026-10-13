import type { ImportEntry } from '@/lib/smart-import-client';

export type ImportDocument = {
  id: string; fileName: string; fileSize: number; fileReady: boolean;
  fileDeletedAt: string | null; readable: boolean; reviewStatus: string;
  error: string | null; excluded: boolean;
};
export type ImportRow = {
  key: string; documentId: string; name: string; size: number; progress: number;
  status: 'waiting' | 'processing' | 'complete' | 'failed';
  label: string; message: string; removableId?: string;
};
const readingErrors: Record<string, string> = {
  PDF_PASSWORD: 'Este PDF tem senha. Selecione uma cópia desbloqueada.',
  PDF_CORRUPT: 'Não foi possível ler este PDF. Selecione uma cópia válida.',
  PDF_NO_TEXT: 'O PDF não contém texto que possa ser lido.',
  PDF_PAGE_LIMIT: 'O PDF excede o limite de páginas permitido.',
  PDF_TEXT_LIMIT: 'O PDF excede o limite de texto permitido.',
  IMPORT_STORAGE_FAILED: 'O arquivo ainda não foi confirmado. Tente recuperar a importação.',
  IMPORT_ANALYSIS_FAILED: 'PDF salvo. Tente novamente para concluir a análise.',
};
export function canIdentify(item: ImportDocument) {
  return item.fileReady && item.readable && !item.fileDeletedAt && !item.excluded && !['DUPLICATE', 'UPLOADING', 'READ_ERROR'].includes(item.reviewStatus);
}
export function canRemoveUpload(entry: ImportEntry) {
  return !entry.result && entry.progress === 0 && (entry.phase === 'queued' || entry.phase === 'rejected');
}
export function importRows(entries: ImportEntry[], documents: ImportDocument[]): ImportRow[] {
  const represented = new Set(entries.map(entry => entry.result?.documentId || entry.id));
  const rows: ImportRow[] = entries.map((entry, index) => {
    const result = entry.result;
    const base = { key: `${entry.id}:${index}`, documentId: result?.documentId || entry.id, name: entry.name, size: entry.size, progress: entry.progress,
      removableId: canRemoveUpload(entry) ? entry.id : undefined };
    if (entry.phase === 'sending') return { ...base, status: 'processing', label: entry.progress === 100 ? 'Analisando' : 'Enviando', message: entry.progress === 100 ? 'Arquivo transmitido. Aguardando confirmação e análise.' : `Enviando arquivo · ${entry.progress}%` };
    if (entry.phase === 'rejected') return { ...base, status: 'failed', label: 'Não importado', message: entry.state.includes('MIME') ? 'Selecione um arquivo no formato PDF.' : entry.state };
    if (entry.phase === 'uncertain') return { ...base, status: 'failed', label: result?.recoverable ? 'Recuperação pendente' : 'Resultado a conferir', message: entry.state };
    if (result && (result.storage !== 'stored' || result.analysis !== 'complete')) return { ...base, status: 'failed', label: result.storage === 'duplicate' ? 'Duplicado' : result.storage === 'deleted' ? 'Removido' : 'Falha na leitura', message: readingErrors[result.code || ''] || result.message };
    if (entry.phase === 'confirmed' && result) return { ...base, status: 'complete', label: 'Concluído', message: entry.state || result.message };
    return { ...base, status: 'waiting', label: 'Aguardando', message: entry.state };
  });
  for (const item of documents) {
    if (represented.has(item.id)) continue;
    const complete = item.fileReady && item.readable && !item.fileDeletedAt && !['DUPLICATE', 'UPLOADING', 'READ_ERROR'].includes(item.reviewStatus);
    rows.push({ key: item.id, documentId: item.id, name: item.fileName, size: item.fileSize, progress: item.fileReady ? 100 : 0,
      status: complete ? 'complete' : 'failed', label: complete ? 'Concluído' : item.reviewStatus === 'DUPLICATE' ? 'Duplicado' : 'Requer atenção',
      message: complete ? 'PDF salvo e analisado. Revise a associação.' : readingErrors[item.error || ''] || 'Confira este documento. Se a importação foi interrompida, selecione o PDF original para recuperar.' });
  }
  return rows;
}
