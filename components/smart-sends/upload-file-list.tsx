"use client";
import { memo, useState } from 'react';
import { CheckCircle2, CircleAlert, Clock3, FileText, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatFileSize } from '@/lib/attachments';
import type { ImportRow } from './import-state';

const FileRow = memo(function FileRow({ name, size, progress, status, label, message, removableId, busy, onRemove }: Omit<ImportRow, 'key'> & { busy: boolean; onRemove: (id: string) => void }) {
  const Icon = status === 'complete' ? CheckCircle2 : status === 'failed' ? CircleAlert : Clock3;
  return <li className={`smart-import-file ${status}`}>
    <div className="smart-import-filename"><FileText size={20} aria-hidden="true" /><div><strong>{name}</strong><small>{formatFileSize(size)}</small></div></div>
    <div className="smart-import-file-state"><span className={`smart-import-badge ${status}`}><Icon size={14} aria-hidden="true" />{label}</span><small>{message}</small></div>
    <div className="smart-import-transfer"><span>{progress}% transmitido</span><progress max={100} value={progress} aria-label={`Envio de ${name}`} /></div>
    <div className="smart-import-file-action">{removableId && <Button size="icon-sm" variant="ghost" disabled={busy} aria-label={`Remover ${name} da fila`} onClick={() => onRemove(removableId)}><Trash2 aria-hidden="true" /></Button>}</div>
  </li>;
});
const PAGE_SIZE = 25;
export function UploadFileList({ rows, busy, onRemove }: { rows: ImportRow[]; busy: boolean; onRemove: (id: string) => void }) {
  const [filter, setFilter] = useState('all'), [page, setPage] = useState(0);
  const filtered = filter === 'failed' ? rows.filter(row => row.status === 'failed') : rows;
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), current = Math.min(page, pages - 1);
  return <section className="smart-import-documents" aria-labelledby="smart-import-documents-title">
    <div className="smart-heading"><h3 id="smart-import-documents-title">Documentos <span className="smart-import-total">{rows.length}</span></h3><label>Exibir<select value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }}><option value="all">Todos os documentos</option><option value="failed">Com falha ou pendência</option></select></label></div>
    <ul className={`smart-upload-list ${filtered.length > 8 ? 'scrollable' : ''}`} tabIndex={filtered.length > 8 ? 0 : undefined} aria-label="Arquivos da importação">{filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(({ key, ...row }) => <FileRow key={key} {...row} busy={busy} onRemove={onRemove} />)}</ul>
    {!filtered.length && <p>Nenhum documento neste filtro.</p>}
    {pages > 1 && <nav className="smart-import-pagination" aria-label="Páginas dos documentos"><Button variant="outline" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Anterior</Button><span role="status">Página {current + 1} de {pages} · {filtered.length} documentos</span><Button variant="outline" size="sm" disabled={current === pages - 1} onClick={() => setPage(current + 1)}>Próxima</Button></nav>}
  </section>;
}
