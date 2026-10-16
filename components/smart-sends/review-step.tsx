"use client";
import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatFileSize } from '@/lib/attachments';
import { reviewLabels, reviewOverview, reviewState, type ReviewInput } from '@/lib/smart-review-policy';
import { readingErrors } from './identification-state';
import { CompanyPicker } from './company-picker';
import { canAssociate, canConfirm, filterReview, type ReviewDocument, type ReviewFilter } from './review-state';

function DocumentPanel({ item, batchId, busy, readOnly, needsSync, onReview }: {
  item: ReviewDocument; batchId: number; busy: boolean; readOnly: boolean; needsSync: boolean;
  onReview: (item: ReviewDocument, input: ReviewInput) => Promise<void>;
}) {
  const [error, setError] = useState(''), [showPdf, setShowPdf] = useState(false), [correcting, setCorrecting] = useState(false), [removing, setRemoving] = useState(false);
  const fileUrl = `/api/smart-sends/${batchId}/items/${item.id}/file`, state = reviewState(item);
  const disabled = busy || readOnly || needsSync;
  async function act(input: ReviewInput) {
    setError('');
    try { await onReview(item, input); setCorrecting(false); setRemoving(false); return true; }
    catch (error) { setError(error instanceof Error ? error.message : 'Falha ao salvar a revisão.'); return false; }
  }
  return <article className="smart-review-detail" aria-labelledby="smart-document-title" aria-busy={busy}>
    <div className="smart-heading"><div><p className="eyebrow">DOCUMENTO SELECIONADO</p><h3 id="smart-document-title" tabIndex={-1}>{item.fileName}</h3><small>{formatFileSize(item.fileSize)}</small></div><span className={`smart-status ${state === 'confirmed' && !needsSync ? 'ok' : ''}`}>{needsSync ? 'Aguardando sincronização' : reviewLabels[state]}</span></div>
    {item.fileReady && !item.fileDeletedAt ? <div className="smart-review-preview">
      <div><Button variant="outline" size="sm" onClick={() => setShowPdf(!showPdf)}><FileText aria-hidden="true" />{showPdf ? 'Ocultar prévia' : 'Carregar prévia do PDF'}</Button><a href={fileUrl} target="_blank" rel="noreferrer">Abrir PDF em outra aba</a></div>
      {showPdf ? <iframe key={item.id} src={fileUrl} title={`Prévia de ${item.fileName}`} /> : <p>Abra a prévia para conferir o conteúdo antes de confirmar o destinatário.</p>}
      {showPdf && <small>Se o navegador não exibir o PDF, use “Abrir PDF em outra aba”.</small>}
    </div> : <p className="smart-notice">PDF indisponível. Consulte as pendências da importação.</p>}
    <dl className="smart-review-metadata"><div><dt>CNPJs extraídos do PDF</dt><dd>{item.extractedCnpjs.join(' · ') || 'Nenhum CNPJ válido encontrado'}</dd></div><div><dt>Método de associação</dt><dd>{({ CNPJ: 'CNPJ no PDF', FILENAME: 'Sugestão pelo nome do arquivo', MANUAL: item.companyId ? 'Seleção manual' : 'Não associado' } as Record<string, string>)[item.identificationMethod] || 'Não concluído'}</dd></div></dl>
    {item.extractedCnpjs.length > 1 && <p className="smart-notice">Há vários CNPJs neste PDF. Confira todos e selecione a empresa correta nas sugestões ou na pesquisa. A ordem dos identificadores não determina o destinatário.</p>}
    {item.identificationMethod === 'FILENAME' && <p className="smart-notice">O nome do arquivo é apenas uma sugestão. Confira o conteúdo do PDF antes de associar.</p>}
    {item.error && <p className="smart-notice">{readingErrors[item.error] || item.error}</p>}
    {item.reviewStatus === 'DUPLICATE' && <p className="smart-notice">Arquivo duplicado. A confirmação está bloqueada para evitar reenvio.</p>}
    {['NO_EMAIL', 'INVALID_EMAIL'].includes(item.reviewStatus) && <p className="smart-notice">{item.reviewStatus === 'NO_EMAIL' ? 'Empresa sem e-mail.' : 'E-mail destinatário inválido.'} Corrija o cadastro e selecione a empresa novamente para atualizar a associação.</p>}
    <section className="smart-review-association" aria-label="Associação a confirmar"><h4>Documento → Empresa → Destinatário</h4>
      <dl><div><dt>Documento</dt><dd>{item.fileName}</dd></div><div><dt>Empresa selecionada / razão social</dt><dd>{item.companyName || 'Selecione uma empresa'}</dd></div><div><dt>CNPJ cadastrado</dt><dd>{item.companyCnpj || 'Não informado'}</dd></div><div><dt>E-mail destinatário</dt><dd>{item.recipient || 'Sem destinatário'}</dd></div></dl>
      {state === 'confirmed' && !needsSync && <p>Associação confirmada{item.confirmedAt ? ` em ${new Date(item.confirmedAt).toLocaleString('pt-BR')}` : ''}.</p>}
      {item.excluded && <p>Excluído do envio. Reinclua e confirme novamente para torná-lo elegível.</p>}
    </section>
    {!readOnly && <>
      <p className="smart-review-safety">Confirme apenas após conferir o PDF, a empresa e o e-mail acima. Esta ação não envia e-mails.</p>
      {error && <p className="smart-error" role="alert">{error}</p>}
      {needsSync && <p className="smart-notice" role="status">O resultado da última alteração precisa ser conferido. Use “Atualizar” antes de continuar; nenhuma confirmação é presumida.</p>}
      <div className="smart-review-actions"><Button disabled={disabled || !canConfirm(item)} onClick={() => void act({ confirm: true, expectedRecipient: item.recipient! })}>{state === 'confirmed' ? 'Associação confirmada' : busy ? 'Salvando revisão…' : 'Confirmar associação'}</Button>
        <Button variant="outline" disabled={disabled || !canAssociate(item) || item.excluded} aria-expanded={correcting} onClick={() => setCorrecting(!correcting)}>{item.companyId ? 'Corrigir empresa' : 'Associar empresa'}</Button>
      </div>
      {(correcting || !item.companyId) && canAssociate(item) && !item.excluded && <CompanyPicker suggestions={item.suggestions || []} disabled={disabled} onChoose={companyId => act({ companyId })} />}
      <div className="smart-review-secondary"><label><input type="checkbox" checked={item.excluded} disabled={disabled || item.reviewStatus === 'UPLOADING'} onChange={event => void act({ excluded: event.target.checked })} />Excluir do envio</label><button disabled={disabled || item.reviewStatus === 'UPLOADING'} onClick={() => setRemoving(!removing)}>Remover documento</button></div>
      {removing && <div className="smart-notice"><p>Remover {item.fileName} deste lote? A associação será descartada.</p><Button variant="outline" disabled={disabled} onClick={() => void act({ remove: true })}>Confirmar remoção</Button><Button variant="ghost" disabled={disabled} onClick={() => setRemoving(false)}>Manter documento</Button></div>}
    </>}
  </article>;
}

