"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmationStep } from '@/components/smart-sends/confirmation-step';
import { MonitorStep } from '@/components/smart-sends/monitor-step';
import { batchLabels, type SendDetail as Detail, type SendTemplate as Template } from '@/components/smart-sends/send-view-state';
import { BatchManager } from '@/components/smart-sends/batch-manager';
import { ReviewStep } from '@/components/smart-sends/review-step';
import type { ReviewDocument } from '@/components/smart-sends/review-state';
import type { ReviewInput } from '@/lib/smart-review-policy';
import { IdentificationStep } from '@/components/smart-sends/identification-step';
import { initialSmartStep, type SmartStep } from '@/components/smart-sends/identification-state';
import { ImportStep } from '@/components/smart-sends/import-step';
import { canRemoveUpload } from '@/components/smart-sends/import-state';
import { smartJson as api, identifyFile, importSnapshot, processImportQueue, restoreImportQueue, saveImportQueue, uploadPdf, type ImportEntry } from '@/lib/smart-import-client';
import { toast } from 'sonner';
export function SmartSendsPage() {
  const [data, setData] = useState<Detail | null>(null), [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState(''), [includeCommon, setIncludeCommon] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(true), [uploads, setUploads] = useState<ImportEntry[]>([]);
  const [activeStep, setActiveStep] = useState<SmartStep>('import');
  const operationGuard = useRef(false);
  const [reviewNeedsSync, setReviewNeedsSync] = useState(false);
  const reviewGuard = useRef(false);
  const [messageDirty, setMessageDirty] = useState(false);
  const navigate = (step: SmartStep) => { setActiveStep(step); requestAnimationFrame(() => document.getElementById(step === 'import' ? 'smart-import-title' : 'smart-batch-heading')?.focus()); };
  const [paused, setPaused] = useState(false), [importing, setImporting] = useState(false), [validating, setValidating] = useState(false);
  const uploadGuard = useRef(false), pauseRequested = useRef(false);
  const selectedFiles = useRef(new Map<string, File>());
  const latestUploads = useRef(uploads);
  useEffect(() => { latestUploads.current = uploads; }, [uploads]);
  const refresh = useCallback(async (id: number) => { const next = await api<Detail>('/' + id); setData(next); setConfirmed(false); setReviewNeedsSync(false); if (!['DRAFT', 'READY'].includes(next.batch.status)) setActiveStep(step => step === 'confirmation' ? 'monitor' : step); return next; }, []);
  useEffect(() => { let active = true; api<Template[]>('/templates').then(t => { if (active) setTemplates(t); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  const batchId = data?.batch.id, batchStatus = data?.batch.status;
  useEffect(() => {
    if (!batchId || activeStep !== 'monitor' || busy) return;
    let active = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState !== 'hidden') {
        try { const next = await api<Detail>('/' + batchId); if (active) { setData(next); setReviewNeedsSync(false); setError(''); } }
        catch { if (active) setError('Não foi possível atualizar o progresso. Os dados exibidos são da última consulta.'); }
      }
      if (active) timer = setTimeout(() => void poll(), 8000);
    };
    timer = setTimeout(() => void poll(), 8000);
    return () => { active = false; clearTimeout(timer); };
  }, [batchId, batchStatus, activeStep, busy]);
  const run = async (work: () => Promise<void>) => {
    if (operationGuard.current) return;
    operationGuard.current = true; setBusy(true); setError(''); setConfirmed(false);
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Falha na operação.'); }
    finally { operationGuard.current = false; setBusy(false); }
  };
  async function openBatch(id: number) {
    const opened = await refresh(id); selectedFiles.current.clear(); setUploads([]); setActiveStep(initialSmartStep(opened.batch.status)); setMessageDirty(false); setTemplateId(opened.batch.templateId ? String(opened.batch.templateId) : ''); setIncludeCommon(opened.batch.commonAttachments.length > 0); setPaused(false); pauseRequested.current = false;
    try { setUploads(restoreImportQueue(localStorage, id)); }
    catch { setError('Não foi possível ler a fila local. Selecione os PDFs novamente; cada hash será conferido no servidor.'); }
  }
  async function create() { await run(async () => { const b = await api<{ id: number }>('', { name: `Documentos — ${new Date().toLocaleString('pt-BR')}` }); await refresh(b.id); selectedFiles.current.clear(); setUploads([]); setActiveStep('import'); setMessageDirty(false); setPaused(false); pauseRequested.current = false; setTemplateId(''); setIncludeCommon(false); }); }
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
  const review = async (item: ReviewDocument, input: ReviewInput) => {
    if (!data || reviewGuard.current || busy || reviewNeedsSync) throw new Error('Aguarde a atualização do lote antes de continuar.');
    reviewGuard.current = true; setBusy(true); setConfirmed(false);
    try {
      await api(`/${data.batch.id}/items/${item.id}`, { ...input, expectedRevision: data.batch.revision }, 'PATCH');
      await refresh(data.batch.id);
    } catch (error) { setReviewNeedsSync(true); throw error; }
    finally { reviewGuard.current = false; setBusy(false); }
  };
  const control = (action: string) => run(async () => {
    try { setData(await api<Detail>(`/${data!.batch.id}/control`, { action, revision: data!.batch.revision, confirmed })); if (action === 'start') navigate('monitor'); toast.success(action === 'start' ? 'Autorização registrada. O processamento continuará em segundo plano.' : 'Lote atualizado.'); }
    catch (error) { setReviewNeedsSync(true); throw error; }
  });
  const prepare = () => run(async () => {
    try { setData(await api<Detail>(`/${data!.batch.id}/prepare`, { templateId: Number(templateId), includeCommon })); setMessageDirty(false); toast.success('Prévia salva. Confira os destinatários antes de autorizar.'); }
    catch (error) { setReviewNeedsSync(true); throw error; }
  });
  const resolve = (id: string) => run(async () => {
    try { await api(`/${data!.batch.id}/items/${id}/resolve`, { acknowledgeUncertain: true }); await refresh(data!.batch.id); toast.success('Resultado incerto preservado. Nenhum reenvio solicitado.'); }
    catch (error) { setReviewNeedsSync(true); throw error; }
  });
  const editing = data && ['DRAFT', 'READY'].includes(data.batch.status), ready = data?.batch.status === 'READY' && !messageDirty && !reviewNeedsSync && data.summary.eligible > 0;
  const showingImport = activeStep === 'import';
  const steps: { id: SmartStep; label: string }[] = [{ id: 'import', label: 'Importação' }, { id: 'identification', label: 'Identificação' }, { id: 'review', label: 'Revisão' }, { id: 'confirmation', label: 'Confirmação' }, { id: 'monitor', label: 'Acompanhamento' }];
  return <div className="smart-sends">{data && <Button className="smart-back" variant="ghost" disabled={busy} onClick={() => { setData(null); setUploads([]); setError(''); selectedFiles.current.clear(); }}><ArrowLeft aria-hidden="true" />Voltar aos lotes</Button>}<section className="page-intro compact"><div><p className="eyebrow">DOCUMENTOS PERSONALIZADOS</p><h1>Envios Inteligentes</h1><p>{data ? data.batch.name : 'Importe PDFs, revise os destinatários e acompanhe cada envio.'}</p></div><Button onClick={create} disabled={busy}><Plus />Novo lote</Button></section>
    {data && <ol className="smart-steps" aria-label="Etapas do envio">{steps.map((step, i) => <li key={step.id} aria-current={activeStep === step.id ? 'step' : undefined} className={activeStep === step.id ? 'current' : ''}><button disabled={busy || (step.id === 'confirmation' ? !editing || reviewNeedsSync || !data.summary.eligible : step.id === 'monitor' ? !!editing : step.id !== 'import' && !data.items.length)} onClick={() => navigate(step.id)}><span>{i + 1}</span>{step.label}</button></li>)}</ol>}
    {error && <div className="smart-error" role="alert">{error}<Button variant="outline" size="sm" onClick={() => void run(async () => { if (batchId) await refresh(batchId); else { setTemplates(await api<Template[]>('/templates')); } })} disabled={busy}>Tentar novamente</Button></div>}
    {loading && <p role="status">Carregando modelos de mensagem...</p>}{!data && <BatchManager disabled={busy} onOpen={id => void run(() => openBatch(id))} onDeleted={ids => {
      if (batchId && ids.includes(batchId)) { setData(null); setUploads([]); selectedFiles.current.clear(); }
    }} />}

    {data && showingImport && <ImportStep key={data.batch.id} entries={uploads} documents={data.items} limits={data.limits} busy={busy} readOnly={!editing} importing={importing} validating={validating} paused={paused}
      onSelect={files => void upload(files)} onPause={() => { pauseRequested.current = true; setPaused(true); }} onResume={() => void upload([])} onRecover={() => void upload([], true)} onRemove={removeUpload} onContinue={() => navigate('identification')} />}
    {data && activeStep === 'identification' && <IdentificationStep key={data.batch.id} items={data.items} batchId={data.batch.id} busy={busy} onBack={() => navigate('import')} onContinue={() => navigate('review')} />}
    {data && activeStep === 'review' && <section className="panel smart-panel"><div className="smart-heading"><div><h2 id="smart-batch-heading" tabIndex={-1}>Revisão dos destinatários</h2><p>{batchLabels[data.batch.status]}</p></div><Button variant="outline" disabled={busy} onClick={() => navigate('identification')}><ArrowLeft aria-hidden="true" />Voltar à identificação</Button><Button variant="outline" disabled={busy} onClick={() => void run(async () => { await refresh(data.batch.id); })}><RefreshCw aria-hidden="true" />Atualizar</Button></div>
      <ReviewStep key={data.batch.id} items={data.items} batchId={data.batch.id} busy={busy} readOnly={!editing} needsSync={reviewNeedsSync} summary={data.reviewSummary} onReview={review} />
      {editing && <footer className="smart-import-footer"><p>{data.summary.eligible} documentos elegíveis. A próxima etapa prepara a mensagem; nenhum e-mail é enviado aqui.</p><Button disabled={busy || reviewNeedsSync || !data.summary.eligible} onClick={() => navigate('confirmation')}>Continuar para confirmação</Button></footer>}
    </section>}
    {data && activeStep === 'confirmation' && <ConfirmationStep key={data.batch.id} data={data} templates={templates} templateId={templateId} includeCommon={includeCommon} ready={!!ready} confirmed={confirmed} busy={busy} needsSync={reviewNeedsSync}
      onTemplate={value => { setTemplateId(value); setIncludeCommon(false); setMessageDirty(true); setConfirmed(false); }} onCommon={value => { setIncludeCommon(value); setMessageDirty(true); setConfirmed(false); }}
      onPrepare={() => void prepare()} onConfirm={setConfirmed} onStart={() => void control('start')} onBack={() => navigate('review')} onRefresh={() => void run(async () => { await refresh(data.batch.id); })} />}
    {data && activeStep === 'monitor' && <MonitorStep key={data.batch.id} data={data} busy={busy} needsSync={reviewNeedsSync} onRefresh={() => void run(async () => { await refresh(data.batch.id); })} onControl={action => void control(action)} onResolve={id => void resolve(id)} />}
  </div>;
}
