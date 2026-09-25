"use client";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
export type SearchCompany = { id:number; name:string; primaryEmail?:string|null; segment?:string|null; city?:string|null; state?:string|null };
export function CompanySearch({value,onSelect,disabled=false}:{value:SearchCompany|null;onSelect:(company:SearchCompany)=>void;disabled?:boolean}) {
  const [query,setQuery]=useState(""),[results,setResults]=useState<SearchCompany[]>([]),[searching,setSearching]=useState(false),[open,setOpen]=useState(false),[error,setError]=useState("");
  useEffect(()=>{
    if(!open || query.trim().length<2) return;
    const controller=new AbortController();
    const timer=setTimeout(async()=>{
      try {
        const r=await fetch("/api/companies?search="+encodeURIComponent(query.trim())+"&limit=20",{signal:controller.signal});
        if(!r.ok) throw new Error();
        const data=await r.json() as SearchCompany[];
        if(!controller.signal.aborted)setResults(data);
      }catch{if(!controller.signal.aborted)setError("Não foi possível pesquisar. Tente novamente.");}
      finally{if(!controller.signal.aborted)setSearching(false);}
    },300);
    return()=>{clearTimeout(timer);controller.abort();};
  },[query,open]);
  return <div className="company-search"><div className="company-search-input"><Search size={16}/><Input aria-label="Pesquisar empresa" disabled={disabled} value={open?query:value?.name||""} onFocus={()=>{setOpen(true);setQuery("");setResults([]);setError("");setSearching(false);}} onChange={e=>{setQuery(e.target.value);setResults([]);setError("");setSearching(e.target.value.trim().length>=2);setOpen(true);}} onBlur={e=>{if(!e.currentTarget.parentElement?.parentElement?.contains(e.relatedTarget))setOpen(false);}} onKeyDown={e=>{if(e.key==="Escape")setOpen(false);}} placeholder="Pesquisar empresa..." autoComplete="off"/></div>
    {open&&<div className="company-search-results" aria-live="polite">{query.trim().length<2?<p>Digite pelo menos 2 caracteres para pesquisar.</p>:searching?<p>Pesquisando empresas…</p>:error?<p role="alert">{error}</p>:results.length?results.map(c=><button key={c.id} type="button" onMouseDown={e=>e.preventDefault()} onClick={()=>{onSelect(c);setQuery("");setResults([]);setOpen(false);}}><strong>{c.name}</strong><small>{[c.city,c.state].filter(Boolean).join("/")||"Localização não informada"}{c.primaryEmail?" · "+c.primaryEmail:""}</small></button>):<p>Nenhuma empresa encontrada.</p>}</div>}
  </div>;
}
