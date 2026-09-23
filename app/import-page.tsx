"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  FileUp,
  History,
  RotateCcw,
  SearchCheck,
  UploadCloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { formatCnpj, parseWorkforce } from "@/lib/company-size";

type Row = Record<string, string>;
type Target =
  | "name"
  | "tradeName"
  | "cnpj"
  | "primaryEmail"
  | "website"
  | "segment"
  | "phone"
  | "mobile"
  | "address"
  | "city"
  | "state"
  | "employeeCount"
  | "contactName"
  | "contactEmail"
  | "contactRole";
type Review = {
  index: number;
  status: "ready" | "duplicate" | "error";
  reason: string | null;
};
type HistoryItem = {
  id: number;
  fileName: string;
  totalRows: number;
  importedRows: number;
  updatedRows: number;
  skippedRows: number;
  errorRows: number;
  createdAt: string;
};
const fields: {
  key: Target;
  label: string;
  required?: boolean;
  aliases: string[];
}[] = [
  {
    key: "name",
    label: "Nome fantasia",
    required: true,
    aliases: [
      "empresa",
      "nome da empresa",
      "nome empresa",
      "nome fantasia",
      "fantasia",
      "company",
      "company name",
      "nome",
    ],
  },
  {
    key: "tradeName",
    label: "Razão social",
    aliases: ["razao social", "razão social", "nome legal", "legal name"],
  },
  {
    key: "cnpj",
    label: "CNPJ",
    aliases: ["cnpj", "documento", "cadastro nacional"],
  },
  {
    key: "primaryEmail",
    label: "E-mail principal",
    aliases: [
      "email",
      "e-mail",
      "email principal",
      "e-mail principal",
      "company email",
    ],
  },
  { key: "website", label: "Site", aliases: ["site", "website", "url"] },
  {
    key: "segment",
    label: "Segmento",
    aliases: ["segmento", "setor", "segment", "industry"],
  },
  {
    key: "phone",
    label: "Telefone",
    aliases: ["telefone", "telefone empresa", "phone"],
  },
  {
    key: "mobile",
    label: "Celular",
    aliases: ["celular", "telefone celular", "mobile", "whatsapp"],
  },
  {
    key: "address",
    label: "Endereço",
    aliases: ["endereco", "endereço", "logradouro", "address"],
  },
  { key: "city", label: "Cidade", aliases: ["cidade", "city"] },
  { key: "state", label: "Estado / UF", aliases: ["estado", "uf", "state"] },
  {
    key: "employeeCount",
    label: "Quadro de funcionários",
    aliases: [
      "quadro de funcionarios",
      "quadro de funcionários",
      "funcionarios",
      "funcionários",
      "colaboradores",
      "numero de funcionarios",
      "número de funcionários",
      "employee count",
      "employees",
    ],
  },
  {
    key: "contactName",
    label: "Nome do contato",
    aliases: [
      "contato",
      "nome contato",
      "nome do contato",
      "contact",
      "contact name",
    ],
  },
  {
    key: "contactEmail",
    label: "E-mail do contato",
    aliases: ["email contato", "e-mail contato", "contact email"],
  },
  {
    key: "contactRole",
    label: "Cargo do contato",
    aliases: ["cargo", "cargo contato", "função", "funcao", "role"],
  },
];
const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

