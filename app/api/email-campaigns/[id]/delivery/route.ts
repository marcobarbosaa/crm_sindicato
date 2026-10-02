import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { getDb, withCampaignDb } from "@/db";
import { companies, emailAccounts, emailCampaignRecipients, emailCampaigns, gmailDeliverySyncState } from "@/db/schema";
import { csvCell, deliveryLabels, safeDiagnostic } from "@/lib/delivery-policy";
import { hasDeliveryScope } from "@/lib/gmail";

const CATEGORIES = ["ADDRESS_NOT_FOUND", "DOMAIN_NOT_FOUND", "MAILBOX_FULL", "MESSAGE_REJECTED", "SPAM_REJECTED", "TEMPORARY_SERVER_FAILURE", "POLICY_REJECTION", "UNKNOWN"];
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const id = Number((await context.params).id), owner = "local-preview-user";
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Campanha inválida." }, { status: 400 });
  return withCampaignDb(async () => {
    const db = getDb(), params = request.nextUrl.searchParams;
    const [campaign] = await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.ownerId, owner))).limit(1);
    if (!campaign) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });
    const category = params.get("category"), after = Number(params.get("after") || 0), csv = params.get("format") === "csv";
    if ((category && !CATEGORIES.includes(category)) || !Number.isSafeInteger(after) || after < 0) return NextResponse.json({ error: "Filtro inválido." }, { status: 400 });
    const ownedRecipients = and(eq(emailCampaignRecipients.campaignId, id), eq(emailCampaignRecipients.status, "SENT"),
      sql`exists (select 1 from ${emailCampaigns} where ${emailCampaigns.id} = ${id} and ${emailCampaigns.ownerId} = ${owner})`);
    const limit = csv ? 1000 : 50;
    const rows = await db.select({ id: emailCampaignRecipients.id, companyName: emailCampaignRecipients.companyName,
      cnpj: companies.cnpj, region: companies.region, city: companies.city, recipient: emailCampaignRecipients.recipient,
      deliveryStatus: emailCampaignRecipients.deliveryStatus, category: emailCampaignRecipients.deliveryFailureCategory,
      smtpStatus: emailCampaignRecipients.deliveryDiagnosticCode, diagnostic: emailCampaignRecipients.deliveryErrorMessage,
      sentAt: emailCampaignRecipients.sentAt, bouncedAt: emailCampaignRecipients.bouncedAt,
    }).from(emailCampaignRecipients).leftJoin(companies, and(eq(companies.id, emailCampaignRecipients.companyId), eq(companies.ownerId, owner)))
      .where(and(ownedRecipients, category ? eq(emailCampaignRecipients.deliveryFailureCategory, category) : undefined, gt(emailCampaignRecipients.id, after)))
      .orderBy(asc(emailCampaignRecipients.id)).limit(limit + 1);
    const hasMore = rows.length > limit, items = rows.slice(0, limit).map(row => ({ ...row, diagnostic: safeDiagnostic(row.diagnostic || "") }));
    const nextCursor = hasMore ? items.at(-1)!.id : null;
    if (csv) {
      const header = ["Empresa", "CNPJ", "Região", "Cidade", "E-mail", "Status de entrega", "Categoria", "Código SMTP", "Motivo", "Data do envio", "Data do bounce"];
      const content = [header, ...items.map(row => [row.companyName, row.cnpj, row.region, row.city, row.recipient,
        deliveryLabels[row.deliveryStatus] || row.deliveryStatus, deliveryLabels[row.category || ""] || row.category,
        row.smtpStatus, row.diagnostic, row.sentAt?.toISOString(), row.bouncedAt?.toISOString()])].map(row => row.map(csvCell).join(";")).join("\r\n");
      return new Response("\uFEFF" + content, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="campanha-${id}-entrega.csv"`,
        "Cache-Control": "no-store", "X-Next-Cursor": nextCursor === null ? "" : String(nextCursor) } });
    }
    const [counts, [sync], [account]] = await Promise.all([
      db.select({ status: emailCampaignRecipients.deliveryStatus, category: emailCampaignRecipients.deliveryFailureCategory, total: sql<number>`count(*)` })
        .from(emailCampaignRecipients).where(ownedRecipients).groupBy(emailCampaignRecipients.deliveryStatus, emailCampaignRecipients.deliveryFailureCategory),
      db.select({ lastError: gmailDeliverySyncState.lastError, lastCheckedAt: gmailDeliverySyncState.lastCheckedAt }).from(gmailDeliverySyncState)
        .where(and(eq(gmailDeliverySyncState.campaignId, id), eq(gmailDeliverySyncState.ownerId, owner))).limit(1),
      db.select({ scopes: emailAccounts.scopes, needsReconnect: emailAccounts.needsReconnect }).from(emailAccounts)
        .where(and(eq(emailAccounts.ownerId, owner), eq(emailAccounts.provider, "GMAIL"))).limit(1),
    ]);
    const sum = (predicate: (row: typeof counts[number]) => boolean) => counts.filter(predicate).reduce((total, row) => total + Number(row.total), 0);
    return NextResponse.json({ items, nextCursor, summary: {
      sent: sum(() => true), pending: sum(row => row.status === "PENDING"), noKnownFailure: sum(row => row.status === "NO_KNOWN_FAILURE"),
      addressNotFound: sum(row => row.category === "ADDRESS_NOT_FOUND"), domainNotFound: sum(row => row.category === "DOMAIN_NOT_FOUND"),
      mailboxFull: sum(row => row.status === "MAILBOX_FULL"), blocked: sum(row => row.status === "BLOCKED"),
      temporary: sum(row => row.status === "TEMPORARY_FAILURE"), unknown: sum(row => row.status === "UNKNOWN_FAILURE"),
    }, enabled: campaign.deliveryMonitoringEnabled, completedAt: campaign.deliveryCompletedAt, checkedAt: campaign.deliveryCheckedAt,
    needsReconnect: !account || account.needsReconnect || !hasDeliveryScope(account.scopes), syncError: sync?.lastError || null,
    }, { headers: { "Cache-Control": "no-store" } });
  });
}
