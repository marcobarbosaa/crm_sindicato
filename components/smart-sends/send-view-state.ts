import { reviewState } from '@/lib/smart-review-policy';
import type { reviewOverview } from '@/lib/smart-review-policy';
import type { Attachment } from '@/lib/attachments';
import type { SmartLimits } from '@/lib/smart-send-policy';
import type { ReviewDocument } from './review-state';

export type SendItem = ReviewDocument & { sendStatus: string; deliveryStatus: string; deliveryError: string | null; subject: string | null; body: string | null; processingAt?: string | null; sentAt?: string | null; updatedAt?: string | null; deliveryCheckedAt?: string | null };
export type SendBatch = { id: number; name: string; status: string; revision: number; templateId?: number | null; templateName: string | null; senderAddress: string | null; commonAttachments: Attachment[]; intervalSeconds: number; notice: string | null; nextRunAt?: string | null; confirmedAt?: string | null; completedAt?: string | null };
export type SendDetail = { batch: SendBatch; items: SendItem[]; reviewSummary?: ReturnType<typeof reviewOverview>; limits: SmartLimits; dailyLimit: number; sender: string | null; signature?: string; timezone?: string;
  quota?: { limit: number; used: number; available: number; resetsAt: string; checkedAt: string };
  summary: { documents: number; companies: number; eligible: number; blocked: number; duplicates: number; withoutEmail: number; excluded: number } };
export type SendTemplate = { id: number; name: string; attachments: Attachment[] };
export const batchLabels: Record<string, string> = { DRAFT: 'Rascunho', READY: 'Preparado para autorização', RUNNING: 'Em execução', PAUSED: 'Pausado', COMPLETED: 'Concluído', CANCELLED: 'Cancelado' };
export const sendLabels: Record<string, string> = { DRAFT: 'Não iniciado', PENDING: 'Pendente', PROCESSING: 'Em processamento', SENT: 'Aceito pelo Gmail', FAILED: 'Falha', SKIPPED: 'Ignorado', UNCERTAIN: 'Resultado incerto' };
export const deliveryLabels: Record<string, string> = { PENDING: 'Monitoramento pendente', NO_KNOWN_FAILURE: 'Sem falha conhecida — entrega não comprovada', BOUNCED: 'Devolvido', DELIVERY_DELAYED: 'Entrega adiada', MAILBOX_FULL: 'Caixa postal cheia' };
export function eligibleItems(items: SendItem[]) { return items.filter(item => reviewState(item) === 'confirmed'); }
export function sendCounts(items: SendItem[]) {
  const counts: Record<string, number> = Object.fromEntries(Object.keys(sendLabels).map(status => [status, 0]));
  for (const item of items) counts[item.sendStatus] = (counts[item.sendStatus] || 0) + 1;
  return { counts, finished: counts.SENT + counts.FAILED + counts.SKIPPED + counts.UNCERTAIN };
}
export function canResume(batch: SendBatch, items: SendItem[]) {
  return batch.status === 'PAUSED' && !items.some(item => ['PROCESSING', 'UNCERTAIN'].includes(item.sendStatus));
}
export function formatSendTime(value: string | null | undefined, timezone = 'America/Sao_Paulo') {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Não informado';
  try { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone: timezone }).format(new Date(value)); }
  catch { return 'Não informado'; }
}
export function scheduledTime(batch: SendBatch, timezone?: string) {
  return batch.status === 'RUNNING' && batch.nextRunAt && Number.isFinite(Date.parse(batch.nextRunAt)) ? formatSendTime(batch.nextRunAt, timezone) : null;
}
export function filterSends(items: SendItem[], query: string, status: string, delivery: string) {
  const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const term = normalize(query.trim());
  return items.filter(item => (status === 'all' || item.sendStatus === status) && (delivery === 'all' || item.deliveryStatus === delivery)
    && (!term || normalize(`${item.fileName} ${item.companyName || ''} ${item.recipient || ''}`).includes(term)));
}