export function ReviewStep({ items, batchId, busy, readOnly, needsSync, summary, onReview }: {
  items: ReviewDocument[]; batchId: number; busy: boolean; readOnly: boolean; needsSync: boolean;
  summary?: ReturnType<typeof reviewOverview>; onReview: (item: ReviewDocument, input: ReviewInput) => Promise<void>;
}) {
  const [documentQuery, setDocumentQuery] = useState(''), [companyQuery, setCompanyQuery] = useState(''), [filter, setFilter] = useState<ReviewFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null), [page, setPage] = useState(0), [mobileDetail, setMobileDetail] = useState(false);
  const filtered = useMemo(() => filterReview(items, documentQuery, companyQuery, filter), [items, documentQuery, companyQuery, filter]);
  const counts = useMemo(() => summary || reviewOverview(items), [summary, items]);
  const pages = Math.max(1, Math.ceil(filtered.length / 25)), current = Math.min(page, pages - 1), visible = filtered.slice(current * 25, (current + 1) * 25);
  // Keep the selected document after confirmation even if a pending-only filter hides it.
  const selected = items.find(item => item.id === selectedId) || visible[0];
  function select(item: ReviewDocument) { setSelectedId(item.id); setMobileDetail(true); requestAnimationFrame(() => document.getElementById('smart-document-title')?.focus()); }
  function resetFilter() { setPage(0); setSelectedId(null); setMobileDetail(false); }
  const nextPending = items.find(item => item.id !== selected?.id && reviewState(item) === 'pending');
  return <div className={`smart-review ${mobileDetail ? 'show-detail' : ''}`}>
    <div className="smart-stats" aria-label="Resumo da revisão">{[[counts.total, 'Total de documentos'], [counts.confirmed, 'Confirmados'], [counts.pending, 'Pendentes'], [counts.blocked, 'Bloqueados'], [counts.excluded, 'Excluídos']].map(([count, label]) => <div key={label} data-review-count={label}><strong>{count}</strong>{label}</div>)}</div>
    {needsSync && <p role="status">Indicadores da última consulta. Atualize para conferir o resultado da alteração.</p>}
    <div className="smart-review-workspace">
      <aside className="smart-review-sidebar" aria-label="Documentos para revisão">
        <div className="smart-review-filters"><label>Pesquisar documento<input value={documentQuery} onChange={event => { setDocumentQuery(event.target.value); resetFilter(); }} placeholder="Nome do arquivo" /></label>
          <label>Pesquisar empresa associada ou sugerida<input value={companyQuery} onChange={event => { setCompanyQuery(event.target.value); resetFilter(); }} placeholder="Nome ou CNPJ" /></label>
          <label>Status da revisão<select value={filter} onChange={event => { setFilter(event.target.value as ReviewFilter); resetFilter(); }}><option value="all">Todos os documentos</option><option value="pending">Somente pendentes</option><option value="confirmed">Somente confirmados</option><option value="blocked">Bloqueados</option><option value="excluded">Excluídos</option><option value="no-email">Sem e-mail</option><option value="invalid-email">E-mail inválido</option><option value="duplicate">Arquivos duplicados</option></select></label>
        </div><p role="status">{filtered.length} documentos encontrados</p>
        <ul className="smart-review-list">{visible.map(item => {
          const state = reviewState(item);
          return <li key={item.id}><button aria-current={selected?.id === item.id ? 'true' : undefined} onClick={() => select(item)}><strong>{item.fileName}</strong><small>{item.companyName || 'Empresa não associada'}</small><span className={`smart-status ${state === 'confirmed' && !needsSync ? 'ok' : ''}`}>{needsSync ? 'Conferir sincronização' : reviewLabels[state]}</span>{['pending', 'blocked'].includes(state) && <small className="smart-review-pending">● {state === 'blocked' ? 'Correção necessária' : 'Aguardando revisão'}</small>}</button></li>;
        })}</ul>
        {!visible.length && <p>Nenhum documento corresponde aos filtros.</p>}
        {pages > 1 && <nav className="smart-import-pagination" aria-label="Paginação da revisão"><Button variant="outline" size="sm" disabled={!current} onClick={() => { setPage(current - 1); setSelectedId(null); }}>Anterior</Button><span>{current + 1} / {pages}</span><Button variant="outline" size="sm" disabled={current + 1 === pages} onClick={() => { setPage(current + 1); setSelectedId(null); }}>Próxima</Button></nav>}
      </aside>
      <div className="smart-review-content"><div className="smart-review-detail-nav"><Button className="smart-review-return" variant="outline" onClick={() => setMobileDetail(false)}><ArrowLeft aria-hidden="true" />Lista de documentos</Button><Button variant="outline" disabled={busy || !nextPending} onClick={() => { if (nextPending) { setDocumentQuery(''); setCompanyQuery(''); setFilter('pending'); const pending = items.filter(item => reviewState(item) === 'pending'); setPage(Math.floor(pending.findIndex(item => item.id === nextPending.id) / 25)); select(nextPending); } }}>Próximo pendente<ArrowRight aria-hidden="true" /></Button></div>
        {selected ? <DocumentPanel key={selected.id} item={selected} batchId={batchId} busy={busy} readOnly={readOnly} needsSync={needsSync} onReview={onReview} /> : <p className="smart-empty">Selecione um documento para revisar.</p>}
      </div>
    </div>
  </div>;
}
