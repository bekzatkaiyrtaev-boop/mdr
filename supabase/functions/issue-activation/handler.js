// Обработчик запроса «выдать ключ активации». Клиенты Supabase передаются снаружи
// (index.ts — настоящие, тесты — подделки), поэтому все правила проверяются без сети.
import { MACHINE_ID_RE, normalizeMachineId, buildPayload, signActivation } from './core.js';

// Сколько разных компьютеров может активировать один сотрудник. Без лимита человек мог бы
// выдавать ключи для любых чужих компьютеров от своего имени. Лишние слоты освобождает ГИП
// (удаляет запись во вкладке «Материалы»).
export const MAX_MACHINES_PER_USER = 3;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

export function createHandler({ getUserClient, getAdminClient, getPrivateKeyPem, now = () => new Date(), maxMachines = MAX_MACHINES_PER_USER }) {
  return async function handle(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return json(405, { error: 'Метод не поддерживается' });

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'Войдите на сайт и повторите' });

    let body;
    try { body = await req.json(); } catch { return json(400, { error: 'Некорректный запрос' }); }
    const materialKey = String(body?.material_key ?? '').trim();
    const machineId = normalizeMachineId(body?.machine_id);

    // кто спрашивает — по JWT, проверенному сервером Supabase (а не по тому, что прислал браузер)
    const userClient = getUserClient(authHeader, req.headers.get('apikey'));
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    const email = userData?.user?.email?.trim().toLowerCase();
    if (userErr || !email) return json(401, { error: 'Сессия недействительна — войдите на сайт заново' });

    // единое правило доступа лежит в базе (public.can_use_materials) — функция его не дублирует
    const { data: allowed, error: rpcErr } = await userClient.rpc('can_use_materials');
    if (rpcErr) return json(500, { error: 'Не удалось проверить доступ' });
    if (allowed !== true) return json(403, { error: 'Доступ только для сотрудников из списка «Пользователи»' });

    if (!MACHINE_ID_RE.test(machineId)) {
      return json(400, { error: 'Код компьютера должен выглядеть как XXXX-XXXX-XXXX-XXXX (скопируйте его из программы)' });
    }
    const { data: material } = await userClient.from('materials').select('key').eq('key', materialKey).maybeSingle();
    if (!material) return json(404, { error: 'Такого материала нет' });

    const admin = getAdminClient();
    const find = () => admin.from('app_activations').select('activation_key')
      .eq('material_key', materialKey).eq('user_email', email).eq('machine_id', machineId).maybeSingle();

    // повторный запрос для того же компьютера возвращает тот же ключ и не занимает новый слот
    const { data: existing } = await find();
    if (existing) return json(200, { activation_key: existing.activation_key, machine_id: machineId, email, reused: true });

    const { count } = await admin.from('app_activations').select('id', { count: 'exact', head: true })
      .eq('material_key', materialKey).eq('user_email', email);
    if ((count ?? 0) >= maxMachines) {
      return json(409, { error: `Уже активировано ${maxMachines} компьютера(ов) — это максимум. Обратитесь к ГИП, чтобы освободить место` });
    }

    const activationKey = await signActivation(
      buildPayload({ product: materialKey, machineId, email, issuedAt: now().toISOString() }),
      getPrivateKeyPem(),
    );
    const { error: insErr } = await admin.from('app_activations').insert({
      material_key: materialKey, user_email: email, machine_id: machineId, activation_key: activationKey,
    });
    if (insErr) {
      // два одновременных запроса: второй упёрся в уникальный индекс — отдаём ключ первого
      const { data: again } = await find();
      if (again) return json(200, { activation_key: again.activation_key, machine_id: machineId, email, reused: true });
      return json(500, { error: 'Не удалось сохранить активацию' });
    }
    return json(200, { activation_key: activationKey, machine_id: machineId, email, reused: false });
  };
}
