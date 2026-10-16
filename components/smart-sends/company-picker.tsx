"use client";
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { smartJson } from '@/lib/smart-import-client';
import { reviewCompanyId } from '@/lib/smart-review-policy';
import { validRecipient } from '@/lib/smart-send-policy';
import type { ReviewCompany } from './review-state';

export function CompanyPicker({ suggestions, disabled, onChoose }: {
  suggestions: ReviewCompany[]; disabled: boolean; onChoose: (id: number) => Promise<boolean>;
}) {
  const [query, setQuery] = useState(''), [rows, setRows] = useState<ReviewCompany[]>([]), [error, setError] = useState('');
  const [completedQuery, setCompletedQuery] = useState(''), [page, setPage] = useState(0);
  useEffect(() => {
    if (!query.trim()) return;
    let active = true;
    const timer = setTimeout(() => {
      void smartJson<ReviewCompany[]>('/companies?search=' + encodeURIComponent(query.trim())).then(result => {
        if (active) { setRows(result); setCompletedQuery(query); setError(''); }
      }).catch(error => { if (active) { setError(error instanceof Error ? error.message : 'Falha na busca de empresas.'); setCompletedQuery(query); } });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);
  async function choose(value: unknown) {
    try {
      const id = reviewCompanyId(value);
      setError('');
      if (await onChoose(id)) { setQuery(''); setRows([]); setPage(0); }
    } catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível selecionar a empresa.'); }
  }
  const searching = !!query.trim(), companies = searching ? (completedQuery === query ? rows : []) : suggestions;
  const pages = Math.max(1, Math.ceil(companies.length / 10)), current = Math.min(page, pages - 1);
  return <div className="smart-company-picker">
    <label>Pesquisar empresa no cadastro<input value={query} disabled={disabled} maxLength={100} placeholder="Razão social, nome fantasia ou CNPJ" onChange={event => { setQuery(event.target.value); setRows([]); setError(''); setPage(0); }} /></label>
    {error && <p role="alert">{error}</p>}
    {searching && completedQuery !== query && <p role="status">Buscando empresas…</p>}
    <p>{searching ? 'Resultados do cadastro' : 'Empresas sugeridas pelo documento'} · {companies.length}</p>
    {!companies.length && (!searching || completedQuery === query) && <p>{searching ? 'Nenhuma empresa encontrada. Confira o nome ou CNPJ.' : 'Sem sugestões. Pesquise a empresa no cadastro.'}</p>}
    <ul aria-label={searching ? 'Resultados da pesquisa de empresas' : 'Sugestões de empresas'}>{companies.slice(current * 10, (current + 1) * 10).map(company => {
      const emailIssue = !company.primaryEmail ? 'Sem e-mail' : !validRecipient(company.primaryEmail.trim()) || company.primaryEmailStatus === 'INVALID' ? 'E-mail inválido' : null;
      return <li key={company.id}><button type="button" disabled={disabled} aria-label={`Selecionar ${company.name}, CNPJ ${company.cnpj || 'não informado'}`} onClick={() => void choose(company.id)}>
        <strong>{company.name}</strong>{company.tradeName && <small>Nome fantasia: {company.tradeName}</small>}<small>CNPJ: {company.cnpj || 'Não informado'}</small><small>Destinatário: {company.primaryEmail || 'Não informado'}</small>
        {emailIssue && <span className="smart-status">{emailIssue} · confirmação bloqueada</span>}
        <span className="smart-company-select">Selecionar empresa</span>
      </button></li>;
    })}</ul>
    {pages > 1 && <nav className="smart-import-pagination" aria-label="Paginação de empresas"><Button variant="outline" size="sm" disabled={disabled || current === 0} onClick={() => setPage(current - 1)}>Empresas anteriores</Button><span>{current + 1} / {pages}</span><Button variant="outline" size="sm" disabled={disabled || current + 1 === pages} onClick={() => setPage(current + 1)}>Próximas empresas</Button></nav>}
    {searching && companies.length === 30 && <p>Mostrando até 30 resultados. Refine a pesquisa para localizar outra empresa.</p>}
    <small>Selecionar uma empresa salva a associação e exige uma nova confirmação do destinatário.</small>
  </div>;
}
