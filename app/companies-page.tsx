"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ExcelJS from "exceljs";
import { Building2, Download, FileUp, Mail, MessageCircle, MoreHorizontal, Plus, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { formatCnpj } from "@/lib/company-size";
import { formatBrazilianPhone } from "@/lib/phone";

type Company = { id:number; name:string; tradeName?:string; cnpj?:string; primaryEmail?:string; primaryEmailStatus?:string; segment?:string; region?:number|null; city?:string; state?:string; phone?:string; phoneWhatsAppStatus?:"UNKNOWN"|"YES"|"NO"; mobile?:string; mobileWhatsAppStatus?:"UNKNOWN"|"YES"|"NO"; companySize?:string|null; status:string };
type PageResponse = { items:Company[]; page:number; pageSize:number; total:number; totalPages:number; cities:string[] };
type Filter = "all"|"with"|"without"|"invalid";
const statusLabel:Record<string,string>={NOT_CONTACTED:"Não contatada",CONTACTED:"Contatada",WAITING_REPLY:"Aguardando resposta",REPLIED:"Respondeu",FOLLOW_UP:"Follow-up",INTERESTED:"Interessada",NOT_INTERESTED:"Não interessada",CLOSED:"Encerrada"};
const statusClass:Record<string,string>={NOT_CONTACTED:"neutral",CONTACTED:"blue",WAITING_REPLY:"amber",REPLIED:"violet",FOLLOW_UP:"orange",INTERESTED:"green",NOT_INTERESTED:"red",CLOSED:"slate"};

export function CompaniesPage({refreshKey=0,onAdd,onOpen,onImport,onRemove}:{refreshKey?:number;onAdd:()=>void;onOpen:(id:number)=>void;onImport:()=>void;onRemove:(id:number,n:string)=>Promise<void>|void}){
 const [search,setSearch]=useState(""),[debouncedSearch,setDebouncedSearch]=useState("");
 const [region,setRegion]=useState("all"),[city,setCity]=useState("all"),[email,setEmail]=useState<Filter>("all"),[phone,setPhone]=useState<Filter>("all"),[mobile,setMobile]=useState<Filter>("all"),[companySize,setCompanySize]=useState("all"),[pagination,setPagination]=useState({page:1,query:""});
 const [data,setData]=useState<PageResponse>({items:[],page:1,pageSize:50,total:0,totalPages:1,cities:[]}),[loading,setLoading]=useState(true),[exporting,setExporting]=useState(false),[error,setError]=useState(false),[retry,setRetry]=useState(0);
 const request=useRef(0);
 useEffect(()=>{const timer=setTimeout(()=>setDebouncedSearch(search.trim()),300);return()=>clearTimeout(timer)},[search]);
 const params=useCallback((targetPage:number,pageSize=50)=>{const p=new URLSearchParams({mode:"page",page:String(targetPage),pageSize:String(pageSize)});if(debouncedSearch)p.set("search",debouncedSearch);if(region!=="all")p.set("region",region);if(city!=="all")p.set("city",city);if(email!=="all")p.set("email",email);if(phone!=="all")p.set("phone",phone);if(mobile!=="all")p.set("mobile",mobile);if(companySize!=="all")p.set("companySize",companySize);return p},[debouncedSearch,region,city,email,phone,mobile,companySize]);
 // A filter change requests page 1 immediately, without first fetching the old page.
 const query=params(1).toString();
 if(pagination.query!==query)setPagination({page:1,query});
 const page=pagination.query===query?pagination.page:1;
 useEffect(()=>{
  const id=++request.current;
  const controller=new AbortController();
  // Show loading while synchronizing the current query with the server.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  setLoading(true);
  setError(false);
  async function load(){
   try{
    const r=await fetch(`/api/companies?${params(page)}`,{signal:controller.signal});
    if(!r.ok)throw new Error();
    const next=await r.json() as PageResponse;
    if(!controller.signal.aborted&&id===request.current)setData(next);
   }catch{
    if(!controller.signal.aborted&&id===request.current){setError(true);toast.error("N\u00e3o foi poss\u00edvel carregar as empresas.")}
   }finally{
    if(!controller.signal.aborted&&id===request.current)setLoading(false);
   }
  }
  void load();
  return()=>controller.abort();
 },[page,params,refreshKey,retry]);
 const active=Boolean(search||region!=="all"||city!=="all"||email!=="all"||phone!=="all"||mobile!=="all"||companySize!=="all");
 function clear(){setSearch("");setDebouncedSearch("");setRegion("all");setCity("all");setEmail("all");setPhone("all");setMobile("all");setCompanySize("all");setPagination({page:1,query:""})}
 async function exportAll(){setExporting(true);try{const first=await fetch(`/api/companies?${params(1,100)}`);if(!first.ok)throw new Error();const initial=await first.json() as PageResponse;const rows=[...initial.items];for(let p=2;p<=initial.totalPages;p++){const r=await fetch(`/api/companies?${params(p,100)}`);if(!r.ok)throw new Error();rows.push(...((await r.json() as PageResponse).items))}const mapped=rows.map(c=>({Nome:c.name,"Nome fantasia":c.tradeName||"",CNPJ:c.cnpj||"",Email:c.primaryEmail||"",Telefone:c.phone||"",Celular:c.mobile||"",Cidade:c.city||"",Estado:c.state||"",Região:c.region?`Região ${c.region}`:"",Porte:c.companySize||"",Segmento:c.segment||""}));const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet("Empresas filtradas",{views:[{state:"frozen",ySplit:1}]});const columns=Object.keys(mapped[0]??{});if(columns.length)ws.addTable({name:"EmpresasFiltradas",ref:"A1",headerRow:true,style:{theme:"TableStyleMedium2",showRowStripes:true},columns:columns.map(name=>({name,filterButton:true})),rows:mapped.map(row=>Object.values(row))});ws.columns=[{width:36},{width:34},{width:18},{width:30},{width:18},{width:18},{width:22},{width:12},{width:14},{width:14},{width:28}];const content=await wb.xlsx.writeBuffer();const url=URL.createObjectURL(new Blob([content],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));const a=document.createElement("a");a.href=url;a.download=`empresas-filtradas-${Date.now()}.xlsx`;a.click();URL.revokeObjectURL(url)}catch{toast.error("Não foi possível exportar as empresas filtradas.")}finally{setExporting(false)}}
 return <div className="companies-page">
  <section className="companies-intro">
   <div><h1>Empresas</h1><p>Gerencie sua base de empresas, contatos e próximos passos.</p></div>
   <div className="companies-intro-actions"><Button variant="outline" onClick={onImport}><FileUp/>Importar</Button><Button onClick={onAdd}><Plus/>Nova empresa</Button></div>
  </section>
  <section className="companies-filters" aria-label="Pesquisa e filtros de empresas">
   <div className="companies-search-row">
    <div className="companies-search"><Search aria-hidden="true"/><Input aria-label="Buscar empresas" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por nome, CNPJ, e-mail ou segmento"/></div>
    <Button variant="outline" onClick={exportAll} disabled={!data.total||exporting||loading||error||search.trim()!==debouncedSearch}><Download/>{exporting?"Exportando…":"Exportar"}</Button>
   </div>
   <div className="companies-main-filters">
    <div className="companies-filter" data-active={region!=="all"}><span>Região</span><Select value={region} onValueChange={v=>{setRegion(v);setCity("all")}}><SelectTrigger className="filter-select" aria-label="Região"><SelectValue placeholder="Todas as regiões"/></SelectTrigger><SelectContent><SelectItem value="all">Todas as regiões</SelectItem>{Array.from({length:17},(_,i)=>i+1).map(v=><SelectItem key={v} value={String(v)}>Região {v}</SelectItem>)}</SelectContent></Select></div>
    <div className="companies-filter" data-active={city!=="all"}><span>Cidade</span><Select value={city} onValueChange={setCity} disabled={region==="all"||loading||error}><SelectTrigger className="filter-select" aria-label="Cidade"><SelectValue placeholder="Todas as cidades"/></SelectTrigger><SelectContent><SelectItem value="all">Todas as cidades</SelectItem>{data.cities.map(v=><SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></div>
    <div className="companies-filter" data-active={companySize!=="all"}><span>Porte</span><Select value={companySize} onValueChange={setCompanySize}><SelectTrigger className="filter-select" aria-label="Porte"><SelectValue placeholder="Porte"/></SelectTrigger><SelectContent><SelectItem value="all">Todos os portes</SelectItem><SelectItem value="ME">ME</SelectItem><SelectItem value="EPP">EPP</SelectItem><SelectItem value="Demais">Demais</SelectItem></SelectContent></Select></div>
   </div>
   <div className="companies-advanced">
    <h2><SlidersHorizontal aria-hidden="true"/>Filtros avançados</h2>
    <div className="companies-contact-filters">
     <div className="companies-filter" data-active={email!=="all"}><span>E-mail</span><FilterSelect value={email} onChange={setEmail} label="e-mails"/></div>
     <div className="companies-filter" data-active={phone!=="all"}><span>Telefone</span><FilterSelect value={phone} onChange={setPhone} label="telefones"/></div>
     <div className="companies-filter" data-active={mobile!=="all"}><span>Celular</span><FilterSelect value={mobile} onChange={setMobile} label="celulares"/></div>
    </div>
   </div>
   <div className="companies-filter-footer"><span>{active?"Filtros aplicados à base":"Exibindo toda a base de empresas"}</span><Button variant="ghost" size="sm" onClick={clear} disabled={!active}><X/>Limpar tudo</Button></div>
  </section>
  <section className="panel companies-panel" aria-label="Lista de empresas">
   <div className="companies-results"><h2>{loading?"Carregando empresas…":error?"Empresas":<><strong>{data.total.toLocaleString("pt-BR")}</strong> empresas encontradas</>}</h2></div>
   {loading?<div className="table-loading"><Skeleton/><Skeleton/><Skeleton/></div>:error?<div className="empty-table" role="alert"><p>Falha ao carregar empresas.</p><Button variant="outline" onClick={()=>setRetry(value=>value+1)}>Tentar novamente</Button></div>:data.items.length?<>
    <Table><TableHeader><TableRow><TableHead>Empresa</TableHead><TableHead>Contato</TableHead><TableHead>Localização</TableHead><TableHead>Porte</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Ações</span></TableHead></TableRow></TableHeader>
     <TableBody>{data.items.map(c=><TableRow key={c.id} className="clickable-row" onClick={()=>onOpen(c.id)}>
      <TableCell><div className="company-cell"><span>{c.name.slice(0,2).toUpperCase()}</span><div><strong>{c.name}</strong><small>{formatCnpj(c.cnpj)||c.tradeName||"CNPJ não informado"}</small></div></div></TableCell>
      <TableCell><div className="companies-contact"><span className="companies-email"><Mail aria-hidden="true"/>{c.primaryEmail||"Sem e-mail"}</span>{c.primaryEmailStatus==="INVALID"&&<small className="companies-email-invalid">E-mail inválido conhecido</small>}<small className="phone-with-status">{formatBrazilianPhone(c.mobile||c.phone)||"Sem telefone"}{(c.mobile&&c.mobileWhatsAppStatus==="YES")||(!c.mobile&&c.phoneWhatsAppStatus==="YES")?<span className="whatsapp-confirmed" title="WhatsApp confirmado"><MessageCircle/></span>:null}</small></div></TableCell>
      <TableCell><div className="companies-location"><span>{[c.city,c.state].filter(Boolean).join(", ")||"—"}</span>{c.region?<small>Região {c.region}</small>:null}</div></TableCell>
      <TableCell><span className="companies-size">{c.companySize||"—"}</span></TableCell>
      <TableCell><span className={`status ${statusClass[c.status]}`}>{statusLabel[c.status]||c.status}</span></TableCell>
      <TableCell onClick={e=>e.stopPropagation()}>
       <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="companies-row-action" aria-label={`Ações de ${c.name}`} onClick={e=>e.stopPropagation()}><MoreHorizontal/></Button></DropdownMenuTrigger><DropdownMenuContent align="end" onClick={e=>e.stopPropagation()}><DropdownMenuItem variant="destructive" onSelect={async e=>{e.stopPropagation();await onRemove(c.id,c.name)}}><Trash2/>Excluir empresa</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      </TableCell>
     </TableRow>)}</TableBody>
    </Table>
    <div className="companies-pagination"><span>Exibindo {(data.page-1)*data.pageSize+1}–{Math.min(data.page*data.pageSize,data.total)} de {data.total}</span><div><Button variant="outline" size="sm" onClick={()=>setPagination({query,page:Math.max(1,data.page-1)})} disabled={data.page<=1}>Anterior</Button><span>Página {data.page} de {data.totalPages}</span><Button variant="outline" size="sm" onClick={()=>setPagination({query,page:Math.min(data.totalPages,data.page+1)})} disabled={data.page>=data.totalPages}>Próxima</Button></div></div>
   </>:<div className="empty-table"><div><Building2/></div><h2>{active?"Nenhuma empresa encontrada":"Sua base começa aqui"}</h2><p>{active?"Tente ajustar os filtros da base para encontrar registros compatíveis.":"Cadastre manualmente ou importe sua planilha para começar."}</p>{active?<Button variant="outline" onClick={clear}><X/>Limpar filtros</Button>:<div className="empty-actions"><Button onClick={onAdd}><Plus/>Cadastrar empresa</Button><Button variant="outline" onClick={onImport}><FileUp/>Importar planilha</Button></div>}</div>}
  </section>
 </div>
}
function FilterSelect({value,onChange,label}:{value:Filter;onChange:(v:Filter)=>void;label:string}){return <Select value={value} onValueChange={v=>onChange(v as Filter)}><SelectTrigger className="filter-select"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">Todos os {label}</SelectItem><SelectItem value="with">Com {label.slice(0,-1)}</SelectItem><SelectItem value="without">Sem {label.slice(0,-1)}</SelectItem>{label==="e-mails"&&<SelectItem value="invalid">E-mail inválido conhecido</SelectItem>}</SelectContent></Select>}
