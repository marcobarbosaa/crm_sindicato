"use client";
import { useRef, useState } from "react";
import { Paperclip, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ATTACHMENT_TYPES, formatFileSize, validateAttachment, validateAttachmentSet, type Attachment } from "@/lib/attachments";
export function AttachmentList({files,onRemove,disabled=false}:{files:Attachment[];onRemove?:(id:string)=>void;disabled?:boolean}) {
  return <ul className="attachment-list">{files.map(file=><li key={file.id}><Paperclip size={15}/><span>{file.name}</span><small>{formatFileSize(file.size)}</small>{onRemove&&<Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={()=>onRemove(file.id)} aria-label={"Remover "+file.name}>Remover</Button>}</li>)}</ul>;
}
export function EmailAttachments({files,onChange,onBusyChange,disabled=false}:{files:Attachment[];onChange:(files:Attachment[])=>void;onBusyChange:(busy:boolean)=>void;disabled?:boolean}) {
  const input=useRef<HTMLInputElement>(null),lock=useRef(false);
  const [uploading,setUploading]=useState(false),[error,setError]=useState("");
  async function upload(selected:File[]) {
    if(lock.current || !selected.length)return;
    setError("");
    try {selected.forEach(validateAttachment);validateAttachmentSet([...files,...selected]);}
    catch(e){setError(e instanceof Error?e.message:"Arquivos inválidos.");return;}
    lock.current=true;setUploading(true);onBusyChange(true);
    try{
      const data=new FormData();selected.forEach(file=>data.append("files",file));
      const r=await fetch("/api/attachments",{method:"POST",body:data});
      const result=await r.json() as Attachment[] & {error?:string};
      if(!r.ok)throw new Error(result.error||"Não foi possível adicionar os arquivos.");
      onChange([...files,...result]);
    }catch(e){setError(e instanceof Error?e.message:"Falha no upload. Tente novamente.");}
    finally{lock.current=false;setUploading(false);onBusyChange(false);}
  }
  return <section className="email-attachments"><div className="attachment-heading"><strong>Anexos</strong><Button type="button" variant="outline" size="sm" disabled={disabled||uploading} onClick={()=>input.current?.click()}>{uploading?<Loader2 className="spin"/>:<Plus/>}{uploading?"Adicionando arquivos…":"Adicionar arquivos"}</Button></div><input ref={input} aria-label="Adicionar arquivos" type="file" multiple hidden accept={Object.keys(ATTACHMENT_TYPES).map(ext=>"."+ext).join(",")} onChange={e=>{void upload(Array.from(e.target.files||[]));e.target.value="";}}/><small>Até 10 arquivos · 8 MB por arquivo · 12 MB no total</small><AttachmentList files={files} disabled={disabled||uploading} onRemove={id=>onChange(files.filter(f=>f.id!==id))}/>{error&&<p className="attachment-error" role="alert">{error}</p>}</section>;
}
