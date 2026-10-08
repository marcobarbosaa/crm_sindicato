import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as jose from 'jose';
import { loader } from './smart-test-loader.mjs';
const { publicKey, privateKey } = await jose.generateKeyPair('RS256');
const issuer = 'https://synthetic.cloudflareaccess.com', audience = 'synthetic-audience';
let settings = { SMART_SEND_ACCESS_ISSUER: issuer, SMART_SEND_ACCESS_AUD: audience, SMART_SEND_OWNER_MAP: '{"operator@example.test":"owner-a"}' };
const load = loader({ jose: { ...jose, createRemoteJWKSet: () => publicKey }, './attachment-storage': { storageConfig: key => settings[key] } });
const { smartOwner } = load('lib/smart-send-auth.ts');
const token = async overrides => new jose.SignJWT({ email: 'operator@example.test', ...overrides }).setProtectedHeader({ alg: 'RS256' }).setIssuer(issuer).setAudience(audience).setSubject('synthetic-user').setIssuedAt().setExpirationTime('1h').sign(privateKey);
test('JWT real verifica assinatura, issuer, audience e mapeamento; não confia em owner do cliente', async () => {
  const request = new Request('https://app.test/api/smart-sends?owner=intruder', { headers: { 'cf-access-jwt-assertion': await token() } });
  assert.equal(await smartOwner(request), 'owner-a');
  await assert.rejects(smartOwner(new Request(request.url, { headers: { 'cf-access-jwt-assertion': await token({ email: 'intruder@example.test' }) } })));
  const bad = await new jose.SignJWT({ email: 'operator@example.test' }).setProtectedHeader({ alg: 'RS256' }).setIssuer(issuer).setAudience('other').setSubject('s').setIssuedAt().setExpirationTime('1h').sign(privateKey);
  await assert.rejects(smartOwner(new Request(request.url, { headers: { 'cf-access-jwt-assertion': bad } })));
  await assert.rejects(smartOwner(new Request(request.url, { headers: { 'cf-access-jwt-assertion': 'unsigned.fake.token' } })));
});
test('CSRF, JWT ausente e bypass local em hostname público são bloqueados', async () => {
  await assert.rejects(smartOwner(new Request('https://app.test/api/smart-sends')));
  await assert.rejects(smartOwner(new Request('https://app.test/api/smart-sends', { method: 'POST', headers: { origin: 'https://attacker.test', 'cf-access-jwt-assertion': await token() } })));
  settings.SMART_SEND_ALLOW_LOCAL = 'true';
  assert.equal(await smartOwner(new Request('http://localhost/api/smart-sends')), 'local-preview-user');
  await assert.rejects(smartOwner(new Request('https://app.test/api/smart-sends')));
  settings.SMART_SEND_ALLOW_LOCAL = 'false';
});
test('armazenamento privado rejeita bucket público, redirects, traversal e stream excessivo', async () => {
  settings = { SUPABASE_URL: 'https://storage.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic', SMART_SEND_BUCKET: 'private' };
  const { smartStorage, boundedBytes } = load('lib/smart-send-storage.ts');
  const original = globalThis.fetch, key = 'smart-sends/00000000-0000-4000-8000-000000000001.pdf';
  try {
    globalThis.fetch = async () => Response.json({ public: true });
    await assert.rejects(smartStorage().put(key, new Uint8Array([1])), /privado/);
    globalThis.fetch = async (url, init) => { assert.equal(init.redirect, 'manual'); return url.includes('/bucket/') ? Response.json({ public: false }) : new Response(null, { status: 302, headers: { location: 'https://attacker.test' } }); };
    await assert.rejects(smartStorage().get(key), /indisponível/);
    await assert.rejects(smartStorage().get('../owner-b/file.pdf'), /Chave/);
    await assert.rejects(boundedBytes(new Response(new Uint8Array(20)).body, 10), /limite/);
  } finally { globalThis.fetch = original; }
});
