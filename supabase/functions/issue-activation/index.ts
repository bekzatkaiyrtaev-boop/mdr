// Edge Function «issue-activation»: выдаёт ключ активации программы сотруднику из списка.
// Деплой и секреты — см. activation-client/README.md.
//
// Секрет ACTIVATION_PRIVATE_KEY (приватный ключ RSA в формате PKCS8 PEM) задаётся вручную;
// SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHandler } from './handler.js';

const url = Deno.env.get('SUPABASE_URL')!;

Deno.serve(createHandler({
  // клиент «от имени пользователя» — запросы идут с его JWT, поэтому работают политики RLS
  // ключ берём из заголовка apikey самого запроса (сайт шлёт свой publishable-ключ), а
  // если его нет — из переменной окружения; сам по себе он ничего не разрешает без JWT
  getUserClient: (authHeader: string, apikey: string | null) =>
    createClient(url, apikey || Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } }),
  // клиент с service role — только для записи в журнал активаций
  getAdminClient: () => createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
  getPrivateKeyPem: () => {
    const pem = Deno.env.get('ACTIVATION_PRIVATE_KEY');
    if (!pem) throw new Error('Не задан секрет ACTIVATION_PRIVATE_KEY');
    return pem;
  },
}));
