// Ядро выдачи ключей активации: формат «кода компьютера», подпись и (для тестов) проверка.
// Только стандартный WebCrypto — работает и в Deno (Edge Function), и в Node.
//
// Ключ активации = base64url(payload) + "." + base64url(подпись),
// payload = "<продукт>|<код компьютера>|<email>|<дата выдачи ISO>",
// подпись — RSASSA-PKCS1-v1_5 / SHA-256 приватным ключом сайта. Программа проверяет
// подпись зашитым в неё публичным ключом (activation-client/LayerPrintActivation.cs).

export const MACHINE_ID_RE = /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/;

export function normalizeMachineId(raw) {
  return String(raw ?? '').trim().toUpperCase();
}

export function buildPayload({ product, machineId, email, issuedAt }) {
  return `${product}|${machineId}|${String(email).toLowerCase()}|${issuedAt}`;
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function pemToDer(pem) {
  // секрет могли вставить с настоящими переводами строк или с литералами «\n» — принимаем оба вида
  const body = String(pem).replace(/\\n/g, '\n')
    .replace(/-----BEGIN [A-Z ]+-----/, '').replace(/-----END [A-Z ]+-----/, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

const RSA_ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

export async function signActivation(payload, privateKeyPem) {
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(privateKeyPem), RSA_ALG, false, ['sign']);
  const data = new TextEncoder().encode(payload);
  const sig = new Uint8Array(await crypto.subtle.sign(RSA_ALG.name, key, data));
  return `${b64url(data)}.${b64url(sig)}`;
}

// Проверка ключа (используется в тестах — так же проверяет и программа на C#).
export async function verifyActivation(activationKey, publicKeySpkiPem, expectedMachineId) {
  try {
    const [p, s] = String(activationKey).trim().split('.');
    if (!p || !s) return { ok: false, reason: 'format' };
    const payloadBytes = fromB64url(p);
    const key = await crypto.subtle.importKey('spki', pemToDer(publicKeySpkiPem), RSA_ALG, false, ['verify']);
    const valid = await crypto.subtle.verify(RSA_ALG.name, key, fromB64url(s), payloadBytes);
    if (!valid) return { ok: false, reason: 'signature' };
    const [product, machineId, email, issuedAt] = new TextDecoder().decode(payloadBytes).split('|');
    if (machineId !== expectedMachineId) return { ok: false, reason: 'machine' };
    return { ok: true, product, machineId, email, issuedAt };
  } catch {
    return { ok: false, reason: 'format' };
  }
}
