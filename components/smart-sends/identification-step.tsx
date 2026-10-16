"use client";
import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { approvalState, classifyIdentification, identificationGroups, identificationOverview, type IdentificationDocument, type IdentificationGroup } from './identification-state';

function Candidates({ item }: { item: IdentificationDocument }) {
  const [open, setOpen] = useState(false), [page, setPage] = useState(0);
  const suggestions = item.suggestions || [];
  if (!item.candidates.length) return null;
  return <details onToggle={event => setOpen(event.currentTarget.open)} className="smart-identification-candidates">
    <summary>Empresas correspondentes / candidatas ({suggestions.length})</summary>
    {open && <><ul>{suggestions.slice(page * 10, (page + 1) * 10).map(company => <li key={company.id}>
      <strong>{company.name}</strong><small>Razão social: {company.name}</small><small>CNPJ: {company.cnpj || 'Não informado'}</small><small>E-mail principal: {company.primaryEmail || 'Não informado'}</small>
    </li>)}</ul>{suggestions.length > 10 && <div className="smart-import-pagination"><Button variant="outline" size="sm" disabled={!page} onClick={() => setPage(page - 1)}>Candidatas anteriores</Button><span>{page + 1} / {Math.ceil(suggestions.length / 10)}</span><Button variant="outline" size="sm" disabled={(page + 1) * 10 >= suggestions.length} onClick={() => setPage(page + 1)}>Próximas candidatas</Button></div>}
      {!suggestions.length && <p>As candidatas não estão mais disponíveis no cadastro.</p>}</>}
  </details>;
}

export function IdentificationStep({ items, batchId, busy, onBack, onContinue }: {
  items: IdentificationDocument[]; batchId: number; busy: boolean; onBack: () => void; onContinue: () => void;
}) {
  const overview = useMemo(() => identificationOverview(items), [items]);
  const [filter, setFilter] = useState<IdentificationGroup | 'all'>('all'), [page, setPage] = useState(0);
  const filtered = filter === 'all' ? Object.values(overview.groups).flat() : overview.groups[filter];
  const pages = Math.max(1, Math.ceil(filtered.length / 25)), currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * 25, (currentPage + 1) * 25);
  const counts = [[overview.documents, 'Documentos analisados'], [overview.companies, 'Empresas identificadas'], [overview.groups.review.length, 'Correspondência ambígua / revisão'], [overview.groups.unidentified.length, 'Empresas não encontradas'], [overview.groups.problem.length, 'Documentos com problema'], [overview.withoutRecipient, 'Sem destinatário válido']] as const;
  return <section className="panel smart-panel smart-identification" aria-labelledby="smart-batch-heading">
    <div className="smart-heading"><div><p className="eyebrow">RESULTADOS DA IMPORTAÇÃO</p><h2 id="smart-batch-heading" tabIndex={-1}>Identificação das empresas</h2><p>Consulte o reconhecimento salvo durante a importação. Na Revisão, escolha e confirme cada destinatário.</p></div><span className="smart-import-step-label">Etapa 2 de 5</span></div>
    <div className="smart-stats">{counts.map(([count, label]) => <div key={label} data-identification-count={label}><strong>{count}</strong>{label}</div>)}</div>
    <p>Empresas são contadas uma vez; cada PDF permanece separado. Identificação automática não autoriza envio.</p>
    <div className="smart-identification-filters" role="group" aria-label="Filtrar resultados de identificação">
      <button aria-pressed={filter === 'all'} onClick={() => { setFilter('all'); setPage(0); }}>Todos ({items.length})</button>
      {Object.entries(identificationGroups).map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => { setFilter(key as IdentificationGroup); setPage(0); }}>{label} ({overview.groups[key as IdentificationGroup].length})</button>)}
    </div>
    {!visible.length && <p role="status">Nenhum documento neste grupo.</p>}
    {Object.entries(identificationGroups).map(([group, label]) => {
      const rows = visible.filter(item => classifyIdentification(item).group === group);
      return rows.length > 0 && <section key={group} className="smart-identification-group" aria-label={label}><h3>{label}</h3><ul className="smart-identification-list">{rows.map(item => {
        const state = approvalState(item), classification = classifyIdentification(item);
        return <li key={item.id} className="smart-identification-document">
          <div className="smart-heading"><div><h4>{item.fileName}</h4>{item.fileReady && !item.fileDeletedAt && <a href={`/api/smart-sends/${batchId}/items/${item.id}/file`} target="_blank" rel="noreferrer">Visualizar PDF</a>}</div><div className="smart-identification-states">
            {item.identificationMethod === 'CNPJ' && item.companyId && <span className="smart-status automatic">Identificado automaticamente</span>}
            <span className={`smart-status ${state === 'Confirmado' ? 'ok' : ''}`}>{state}</span>{item.excluded && <small>Excluído do envio</small>}
          </div></div>
          <dl className="smart-identification-fields">
            <div><dt>CNPJs extraídos</dt><dd>{item.extractedCnpjs.join(', ') || 'Nenhum CNPJ válido encontrado'}</dd></div>
            <div><dt>{item.identificationMethod === 'MANUAL' ? 'Empresa associada' : 'Empresa sugerida'}</dt><dd>{item.companyName || 'Sem empresa selecionada'}</dd></div>
            <div><dt>Razão social</dt><dd>{item.companyName || 'A definir na revisão'}</dd></div>
            <div><dt>CNPJ da empresa</dt><dd>{item.companyCnpj || 'Não informado'}</dd></div>
            <div><dt>E-mail principal</dt><dd>{item.recipient || 'Sem destinatário'}</dd></div>
            <div><dt>Método de identificação</dt><dd>{({ CNPJ: 'CNPJ no PDF', FILENAME: 'Nome do arquivo (sugestão)', MANUAL: item.companyId ? 'Associação manual' : 'Sem correspondência automática' } as Record<string, string>)[item.identificationMethod] || 'Não concluído'}</dd></div>
          </dl><p className="smart-identification-reason"><strong>Motivo: </strong>{classification.reason}</p>
          {['NO_EMAIL', 'INVALID_EMAIL'].includes(item.reviewStatus) && <p>Corrija o e-mail principal no cadastro antes de confirmar o destinatário.</p>}
          <Candidates item={item} />
        </li>;
      })}</ul></section>;
    })}
    {pages > 1 && <nav className="smart-import-pagination" aria-label="Paginação da identificação"><Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</Button><span aria-live="polite">Página {currentPage + 1} de {pages} · {filtered.length} documentos</span><Button variant="outline" size="sm" disabled={currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)}>Próxima</Button></nav>}
    <footer className="smart-import-footer"><Button variant="outline" disabled={busy} onClick={onBack}><ArrowLeft aria-hidden="true" />Voltar à importação</Button><Button disabled={busy || !items.length} onClick={onContinue}>Revisar destinatários<ArrowRight aria-hidden="true" /></Button></footer>
  </section>;
}
