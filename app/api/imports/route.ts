import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs, companies, contacts, importBatches } from "@/db/schema";
import {
  isValidCnpj,
  isValidEmployeeCount,
  normalizeCnpj,
  parseWorkforce,
} from "@/lib/company-size";
import { normalizeBrazilianPhone } from "@/lib/phone";
import { isValidRegion, parseRegion } from "@/lib/region";

type ImportRow = {
  name?: string;
  tradeName?: string;
  cnpj?: string;
  website?: string;
  segment?: string;
  region?: string;
  address?: string;
  city?: string;
  state?: string;
  phone?: string;
  mobile?: string;
  primaryEmail?: string;
  employeeCount?: string;
  contactName?: string;
  contactEmail?: string;
  contactRole?: string;
};
type ImportBody = {
  fileName?: string;
  duplicateStrategy?: "skip" | "update";
  preview?: boolean;
  rows?: ImportRow[];
};
const ownerId = (request: NextRequest) =>
  "local-preview-user";
const clean = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export async function GET(request: NextRequest) {
  const db = getDb();
  const owner = ownerId(request);
  return NextResponse.json(
    await db
      .select()
      .from(importBatches)
      .where(eq(importBatches.ownerId, owner))
      .orderBy(desc(importBatches.createdAt))
      .limit(20),
  );
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const owner = ownerId(request);
  const body = (await request.json()) as ImportBody;
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 1000) : [];
  if (!rows.length)
    return NextResponse.json(
      { error: "A planilha não possui linhas válidas." },
      { status: 400 },
    );
  if ((body.rows?.length || 0) > 1000)
    return NextResponse.json(
      { error: "Importe no máximo 1.000 empresas por vez." },
      { status: 400 },
    );
  if (body.preview) {
    const review = [];
    const seenCnpjs = new Map<string, number>();
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const name = clean(row.name);
      const cnpj = normalizeCnpj(row.cnpj);
      const email = clean(row.primaryEmail)?.toLowerCase() || null;
      if (!name) {
        review.push({
          index,
          status: "error",
          reason: "Nome fantasia ausente",
        });
        continue;
      }
      if (!isValidCnpj(row.cnpj)) {
        review.push({
          index,
          status: "error",
          reason: "CNPJ deve conter 14 dígitos",
        });
        continue;
      }
      if (!isValidEmployeeCount(row.employeeCount)) {
        review.push({
          index,
          status: "error",
          reason: "Quadro de funcionários inválido",
        });
        continue;
      }
      if (!isValidRegion(row.region)) {
        review.push({
          index,
          status: "error",
          reason: "Região deve estar entre 1 e 17",
        });
        continue;
      }
      if (cnpj && seenCnpjs.has(cnpj)) {
        review.push({
          index,
          status: "duplicate",
          reason: `CNPJ repetido na própria planilha (primeira ocorrência na linha ${seenCnpjs.get(cnpj)! + 2})`,
        });
        continue;
      }
      if (cnpj) seenCnpjs.set(cnpj, index);
      const existing = cnpj
        ? (
            await db
              .select({ id: companies.id, name: companies.name })
              .from(companies)
              .where(
                and(eq(companies.ownerId, owner), eq(companies.cnpj, cnpj)),
              )
              .limit(1)
          )[0]
        : email
          ? (
              await db
                .select({ id: companies.id, name: companies.name })
                .from(companies)
                .where(
                  and(
                    eq(companies.ownerId, owner),
                    eq(companies.primaryEmail, email),
                  ),
                )
                .limit(1)
            )[0]
          : (
              await db
                .select({ id: companies.id, name: companies.name })
                .from(companies)
                .where(
                  and(eq(companies.ownerId, owner), eq(companies.name, name)),
                )
                .limit(1)
            )[0];
      review.push({
        index,
        status: existing ? "duplicate" : "ready",
        reason: existing ? `Já cadastrada como ${existing.name}` : null,
      });
    }
    return NextResponse.json({
      review,
      total: rows.length,
      ready: review.filter((r) => r.status === "ready").length,
      duplicates: review.filter((r) => r.status === "duplicate").length,
      errors: review.filter((r) => r.status === "error").length,
    });
  }
  const strategy = body.duplicateStrategy === "update" ? "update" : "skip";
  let imported = 0,
    updated = 0,
    skipped = 0,
    errors = 0;
  const failedRows: { line: number; reason: string }[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const name = clean(row.name);
    const cnpj = normalizeCnpj(row.cnpj);
    const email = clean(row.primaryEmail)?.toLowerCase() || null;
    if (
      !name ||
      !isValidCnpj(row.cnpj) ||
      !isValidEmployeeCount(row.employeeCount) ||
      !isValidRegion(row.region)
    ) {
      errors++;
      failedRows.push({
        line: rowIndex + 2,
        reason: "Dados obrigatórios ou formato inválido",
      });
      continue;
    }
    try {
      const existing = cnpj
        ? (
            await db
              .select()
              .from(companies)
              .where(
                and(eq(companies.ownerId, owner), eq(companies.cnpj, cnpj)),
              )
              .limit(1)
          )[0]
        : email
          ? (
              await db
                .select()
                .from(companies)
                .where(
                  and(
                    eq(companies.ownerId, owner),
                    eq(companies.primaryEmail, email),
                  ),
                )
                .limit(1)
            )[0]
          : (
              await db
                .select()
                .from(companies)
                .where(
                  and(eq(companies.ownerId, owner), eq(companies.name, name)),
                )
                .limit(1)
            )[0];
      if (existing && strategy === "skip") {
        skipped++;
        continue;
      }
      const now = new Date();
      const hasEmployeeCount = clean(row.employeeCount) !== null;
      const workforce = parseWorkforce(row.employeeCount);
      if (existing) {
        await db
          .update(companies)
          .set({
            name,
            tradeName: clean(row.tradeName) ?? existing.tradeName,
            cnpj: cnpj ?? existing.cnpj,
            website: clean(row.website) ?? existing.website,
            segment: clean(row.segment) ?? existing.segment,
            region: clean(row.region)
              ? parseRegion(row.region)
              : existing.region,
            address: clean(row.address) ?? existing.address,
            city: clean(row.city) ?? existing.city,
            state: clean(row.state)?.toUpperCase() ?? existing.state,
            phone: clean(row.phone)
              ? normalizeBrazilianPhone(row.phone)
              : existing.phone,
            phoneWhatsAppStatus: clean(row.phone)
              ? "UNKNOWN"
              : existing.phoneWhatsAppStatus,
            mobile: clean(row.mobile)
              ? normalizeBrazilianPhone(row.mobile)
              : existing.mobile,
            mobileWhatsAppStatus: clean(row.mobile)
              ? "UNKNOWN"
              : existing.mobileWhatsAppStatus,
            primaryEmail: email ?? existing.primaryEmail,
            employeeCount: hasEmployeeCount
              ? workforce.employeeCount
              : existing.employeeCount,
            employeeRange: hasEmployeeCount
              ? workforce.employeeRange
              : existing.employeeRange,
            companySize: hasEmployeeCount
              ? workforce.companySize
              : existing.companySize,
            updatedAt: now,
          })
          .where(
            and(eq(companies.id, existing.id), eq(companies.ownerId, owner)),
          );
        updated++;
      } else {
        const [company] = await db
          .insert(companies)
          .values({
            ownerId: owner,
            name,
            tradeName: clean(row.tradeName),
            cnpj,
            website: clean(row.website),
            segment: clean(row.segment),
            region: parseRegion(row.region),
            address: clean(row.address),
            city: clean(row.city),
            state: clean(row.state)?.toUpperCase() || null,
            phone: normalizeBrazilianPhone(row.phone),
            mobile: normalizeBrazilianPhone(row.mobile),
            primaryEmail: email,
            employeeCount: workforce.employeeCount,
            employeeRange: workforce.employeeRange,
            companySize: workforce.companySize,
            status: "NOT_CONTACTED",
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        imported++;
        if (clean(row.contactName) || clean(row.contactEmail)) {
          try {
            await db.insert(contacts).values({
              companyId: company.id,
              name: clean(row.contactName),
              email: clean(row.contactEmail)?.toLowerCase() || null,
              role: clean(row.contactRole),
              isPrimary: true,
              createdAt: now,
            });
          } catch {
            // A empresa continua válida mesmo se o contato opcional falhar.
          }
        }
      }
    } catch (error) {
      errors++;
      failedRows.push({
        line: rowIndex + 2,
        reason: String(error).includes("UNIQUE")
          ? "CNPJ duplicado"
          : "Não foi possível salvar esta linha",
      });
    }
  }
  const now = new Date();
  const [batch] = await db
    .insert(importBatches)
    .values({
      ownerId: owner,
      fileName: clean(body.fileName) || "planilha",
      totalRows: rows.length,
      importedRows: imported,
      updatedRows: updated,
      skippedRows: skipped,
      errorRows: errors,
      createdAt: now,
    })
    .returning();
  await db.insert(activityLogs).values({
    ownerId: owner,
    companyId: null,
    type: "IMPORT_COMPLETED",
    description: `Importação concluída: ${imported} criada(s), ${updated} atualizada(s)`,
    createdAt: now,
  });
  return NextResponse.json(
    {
      id: batch.id,
      total: rows.length,
      imported,
      updated,
      skipped,
      errors,
      failedRows,
    },
    { status: 201 },
  );
}
