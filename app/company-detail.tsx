"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Calendar,
  Check,
  Clock3,
  Edit3,
  Mail,
  MessageCircle,
  MapPin,
  Phone,
  Plus,
  Star,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { formatCnpj, parseWorkforce } from "@/lib/company-size";
import { formatBrazilianPhone } from "@/lib/phone";

type Company = {
  id: number;
  name: string;
  tradeName?: string | null;
  cnpj?: string | null;
  website?: string | null;
  primaryEmail?: string | null;
  segment?: string | null;
  region?: number | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  phoneWhatsAppStatus?: "UNKNOWN" | "YES" | "NO";
  mobile?: string | null;
  mobileWhatsAppStatus?: "UNKNOWN" | "YES" | "NO";
  employeeCount?: number | null;
  employeeRange?: string | null;
  companySize?: string | null;
  notes?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};
type Contact = {
  id: number;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  isPrimary: boolean;
  createdAt: string;
};
type Activity = {
  id: number;
  type: string;
  description: string;
  createdAt: string;
};
type Detail = { company: Company; contacts: Contact[]; activities: Activity[] };
const statuses = [
  ["NOT_CONTACTED", "Não contatada"],
  ["CONTACTED", "Contatada"],
  ["WAITING_REPLY", "Aguardando resposta"],
  ["REPLIED", "Respondeu"],
  ["FOLLOW_UP", "Follow-up"],
  ["INTERESTED", "Interessada"],
  ["NOT_INTERESTED", "Sem interesse"],
  ["CLOSED", "Cliente / encerrada"],
] as const;

