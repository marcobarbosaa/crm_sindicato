import { NextResponse } from "next/server";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { companies, contacts, crmSettings, emailMessages, followUps, importBatches } from "@/db/schema";
import { sendingDayWindow } from "@/lib/settings";

export async function GET() {
  const db = getDb(), owner = "local-preview-user";
  const [settings] = await db.select().from(crmSettings).where(eq(crmSettings.ownerId, owner)).limit(1);
  const { start, next } = sendingDayWindow(settings?.timezone);
  const [companyCount, contactCount, messages, today, follows, imports] = await Promise.all([
    db.select({ total: sql<number>`count(*)` }).from(companies).where(eq(companies.ownerId, owner)),
    db.select({ total: sql<number>`count(*)` }).from(contacts).innerJoin(companies, eq(contacts.companyId, companies.id)).where(eq(companies.ownerId, owner)),
    db.select({ status: emailMessages.status, total: sql<number>`count(*)` }).from(emailMessages).where(eq(emailMessages.ownerId, owner)).groupBy(emailMessages.status),
    db.select({ total: sql<number>`count(*)` }).from(emailMessages).where(and(eq(emailMessages.ownerId, owner), eq(emailMessages.status, "SENT"), gte(emailMessages.sentAt, start), lt(emailMessages.sentAt, next))),
    db.select({
      total: sql<number>`count(*)`,
      pending: sql<number>`count(*) filter (where ${followUps.status} = 'PENDING')`,
      overdue: sql<number>`count(*) filter (where ${followUps.status} = 'PENDING' and ${followUps.dueAt} < ${Date.now()})`,
      completed: sql<number>`count(*) filter (where ${followUps.status} = 'COMPLETED')`,
    }).from(followUps).where(eq(followUps.ownerId, owner)),
    db.select().from(importBatches).where(eq(importBatches.ownerId, owner)).orderBy(desc(importBatches.createdAt)).limit(5),
  ]);
  const counts = Object.fromEntries(messages.map(row => [row.status, Number(row.total)]));
  return NextResponse.json({
    companies: Number(companyCount[0].total), contacts: Number(contactCount[0].total),
    sent: counts.SENT || 0, failed: counts.FAILED || 0, sentToday: Number(today[0].total),
    followups: Object.fromEntries(Object.entries(follows[0]).map(([key, value]) => [key, Number(value)])),
    imports, timezone: settings?.timezone || "America/Sao_Paulo", dailySendLimit: settings?.dailySendLimit || 100,
    updatedAt: new Date().toISOString(),
  });
}
