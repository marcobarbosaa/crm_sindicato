"use client";
import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { batchLabels, canResume, deliveryLabels, filterSends, formatSendTime, scheduledTime, sendCounts, sendLabels, type SendDetail } from './send-view-state';

export function MonitorStep({ data, busy, needsSync, onRefresh, onControl, onResolve }: {
  data: SendDetail; busy: boolean; needsSync: boolean; onRefresh: () => void; onControl: (action: string) => void; onResolve: (id: string) => void;
}) {
  const [query, setQuery] = useState(''), [status, setStatus] = useState('all'), [delivery, setDelivery] = useState('all'), [page, setPage] = useState(0);
  const { counts, finished } = useMemo(() => sendCounts(data.items), [data.items]);
  const filtered = useMemo(() => filterSends(data.items, query, status, delivery), [data.items, query, status, delivery]);
  const pages = Math.max(1, Math.ceil(filtered.length / 25)), current = Math.min(page, pages - 1), schedule = scheduledTime(data.batch, data.timezone);
  const disabled = busy || needsSync;
  return <section className="panel smart-panel smart-monitor" aria-labelledby="smart-batch-heading">
    <div className="smart-heading"><div><p className="eyebrow">ETAPA 5 DE 5</p><h2 id="smart-batch-heading" tabIndex={-1}>Acompanhamento</h2><p>{data.batch.name} · <strong>{batchLabels[data.batch.status] || data.batch.status}</strong></p></div><Button variant="outline" disabled={busy} onClick={onRefresh}><RefreshCw aria-hidden="true" />Atualizar</Button></div>
    <div className="smart-stats"><div><strong>{data.items.length}</strong>Total de PDFs</div>{['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED', 'UNCERTAIN'].map(key => <div key={key} data-send-count={key}><strong>{counts[key]}</strong>{sendLabels[key]}</div>)}</div>
    <progress className="smart-progress" value={finished} max={Math.max(1, data.items.length)} aria-label="Progresso global" /><p>{finished} de {data.items.length} documentos com resultado registrado. Aceitação pelo Gmail não comprova entrega.</p>
    <dl className="smart-confirmation-meta"><div><dt>Remetente</dt><dd>{data.batch.senderAddress || 'Não informado'}</dd></div><div><dt>Autorização registrada</dt><dd>{formatSendTime(data.batch.confirmedAt, data.timezone)}</dd></div><div><dt>Próxima execução</dt><dd>{schedule ? `A partir de ${schedule}` : 'Sem previsão disponível'}</dd></div><div><dt>Conclusão registrada</dt><dd>{formatSendTime(data.batch.completedAt, data.timezone)}</dd></div></dl>
    <small>Horários em {data.timezone || 'America/Sao_Paulo'}. O agendamento registrado pode aguardar o processador e a quota compartilhada; não é uma previsão de entrega.</small>
    {data.batch.notice && <p className="smart-notice" role="status">{data.batch.notice}</p>}
    {needsSync && <p className="smart-error" role="alert">Não foi possível conferir a última operação. Atualize antes de solicitar outro controle.</p>}
    <div className="smart-actions">
      {data.batch.status === 'RUNNING' && <Button disabled={disabled} variant="outline" onClick={() => onControl('pause')}>Pausar</Button>}
      {data.batch.status === 'PAUSED' && <Button disabled={disabled || !canResume(data.batch, data.items)} onClick={() => onControl('resume')}>Retomar</Button>}
      {['RUNNING', 'PAUSED'].includes(data.batch.status) && <Button variant="outline" disabled={disabled} onClick={() => { if (window.confirm('Cancelar os documentos pendentes? Um envio já iniciado pode terminar. Esta ação não desfaz mensagens aceitas.')) onControl('cancel'); }}>Cancelar pendentes</Button>}
      <a href={`/api/smart-sends/${data.batch.id}/report`}>Exportar relatório CSV</a>
    </div>
    {counts.UNCERTAIN > 0 && <p className="smart-notice">Há resultado incerto: o Gmail pode ter aceitado a mensagem. Confira o histórico e a pasta Enviados. Não haverá reenvio automático; “Encerrar sem reenviar” mantém o registro da incerteza.</p>}
    {data.batch.status === 'PAUSED' && counts.PROCESSING > 0 && <p className="smart-notice">Aguarde a recuperação do documento em processamento antes de retomar.</p>}
    <div className="smart-monitor-filters"><label>Pesquisar documento, empresa ou destinatário<input value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="Arquivo, empresa ou e-mail" /></label><label>Estado do envio<select value={status} onChange={event => { setStatus(event.target.value); setPage(0); }}><option value="all">Todos</option>{Object.entries(sendLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Monitoramento<select value={delivery} onChange={event => { setDelivery(event.target.value); setPage(0); }}><option value="all">Todos</option>{Object.entries(deliveryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
    <p role="status">{filtered.length} documentos encontrados</p>
    <ul className="smart-monitor-list">{filtered.slice(current * 25, (current + 1) * 25).map(item => <li key={item.id}>
      <div className="smart-monitor-document"><strong>{item.fileName}</strong><small>{item.companyName || 'Empresa não associada'}</small><span>{item.recipient || 'Sem destinatário'}</span>{item.excluded && <small>Excluído do envio</small>}{item.fileReady && !item.fileDeletedAt && <a href={`/api/smart-sends/${data.batch.id}/items/${item.id}/file`} target="_blank" rel="noreferrer">Consultar PDF</a>}</div>
      <div><span className={`smart-status ${item.sendStatus === 'SENT' ? 'ok' : ''}`}>{sendLabels[item.sendStatus] || item.sendStatus}</span>
        {item.processingAt && <small>Em processamento desde: {formatSendTime(item.processingAt, data.timezone)}</small>}
        {item.sentAt && <small>Aceito em: {formatSendTime(item.sentAt, data.timezone)}</small>}
        {!item.processingAt && !item.sentAt && <small>Horário de processamento não registrado</small>}
        <small>Última alteração: {formatSendTime(item.updatedAt, data.timezone)}</small>
      </div>
      <div><small>Monitoramento</small><span>{item.sendStatus === 'SENT' ? deliveryLabels[item.deliveryStatus] || item.deliveryStatus : 'Sem entrega comprovada'}</span>{item.deliveryCheckedAt && <small>Consultado em: {formatSendTime(item.deliveryCheckedAt, data.timezone)}</small>}{item.error && <p className="smart-monitor-error">{item.error}</p>}{item.deliveryError && <p className="smart-monitor-error">{item.deliveryError}</p>}
        {item.sendStatus === 'UNCERTAIN' && <Button variant="outline" size="sm" disabled={disabled} onClick={() => { if (window.confirm('O Gmail pode ter aceitado esta mensagem. Encerrar o item sem reenviar e preservar o resultado incerto no histórico?')) onResolve(item.id); }}>Encerrar sem reenviar</Button>}
      </div>
    </li>)}</ul>
    {!filtered.length && <p className="smart-empty">Nenhum documento corresponde aos filtros.</p>}
    {pages > 1 && <nav className="smart-import-pagination" aria-label="Paginação do acompanhamento"><Button variant="outline" size="sm" disabled={!current} onClick={() => setPage(current - 1)}>Anterior</Button><span>Página {current + 1} de {pages}</span><Button variant="outline" size="sm" disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>Próxima</Button></nav>}
  </section>;
}