export function ImportPage({ onImported }: { onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(1);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Row[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<Target, string>>>({});
  const [review, setReview] = useState<Review[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [strategy, setStrategy] = useState<"skip" | "update">("skip");
  const [selectedRegion, setSelectedRegion] = useState("");
  const [result, setResult] = useState<{
    total: number;
    imported: number;
    updated: number;
    skipped: number;
    errors: number;
    failedRows?: { line: number; reason: string }[];
  } | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch("/api/imports");
      if (r.ok) setHistory((await r.json()) as HistoryItem[]);
    } catch {}
  }, []);
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);
  const mappedRows = useMemo(
    () =>
      rawRows.map((row) =>
        Object.fromEntries(
          fields.map((f) => [
            f.key,
            mapping[f.key] ? row[mapping[f.key]!] || "" : "",
          ]),
        ),
      ),
    [rawRows, mapping],
  );
  const counts = useMemo(
    () => ({
      ready: review.filter((r) => r.status === "ready").length,
      duplicates: review.filter((r) => r.status === "duplicate").length,
      errors: review.filter((r) => r.status === "error").length,
    }),
    [review],
  );
  async function readFile(file: File) {
    if (!/\.(csv|xlsx|xls)$/i.test(file.name))
      return toast.error("Escolha um arquivo CSV, XLSX ou XLS.");
    try {
      const XLSX = await import("xlsx");
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(
        sheet,
        { header: 1, defval: "", raw: false },
      );
      const header = (matrix[0] || [])
        .map((v) => String(v).trim())
        .filter(Boolean);
      if (!header.length) throw new Error();
      const rows = matrix
        .slice(1)
        .filter((r) => r.some((v) => String(v).trim()))
        .map((values) =>
          Object.fromEntries(
            header.map((h, i) => [h, String(values[i] ?? "").trim()]),
          ),
        );
      if (!rows.length)
        return toast.error("A planilha não possui dados abaixo do cabeçalho.");
      if (rows.length > 1000)
        return toast.error(
          "Esta versão aceita até 1.000 linhas por importação.",
        );
      const auto: Partial<Record<Target, string>> = {};
      for (const field of fields) {
        const found = header.find((h) =>
          field.aliases.map(normalize).includes(normalize(h)),
        );
        if (found) auto[field.key] = found;
      }
      setFileName(file.name);
      setHeaders(header);
      setRawRows(rows);
      setMapping(auto);
      setReview([]);
      setSelectedRegion("");
      setResult(null);
      setStep(2);
    } catch {
      toast.error(
        "Não foi possível ler a planilha. Verifique se o arquivo não está corrompido.",
      );
    }
  }
  async function generateReview() {
    if (!mapping.name)
      return toast.error("Associe uma coluna ao campo Nome fantasia.");
    setReviewing(true);
    try {
      const r = await fetch("/api/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName, rows: mappedRows, preview: true }),
      });
      const data = (await r.json()) as { error?: string; review?: Review[] };
      if (!r.ok) throw new Error(data.error);
      setReview(data.review || []);
      setStep(3);
    } catch (e) {
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : "Não foi possível revisar a planilha.",
      );
    } finally {
      setReviewing(false);
    }
  }
  async function confirmImport() {
    if (!selectedRegion)
      return toast.error("Selecione a região desta importação.");
    setImporting(true);
    try {
      const r = await fetch("/api/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName,
          rows: mappedRows.map((row) => ({ ...row, region: selectedRegion })),
          duplicateStrategy: strategy,
        }),
      });
      const data = (await r.json()) as {
        error?: string;
        total: number;
        imported: number;
        updated: number;
        skipped: number;
        errors: number;
        failedRows?: { line: number; reason: string }[];
      };
      if (!r.ok) throw new Error(data.error);
      setResult(data);
      setStep(4);
      await loadHistory();
      onImported();
      toast.success("Importação concluída.");
    } catch (e) {
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : "Não foi possível concluir a importação.",
      );
    } finally {
      setImporting(false);
    }
  }
  function reset() {
    setStep(1);
    setFileName("");
    setHeaders([]);
    setRawRows([]);
    setMapping({});
    setReview([]);
    setSelectedRegion("");
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }
  return (
    <>
      <section className="page-intro compact">
        <div>
          <p className="eyebrow">ENTRADA DE DADOS</p>
          <h1>Importar empresas</h1>
          <p>Traga sua base de uma planilha com revisão antes de salvar.</p>
        </div>
        {step > 1 && step < 4 ? (
          <Button variant="outline" onClick={reset}>
            <RotateCcw />
            Trocar arquivo
          </Button>
        ) : null}
      </section>
      <div className="import-steps">
        {["Arquivo", "Colunas", "Revisão", "Resultado"].map((label, i) => (
          <div key={label} className={step >= i + 1 ? "active" : ""}>
            <span>{step > i + 1 ? <CheckCircle2 /> : i + 1}</span>
            <strong>{label}</strong>
          </div>
        ))}
      </div>
      {step === 1 ? (
        <UploadStep inputRef={inputRef} onFile={readFile} />
      ) : step === 2 ? (
        <MappingStep
          fileName={fileName}
          rows={rawRows.length}
          headers={headers}
          mapping={mapping}
          setMapping={setMapping}
          onBack={reset}
          onNext={generateReview}
          loading={reviewing}
        />
      ) : step === 3 ? (
        <ReviewStep
          fileName={fileName}
          rows={mappedRows}
          review={review}
          counts={counts}
          strategy={strategy}
          setStrategy={setStrategy}
          selectedRegion={selectedRegion}
          setSelectedRegion={setSelectedRegion}
          onBack={() => setStep(2)}
          onConfirm={confirmImport}
          loading={importing}
        />
      ) : result ? (
        <ResultStep result={result} reset={reset} />
      ) : null}
      <ImportHistory items={history} />
    </>
  );
}

