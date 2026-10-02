import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { companies, contacts, emailCampaignRecipients, emailCampaigns } from "@/db/schema";
import { loadSendAttachments } from "@/lib/attachment-service";
import { audienceKnownInvalid, audienceRecipient, primaryContactId } from "@/lib/campaign-audience";

const ownerId = () => "local-preview-user";

type Audience = {
  region?: number;
  city?: string;
  companySize?: string;
  companyStatus?: string;
  groupIds?: number[];
};

export async function POST(...[, context]: [NextRequest, { params: Promise<{ id: string }> }]) {
  const db = getDb();
  const owner = ownerId();
  const { id: rawId } = await context.params;
  const campaignId = Number(rawId);
  if (!Number.isInteger(campaignId)) return NextResponse.json({ error: "Campanha inválida." }, { status: 400 });

  const [campaign] = await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, campaignId), eq(emailCampaigns.ownerId, owner))).limit(1);
  if (!campaign) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });
  if (!['DRAFT', 'READY'].includes(campaign.status)) return NextResponse.json({ error: "O público não pode ser alterado depois que a campanha iniciou." }, { status: 409 });
  if (!campaign.templateId) return NextResponse.json({ error: "O template da campanha não está mais disponível." }, { status: 409 });

  try {
    await loadSendAttachments(owner, undefined, campaign.templateId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? `Não foi possível validar os anexos do template: ${error.message}` : "Não foi possível validar os anexos do template." }, { status: 409 });
  }

  const audience = (campaign.audience || {}) as Audience;
  const condition = and(
    eq(companies.ownerId, owner),
    Number.isInteger(audience.region) ? eq(companies.region, Number(audience.region)) : undefined,
    audience.city ? eq(companies.city, audience.city) : undefined,
    audience.companySize ? eq(companies.companySize, audience.companySize) : undefined,
    audience.companyStatus ? eq(companies.status, audience.companyStatus) : undefined,
  );

  // groupIds será incorporado quando o modelo de grupos/associadas existir.
  // Até lá, não aceitamos silenciosamente um filtro que não conseguiríamos cumprir.
  if (audience.groupIds?.length) return NextResponse.json({ error: "Filtro por grupos ainda não está disponível." }, { status: 400 });

  const rows = await db
    .select({
      companyId: companies.id,
      companyName: companies.name,
      companyEmail: companies.primaryEmail,
      recipient: audienceRecipient,
      knownInvalid: audienceKnownInvalid,
      contactId: contacts.id,
      contactName: contacts.name,
      contactEmail: contacts.email,
    })
    .from(companies)
    .leftJoin(contacts, and(eq(contacts.companyId, companies.id), eq(contacts.id, primaryContactId)))
    .where(condition);

  const now = new Date();
  const recipients = rows.flatMap((row) => {
    const recipient = row.recipient;
    if (!recipient || row.knownInvalid) return [];
    return [{
      campaignId,
      companyId: row.companyId,
      contactId: row.contactId || null,
      recipient,
      companyName: row.companyName,
      personalization: {
        empresa: row.companyName,
        contato: row.contactName || "",
      },
      status: "PENDING",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    }];
  });
  const withoutEmail = rows.filter(row => !row.recipient).length;
  const invalidEmail = rows.filter(row => row.recipient && row.knownInvalid).length;

  const prepared = await db.transaction(async (tx) => {
    const [current] = await tx.select({ status: emailCampaigns.status }).from(emailCampaigns)
      .where(and(eq(emailCampaigns.id, campaignId), eq(emailCampaigns.ownerId, owner))).for("update");
    if (!current || !["DRAFT", "READY"].includes(current.status)) return false;
    await tx.delete(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, campaignId));
    // Inserts em blocos evitam uma query com milhares de parâmetros para bases grandes.
    for (let offset = 0; offset < recipients.length; offset += 250) {
      await tx.insert(emailCampaignRecipients).values(recipients.slice(offset, offset + 250));
    }
    await tx.update(emailCampaigns).set({
      status: "READY",
      total: rows.length,
      pending: recipients.length,
      sent: 0,
      failed: 0,
      skipped: rows.length - recipients.length,
      audienceWithoutEmail: withoutEmail,
      audienceInvalidEmail: invalidEmail,
      updatedAt: now,
    }).where(and(eq(emailCampaigns.id, campaignId), eq(emailCampaigns.ownerId, owner)));
    return true;
  });
  if (!prepared) return NextResponse.json({ error: "A campanha mudou de estado durante a preparação. Atualize a tela." }, { status: 409 });

  return NextResponse.json({
    campaignId,
    total: rows.length,
    eligible: recipients.length,
    pending: recipients.length,
    skipped: rows.length - recipients.length,
    withoutEmail,
    invalidEmail,
    status: "READY",
  });
}
