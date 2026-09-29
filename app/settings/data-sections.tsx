import { CalendarClock, Database, Download, FileUp, Shield, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsSection, StatList, formatDate } from "./shared";
import type { SettingsDestination, SettingsSummary } from "./types";

type Navigate = { navigate: (view: SettingsDestination) => void };
export function FollowUpSettings({ navigate }: Navigate) {
  return <SettingsSection icon={CalendarClock} title="Acompanhamentos manuais" description="Defina a empresa, a data e as anotações de cada follow-up.">
    <p>Os acompanhamentos são criados no módulo de follow-ups. Você pode concluir, reabrir ou excluir um acompanhamento e consultar o próximo prazo na empresa.</p>
    <p className="preferences-note">O CRM não cria follow-ups após os envios nem envia lembretes automáticos nesta versão.</p>
    <Button variant="outline" onClick={() => navigate("followups")}><CalendarClock />Gerenciar follow-ups</Button>
  </SettingsSection>;
}
export function FollowUpSummary({ summary }: { summary: SettingsSummary }) {
  const data = summary.followups;
  return <SettingsSection icon={CalendarClock} title="Resumo de follow-ups" description="Os vencidos estão incluídos nos pendentes.">
    <StatList items={[["Total", data.total], ["Pendentes", data.pending], ["Vencidos", data.overdue], ["Concluídos", data.completed]]} />
    {!data.total && <p>Nenhum acompanhamento cadastrado ainda.</p>}
    <small>Atualizado em {formatDate(summary.updatedAt)}</small>
  </SettingsSection>;
}
export function DataSettings({ summary, navigate }: { summary: SettingsSummary } & Navigate) {
  return <>
    <SettingsSection icon={Database} title="Resumo dos dados" description="Informações armazenadas neste CRM.">
      <div className="preferences-data-totals">{([["Empresas", summary.companies], ["Contatos", summary.contacts], ["E-mails enviados", summary.sent], ["Follow-ups", summary.followups.total]] as const).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value.toLocaleString("pt-BR")}</strong></div>)}</div>
    </SettingsSection>
    <SettingsSection icon={FileUp} title="Últimas importações" description="As cinco importações mais recentes e seus resultados registrados.">
      <Button variant="outline" onClick={() => navigate("imports")}><FileUp />Ir para Importações</Button>
      {summary.imports.length ? <div className="preferences-table" role="region" aria-label="Histórico de importações, role horizontalmente para ver todas as colunas" tabIndex={0}><table><caption className="sr-only">Últimas cinco importações</caption><thead><tr>{["Data", "Arquivo", "Processadas", "Importadas", "Atualizadas", "Ignoradas", "Erros"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{summary.imports.map(item => <tr key={item.id}><td>{formatDate(item.createdAt, summary.timezone)}</td><th scope="row">{item.fileName}</th><td>{item.totalRows}</td><td>{item.importedRows}</td><td>{item.updatedRows}</td><td>{item.skippedRows}</td><td>{item.errorRows}</td></tr>)}</tbody></table></div> : <div className="preferences-empty"><FileUp /><h3>Nenhuma importação registrada</h3><p>Importe uma planilha no módulo de Importações para começar.</p></div>}
    </SettingsSection>
    <SettingsSection icon={Download} title="Exportar empresas" description="Utilize a exportação Excel já disponível na listagem de empresas.">
      <p>Na seção Empresas, aplique os filtros desejados e selecione Exportar para baixar os resultados.</p>
      <Button variant="outline" onClick={() => navigate("companies")}><Download />Ir para exportação de empresas</Button>
    </SettingsSection>
  </>;
}
export function SecuritySettings() {
  return <>
    <SettingsSection icon={Shield} title="Acesso ao CRM" description="Modo de acesso desta instalação.">
      <span className="preferences-badge warning">Usuário local compartilhado</span>
      <p>Esta versão utiliza um usuário local fixo e não possui autenticação individual no aplicativo. Quem tem acesso à instalação utiliza o mesmo espaço de dados.</p>
      <p>Não há senha de conta, rastreamento de sessões, registro de logins ou autenticação em duas etapas disponíveis para gerenciar aqui.</p>
    </SettingsSection>
    <SettingsSection icon={KeyRound} title="Autorização do Gmail" description="A conexão de envio é independente do acesso ao CRM.">
      <p>O Google autoriza o envio por OAuth. O token de renovação é armazenado de forma criptografada. Conectar o Gmail não cria uma sessão de login no CRM.</p>
      <p>Você pode remover a conexão na aba Gmail. A remoção elimina a credencial armazenada no CRM; as permissões também podem ser revogadas na sua conta Google.</p>
    </SettingsSection>
  </>;
}
