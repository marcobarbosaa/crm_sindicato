"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Eye, FileText, Mail, Plus, Save, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { EmailAttachments } from "@/components/email-attachments";
import { TemplatePreview } from "@/components/template-preview";
import { type Attachment } from "@/lib/attachments";
import { toast } from "sonner";
type Draft={name:string;subject:string;body:string;attachments:Attachment[]};
type Template=Draft&{id:number;updatedAt:string};
const blank:Draft={name:"",subject:"",body:"",attachments:[]};
const variables=[["empresa","Empresa"],["contato","Contato"],["cidade","Cidade"],["segmento","Segmento"]];
const asDraft=(t:Template):Draft=>({name:t.name,subject:t.subject,body:t.body,attachments:t.attachments||[]});
export function TemplatesPage({onDirtyChange}:{onDirtyChange?:(dirty:boolean)=>void}) {
  const [templates,setTemplates]=useState<Template[]>([]),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(false),[search,setSearch]=useState(""),[editing,setEditing]=useState<Template|null>(null),[draft,setDraft]=useState<Draft>(blank),[saving,setSaving]=useState(false),[uploading,setUploading]=useState(false),[preview,setPreview]=useState(false);
  const subjectRef=useRef<HTMLInputElement>(null),bodyRef=useRef<HTMLTextAreaElement>(null),lastField=useRef<"subject"|"body">("body"),lock=useRef(false);
  const dirty=JSON.stringify(draft)!==JSON.stringify(editing?asDraft(editing):blank),busy=saving||uploading;
  useEffect(()=>{onDirtyChange?.(dirty||busy);return()=>onDirtyChange?.(false);},[dirty,busy,onDirtyChange]);
  useEffect(()=>{if(!dirty&&!busy)return;const prevent=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener("beforeunload",prevent);return()=>window.removeEventListener("beforeunload",prevent);},[dirty,busy]);
  const load=useCallback(()=>fetch("/api/templates").then(async r=>{
    if(!r.ok)throw new Error();
    setTemplates(await r.json() as Template[]);setLoadError(false);
  }).catch(()=>{setLoadError(true);toast.error("Não foi possível carregar os templates.");}).finally(()=>setLoading(false)),[]);
  useEffect(()=>{void load();},[load]);
  const filtered=useMemo(()=>templates.filter(t=>(t.name+" "+t.subject).toLowerCase().includes(search.toLowerCase())),[templates,search]);
  function open(template:Template|null){if(busy)return;if(dirty&&!confirm("Descartar as alterações não salvas deste template?"))return;setEditing(template);setDraft(template?asDraft(template):blank);setPreview(false);}
  async function save(){
    if(lock.current||uploading)return;
    if(!draft.name.trim()||!draft.subject.trim()||!draft.body.trim())return toast.error("Preencha nome, assunto e mensagem.");
    lock.current=true;setSaving(true);
    try{
      const r=await fetch("/api/templates"+(editing?"?id="+editing.id:""),{method:editing?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:draft.name,subject:draft.subject,body:draft.body,attachmentIds:draft.attachments.map(f=>f.id)})});
      const data=await r.json() as Template&{error?:string};if(!r.ok)throw new Error(data.error||"Não foi possível salvar.");
      setEditing(data);setDraft(asDraft(data));setTemplates(current=>[data,...current.filter(t=>t.id!==data.id)]);toast.success("Template salvo.");
    }catch(e){toast.error(e instanceof Error?e.message:"Não foi possível salvar.");}
    finally{lock.current=false;setSaving(false);}
  }
  async function duplicate(){
    if(!editing||lock.current||uploading)return;
    if(dirty&&!confirm("Duplicar a versão salva e descartar as alterações não salvas?"))return;
    lock.current=true;setSaving(true);
    try{
      const r=await fetch("/api/templates",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sourceId:editing.id})});
      const data=await r.json() as Template&{error?:string};if(!r.ok)throw new Error(data.error||"Não foi possível duplicar.");
      setTemplates(current=>[data,...current]);setEditing(data);setDraft(asDraft(data));setPreview(false);toast.success("Cópia criada.");
    }catch(e){toast.error(e instanceof Error?e.message:"Não foi possível duplicar.");}finally{lock.current=false;setSaving(false);}
  }
  async function remove(){
    if(!editing||lock.current||uploading||!confirm("Excluir o template "+editing.name+"?"))return;
    lock.current=true;setSaving(true);
    try{const r=await fetch("/api/templates?id="+editing.id,{method:"DELETE"});if(!r.ok)throw new Error();setTemplates(current=>current.filter(t=>t.id!==editing.id));setEditing(null);setDraft(blank);setPreview(false);toast.success("Template excluído.");}
    catch{toast.error("Não foi possível excluir o template.");}finally{lock.current=false;setSaving(false);}
  }
  function personalize(key:string){
    const field=lastField.current,element=field==="subject"?subjectRef.current:bodyRef.current,value=draft[field],start=element?.selectionStart??value.length,end=element?.selectionEnd??value.length,token="{{"+key+"}}";
    if(value.length-end+start+token.length>(field==="subject"?200:20000))return toast.error("O campo atingiu o limite de caracteres.");
    setDraft(current=>({...current,[field]:value.slice(0,start)+token+value.slice(end)}));
    requestAnimationFrame(()=>{element?.focus();element?.setSelectionRange(start+token.length,start+token.length);});
  }
  return <><section className="page-intro compact"><div><p className="eyebrow">BIBLIOTECA DE MENSAGENS</p><h1>Templates de e-mail</h1><p>Crie mensagens reutilizáveis e personalize cada envio automaticamente.</p></div></section>
  <div className="template-layout"><aside className="panel template-list"><div className="template-library-heading"><strong>Sua biblioteca</strong>{templates.length>0&&<Button variant="ghost" size="sm" disabled={busy} onClick={()=>open(null)}><Plus/>Novo template</Button>}</div><div className="template-search"><Search/><Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar templates"/></div>{loading?<div className="template-skeleton"><Skeleton/><Skeleton/></div>:loadError?<div className="template-list-empty"><strong>Não foi possível carregar.</strong><Button variant="outline" onClick={()=>{setLoading(true);void load();}}>Tentar novamente</Button></div>:filtered.length?<div className="template-items">{filtered.map(t=><button disabled={busy} key={t.id} className={editing?.id===t.id?"active":""} onClick={()=>open(t)}><span className="template-icon"><Mail/></span><span><strong>{t.name}</strong><small>{t.subject}</small><em>Editado em {new Date(t.updatedAt).toLocaleDateString("pt-BR")}</em></span></button>)}</div>:<div className="template-list-empty"><FileText/><strong>{search?"Nenhum resultado":"Nenhum template ainda"}</strong><span>{search?"Tente outro termo.":"Preencha e salve sua primeira mensagem ao lado."}</span></div>}</aside>
  <section className="panel template-editor"><div className="editor-top"><div><h2>{editing?"Editar template":"Criar template"}</h2><p className="template-description">Esta mensagem poderá ser reutilizada nos seus envios.</p></div>{editing&&<div><Button variant="ghost" size="icon" disabled={busy} onClick={duplicate} aria-label="Duplicar template"><Copy/></Button><Button variant="ghost" size="icon" disabled={busy} onClick={remove} aria-label="Excluir template"><Trash2/></Button></div>}</div>
  {preview?<TemplatePreview subject={draft.subject} body={draft.body} attachments={draft.attachments}/>:<fieldset className="editor-body template-fields" disabled={busy||loading||loadError}><div className="template-name"><Label htmlFor="template-name">Nome do template</Label><Input id="template-name" value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} placeholder="Prospecção inicial" maxLength={100}/><small>Apenas você verá este nome.</small></div><div className="email-compose"><div className="compose-row"><Label htmlFor="template-subject">Assunto</Label><Input ref={subjectRef} id="template-subject" value={draft.subject} onFocus={()=>lastField.current="subject"} onChange={e=>setDraft({...draft,subject:e.target.value})} placeholder="Uma ideia para {{empresa}}" maxLength={200}/></div><div className="compose-content"><Label htmlFor="template-body">Mensagem</Label><Textarea ref={bodyRef} id="template-body" value={draft.body} onFocus={()=>lastField.current="body"} onChange={e=>setDraft({...draft,body:e.target.value})} placeholder={"Olá, {{contato}}!\n\nGostaria de conversar com a {{empresa}}..."} maxLength={20000}/><div className="compose-footer"><span>{draft.body.length.toLocaleString("pt-BR")} caracteres</span></div></div></div>
  <div className="variable-bar"><div><span><strong>Personalizar mensagem</strong><small>Insira automaticamente informações da empresa.</small></span></div><div>{variables.map(([key,label])=><button type="button" key={key} onMouseDown={e=>e.preventDefault()} onClick={()=>personalize(key)}>{label}</button>)}</div></div><EmailAttachments files={draft.attachments} onChange={attachments=>setDraft(current=>({...current,attachments}))} onBusyChange={setUploading} disabled={saving}/></fieldset>}
  <div className="template-actions"><span aria-live="polite">{dirty?"Alterações não salvas":editing?"Salvo":""}</span><Button variant="outline" disabled={busy||loading||loadError} onClick={()=>setPreview(v=>!v)}><Eye/>{preview?"Voltar ao editor":"Pré-visualizar"}</Button><Button onClick={save} disabled={busy||loading||loadError}><Save/>{saving?"Salvando…":uploading?"Adicionando arquivos…":"Salvar"}</Button></div></section></div></>;
}
