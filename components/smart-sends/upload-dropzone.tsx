"use client";
import { useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatFileSize } from '@/lib/attachments';
import type { SmartLimits } from '@/lib/smart-send-policy';

export function UploadDropzone({ limits, disabled, hasDocuments, onSelect }: {
  limits: SmartLimits; disabled: boolean; hasDocuments: boolean; onSelect: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return <div className={`smart-drop ${drag && !disabled ? 'drag' : ''}`} aria-disabled={disabled}
    onDragOver={event => { event.preventDefault(); if (!disabled) setDrag(true); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrag(false); }}
    onDrop={event => { event.preventDefault(); setDrag(false); if (!disabled) onSelect(Array.from(event.dataTransfer.files)); }}>
    <FileUp size={28} aria-hidden="true" />
    <h3>{hasDocuments ? 'Adicione mais PDFs a este lote' : 'Arraste seus PDFs até aqui'}</h3>
    <p>Selecione vários arquivos. A importação começa automaticamente.</p>
    <Button variant="outline" disabled={disabled} onClick={() => input.current?.click()} aria-describedby="smart-import-limits">Selecionar PDFs</Button>
    <input ref={input} className="smart-file-input" type="file" multiple accept="application/pdf,.pdf" id="smart-files" aria-label="Selecionar arquivos PDF" tabIndex={-1} disabled={disabled}
      onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; if (files.length) onSelect(files); }} />
    <p id="smart-import-limits" className="smart-import-limits">Até {limits.batchFiles} documentos por lote · {formatFileSize(limits.fileBytes)} por PDF · {limits.pages} páginas por PDF</p>
  </div>;
}
