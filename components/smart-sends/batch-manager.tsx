"use client";
import { useCallback, useEffect, useState } from 'react';
import { MoreHorizontal, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { smartJson, clearImportQueue } from '@/lib/smart-import-client';
import type { DeletionResult } from '@/lib/smart-batch-management';

type BatchRow = { id: number; name: string; createdAt: string; status: string; documents: number; pendingReview: number; sent: number; pendingFiles: number; deletionRequestedAt: string | null; deletionError: string | null };
type Catalog = { rows: BatchRow[]; hasMore: boolean };
const labels: Record<string, string> = { DRAFT: 'Rascunho', READY: 'Preparado', RUNNING: 'Em execução', PAUSED: 'Pausado', COMPLETED: 'Concluído', CANCELLED: 'Cancelado', DELETING: 'Em exclusão' };

export function BatchManager({ disabled, onOpen, onDeleted }: { disabled: boolean; onOpen: (id: number) => void; onDeleted: (ids: number[]) => void }) {
  const [catalog, setCatalog] = useState<Catalog>({ rows: [], hasMore: false });
  const [search, setSearch] = useState(''), [status, setStatus] = useState(''), [order, setOrder] = useState('newest'), [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number[]>([]), [preview, setPreview] = useState<DeletionResult[] | null>(null);
  const [loading, setLoading] = useState(true), [working, setWorking] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [version, setVersion] = useState(0);
  const [workingIds, setWorkingIds] = useState<number[]>([]);
  const reload = useCallback(() => setVersion(v => v + 1), []);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      void smartJson<Catalog>(`/batches?${new URLSearchParams({ search, status, order, page: String(page) })}`)
        .then(result => { if (active) { setCatalog(result); setError(''); } })
        .catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [search, status, order, page, version]);
  useEffect(() => {
    if (!catalog.rows.some(row => row.deletionRequestedAt)) return;
    // Also reconcile local metadata after a lost response or browser reload.
    for (const row of catalog.rows.filter(row => row.deletionRequestedAt)) {
      try { clearImportQueue(localStorage, row.id); } catch { /* Server state still fences stale queues. */ }
    }
    if (status !== 'DELETING' || loading || working) return;
    // Only the visible deletion view refreshes, once after the previous response.
    const refreshVisible = () => { if (document.visibilityState === 'visible') reload(); };
    const timer = setTimeout(refreshVisible, 60_000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', refreshVisible); };
  }, [catalog.rows, status, loading, working, reload]);
  const busy = disabled || working;
  const filtersChanged = () => { setPage(0); setSelected([]); };
  async function inspect(ids: number[]) {
    setWorking(true); setWorkingIds(ids); setError(''); setNotice('');
    try { setPreview(await smartJson<DeletionResult[]>('/deletion-preview', { ids })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha ao verificar os lotes.'); }
    finally { setWorking(false); setWorkingIds([]); }
  }
  async function confirmDeletion() {
    if (!preview) return;
    setWorking(true); setWorkingIds(preview.filter(row => row.eligible).map(row => row.id)); setError('');
    try {
      const eligible = preview.filter(row => row.eligible);
      const results = await smartJson<DeletionResult[]>('/deletion-request', { confirmed: true, batches: eligible.map(({ id, revision, documents }) => ({ id, revision, documents })) });
      const accepted = results.filter(row => ['pending', 'deleted'].includes(row.state)).map(row => row.id);
      for (const id of accepted) {
        try { clearImportQueue(localStorage, id); }
        catch { setError('Exclusão solicitada. Não foi possível limpar a fila local; o servidor já bloqueou novas importações nesses lotes.'); }
      }
      onDeleted(accepted); setSelected(ids => ids.filter(id => !accepted.includes(id)));
      // Update immediately after the persisted acknowledgement; do not wait for a GET.
      if (status !== 'DELETING') setCatalog(current => ({ ...current, rows: current.rows.filter(row => !accepted.includes(row.id)) }));
      const blocked = results.filter(row => row.state === 'blocked');
      setNotice(`${accepted.length} solicitação(ões) de exclusão confirmada(s). Acompanhe a remoção dos PDFs em “Em exclusão”. Você já pode trabalhar em outro lote.`);
      setPreview(blocked.length ? blocked : null); reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao solicitar exclusão.'); }
    finally { setWorking(false); setWorkingIds([]); }
  }
  const eligible = preview?.filter(row => row.eligible) || [];
  return <section className="panel smart-panel smart-batches" aria-labelledby="smart-batches-title">
    <div className="smart-heading"><div><h2 id="smart-batches-title" tabIndex={-1}>Meus lotes</h2><p>Organize seus documentos. Lotes com histórico de envio são preservados.</p></div><Button variant="outline" disabled={busy || loading} onClick={reload}><RefreshCw aria-hidden="true" />Atualizar</Button></div>
    <div className="smart-batch-filters"><label>Pesquisar por nome<input type="search" value={search} maxLength={100} onChange={e => { setSearch(e.target.value); filtersChanged(); }} /></label><label>Status<select value={status} onChange={e => { setStatus(e.target.value); filtersChanged(); }}><option value="">Todos fora de exclusão</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Ordenar por data<select value={order} onChange={e => { setOrder(e.target.value); filtersChanged(); }}><option value="newest">Mais recentes</option><option value="oldest">Mais antigos</option></select></label></div>
    {status === 'DELETING' && <p>Limpeza em segundo plano. Atualização a cada minuto enquanto esta visualização estiver aberta. Use “Atualizar” para consultar agora.</p>}
    {error && <p role="alert" className="smart-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="smart-heading"><p>{selected.length} selecionado(s) · até 5 por exclusão</p><Button variant="destructive" disabled={busy || !selected.length} onClick={() => void inspect(selected)}><Trash2 aria-hidden="true" />Excluir selecionados</Button></div>
    {loading && <p role="status">Atualizando lotes…</p>}
    {!loading && !catalog.rows.length && <p className="smart-empty">Nenhum lote encontrado. Crie um novo lote ou ajuste os filtros.</p>}
    <ul className="smart-batch-list" aria-busy={loading}>{catalog.rows.map(row => <li key={row.id}>
      <input type="checkbox" aria-label={`Selecionar ${row.name}`} disabled={busy || loading || !!row.deletionRequestedAt || (!selected.includes(row.id) && selected.length >= 5)} checked={selected.includes(row.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, row.id] : ids.filter(id => id !== row.id))} />
      <div className="smart-batch-info"><strong>{row.name}</strong><small>Criado em {new Date(row.createdAt).toLocaleString('pt-BR')}</small><span>{row.deletionRequestedAt ? labels.DELETING : labels[row.status] || row.status}</span><p>{row.documents} PDFs · {row.pendingReview} pendentes de revisão · {row.sent} aceitos pelo Gmail</p>{row.deletionRequestedAt && <p role="status">{row.pendingFiles} objeto(s) pendente(s). {row.deletionError || 'Aguardando limpeza agendada.'}</p>}</div>
      <div className="smart-batch-actions"><Button variant="outline" disabled={disabled || workingIds.includes(row.id) || !!row.deletionRequestedAt} onClick={() => onOpen(row.id)}>Abrir lote</Button><details><summary aria-label={`Ações de ${row.name}`}><MoreHorizontal aria-hidden="true" /></summary><button className="smart-delete-action" disabled={busy || !!row.deletionRequestedAt} onClick={() => void inspect([row.id])}>Excluir lote</button></details></div>
    </li>)}</ul>
    <div className="smart-heading"><Button variant="outline" disabled={busy || loading || page === 0} onClick={() => { setPage(p => p - 1); setSelected([]); }}>Anterior</Button><span>Página {page + 1}</span><Button variant="outline" disabled={busy || loading || !catalog.hasMore} onClick={() => { setPage(p => p + 1); setSelected([]); }}>Próxima</Button></div>
    <AlertDialog open={preview !== null} onOpenChange={open => { if (!open && !working) setPreview(null); }}>
      <AlertDialogContent onCloseAutoFocus={event => { event.preventDefault(); document.getElementById('smart-batches-title')?.focus(); }}><AlertDialogHeader><AlertDialogTitle>Excluir lotes definitivamente?</AlertDialogTitle><AlertDialogDescription>Você está prestes a excluir definitivamente este lote e seus documentos armazenados. Esta ação não pode ser desfeita.</AlertDialogDescription></AlertDialogHeader>
        <p>{preview?.length || 0} selecionado(s) · {eligible.length} elegível(is) · {(preview?.length || 0) - eligible.length} bloqueado(s) · {eligible.reduce((sum, row) => sum + row.documents, 0)} PDFs</p>
        <ul className="smart-deletion-preview">{preview?.map(row => <li key={row.id}><strong>{row.name}</strong> · {row.documents} PDFs<p>{row.eligible ? 'Elegível para exclusão' : row.reason || (row.state === 'pending' ? 'Exclusão já solicitada.' : 'Lote já excluído.')}</p></li>)}</ul>
        {error && <p role="alert">{error}</p>}
        <AlertDialogFooter><AlertDialogCancel disabled={working}>Cancelar</AlertDialogCancel><Button variant="destructive" disabled={working || !eligible.length} onClick={() => void confirmDeletion()}>{working ? 'Solicitando…' : 'Excluir definitivamente'}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
