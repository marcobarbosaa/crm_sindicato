"use client";
import { useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { eligibleItems, formatSendTime, type SendDetail, type SendTemplate } from './send-view-state';

export function ConfirmationStep({ data, templates, templateId, includeCommon, ready, confirmed, busy, needsSync, onTemplate, onCommon, onPrepare, onConfirm, onStart, onBack, onRefresh }: {
  data: SendDetail; templates: SendTemplate[]; templateId: string; includeCommon: boolean; ready: boolean; confirmed: boolean; busy: boolean; needsSync: boolean;
  onTemplate: (value: string) => void; onCommon: (value: boolean) => void; onPrepare: () => void; onConfirm: (value: boolean) => void; onStart: () => void; onBack: () => void; onRefresh: () => void;
}) {
  const [page, setPage] = useState(0), [previewId, setPreviewId] = useState<string | null>(null);
  const eligible = useMemo(() => eligibleItems(data.items), [data.items]);
  const pages = Math.max(1, Math.ceil(eligible.length / 25)), current = Math.min(page, pages - 1);
  const selected = eligible.find(item => item.id === previewId) || eligible[0], template = templates.find(t => String(t.id) === templateId);
  const recipients = new Set(eligible.map(item => item.recipient)).size;
  const consistent = eligible.length === data.summary.eligible;
  const stats = [[data.summary.documents, 'Total de PDFs'], [data.summary.companies, 'Empresas distintas elegíveis'], [recipients, 'Destinatários elegíveis distintos'], [data.summary.eligible, 'E-mails estimados'], [data.summary.blocked, 'Bloqueados'], [data.summary.excluded, 'Excluídos'], [data.summary.duplicates, 'Duplicatas']] as const;
  return <section className="panel smart-panel smart-confirmation" aria-labelledby="smart-batch-heading">
    <div className="smart-heading"><div><p className="eyebrow">ETAPA 4 DE 5</p><h2 id="smart-batch-heading" tabIndex={-1}>Confirmação do lote</h2><p>Prepare a mensagem e confira os destinatários antes de autorizar.</p></div><Button variant="outline" disabled={busy} onClick={onRefresh}><RefreshCw aria-hidden="true" />Atualizar</Button></div>
    <div className="smart-stats">{stats.map(([value, label]) => <div key={label}><strong>{value}</strong>{label}</div>)}</div>
    <p className="smart-notice"><strong>Um PDF por mensagem.</strong> Dois PDFs aprovados para a mesma empresa geram dois e-mails separados. Documentos bloqueados ou excluídos não serão enviados.</p>
    <dl className="smart-confirmation-meta"><div><dt>Conta Gmail remetente</dt><dd>{ready ? data.batch.senderAddress || 'Não definida' : data.sender || 'Nenhuma conta disponível'}</dd></div><div><dt>Intervalo mínimo entre envios</dt><dd>{data.batch.intervalSeconds} segundos</dd></div><div><dt>Limite diário disponível</dt><dd>{data.quota ? `${data.quota.available} de ${data.quota.limit} (${data.quota.used} usados ou reservados)` : 'Saldo não disponível nesta consulta'}</dd></div><div><dt>Renovação diária da quota</dt><dd>{formatSendTime(data.quota?.resetsAt, data.timezone)}</dd></div></dl>
    <small>Quota compartilhada com os demais envios do CRM, consultada em {formatSendTime(data.quota?.checkedAt, data.timezone)}. Este resumo não reserva capacidade; o processador confere o saldo antes de cada envio. Horários em {data.timezone || 'America/Sao_Paulo'}.</small>
    {data.quota && data.quota.available < data.summary.eligible && <p className="smart-notice">O saldo atual não comporta todo o lote. Os documentos restantes aguardam a disponibilidade de quota, conforme a política existente.</p>}
    <section className="smart-confirmation-config" aria-label="Configuração de mensagem"><h3>Mensagem e anexos</h3>
      <label>Template<select disabled={busy || needsSync} value={templateId} onChange={event => onTemplate(event.target.value)}><option value="">Selecione um template</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      {!templates.length && <p>Nenhum template disponível. Cadastre um template na seção Templates antes de preparar o lote.</p>}
      {!!template?.attachments.length && <label className="smart-check"><input type="checkbox" checked={includeCommon} disabled={busy || needsSync} onChange={event => onCommon(event.target.checked)} />Incluir anexos comuns em todas as mensagens: {template.attachments.map(a => a.name).join(', ')}</label>}
      <details><summary>Assinatura configurada atualmente</summary><pre>{data.signature || 'Sem assinatura configurada.'}</pre><small>A preparação inclui a assinatura no corpo de cada mensagem. A prévia salva abaixo é o conteúdo a ser enviado.</small></details>
      <Button disabled={busy || needsSync || !templateId || !eligible.length || !consistent} onClick={onPrepare}>{busy ? 'Aguarde…' : 'Gerar revisão final'}</Button>
      {!ready && <p>Gere a revisão final para salvar as mensagens personalizadas. Nenhum envio é iniciado nesta preparação.</p>}
    </section>
    <section className="smart-final" aria-label="Relação final de destinatários"><div className="smart-heading"><h3>Documento → Empresa → E-mail</h3><span>{eligible.length} mensagens elegíveis</span></div>
      {!eligible.length && <p>Nenhum documento elegível. Volte à Revisão e confirme ao menos uma associação válida.</p>}
      <ul className="smart-final-list">{eligible.slice(current * 25, (current + 1) * 25).map(item => <li key={item.id}><button disabled={!ready || busy} aria-pressed={selected?.id === item.id} onClick={() => setPreviewId(item.id)}><strong>{item.fileName}</strong><span>{item.companyName}</span><span>{item.recipient}</span><small>{ready ? 'Ver mensagem personalizada' : 'Aguardando preparação'}</small></button></li>)}</ul>
      {pages > 1 && <nav className="smart-import-pagination" aria-label="Paginação de destinatários"><Button variant="outline" size="sm" disabled={!current} onClick={() => setPage(current - 1)}>Anterior</Button><span>Página {current + 1} de {pages} · todos os {eligible.length} destinatários disponíveis</span><Button variant="outline" size="sm" disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>Próxima</Button></nav>}
      {ready && selected && <article className="smart-message" aria-label="Prévia individual"><h4>{selected.fileName}</h4><p>Para: {selected.companyName} · {selected.recipient}</p><small>Assunto</small><strong>{selected.subject}</strong><small>Corpo e assinatura salvos</small><pre>{selected.body}</pre><small>PDF individual: {selected.fileName}</small><small>Anexos comuns: {data.batch.commonAttachments.map(a => a.name).join(', ') || 'Nenhum'}</small></article>}
      {(!consistent || needsSync) && <p className="smart-error" role="alert">Atualize o lote antes de autorizar. A revisão precisa ser conferida com o servidor.</p>}
      {ready && <div className="smart-authorization"><ShieldCheck aria-hidden="true" /><label className="smart-check"><input type="checkbox" checked={confirmed} disabled={busy || needsSync || !consistent} onChange={event => onConfirm(event.target.checked)} />Conferi a relação de documentos, empresas, destinatários e as prévias. Autorizo {data.summary.eligible} mensagens individuais; bloqueados e excluídos ficam de fora.</label><Button disabled={busy || needsSync || !consistent || !confirmed || !eligible.length} onClick={onStart}><Send aria-hidden="true" />Confirmar e iniciar {data.summary.eligible} envios</Button></div>}
    </section><footer className="smart-import-footer"><Button variant="outline" disabled={busy} onClick={onBack}><ArrowLeft aria-hidden="true" />Voltar à revisão</Button></footer>
  </section>;
}
