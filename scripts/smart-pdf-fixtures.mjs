import { deflateSync } from 'node:zlib';

// Synthetic, valid xref/Flate streams; never reads customer documents.
export function syntheticPdf({ pages = 1, operations = 1, compressed = false } = {}) {
  const objects = [Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), null,
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')];
  const kids = [];
  for (let page = 0; page < pages; page++) {
    const id = objects.length + 1;
    kids.push(`${id} 0 R`);
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`));
    const raw = Buffer.from(`BT /F1 12 Tf 50 700 Td ${Array.from({ length: operations }, (_, n) => `(Destinataria 11222333000181 ${page}-${n}) Tj 0 -1 Td`).join('\n')} ET`);
    const stream = compressed ? deflateSync(raw) : raw;
    objects.push(Buffer.concat([Buffer.from(`<< /Length ${stream.length} ${compressed ? '/Filter /FlateDecode' : ''} >>\nstream\n`), stream, Buffer.from('\nendstream')]));
  }
  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`);
  const chunks = [Buffer.from('%PDF-1.4\n')], offsets = [0];
  let length = chunks[0].length;
  objects.forEach((object, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]);
    chunks.push(chunk); length += chunk.length;
  });
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`));
  return Buffer.concat(chunks);
}