function UploadStep({
  inputRef,
  onFile,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (f: File) => void;
}) {
  const [drag, setDrag] = useState(false);
  return (
    <section
      className={`panel upload-zone ${drag ? "dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      <div className="upload-icon">
        <UploadCloud />
      </div>
      <h2>Selecione sua planilha</h2>
      <p>Arraste o arquivo para cá ou escolha no computador.</p>
      <Button onClick={() => inputRef.current?.click()}>
        <FileUp />
        Escolher arquivo
      </Button>
      <small>Formatos aceitos: CSV, XLSX e XLS · até 1.000 linhas</small>
      <div className="sheet-tip">
        <FileSpreadsheet />
        <div>
          <strong>A primeira linha deve conter os títulos das colunas</strong>
          <span>
            Ex.: Nome Fantasia, Razão Social, CNPJ, E-mail, Cidade e Quadro de
            Funcionários.
          </span>
        </div>
      </div>
    </section>
  );
}
function MappingStep({
  fileName,
  rows,
  headers,
  mapping,
  setMapping,
  onBack,
  onNext,
  loading,
}: {
  fileName: string;
  rows: number;
  headers: string[];
  mapping: Partial<Record<Target, string>>;
  setMapping: React.Dispatch<
    React.SetStateAction<Partial<Record<Target, string>>>
  >;
  onBack: () => void;
  onNext: () => void;
  loading: boolean;
}) {
  return (
    <section className="panel import-workspace">
      <div className="import-file">
        <FileSpreadsheet />
        <div>
          <strong>{fileName}</strong>
          <span>
            {rows} linha(s) encontrada(s) · {headers.length} coluna(s)
          </span>
        </div>
      </div>
      <div className="mapping-head">
        <div>
          <h2>Associe as colunas</h2>
          <p>
            Indique qual informação da planilha corresponde a cada campo do CRM.
          </p>
        </div>
        <span>
          <i />
          Obrigatório
        </span>
      </div>
      <div className="mapping-grid">
        {fields.map((field) => (
          <div className="mapping-row" key={field.key}>
            <div>
              <strong>{field.label}</strong>
              {field.required ? (
                <small>Obrigatório</small>
              ) : (
                <small>Opcional</small>
              )}
            </div>
            <ArrowRight />
            <Select
              value={mapping[field.key] || "__ignore"}
              onValueChange={(value) =>
                setMapping((current) => ({
                  ...current,
                  [field.key]: value === "__ignore" ? undefined : value,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Não importar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ignore">Não importar</SelectItem>
                {headers.map((h) => (
                  <SelectItem key={h} value={h}>
                    {h}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
      <div className="import-actions">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft />
          Voltar
        </Button>
        <Button onClick={onNext} disabled={loading || !mapping.name}>
          {loading ? "Analisando…" : "Revisar dados"}
          <SearchCheck />
        </Button>
      </div>
    </section>
  );
}
function ReviewStep({
  fileName,
  rows,
  review,
  counts,
  strategy,
  setStrategy,
  selectedRegion,
  setSelectedRegion,
  onBack,
  onConfirm,
  loading,
}: {
  fileName: string;
  rows: Record<string, string>[];
  review: Review[];
  counts: { ready: number; duplicates: number; errors: number };
  strategy: "skip" | "update";
  setStrategy: (v: "skip" | "update") => void;
  selectedRegion: string;
  setSelectedRegion: (v: string) => void;
  onBack: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  return (
    <section className="panel import-workspace">
      <div className="review-summary">
        <article className="ready">
          <CheckCircle2 />
          <div>
            <strong>{counts.ready}</strong>
            <span>Prontas para importar</span>
          </div>
        </article>
        <article className="duplicate">
          <AlertCircle />
          <div>
            <strong>{counts.duplicates}</strong>
            <span>Duplicadas</span>
          </div>
        </article>
        <article className="error">
          <AlertCircle />
          <div>
            <strong>{counts.errors}</strong>
            <span>Com erro</span>
          </div>
        </article>
      </div>
      <div className="duplicate-choice">
        <div>
          <strong>Região desta importação *</strong>
          <span>
            Todas as empresas deste arquivo serão organizadas na região
            escolhida.
          </span>
        </div>
        <Select value={selectedRegion} onValueChange={setSelectedRegion}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione a região" />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 17 }, (_, index) => index + 1).map(
              (region) => (
                <SelectItem key={region} value={String(region)}>
                  Região {region}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>
      {counts.duplicates > 0 ? (
        <div className="duplicate-choice">
          <div>
            <strong>Como tratar empresas duplicadas?</strong>
            <span>
              A comparação prioriza o CNPJ; depois usa o e-mail e, por último, o
              nome fantasia.
            </span>
          </div>
          <Select
            value={strategy}
            onValueChange={(v) => setStrategy(v as "skip" | "update")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="skip">Ignorar duplicadas</SelectItem>
              <SelectItem value="update">Atualizar dados existentes</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="review-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Linha</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead>CNPJ</TableHead>
              <TableHead>Região</TableHead>
              <TableHead>Funcionários</TableHead>
              <TableHead>Porte</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, 100).map((row, index) => {
              const item = review.find((r) => r.index === index);
              const size = parseWorkforce(row.employeeCount).companySize;
              return (
                <TableRow key={index}>
                  <TableCell>{index + 2}</TableCell>
                  <TableCell>
                    <strong>{row.name || "—"}</strong>
                    <small className="row-reason">
                      {row.tradeName || row.primaryEmail || ""}
                    </small>
                  </TableCell>
                  <TableCell>{formatCnpj(row.cnpj) || "—"}</TableCell>
                  <TableCell>
                    {selectedRegion ? `Região ${selectedRegion}` : "—"}
                  </TableCell>
                  <TableCell>{row.employeeCount || "—"}</TableCell>
                  <TableCell>{size || "—"}</TableCell>
                  <TableCell>
                    <span className={`import-status ${item?.status}`}>
                      {item?.status === "ready"
                        ? "Pronta"
                        : item?.status === "duplicate"
                          ? "Duplicada"
                          : "Erro"}
                    </span>
                    {item?.reason ? (
                      <small className="row-reason">{item.reason}</small>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {rows.length > 100 ? (
          <p className="table-limit">
            Exibindo as primeiras 100 de {rows.length} linhas. Todas serão
            processadas.
          </p>
        ) : null}
      </div>
      <div className="import-actions">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft />
          Ajustar colunas
        </Button>
        <div>
          <span>{fileName}</span>
          <Button
            onClick={onConfirm}
            disabled={
              loading ||
              !selectedRegion ||
              counts.ready + counts.duplicates === 0
            }
          >
            {loading ? "Importando…" : "Confirmar importação"}
          </Button>
        </div>
      </div>
    </section>
  );
}
function ResultStep({
  result,
  reset,
}: {
  result: {
    total: number;
    imported: number;
    updated: number;
    skipped: number;
    errors: number;
    failedRows?: { line: number; reason: string }[];
  };
  reset: () => void;
}) {
  return (
    <section className="panel import-result">
      <div className="result-mark">
        <CheckCircle2 />
      </div>
      <h2>Importação concluída</h2>
      <p>A base foi processada e o dashboard já está atualizado.</p>
      <div className="result-grid">
        <div>
          <strong>{result.imported}</strong>
          <span>Empresas criadas</span>
        </div>
        <div>
          <strong>{result.updated}</strong>
          <span>Atualizadas</span>
        </div>
        <div>
          <strong>{result.skipped}</strong>
          <span>Ignoradas</span>
        </div>
        <div>
          <strong>{result.errors}</strong>
          <span>Com erro</span>
        </div>
      </div>
      {result.failedRows?.length ? (
        <div className="import-failures">
          <strong>Linhas que não foram importadas</strong>
          <p>
            {result.failedRows
              .slice(0, 20)
              .map((item) => `Linha ${item.line}: ${item.reason}`)
              .join(" • ")}
            {result.failedRows.length > 20
              ? ` • e mais ${result.failedRows.length - 20}`
              : ""}
          </p>
        </div>
      ) : null}
      <Button onClick={reset}>
        <FileUp />
        Importar outra planilha
      </Button>
    </section>
  );
}
function ImportHistory({ items }: { items: HistoryItem[] }) {
  return (
    <section className="panel import-history">
      <div className="panel-heading">
        <div>
          <h2>Histórico de importações</h2>
          <p>Últimos arquivos processados</p>
        </div>
        <History />
      </div>
      {items.length ? (
        <div className="history-list">
          {items.map((item) => (
            <article key={item.id}>
              <FileSpreadsheet />
              <div>
                <strong>{item.fileName}</strong>
                <span>{new Date(item.createdAt).toLocaleString("pt-BR")}</span>
              </div>
              <div>
                <strong>{item.importedRows + item.updatedRows}</strong>
                <span>incluídas ou atualizadas</span>
              </div>
              <span className={item.errorRows ? "with-errors" : "success"}>
                {item.errorRows ? `${item.errorRows} erro(s)` : "Concluída"}
              </span>
            </article>
          ))}
        </div>
      ) : (
        <div className="history-empty">Nenhuma importação realizada ainda.</div>
      )}
    </section>
  );
}
