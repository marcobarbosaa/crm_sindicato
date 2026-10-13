"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileUp, Plus, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ImportStep } from '@/components/smart-sends/import-step';
import { canRemoveUpload } from '@/components/smart-sends/import-state';
import { formatFileSize, type Attachment } from '@/lib/attachments';
import { type SmartLimits } from '@/lib/smart-send-policy';
import { smartJson as api, identifyFile, importSnapshot, processImportQueue, restoreImportQueue, saveImportQueue, uploadPdf, type ImportEntry } from '@/lib/smart-import-client';
import { toast } from 'sonner';
type Item = { id: string; fileName: string; fileSize: number; fileReady: boolean; fileDeletedAt: string | null; readable: boolean; companyId: number | null; companyName: string | null; companyCnpj: string | null; recipient: string | null; extractedCnpjs: string[]; candidates: number[]; suggestions?: { id: number | string; name: string; primaryEmail: string | null }[]; identificationMethod: string; reviewStatus: string; sendStatus: string; deliveryStatus: string; error: string | null; deliveryError: string | null; excluded: boolean; subject: string | null; body: string | null };
type Batch = { id: number; name: string; status: string; revision: number; templateName: string | null; senderAddress: string | null; commonAttachments: Attachment[]; intervalSeconds: number; notice: string | null };
type Detail = { batch: Batch; items: Item[]; limits: SmartLimits; dailyLimit: number; sender: string | null; summary: { documents: number; companies: number; eligible: number; blocked: number; duplicates: number; withoutEmail: number; excluded: number } };
type Template = { id: number; name: string; attachments: Attachment[] };
type Company = { id: number | string; name: string; primaryEmail: string | null; cnpj: string | null };
const readingErrors: Record<string, string> = { IMPORT_STORAGE_FAILED: 'Registro salvo; armazenamento não confirmado. Use Recuperar pendentes.', IMPORT_ANALYSIS_FAILED: 'PDF salvo; análise interrompida. Use Recuperar pendentes.', PDF_PASSWORD: 'PDF protegido por senha. Importe uma cópia desbloqueada.', PDF_CORRUPT: 'PDF corrompido ou incompatível.', PDF_NO_TEXT: 'Sem camada textual. Visualize o PDF e associe uma empresa manualmente.', PDF_PAGE_LIMIT: 'PDF excede o limite de páginas.', PDF_TEXT_LIMIT: 'PDF excede o limite de texto analisável.' };
const labels: Record<string, string> = { DRAFT: 'Rascunho', READY: 'Pronto para envio', RUNNING: 'Em execução', PAUSED: 'Pausado', COMPLETED: 'Concluído', CANCELLED: 'Cancelado', IDENTIFIED: 'Identificado', REVIEW_REQUIRED: 'Revisão necessária', COMPANY_NOT_FOUND: 'Empresa não cadastrada', NO_EMAIL: 'Sem e-mail', INVALID_EMAIL: 'E-mail inválido', DUPLICATE: 'Documento duplicado', READ_ERROR: 'Erro de leitura', UPLOADING: 'Analisando', PENDING: 'Pendente', PROCESSING: 'Em processamento', SENT: 'Aceito pelo Gmail', FAILED: 'Falha', SKIPPED: 'Ignorado', UNCERTAIN: 'Resultado incerto', NO_KNOWN_FAILURE: 'Sem falha conhecida', BOUNCED: 'Devolvido', DELIVERY_DELAYED: 'Entrega adiada' };
function CompanyPicker({ item, disabled, onChoose }: { item: Item; disabled: boolean; onChoose: (id: number) => void }) {
  const [query, setQuery] = useState(''), [rows, setRows] = useState<Company[]>([]), [error, setError] = useState('');
  useEffect(() => {
    if (!query.trim()) return;
    let active = true; const timer = setTimeout(() => { void api<Company[]>('/companies?search=' + encodeURIComponent(query)).then(data => { if (active) { setRows(data); setError(''); } }).catch(() => { if (active) setError('Falha na busca.'); }); }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);
  function chooseCompany(value: number | string) {
    const id = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
      setError('Identificador de empresa inválido. Pesquise e selecione a empresa novamente.');
      return;
    }
    setError('');
    onChoose(id);
    setQuery('');
    setRows([]);
  }
  return <details className="smart-associate"><summary>Associar empresa</summary>{!!item.suggestions?.length && <ul aria-label="Sugestões de empresas">{item.suggestions.map(c => <li key={c.id}><button disabled={disabled} onClick={() => chooseCompany(c.id)}>{c.name}<small>{c.primaryEmail || "Sem e-mail"}</small></button></li>)}</ul>}<label>Buscar empresa para {item.fileName}<input disabled={disabled} value={query} onChange={e => { setQuery(e.target.value); setRows([]); }} placeholder="Nome ou CNPJ" /></label>{error && <p role="alert">{error}</p>}{query && <ul>{rows.map(c => <li key={c.id}><button disabled={disabled} onClick={() => chooseCompany(c.id)}>{c.name}<small>{c.cnpj} · {c.primaryEmail || 'Sem e-mail'}</small></button></li>)}</ul>}</details>;
}
export function SmartSendsPage() {
  const [history, setHistory] = useState<Batch[]>([]), [data, setData] = useState<Detail | null>(null), [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState(''), [includeCommon, setIncludeCommon] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(true), [uploads, setUploads] = useState<ImportEntry[]>([]);
  const [preview, setPreview] = useState<string | null>(null), [importStep, setImportStep] = useState(true);
  const [paused, setPaused] = useState(false), [importing, setImporting] = useState(false), [validating, setValidating] = useState(false);
  const uploadGuard = useRef(false), pauseRequested = useRef(false);
  const selectedFiles = useRef(new Map<string, File>());
  const latestUploads = useRef(uploads);
  useEffect(() => { latestUploads.current = uploads; }, [uploads]);
  const refresh = useCallback(async (id: number) => { const next = await api<Detail>('/' + id); setData(next); setHistory(rows => rows.map(row => row.id === next.batch.id ? next.batch : row)); return next; }, []);
  useEffect(() => { let active = true; Promise.all([api<Batch[]>(''), api<Template[]>('/templates')]).then(([b, t]) => { if (active) { setHistory(b); setTemplates(t); } }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  const batchId = data?.batch.id, batchStatus = data?.batch.status;
  useEffect(() => { if (!batchId || !['RUNNING', 'PAUSED', 'CANCELLED', 'COMPLETED'].includes(batchStatus || '')) return; const timer = setInterval(() => { void refresh(batchId).catch(() => setError('Não foi possível atualizar o progresso.')); }, 8000); return () => clearInterval(timer); }, [batchId, batchStatus, refresh]);
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(''); setConfirmed(false); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Falha na operação.'); } finally { setBusy(false); } };
  async function openBatch(id: number) {
    await refresh(id); selectedFiles.current.clear(); setUploads([]); setImportStep(true); setPaused(false); pauseRequested.current = false;
    try { setUploads(restoreImportQueue(localStorage, id)); }
    catch { setError('Não foi possível ler a fila local. Selecione os PDFs novamente; cada hash será conferido no servidor.'); }
  }
  async function create() { await run(async () => { const b = await api<{ id: number }>('', { name: `Documentos — ${new Date().toLocaleString('pt-BR')}` }); await refresh(b.id); selectedFiles.current.clear(); setUploads([]); setImportStep(true); setPaused(false); pauseRequested.current = false; setTemplateId(''); setIncludeCommon(false); setHistory(await api<Batch[]>('')); }); }
  async function upload(files: File[], recover = false) {
    if (!data || uploadGuard.current || busy) return;
    uploadGuard.current = true; setBusy(true); setImporting(true); setValidating(files.length > 0); setError(''); setConfirmed(false);
    pauseRequested.current = false; setPaused(false);
    try {
      const entries = uploads.map(e => ({ ...e }));
      for (const file of files) {
        try {
          const hash = await identifyFile(file, data.limits);
          selectedFiles.current.set(hash, file);
          const existing = entries.find(e => e.hash === hash);
          if (existing?.phase === 'rejected') { existing.phase = 'queued'; existing.state = 'Aguardando reconciliação'; }
          if (!existing) entries.push({ id: crypto.randomUUID(), hash, name: file.name, size: file.size, progress: 0, phase: 'queued', state: 'Aguardando' });
        } catch (e) { entries.push({ id: crypto.randomUUID(), name: file.name.slice(0, 180), size: file.size, progress: 0, phase: 'rejected', state: e instanceof Error ? e.message : 'PDF inválido.' }); }
      }
      if (entries.length > 500) throw new Error('A fila local permite até 500 arquivos. Selecione menos documentos.');
      const changed = (rows: ImportEntry[]) => {
        setUploads(rows);
        try { saveImportQueue(localStorage, data.batch.id, rows); }
        catch { throw new Error('Não foi possível preservar a fila neste navegador. Libere o armazenamento local antes de continuar.'); }
      };
      changed(entries);
      setValidating(false);
      const outcome = await processImportQueue(entries, {
        snapshot: () => importSnapshot(data.batch.id), hasFile: entry => selectedFiles.current.has(entry.hash!), changed,
        send: (entry, recovering, progress) => uploadPdf(data.batch.id, { ...entry, id: entry.result?.documentId || entry.id }, selectedFiles.current.get(entry.hash!)!, recovering, progress),
        sync: () => refresh(data.batch.id),
        shouldPause: () => pauseRequested.current,
      }, recover);
      if (outcome.warning) setError(outcome.warning);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha no upload.'); }
    finally { setBusy(false); setImporting(false); setValidating(false); uploadGuard.current = false; }
  }
  const removeUpload = useCallback((id: string) => {
    if (!batchId || uploadGuard.current) return;
    const next = latestUploads.current.filter(entry => entry.id !== id || !canRemoveUpload(entry));
    try { saveImportQueue(localStorage, batchId, next); setUploads(next); }
    catch { setError('Não foi possível salvar a fila. O arquivo foi mantido; tente novamente.'); }
  }, [batchId]);
  const review = (item: Item, input: unknown) => run(async () => { await api(`/${data!.batch.id}/items/${item.id}`, input, 'PATCH'); await refresh(data!.batch.id); });
  const control = (action: string) => run(async () => { setData(await api<Detail>(`/${data!.batch.id}/control`, { action, revision: data!.batch.revision, confirmed })); toast.success(action === 'start' ? 'Fila iniciada. O processamento continuará em segundo plano.' : 'Lote atualizado.'); });
  const editing = data && ['DRAFT', 'READY'].includes(data.batch.status), ready = data?.batch.status === 'READY';
  const selected = templates.find(t => String(t.id) === templateId), selectedPreview = data?.items.find(i => i.id === preview) || data?.items.find(i => i.subject);
  const counts = Object.fromEntries(['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED', 'UNCERTAIN'].map(s => [s, data?.items.filter(i => i.sendStatus === s).length || 0]));
  const finished = counts.SENT + counts.FAILED + counts.SKIPPED + counts.UNCERTAIN;
  const showingImport = !!editing && importStep;
  const step = !data || showingImport ? 0 : !editing ? 4 : ready ? 3 : 1;
  return <div className="smart-sends">{data && <Button className="smart-back" variant="ghost" disabled={busy} onClick={() => { setData(null); setUploads([]); setError(''); selectedFiles.current.clear(); }}><ArrowLeft aria-hidden="true" />Voltar aos lotes</Button>}<section className="page-intro compact"><div><p className="eyebrow">DOCUMENTOS PERSONALIZADOS</p><h1>Envios Inteligentes</h1><p>{data ? data.batch.name : 'Importe PDFs, revise os destinatários e acompanhe cada envio.'}</p></div><Button onClick={create} disabled={busy || loading}><Plus />Novo lote</Button></section>
    {data && <ol className="smart-steps" aria-label="Etapas do envio">{['Importação', 'Identificação', 'Revisão', 'Confirmação', 'Acompanhamento'].map((s, i) => <li key={s} aria-current={i === step ? 'step' : undefined} className={i === step ? 'current' : i < step ? 'done' : ''}><span>{i + 1}</span>{s}</li>)}</ol>}
    {error && <div className="smart-error" role="alert">{error}<Button variant="outline" size="sm" onClick={() => void run(async () => { if (batchId) await refresh(batchId); else { setHistory(await api<Batch[]>('')); setTemplates(await api<Template[]>('/templates')); } })} disabled={busy}>Tentar novamente</Button></div>}
    {loading ? <p role="status">Carregando Envios Inteligentes…</p> : !data && <section className="panel smart-panel"><label>Lotes recentes<select disabled={busy} value="" onChange={e => e.target.value && void run(() => openBatch(Number(e.target.value)))}><option value="">Selecione um lote</option>{history.map(b => <option key={b.id} value={b.id}>{b.name} · {labels[b.status] || b.status}</option>)}</select></label><div className="smart-empty"><FileUp size={36} /><h2>Um documento, o destinatário certo</h2><p>Crie um lote para importar arquivos. Você aprova cada associação antes de iniciar os envios.</p></div></section>}
    {data && showingImport && <ImportStep key={data.batch.id} entries={uploads} documents={data.items} limits={data.limits} busy={busy} importing={importing} validating={validating} paused={paused}
      onSelect={files => void upload(files)} onPause={() => { pauseRequested.current = true; setPaused(true); }} onResume={() => void upload([])} onRecover={() => void upload([], true)} onRemove={removeUpload} onContinue={() => { setImportStep(false); requestAnimationFrame(() => document.getElementById('smart-batch-heading')?.focus()); }} />}
    {data && !showingImport && <><section className="panel smart-panel"><div className="smart-heading"><div><h2 id="smart-batch-heading" tabIndex={-1}>{data.batch.name}</h2><p>{labels[data.batch.status]}</p></div>{editing && <Button variant="outline" disabled={busy} onClick={() => setImportStep(true)}><ArrowLeft aria-hidden="true" />Voltar à importação</Button>}<Button variant="outline" disabled={busy} onClick={() => void run(async () => { await refresh(data.batch.id); })}><RefreshCw />Atualizar</Button></div>
      {!editing && <><div className="smart-stats"><div><strong>{data.items.length}</strong>Total</div>{Object.entries(counts).map(([s, count]) => <div key={s}><strong>{count}</strong>{labels[s]}</div>)}</div><progress className="smart-progress" max={Math.max(1, data.items.length)} value={finished} aria-label="Progresso global" /><p>{finished} de {data.items.length} documentos com resultado. Aceitação pelo Gmail não comprova entrega.</p>{data.batch.notice && <p role="status" className="smart-notice">{data.batch.notice}</p>}<div className="smart-actions">{data.batch.status === 'RUNNING' && <Button disabled={busy} variant="outline" onClick={() => void control('pause')}>Pausar</Button>}{data.batch.status === 'PAUSED' && <Button disabled={busy || counts.UNCERTAIN > 0 || counts.PROCESSING > 0} onClick={() => void control('resume')}>Retomar</Button>}{['RUNNING', 'PAUSED'].includes(data.batch.status) && <Button variant="outline" disabled={busy} onClick={() => { if (window.confirm('Cancelar os itens pendentes? Um envio já iniciado pode terminar.')) void control('cancel'); }}>Cancelar pendentes</Button>}<a href={`/api/smart-sends/${data.batch.id}/report`}>Exportar relatório CSV</a></div></>}
      {!!data.items.length && <div className="smart-table-wrap"><table><caption>Documento → Empresa → E-mail destinatário</caption><thead><tr><th>Documento</th><th>CNPJ / Empresa</th><th>Destinatário</th><th>Identificação</th><th>Status</th><th>Ações</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id} className={item.excluded ? 'excluded' : ''}><td><strong>{item.fileName}</strong><small>{formatFileSize(item.fileSize)}</small>{item.fileReady && !item.fileDeletedAt && <a href={`/api/smart-sends/${data.batch.id}/items/${item.id}/file`} target="_blank" rel="noreferrer">Visualizar PDF</a>}</td><td>{item.companyName || 'Associação pendente'}<small>{item.extractedCnpjs.join(', ') || item.companyCnpj || 'CNPJ não identificado'}</small></td><td>{item.recipient || 'Sem destinatário'}</td><td>{({ CNPJ: 'CNPJ no PDF', FILENAME: 'Nome do arquivo', MANUAL: 'Manual' } as Record<string, string>)[item.identificationMethod]}{item.candidates.length > 0 && <small>{item.candidates.length} sugestão(ões)</small>}</td><td><span className={`smart-status ${item.reviewStatus === 'READY' || item.sendStatus === 'SENT' ? 'ok' : ''}`}>{item.excluded ? 'Excluído do envio' : labels[editing ? item.reviewStatus : item.sendStatus]}</span>{!editing && <small>{labels[item.deliveryStatus] || item.deliveryStatus}</small>}{(item.error || item.deliveryError) && <small>{readingErrors[item.error || ''] || item.error || item.deliveryError}</small>}</td><td>{editing ? <div className="smart-row-actions">{item.readable && item.fileReady && !item.fileDeletedAt && item.reviewStatus !== 'DUPLICATE' && <><CompanyPicker item={item} disabled={busy} onChoose={companyId => void review(item, { companyId })} /><Button size="sm" variant="outline" disabled={busy || item.excluded || !item.companyId || !['IDENTIFIED', 'READY'].includes(item.reviewStatus)} onClick={() => void review(item, { confirm: true })}>{item.reviewStatus === 'READY' ? 'Confirmado' : 'Confirmar associação'}</Button></>}<label><input type="checkbox" checked={item.excluded} disabled={busy} onChange={e => void review(item, { excluded: e.target.checked })} />Excluir do envio</label><button disabled={busy} onClick={() => void review(item, { remove: true })}>Remover documento</button></div> : item.sendStatus === 'UNCERTAIN' ? <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (window.confirm('O Gmail pode ter aceitado a mensagem. Encerrar este item sem reenviar e manter o resultado incerto no histórico?')) void run(async () => { await api(`/${data.batch.id}/items/${item.id}/resolve`, { acknowledgeUncertain: true }); await refresh(data.batch.id); }); }}>Encerrar sem reenviar</Button> : '—'}</td></tr>)}</tbody></table></div>}
    </section>
    {editing && <section className="panel smart-panel"><div className="smart-heading"><div><h2>Mensagem e confirmação</h2><p>Cada e-mail contém exclusivamente o PDF da linha aprovada, além dos anexos comuns escolhidos.</p></div><ShieldCheck /></div><label>Template<select value={templateId} disabled={busy} onChange={e => { setTemplateId(e.target.value); setConfirmed(false); setData(current => current ? { ...current, batch: { ...current.batch, status: 'DRAFT' } } : current); }}><option value="">Selecione um template</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>{selected && selected.attachments.length > 0 && <label className="smart-check"><input type="checkbox" disabled={busy} checked={includeCommon} onChange={e => { setIncludeCommon(e.target.checked); setConfirmed(false); setData(current => current ? { ...current, batch: { ...current.batch, status: 'DRAFT' } } : current); }} />Incluir anexos comuns do template em todos os e-mails: {selected.attachments.map(a => a.name).join(', ')}</label>}<Button disabled={busy || !templateId || !data.summary.eligible} onClick={() => void run(async () => { setData(await api<Detail>(`/${data.batch.id}/prepare`, { templateId: Number(templateId), includeCommon })); })}>Gerar revisão final</Button>
      {ready && <div className="smart-final"><h3>Confira antes de iniciar</h3><div className="smart-stats">{[[data.summary.documents, 'Documentos'], [data.summary.companies, 'Empresas'], [data.summary.eligible, 'Envios estimados'], [data.summary.blocked, 'Bloqueados'], [data.summary.duplicates, 'Duplicados'], [data.summary.withoutEmail, 'Sem destinatário'], [data.summary.excluded, 'Excluídos']].map(([n, label]) => <div key={label}><strong>{n}</strong>{label}</div>)}</div><p>Remetente: <strong>{data.batch.senderAddress}</strong> · Template: <strong>{data.batch.templateName}</strong></p><p>Um envio por bloco técnico, intervalo mínimo de {data.batch.intervalSeconds}s. Limite diário compartilhado: {data.dailyLimit}. Dois PDFs para a mesma empresa geram dois e-mails separados.</p><p>Anexos comuns confirmados: {data.batch.commonAttachments.map(a => a.name).join(', ') || 'Nenhum'}.</p><label>Prévia por documento<select value={selectedPreview?.id || ''} onChange={e => setPreview(e.target.value)}>{data.items.filter(i => i.reviewStatus === 'READY' && !i.excluded).map(i => <option key={i.id} value={i.id}>{i.fileName} → {i.companyName} → {i.recipient}</option>)}</select></label>{selectedPreview && <article className="smart-message"><strong>{selectedPreview.subject}</strong><pre>{selectedPreview.body}</pre><small>PDF individual: {selectedPreview.fileName}</small></article>}<label className="smart-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />Conferi as associações e a prévia acima. Autorizo {data.summary.eligible} envios; itens bloqueados e excluídos serão ignorados.</label><Button disabled={busy || !confirmed} onClick={() => void control('start')}><Send />Confirmar e iniciar {data.summary.eligible} envios</Button></div>}
    </section>}</>}
  </div>;
}
