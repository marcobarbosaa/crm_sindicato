"use client";
import { useMemo, useState } from 'react';
import { ArrowRight, Pause, Play, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ImportEntry } from '@/lib/smart-import-client';
import type { SmartLimits } from '@/lib/smart-send-policy';
import { canIdentify, importRows, type ImportDocument } from './import-state';
import { UploadDropzone } from './upload-dropzone';
import { UploadProgress } from './upload-progress';
import { UploadFileList } from './upload-file-list';

export function ImportStep({ entries, documents, limits, busy, readOnly = false, importing, validating, paused, onSelect, onPause, onResume, onRecover, onRemove, onContinue }: {
  entries: ImportEntry[]; documents: ImportDocument[]; limits: SmartLimits; busy: boolean; readOnly?: boolean; importing: boolean; validating: boolean; paused: boolean;
  onSelect: (files: File[]) => void; onPause: () => void; onResume: () => void; onRecover: () => void; onRemove: (id: string) => void; onContinue: () => void;
}) {
  const rows = useMemo(() => importRows(entries, documents), [entries, documents]);
  const valid = documents.filter(canIdentify).length;
  const unavailable = new Set(documents.filter(item => !canIdentify(item)).map(item => item.id));
  const omitted = rows.filter(row => row.status !== 'complete' || unavailable.has(row.documentId));
  const acknowledgementKey = JSON.stringify(omitted.map(row => row.key));
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const hasPending = entries.some(entry => entry.phase === 'queued');
  const hasRecovery = entries.some(entry => entry.phase === 'uncertain' || entry.result?.recoverable);
  return <section className="panel smart-panel smart-import" aria-labelledby="smart-import-title">
    <div className="smart-heading"><div><h2 id="smart-import-title" tabIndex={-1}>Importação</h2><p>Adicione os PDFs e acompanhe a leitura de cada documento. Depois, revise as associações.</p></div><span className="smart-import-step-label">Etapa 1 de 5</span></div>
    {readOnly ? <p>Importação encerrada. Os documentos estão disponíveis para consulta.</p> : <UploadDropzone limits={limits} disabled={busy} hasDocuments={!!rows.length} onSelect={onSelect} />}
    {validating && !rows.length && <p role="status">Validando arquivos selecionados…</p>}
    {!!rows.length && <>
      <UploadProgress rows={rows} busy={importing} paused={paused} validating={validating} />
      {!readOnly && <div className="smart-import-toolbar">
        {importing ? <Button variant="outline" disabled={paused} onClick={onPause}><Pause aria-hidden="true" />{paused ? 'Pausa solicitada' : 'Pausar novos uploads'}</Button> : hasPending && <Button variant="outline" disabled={busy} onClick={onResume}><Play aria-hidden="true" />Continuar importação</Button>}
        {hasRecovery && <Button variant="outline" disabled={busy} onClick={onRecover}><RefreshCw aria-hidden="true" />Tentar novamente falhas recuperáveis</Button>}
        <p>{paused ? 'O arquivo em andamento será concluído antes da pausa.' : 'Arquivos enviados um por vez. Nenhum e-mail é enviado nesta etapa.'}</p>
      </div>}
      <UploadFileList rows={rows} busy={busy || readOnly} onRemove={onRemove} />
      <p className="smart-import-recovery">Você pode voltar a este lote depois. Ao reabrir, selecione os PDFs pendentes novamente. O sistema confere os documentos salvos antes de recuperar a importação.</p>
    </>}
    <footer className="smart-import-footer">
      <div><strong>{valid} {valid === 1 ? 'documento disponível' : 'documentos disponíveis'} para identificação</strong><p>A associação ao destinatário será revisada na próxima etapa.</p></div>
      {omitted.length > 0 && <div className="smart-import-omitted"><details><summary>{omitted.length} {omitted.length === 1 ? 'arquivo ficará de fora por enquanto' : 'arquivos ficarão de fora por enquanto'}</summary><ul>{omitted.map(row => <li key={row.key}>{row.name}</li>)}</ul></details><label className="smart-check"><input type="checkbox" disabled={busy} checked={acknowledged === acknowledgementKey} onChange={event => setAcknowledged(event.target.checked ? acknowledgementKey : null)} />Entendi as pendências e quero continuar com os documentos disponíveis.</label></div>}
      <Button disabled={busy || documents.length === 0 || (!readOnly && omitted.length > 0 && acknowledged !== acknowledgementKey)} onClick={onContinue}>Continuar para identificação<ArrowRight aria-hidden="true" /></Button>
    </footer>
  </section>;
}
