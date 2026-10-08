import { createRemoteJWKSet, jwtVerify } from 'jose';
import { storageConfig } from './attachment-storage';
import { SmartSendError } from './smart-send-policy';
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function smartOwner(request: Request) {
  const url = new URL(request.url);
  if (!['GET', 'HEAD'].includes(request.method)) {
    if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new SmartSendError('Origem da requisição inválida.', 403);
  }
  if (storageConfig('SMART_SEND_ALLOW_LOCAL') === 'true' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return 'local-preview-user';
  const issuer = storageConfig('SMART_SEND_ACCESS_ISSUER'), audience = storageConfig('SMART_SEND_ACCESS_AUD');
  if (!issuer || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) || !audience) throw new SmartSendError('Configure a autenticação de Envios Inteligentes (Cloudflare Access).', 503);
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) throw new SmartSendError('Autenticação necessária.', 401);
  try {
    let keys = keySets.get(issuer);
    if (!keys) { keys = createRemoteJWKSet(new URL(issuer + '/cdn-cgi/access/certs'), { timeoutDuration: 5000 }); keySets.set(issuer, keys); }
    const { payload } = await jwtVerify(token, keys, { issuer, audience, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'email'] });
    const owners = JSON.parse(storageConfig('SMART_SEND_OWNER_MAP') || '{}') as Record<string, unknown>;
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    const owner = Object.hasOwn(owners, email) ? owners[email] : undefined;
    if (typeof owner !== 'string' || !owner || owner.length > 200) throw new Error('owner');
    return owner;
  } catch { throw new SmartSendError('Sessão inválida ou usuário sem acesso ao CRM.', 403); }
}
