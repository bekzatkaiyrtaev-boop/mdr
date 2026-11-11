// Одноразовая генерация пары ключей подписи активаций (RSA-2048).
//   node activation-client/generate-keys.js
// Создаёт activation-private.pem (СЕКРЕТ — в .gitignore, хранить только в менеджере паролей и в
// секрете Supabase) и activation-public.pem. В конце печатает константы для LayerPrintActivation.cs.
// Если ключи уже есть — НЕ перезаписывает: смена ключа сделает недействительными все выданные активации.
const { generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const priv = path.join(__dirname, '..', 'activation-private.pem');
const pub = path.join(__dirname, 'activation-public.pem');
if (fs.existsSync(priv)) {
  console.error('activation-private.pem уже существует — не перезаписываю. Удалите файл вручную, только если понимаете последствия.');
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
fs.writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
fs.writeFileSync(pub, publicKey.export({ type: 'spki', format: 'pem' }));

const jwk = publicKey.export({ format: 'jwk' });
const b64 = (s) => Buffer.from(s, 'base64url').toString('base64');
console.log('Готово:\n  ' + priv + '  (секрет)\n  ' + pub + '\n');
console.log('Вставьте в LayerPrintActivation.cs:\n');
console.log('    const string PublicModulusBase64  = "' + b64(jwk.n) + '";');
console.log('    const string PublicExponentBase64 = "' + b64(jwk.e) + '";');
console.log('\nСекрет Supabase (из папки проекта):\n  supabase secrets set ACTIVATION_PRIVATE_KEY="$(cat activation-private.pem)"');
