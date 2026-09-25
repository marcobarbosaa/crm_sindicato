"use client";
import { useEffect, useState } from "react";
import { CompanySearch, type SearchCompany } from "@/components/company-search";
import { AttachmentList } from "@/components/email-attachments";
import { type Attachment } from "@/lib/attachments";
type Contact={name?:string|null;email?:string|null;isPrimary?:boolean};
export function TemplatePreview({subject,body,attachments}:{subject:string;body:string;attachments:Attachment[]}) {
  const [company,setCompany]=useState<SearchCompany|null>(null),[contact,setContact]=useState<Contact|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState("");
  useEffect(()=>{
    if(!company)return;
    const controller=new AbortController();
    void fetch("/api/companies/"+company.id,{signal:controller.signal}).then(async r=>{
      if(!r.ok)throw new Error();
      const data=await r.json() as {contacts:Contact[]};
      if(!controller.signal.aborted)setContact(data.contacts.find(c=>c.isPrimary)||data.contacts[0]||null);
    }).catch(()=>{if(!controller.signal.aborted)setError("Não foi possível carregar o contato desta empresa.");}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[company]);
  const data:Record<string,string>={empresa:company?.name||"",contato:contact?.name||"",cidade:company?.city||"",segmento:company?.segment||"",estado:company?.state||"",email_empresa:company?.primaryEmail||""};
  const render=(value:string)=>value.replace(/{{\s*(empresa|contato|segmento|cidade|estado|email_empresa)\s*}}/g,(_,key:string)=>data[key]||"");
  return <div className="template-preview"><div className="preview-company"><strong>Visualizar como</strong><CompanySearch value={company} onSelect={c=>{setCompany(c);setContact(null);setLoading(true);setError("");}}/></div>{loading?<p role="status">Carregando contato…</p>:error?<p role="alert">{error}</p>:company?<article className="email-preview-card"><header>Para: {contact?.email||company.primaryEmail||"E-mail não informado"}</header><div className="preview-subject"><span>Assunto</span><h3>{render(subject)||"Sem assunto"}</h3></div><div className="preview-body" style={{whiteSpace:"pre-wrap"}}>{render(body)}</div><AttachmentList files={attachments}/></article>:<p>Pesquise uma empresa para visualizar a mensagem personalizada.</p>}<p className="preview-note">Esta seleção serve apenas para pré-visualização e não modifica o template.</p></div>;
}
