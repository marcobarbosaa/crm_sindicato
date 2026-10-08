import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, withCampaignDb } from '@/db';
import { documentSendBatches as batches, documentSendItems as items } from '@/db/schema';
import { smartOwner } from '@/lib/smart-send-auth';
import { boundedBytes, contentHash, smartStorage } from '@/lib/smart-send-storage';
import { SmartSendError, csvCell, smartLimits } from '@/lib/smart-send-policy';
import { storageConfig } from '@/lib/attachment-storage';
import { AttachmentError } from '@/lib/attachments';
import { controlSmartBatch, getSmartBatch, ownedItems, prepareSmartBatch, reviewSmartItem, smartCatalog, uploadSmartPdf } from '@/lib/smart-send-service';
type Context = { params: Promise<{ path?: string[] }> };
const idSchema = z.coerce.number().int().positive().safe();
async function json(request: Request) { return JSON.parse(new TextDecoder().decode(await boundedBytes(request.body, 64 * 1024))) as unknown; }
async function handle(request: NextRequest, context: Context) {
  try {
    const owner = await smartOwner(request), path = (await context.params).path || [];
    return await withCampaignDb(async () => {
      const db = getDb(), method = request.method;
      const response = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'cache-control': 'private, no-store' } });
      if (!path.length) {
        if (method === 'GET') return response(await db.select({ id: batches.id, name: batches.name, status: batches.status, createdAt: batches.createdAt }).from(batches).where(eq(batches.ownerId, owner)).orderBy(desc(batches.createdAt)).limit(100));
        if (method === 'POST') {
          const input = z.object({ name: z.string().trim().min(1).max(100) }).strict().parse(await json(request));
          const now = new Date();
          const [batch] = await db.insert(batches).values({ ownerId: owner, name: input.name, intervalSeconds: smartLimits(storageConfig).intervalSeconds, createdAt: now, updatedAt: now }).returning();
          return response({ id: batch.id }, 201);
        }
      }
      if (method === 'GET' && path.length === 1 && path[0] === 'templates') return response(await smartCatalog(owner));
      if (method === 'GET' && path.length === 1 && path[0] === 'companies') return response(await smartCatalog(owner, request.nextUrl.searchParams.get('search') || ''));
      const id = idSchema.parse(path[0]);
      if (method === 'GET' && path.length === 1) return response(await getSmartBatch(owner, id));
      if (method === 'GET' && path.length === 2 && path[1] === 'report') {
        const data = await getSmartBatch(owner, id);
        const rows: unknown[][] = [['Documento', 'Empresa', 'CNPJ', 'Destinatário', 'Revisão', 'Envio', 'Resultado de entrega', 'Data', 'Erro'],
          ...data.items.map(i => [i.fileName, i.companyName, i.companyCnpj, i.recipient, i.reviewStatus, i.sendStatus, i.deliveryStatus, i.sentAt?.toISOString(), i.error || i.deliveryError])];
        return new Response('\uFEFF' + rows.map(r => r.map(csvCell).join(';')).join('\r\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="envios-${id}.csv"`, 'cache-control': 'private, no-store' } });
      }
      if (method === 'POST' && path.length === 2 && path[1] === 'upload') {
        const limit = smartLimits(storageConfig).fileBytes;
        if (Number(request.headers.get('content-length')) > limit) throw new SmartSendError('PDF excede o limite.', 413);
        const name = decodeURIComponent(request.headers.get('x-file-name') || '');
        await uploadSmartPdf(owner, id, name, request.headers.get('content-type') || '', await boundedBytes(request.body, limit));
        return response({ ok: true }, 201);
      }
      if (path[1] === 'items' && path.length >= 3) {
        const itemId = z.string().uuid().parse(path[2]);
        if (method === 'GET' && path.length === 4 && path[3] === 'file') {
          const [item] = await db.select().from(items).where(and(ownedItems(owner, id), eq(items.id, itemId), isNull(items.removedAt), isNull(items.fileDeletedAt)));
          if (!item?.fileReady) throw new SmartSendError('PDF indisponível.', 404);
          const bytes = await smartStorage().get(item.storageKey);
          if (await contentHash(bytes) !== item.contentHash) throw new SmartSendError('Integridade do PDF inválida.', 409);
          return new Response(new Uint8Array(bytes), { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(item.fileName)}`,
            'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'; frame-ancestors 'self'" } });
        }
        if (method === 'PATCH' && path.length === 3) {
          const input = z.object({ companyId: z.number().int().positive().optional(), confirm: z.boolean().optional(), excluded: z.boolean().optional(), remove: z.boolean().optional() }).strict().parse(await json(request));
          await reviewSmartItem(owner, id, itemId, input); return response({ ok: true });
        }
        if (method === 'POST' && path.length === 4 && path[3] === 'resolve') {
          const input = z.object({ acknowledgeUncertain: z.literal(true) }).strict().parse(await json(request));
          if (input.acknowledgeUncertain) {
            const changed = await db.update(items).set({ sendStatus: 'SKIPPED', error: 'Resultado incerto encerrado manualmente sem reenvio. Consulte Enviados no Gmail.', updatedAt: new Date() })
              .where(and(ownedItems(owner, id), eq(items.id, itemId), eq(items.sendStatus, 'UNCERTAIN'))).returning({ id: items.id });
            if (!changed.length) throw new SmartSendError('Item não está incerto.', 409);
          }
          return response({ ok: true });
        }
      }
      if (method === 'POST' && path.length === 2 && path[1] === 'prepare') {
        const input = z.object({ templateId: z.number().int().positive(), includeCommon: z.boolean() }).strict().parse(await json(request));
        await prepareSmartBatch(owner, id, input.templateId, input.includeCommon); return response(await getSmartBatch(owner, id));
      }
      if (method === 'POST' && path.length === 2 && path[1] === 'control') {
        const input = z.object({ action: z.enum(['start', 'pause', 'resume', 'cancel']), revision: z.number().int().optional(), confirmed: z.boolean().optional() }).strict().parse(await json(request));
        await controlSmartBatch(owner, id, input.action, input.revision, input.confirmed); return response(await getSmartBatch(owner, id));
      }
      throw new SmartSendError('Rota não encontrada.', 404);
    });
  } catch (error) {
    const status = error instanceof SmartSendError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError || error instanceof URIError || error instanceof AttachmentError ? 400 : 503;
    return NextResponse.json({ error: error instanceof SmartSendError || error instanceof AttachmentError ? error.message : status === 400 ? 'Dados inválidos.' : 'Serviço indisponível. Verifique a configuração e tente novamente.' }, { status, headers: { 'cache-control': 'no-store' } });
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