export function CompanyDetail({
  companyId,
  onClose,
  onChanged,
}: {
  companyId: number | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<Detail | null>(null),
    [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [editing, setEditing] = useState(false),
    [contactOpen, setContactOpen] = useState(false),
    [editingContact, setEditingContact] = useState<Contact | null>(null);
  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/companies/${companyId}`);
      if (!r.ok) throw new Error();
      setData(await r.json());
    } catch {
      toast.error("Não foi possível abrir a empresa.");
      onClose();
    } finally {
      setLoading(false);
    }
  }, [companyId, onClose]);
  useEffect(() => {
    if (companyId) {
      setData(null);
      setEditing(false);
      void load();
    }
  }, [companyId, load]);
  async function saveCompany(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!companyId) return;
    setSaving(true);
    const body = Object.fromEntries(new FormData(e.currentTarget));
    body.statusLabel =
      statuses.find((s) => s[0] === body.status)?.[1] || String(body.status);
    const r = await fetch(`/api/companies/${companyId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await r.json()) as { error?: string };
    setSaving(false);
    if (!r.ok) return toast.error(result.error || "Não foi possível salvar.");
    toast.success("Dados atualizados.");
    setEditing(false);
    await load();
    onChanged();
  }
  async function deleteContact(contact: Contact) {
    if (
      !companyId ||
      !confirm(`Remover o contato ${contact.name || contact.email}?`)
    )
      return;
    const r = await fetch(
      `/api/companies/${companyId}/contacts?contactId=${contact.id}`,
      { method: "DELETE" },
    );
    if (r.ok) {
      toast.success("Contato removido.");
      await load();
    } else toast.error("Não foi possível remover o contato.");
  }
  return (
    <Sheet
      open={companyId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        className="company-sheet sm:max-w-[820px]"
        aria-describedby="company-detail-description"
      >
        <SheetHeader className="detail-header">
          <SheetTitle>
            {loading ? "Carregando empresa…" : data?.company.name || "Empresa"}
          </SheetTitle>
          <SheetDescription id="company-detail-description">
            Dados, contatos e histórico da prospecção em um só lugar.
          </SheetDescription>
        </SheetHeader>
        {loading ? (
          <div className="detail-loading">
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        ) : data ? (
          <div className="detail-scroll">
            <div className="company-summary">
              <div className="company-logo">
                {data.company.name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <h2>{data.company.name}</h2>
                <p>{data.company.segment || "Segmento não informado"}</p>
                <div className="summary-meta">
                  {data.company.city || data.company.state ? (
                    <span>
                      <MapPin />
                      {[data.company.city, data.company.state]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  ) : null}
                  {data.company.primaryEmail ? (
                    <span>
                      <Mail />
                      {data.company.primaryEmail}
                    </span>
                  ) : null}
                </div>
              </div>
              <Button variant="outline" onClick={() => setEditing((v) => !v)}>
                <Edit3 />
                {editing ? "Cancelar edição" : "Editar"}
              </Button>
            </div>
            <Tabs defaultValue="overview">
              <TabsList variant="line" className="detail-tabs">
                <TabsTrigger value="overview">Visão geral</TabsTrigger>
                <TabsTrigger value="contacts">
                  Contatos <b>{data.contacts.length}</b>
                </TabsTrigger>
                <TabsTrigger value="activity">
                  Timeline <b>{data.activities.length}</b>
                </TabsTrigger>
              </TabsList>
              <TabsContent value="overview">
                {editing ? (
                  <CompanyForm
                    company={data.company}
                    saving={saving}
                    onSubmit={saveCompany}
                  />
                ) : (
                  <CompanyOverview company={data.company} />
                )}
              </TabsContent>
              <TabsContent value="contacts">
                <div className="section-toolbar">
                  <div>
                    <h3>Contatos da empresa</h3>
                    <p>Registre as pessoas envolvidas na negociação.</p>
                  </div>
                  <Button
                    onClick={() => {
                      setEditingContact(null);
                      setContactOpen(true);
                    }}
                  >
                    <Plus />
                    Adicionar contato
                  </Button>
                </div>
                {data.contacts.length ? (
                  <div className="contact-list">
                    {data.contacts.map((contact) => (
                      <article key={contact.id} className="contact-card">
                        <div className="contact-avatar">
                          <UserRound />
                        </div>
                        <div className="contact-main">
                          <div>
                            <strong>
                              {contact.name || "Contato sem nome"}
                            </strong>
                            {contact.isPrimary && (
                              <span className="primary-tag">
                                <Star />
                                Principal
                              </span>
                            )}
                          </div>
                          <small>{contact.role || "Cargo não informado"}</small>
                          <div className="contact-lines">
                            {contact.email && (
                              <span>
                                <Mail />
                                {contact.email}
                              </span>
                            )}
                            {contact.phone && (
                              <span>
                                <Phone />
                                {contact.phone}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="contact-actions">
                          <button
                            onClick={() => {
                              setEditingContact(contact);
                              setContactOpen(true);
                            }}
                            aria-label="Editar contato"
                          >
                            <Edit3 />
                          </button>
                          <button
                            onClick={() => deleteContact(contact)}
                            aria-label="Excluir contato"
                          >
                            <Trash2 />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="detail-empty">
                    <UserRound />
                    <h3>Nenhum contato cadastrado</h3>
                    <p>
                      Adicione quem você procura ou com quem já está
                      conversando.
                    </p>
                    <Button onClick={() => setContactOpen(true)}>
                      <Plus />
                      Adicionar primeiro contato
                    </Button>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="activity">
                <div className="section-toolbar">
                  <div>
                    <h3>Histórico da empresa</h3>
                    <p>As ações são registradas automaticamente.</p>
                  </div>
                </div>
                <ol className="timeline">
                  {data.activities.map((a, index) => (
                    <li key={a.id}>
                      <span className="timeline-dot">
                        {index === 0 ? <Check /> : <Clock3 />}
                      </span>
                      <div>
                        <strong>{a.description}</strong>
                        <small>
                          {new Date(a.createdAt).toLocaleString("pt-BR")}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
              </TabsContent>
            </Tabs>
          </div>
        ) : null}
        <ContactDialog
          open={contactOpen}
          onOpenChange={setContactOpen}
          companyId={companyId}
          contact={editingContact}
          onSaved={load}
        />
      </SheetContent>
    </Sheet>
  );
}

function CompanyOverview({ company }: { company: Company }) {
  const label =
    statuses.find((s) => s[0] === company.status)?.[1] || company.status;
  return (
    <div className="overview-grid">
      <Info label="Status" value={label} />
      <Info label="CNPJ" value={formatCnpj(company.cnpj)} />
      <Info label="Nome fantasia" value={company.name} />
      <Info label="Razão social" value={company.tradeName} />
      <Info
        label="Telefone"
        value={formatBrazilianPhone(company.phone)}
        icon={
          company.phoneWhatsAppStatus === "YES" ? (
            <MessageCircle className="confirmed-whatsapp-icon" />
          ) : undefined
        }
      />
      <Info
        label="Celular"
        value={formatBrazilianPhone(company.mobile)}
        icon={
          company.mobileWhatsAppStatus === "YES" ? (
            <MessageCircle className="confirmed-whatsapp-icon" />
          ) : undefined
        }
      />
      <Info label="E-mail" value={company.primaryEmail} />
      <Info label="Endereço" value={company.address} />
      <Info
        label="Região"
        value={company.region ? `Região ${company.region}` : null}
      />
      <Info
        label="Cidade"
        value={[company.city, company.state].filter(Boolean).join(", ")}
      />
      <Info
        label="Quadro de funcionários"
        value={
          company.employeeRange ||
          (company.employeeCount === null || company.employeeCount === undefined
            ? null
            : String(company.employeeCount))
        }
      />
      <Info label="Porte" value={company.companySize} />
      <Info label="Site" value={company.website} />
      <Info
        label="Cadastrada em"
        value={new Date(company.createdAt).toLocaleDateString("pt-BR")}
        icon={<Calendar />}
      />
      <Info
        label="Última atualização"
        value={new Date(company.updatedAt).toLocaleString("pt-BR")}
        icon={<Clock3 />}
      />
      <div className="info-card notes-card">
        <span>Observações</span>
        <p>{company.notes || "Nenhuma observação registrada."}</p>
      </div>
    </div>
  );
}
function Info({
  label,
  value,
  icon,
}: {
  label: string;
  value?: string | null;
  icon?: React.ReactNode;
}) {
  return (
    <div className="info-card">
      <span>
        {icon}
        {label}
      </span>
      <strong>{value || "Não informado"}</strong>
    </div>
  );
}
function CompanyForm({
  company,
  saving,
  onSubmit,
}: {
  company: Company;
  saving: boolean;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
}) {
  const [employeeCount, setEmployeeCount] = useState(
    company.employeeRange ||
      (company.employeeCount === null || company.employeeCount === undefined
        ? ""
        : String(company.employeeCount)),
  );
  const companySize = parseWorkforce(employeeCount).companySize;
  return (
    <form className="detail-form" onSubmit={onSubmit}>
      <div className="form-grid">
        <Field
          name="name"
          label="Nome fantasia *"
          defaultValue={company.name}
          required
        />
        <Field
          name="tradeName"
          label="Razão social"
          defaultValue={company.tradeName || ""}
        />
        <Field
          name="cnpj"
          label="CNPJ"
          inputMode="numeric"
          defaultValue={formatCnpj(company.cnpj)}
        />
        <Field
          name="primaryEmail"
          label="E-mail"
          type="email"
          defaultValue={company.primaryEmail || ""}
        />
        <Field
          name="phone"
          label="Telefone"
          defaultValue={formatBrazilianPhone(company.phone)}
        />
        <WhatsAppStatusField
          name="phoneWhatsAppStatus"
          label="WhatsApp do telefone"
          defaultValue={company.phoneWhatsAppStatus || "UNKNOWN"}
        />
        <Field
          name="mobile"
          label="Celular"
          defaultValue={formatBrazilianPhone(company.mobile)}
        />
        <WhatsAppStatusField
          name="mobileWhatsAppStatus"
          label="WhatsApp do celular"
          defaultValue={company.mobileWhatsAppStatus || "UNKNOWN"}
        />
        <Field
          name="address"
          label="Endereço"
          defaultValue={company.address || ""}
          wide
        />
        <Field
          name="region"
          label="Região"
          type="number"
          min="1"
          max="17"
          step="1"
          defaultValue={company.region || ""}
        />
        <Field name="city" label="Cidade" defaultValue={company.city || ""} />
        <Field
          name="state"
          label="Estado / UF"
          defaultValue={company.state || ""}
        />
        <Field
          name="employeeCount"
          label="Quadro de funcionários"
          value={employeeCount}
          onChange={(event) => setEmployeeCount(event.target.value)}
          placeholder="Ex.: 25 ou 3 A 9 COLABORADORES"
        />
        <div className="field">
          <Label>Porte calculado</Label>
          <div className={`size-preview ${companySize ? "defined" : ""}`}>
            <strong>{companySize || "Sem porte automático"}</strong>
            <small>
              {employeeCount && !companySize
                ? "Esta faixa não possui classificação definida."
                : "Calculado pelo quadro de funcionários."}
            </small>
          </div>
        </div>
        <Field
          name="segment"
          label="Segmento"
          defaultValue={company.segment || ""}
        />
        <Field
          name="website"
          label="Site"
          defaultValue={company.website || ""}
        />
        <div className="field wide">
          <Label>Status da prospecção</Label>
          <Select name="status" defaultValue={company.status}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statuses.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="field wide">
          <Label htmlFor="notes">Observações</Label>
          <Textarea
            id="notes"
            name="notes"
            defaultValue={company.notes || ""}
            placeholder="Contexto da negociação, preferências ou próximos passos…"
          />
        </div>
      </div>
      <div className="form-actions">
        <Button type="submit" disabled={saving}>
          {saving ? "Salvando…" : "Salvar alterações"}
        </Button>
      </div>
    </form>
  );
}

function WhatsAppStatusField({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: "UNKNOWN" | "YES" | "NO";
}) {
  return (
    <div className="field">
      <Label>{label}</Label>
      <Select name={name} defaultValue={defaultValue}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="UNKNOWN">Não verificado</SelectItem>
          <SelectItem value="YES">Possui WhatsApp</SelectItem>
          <SelectItem value="NO">Não possui</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
function Field({
  name,
  label,
  wide,
  ...props
}: { name: string; label: string; wide?: boolean } & React.ComponentProps<
  typeof Input
>) {
  return (
    <div className={`field ${wide ? "wide" : ""}`}>
      <Label htmlFor={`detail-${name}`}>{label}</Label>
      <Input id={`detail-${name}`} name={name} {...props} />
    </div>
  );
}

function ContactDialog({
  open,
  onOpenChange,
  companyId,
  contact,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: number | null;
  contact: Contact | null;
  onSaved: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!companyId) return;
    setSaving(true);
    const form = new FormData(e.currentTarget);
    const body = {
      id: contact?.id,
      name: form.get("name"),
      role: form.get("role"),
      email: form.get("email"),
      phone: form.get("phone"),
      isPrimary: form.get("isPrimary") === "on",
    };
    const r = await fetch(`/api/companies/${companyId}/contacts`, {
      method: contact ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await r.json()) as { error?: string };
    setSaving(false);
    if (!r.ok)
      return toast.error(result.error || "Não foi possível salvar o contato.");
    toast.success(contact ? "Contato atualizado." : "Contato adicionado.");
    onOpenChange(false);
    await onSaved();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="contact-form">
          <DialogHeader>
            <DialogTitle>
              {contact ? "Editar contato" : "Adicionar contato"}
            </DialogTitle>
            <DialogDescription>
              Associe uma pessoa a esta empresa e defina quem é o contato
              principal.
            </DialogDescription>
          </DialogHeader>
          <div className="form-grid">
            <Field
              name="name"
              label="Nome"
              defaultValue={contact?.name || ""}
              wide
            />
            <Field
              name="role"
              label="Cargo"
              defaultValue={contact?.role || ""}
            />
            <Field
              name="email"
              label="E-mail"
              type="email"
              defaultValue={contact?.email || ""}
            />
            <Field
              name="phone"
              label="Telefone"
              defaultValue={contact?.phone || ""}
            />
            <label className="primary-check">
              <input
                type="checkbox"
                name="isPrimary"
                defaultChecked={contact?.isPrimary}
              />
              <span>
                <strong>Contato principal</strong>
                <small>Será a primeira pessoa exibida para esta empresa.</small>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando…" : "Salvar contato"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
