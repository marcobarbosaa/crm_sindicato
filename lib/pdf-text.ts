import { getDocumentProxy } from 'unpdf';
import { SMART_DEFAULTS, type SmartLimits } from './smart-send-policy';
export type PdfReading = { text: string; error: string | null; readable: boolean };
// Isolated reader boundary: future OCR requires a separately authorized provider.
export async function readPdfText(bytes: Uint8Array, limits: SmartLimits = SMART_DEFAULTS): Promise<PdfReading> {
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') return { text: '', error: 'PDF_SIGNATURE_INVALID', readable: false };
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes), { useSystemFonts: false, stopAtErrors: true, verbosity: 0 });
    if (pdf.numPages > limits.pages) return { text: '', error: 'PDF_PAGE_LIMIT', readable: false };
    const pages: string[] = []; let length = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      try {
        const content = await page.getTextContent();
        // Bound the join before allocating a potentially oversized page string.
        for (let i = 0; i < content.items.length; i++) {
          const item = content.items[i];
          length += ('str' in item ? item.str.length : 0) + (i ? 1 : 0);
          if (length > limits.textChars) return { text: '', error: 'PDF_TEXT_LIMIT', readable: false };
        }
        if (++length > limits.textChars) return { text: '', error: 'PDF_TEXT_LIMIT', readable: false };
        pages.push(content.items.map(item => 'str' in item ? item.str : '').join(' '));
      } finally { page.cleanup(); }
    }
    const text = pages.join('\n') + (pages.length ? '\n' : '');
    return { text, readable: true, error: text.trim() ? null : 'PDF_NO_TEXT' };
  } catch (error) {
    return { text: '', readable: false, error: error instanceof Error && error.name === 'PasswordException' ? 'PDF_PASSWORD' : 'PDF_CORRUPT' };
  } finally { await pdf?.loadingTask.destroy().catch(() => {}); }
}
