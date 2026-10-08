export type MatchCompany = { id: number; name: string; tradeName: string | null; cnpj: string | null };
export function validCnpj(value: string) {
  const digits = value.replace(/\D/g, '');
  if (!/^\d{14}$/.test(digits) || /^(\d)\1+$/.test(digits)) return false;
  const check = (size: number) => {
    let sum = 0, weight = size - 7;
    for (let i = 0; i < size; i++) { sum += Number(digits[i]) * weight; weight = weight === 2 ? 9 : weight - 1; }
    return (sum % 11 < 2 ? 0 : 11 - sum % 11) === Number(digits[size]);
  };
  return check(12) && check(13);
}
export function extractCnpjs(text: string) {
  const found = new Map<string, { cnpj: string; context: boolean }>();
  for (const match of text.matchAll(/(?<!\d)\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}(?!\d)/g)) {
    const cnpj = match[0].replace(/\D/g, '');
    if (!validCnpj(cnpj)) continue;
    const prefix = normalizeName(text.slice(Math.max(0, match.index! - 100), match.index));
    const context = /destinatari|contratante|cnpj da empresa|identificacao do estabelecimento|razao social/.test(prefix);
    found.set(cnpj, { cnpj, context: context || !!found.get(cnpj)?.context });
  }
  return [...found.values()];
}
export const normalizeName = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\.pdf$/i, '').replace(/[^a-z0-9]+/g, ' ').trim();
export function matchPdfCompany(text: string, filename: string, companies: MatchCompany[]) {
  const cnpjs = extractCnpjs(text);
  if (cnpjs.length) {
    const candidates = companies.filter(c => cnpjs.some(n => n.cnpj === c.cnpj?.replace(/\D/g, '')));
    // Context ranks suggestions only. Multiple tax IDs always require human review.
    candidates.sort((a, b) => Number(cnpjs.find(n => n.cnpj === b.cnpj?.replace(/\D/g, ''))?.context) - Number(cnpjs.find(n => n.cnpj === a.cnpj?.replace(/\D/g, ''))?.context));
    return { cnpjs: cnpjs.map(c => c.cnpj), candidates: candidates.map(c => c.id), companyId: cnpjs.length === 1 && candidates.length === 1 ? candidates[0].id : null,
      method: 'CNPJ', status: candidates.length === 0 ? 'COMPANY_NOT_FOUND' : cnpjs.length === 1 && candidates.length === 1 ? 'IDENTIFIED' : 'REVIEW_REQUIRED' };
  }
  const name = normalizeName(filename), tokens = new Set(name.split(' ').filter(t => t.length > 2));
  const candidates = companies.filter(company => [company.name, company.tradeName].some(value => {
    if (!value) return false;
    const normalized = normalizeName(value), words = normalized.split(' ').filter(t => t.length > 2);
    return normalized === name || (words.length > 0 && words.filter(t => tokens.has(t)).length / words.length >= 0.6);
  })).slice(0, 10);
  return { cnpjs: [], candidates: candidates.map(c => c.id), companyId: null, method: candidates.length ? 'FILENAME' : 'MANUAL', status: 'REVIEW_REQUIRED' };
}
