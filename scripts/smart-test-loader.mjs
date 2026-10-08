import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
const nativeRequire = createRequire(import.meta.url);
export function loader(overrides = {}) {
  const cache = new Map();
  function load(path) {
    path = resolve(path);
    if (cache.has(path)) return cache.get(path).exports;
    const loaded = { exports: {} }; cache.set(path, loaded);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const require = name => {
      if (name in overrides) return overrides[name];
      if (name.startsWith('@/')) return load(resolve(name.slice(2)) + '.ts');
      if (name.startsWith('.')) return load(resolve(dirname(path), name) + '.ts');
      return nativeRequire(name);
    };
    new Function('require', 'module', 'exports', code)(require, loaded, loaded.exports);
    return loaded.exports;
  }
  return load;
}
export function pdfFixture(text = '', encrypted = false) {
  const stream = `BT /F1 12 Tf 50 700 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  if (encrypted) objects.push('<< /Filter /Standard /V 1 /R 2 /O <0000000000000000000000000000000000000000000000000000000000000000> /U <1111111111111111111111111111111111111111111111111111111111111111> /P -4 >>');
  let file = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(file)); file += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(file);
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
  file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${encrypted ? '/Encrypt 6 0 R /ID [<1234567890abcdef><1234567890abcdef>]' : ''} >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(file));
}
