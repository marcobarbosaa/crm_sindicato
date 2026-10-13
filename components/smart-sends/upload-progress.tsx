import type { ImportRow } from './import-state';

export function UploadProgress({ rows, busy, paused, validating }: { rows: ImportRow[]; busy: boolean; paused: boolean; validating: boolean }) {
  const counts = { waiting: 0, processing: 0, complete: 0, failed: 0 };
  for (const row of rows) counts[row.status]++;
  const finished = counts.complete + counts.failed;
  return <section className="smart-import-progress" aria-label="Resumo da importação">
    <dl className="smart-import-counts">
      {[[rows.length, 'Selecionados'], [counts.waiting, 'Aguardando'], [counts.processing, 'Em processamento'], [counts.complete, 'Concluídos'], [counts.failed, 'Com falha']].map(([count, label]) =>
        <div key={label} data-count={label}><dt>{label}</dt><dd>{count}</dd></div>)}
    </dl>
    <div className="smart-import-progress-heading"><strong>{validating ? 'Validando arquivos…' : paused ? busy ? 'Pausando após o arquivo atual…' : 'Importação pausada' : busy ? 'Importação em andamento' : counts.waiting ? 'Há documentos aguardando' : counts.failed ? 'Importação com pendências' : 'Importação concluída'}</strong><span>{finished} de {rows.length} com resultado</span></div>
    <progress max={Math.max(1, rows.length)} value={finished} aria-label="Documentos com resultado na importação" />
    <p role="status" aria-live="polite" aria-atomic="true">{counts.complete} concluídos · {counts.failed} com falha ou resultado a conferir · {counts.waiting} aguardando.</p>
  </section>;
}
