import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs, companies, emailMessages, followUps } from "@/db/schema";

export async function GET(request: NextRequest) {
  const db = getDb(); const owner = "local-preview-user";
  const startToday = new Date(); startToday.setHours(3, 0, 0, 0); const endToday=new Date(startToday.getTime()+86400000-1); const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
  const [companyCounts, todayEmails, weekEmails, dueFollowUps, activities] = await Promise.all([
    db.select({ status: companies.status, total: sql<number>`count(*)` }).from(companies).where(eq(companies.ownerId, owner)).groupBy(companies.status),
    db.select({ total: sql<number>`count(*)` }).from(emailMessages).where(and(eq(emailMessages.ownerId, owner), gte(emailMessages.sentAt, sql`${startToday.getTime()}`))),
    db.select({ total: sql<number>`count(*)` }).from(emailMessages).where(and(eq(emailMessages.ownerId, owner), gte(emailMessages.sentAt, sql`${sevenDaysAgo.getTime()}`))),
    db.select({ total: sql<number>`count(*)` }).from(followUps).where(and(eq(followUps.ownerId, owner), eq(followUps.status, "PENDING"),lte(followUps.dueAt,sql`${endToday.getTime()}`))),
    db.select().from(activityLogs).where(eq(activityLogs.ownerId, owner)).orderBy(desc(activityLogs.createdAt)).limit(8),
  ]);
  const counts = Object.fromEntries(companyCounts.map((row) => [row.status, Number(row.total)])); const total = Object.values(counts).reduce((sum, value) => sum + value, 0); const replied = (counts.REPLIED || 0) + (counts.INTERESTED || 0) + (counts.NOT_INTERESTED || 0);
  return NextResponse.json({ total, notContacted: counts.NOT_CONTACTED || 0, contacted: total - (counts.NOT_CONTACTED || 0), replied, followUps: Number(dueFollowUps[0]?.total || 0), sentToday: Number(todayEmails[0]?.total || 0), sentWeek: Number(weekEmails[0]?.total || 0), responseRate: total ? Math.round((replied / total) * 100) : 0, activities });
}
