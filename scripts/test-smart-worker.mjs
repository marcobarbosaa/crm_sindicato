import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pdfFixture } from './smart-test-loader.mjs';
import { syntheticPdf } from './smart-pdf-fixtures.mjs';
const require = createRequire(import.meta.url);
const { Miniflare, NoOpLog } = require(require.resolve('miniflare', { paths: [require.resolve('wrangler/package.json')] }));
const { build } = require(require.resolve('esbuild', { paths: [require.resolve('wrangler/package.json')] }));
test('workerd extrai texto de PDF sintético sem filesystem, canvas, OCR ou rede', async () => {
  const bundle = await build({ stdin: { contents: `import {readPdfText} from './lib/pdf-text.ts'; export default {async fetch(r){return Response.json(await readPdfText(new Uint8Array(await r.arrayBuffer())));}}`, resolveDir: process.cwd() },
    bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022', conditions: ['workerd', 'worker', 'browser'], external: ['node:*', '@napi-rs/canvas', 'pdfjs-dist', 'pdfjs-dist/*'], logLevel: 'silent' });
  const mf = new Miniflare({ log: new NoOpLog(), modules: true, compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'], script: bundle.outputFiles[0].text,
    outboundService: () => { assert.fail('PDF reader must not use network'); } });
  try {
    const response = await mf.dispatchFetch('http://worker.test', { method: 'POST', body: pdfFixture('Destinataria 11222333000181') });
    const result = await response.json(); assert.equal(result.error, null); assert.match(result.text, /11222333000181/);
    for (const options of [{pages:50}, {pages:10,operations:300,compressed:true}]) {
      const response = await mf.dispatchFetch('http://worker.test', {method:'POST',body:syntheticPdf(options)});
      const result = await response.json(); assert.equal(result.readable,true); assert.equal(result.error,null);
      assert.match(result.text,/11222333000181/);
    }
    const oversized = await mf.dispatchFetch('http://worker.test', {method:'POST',body:syntheticPdf({pages:51})});
    assert.equal((await oversized.json()).error,'PDF_PAGE_LIMIT');
    const excessText = await mf.dispatchFetch('http://worker.test', {method:'POST',body:syntheticPdf({pages:10,operations:1000,compressed:true})});
    const limited = await excessText.json(); assert.equal(limited.error,'PDF_TEXT_LIMIT'); assert.equal(limited.readable,false); assert.equal(limited.text,'');
    const corrupt = await mf.dispatchFetch('http://worker.test', {method:'POST',body:'%PDF-broken'});
    assert.equal((await corrupt.json()).error,'PDF_CORRUPT');
  } finally { await mf.dispose(); }
});
