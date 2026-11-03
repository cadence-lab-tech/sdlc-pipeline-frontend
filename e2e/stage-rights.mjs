// Право этапа в карточке и в «Ждут меня» (CLAB-383, решение 0072, ПР-1, ПР-2,
// ПР-4, ПР-5, ПР-7, ПР-9): кнопки решения и перехода показаны ровно по полям
// ответа сервера, а на чужом этапе на их месте — текст сервера дословно.
//
// Стенд в режиме header, где права этапа не применяются: сервер отвечает
// actor_may: true всем. Поэтому ответ о праве подменяется в браузере — к
// настоящему ответу карточки (`GET /tasks/{key}` и `/transitions`) и «Ждут
// решения» дописываются поля actor_*/can_decide — а само устройство экрана
// (кнопки, текст, ни одного POST при открытой карточке) проверяется живьём.
// Саму формулу права проверяют тесты backend. Лента — настоящая: самоапрув
// пишет движок стенда (захват, артефакт и решение одним актором).
//
// Задачи сценария свои, с суффиксом запуска: повтор на той же базе безопасен.
import {session, helpers} from './driver.mjs';

const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
const API = process.env.SDLC_API_URL ?? 'http://localhost:8088';
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sfx = Date.now().toString(36).slice(-5);
const OWNER = `e2e-sr-owner-${sfx}`;

async function call(method, path, body, actor = 'e2e') {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: {'Content-Type': 'application/json', 'X-SDLC-Actor': actor},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return {status: res.status, ok: res.ok, body: text ? JSON.parse(text) : undefined};
}
const must = (r, what) => {
  if (!r.ok) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

// ── данные ──────────────────────────────────────────────────────────────────
// Участник уровня agent с ролью analyst: вести этап ему разрешено, поэтому
// захват и сдача артефакта от его имени проходят.
await call('GET', '/auth/me', undefined, OWNER);
const invite = must(await call('POST', '/projects/SDLC/invites', {level: 'agent', role_keys: ['analyst'], days: 1}), 'приглашение');
must(await call('POST', '/invites/accept', {token: invite.token}, OWNER), 'приём приглашения');
const REPO = 'cadence-lab-tech/sdlc-pipeline-frontend';
async function newTask(title) {
  const t = must(await call('POST', '/projects/SDLC/tasks', {title, repositories: [REPO]}), 'заведение');
  must(await call('POST', `/tasks/${t.key}/transitions/start`, {}), 'старт');
  return t.key;
}
const PENDING = await newTask(`Право этапа ${sfx}: ждёт решения`);
const SELF = await newTask(`Право этапа ${sfx}: самоапрув`);
const OTHER = await newTask(`Право этапа ${sfx}: решил сопровождающий`);
// Остальные гейты analysis_done снимает сопровождающий: тогда задача ждёт
// только апрува и попадает в «Ждут решения», а кнопки апрува лежат в карточке
// на виду, без раскрытия списка гейтов.
for (const gate of ['artifacts', 'peer_review']) {
  must(await call('POST', `/tasks/${PENDING}/transitions/analysis_done/gates/${gate}/decision`, {status: 'waived', details: {reason: 'сценарий права этапа'}}), 'снятие гейта');
}
// Самоапрув: тот же человек вёл этап (аренда, артефакт) и решил сам.
must(await call('POST', `/tasks/${SELF}/claim`, {role: 'analyst'}, OWNER), 'захват');
must(await call('POST', `/tasks/${SELF}/artifacts`, {kind: 'analysis.brief', title: 'Бриф', format: 'markdown', content: 'x'}, OWNER), 'артефакт');
must(await call('POST', `/tasks/${SELF}/transitions/analysis_done/gates/human_approval/decision`, {status: 'passed'}, OWNER), 'самоапрув');
// Решение чужого: тот, кто этап не вёл.
must(await call('POST', `/tasks/${OTHER}/transitions/analysis_done/gates/human_approval/decision`, {status: 'passed'}, 'e2e'), 'решение');
console.log(`задачи сценария: ${PENDING} ${SELF} ${OTHER}`);

// ── подмена права в браузере ────────────────────────────────────────────────
const DENY = 'Этап «Analysis» ведёт роль analyst; у вас её нет (e2e-текст сервера)';
const DENY_CANCEL = 'Отмена задачи — решение сопровождающего (e2e-текст сервера)';
const STUB = `
  const prevFetch = window.fetch;
  window.__posts = [];
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = ((init && init.method) || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
    if (method !== 'GET' && /\\/v1\\/tasks\\/[^/]+\\/transitions\\//.test(url)) window.__posts.push(method + ' ' + url);
    const res = await prevFetch(input, init);
    const cfg = JSON.parse(sessionStorage.getItem('e2e.rights') || '{}');
    if ((!cfg.mode && !cfg.approvals) || method !== 'GET') return res;
    const json = (body) => new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}});
    const deny = (message) => ({code: 'forbidden', reason: 'not_stage_role', message});
    const patch = (transitions) => transitions.map((t) => {
      const mine = cfg.mode === 'own' || cfg.mode === 'maintainer';
      const cancel = t.kind === 'cancel';
      const out = {...t};
      for (const k of Object.keys(out)) if (k.startsWith('actor_')) delete out[k];
      if (cfg.mode === 'legacy') {
        out.gates = t.gates.map((g) => { const c = {...g}; for (const k of Object.keys(c)) if (k.startsWith('actor_')) delete c[k]; return c; });
        return out;
      }
      const may = cfg.mode === 'maintainer' || (mine && !cancel);
      out.actor_may = may;
      if (!may) out.actor_deny = deny(cancel ? ${JSON.stringify(DENY_CANCEL)} : ${JSON.stringify(DENY)});
      out.gates = t.gates.map((g) => {
        const c = {...g};
        for (const k of Object.keys(c)) if (k.startsWith('actor_')) delete c[k];
        const manual = g.type === 'human_approval';
        if (cfg.mode === 'maintainer') { c.actor_may_decide = true; c.actor_decisions = ['passed', 'failed', 'waived']; }
        else if (mine && manual) { c.actor_may_decide = true; c.actor_decisions = ['passed', 'failed']; }
        else { c.actor_may_decide = false; c.actor_deny = deny(${JSON.stringify(DENY)}); }
        return c;
      });
      return out;
    });
    if (cfg.mode && /\\/v1\\/tasks\\/[^/?]+$/.test(url) && cfg.keys?.some((k) => url.endsWith('/' + k))) {
      const body = await res.clone().json();
      body.transitions = patch(body.transitions || []);
      return json(body);
    }
    if (/\\/v1\\/projects\\/[^/]+\\/approvals/.test(url) && cfg.approvals) {
      // Записи собираются из задачи сценария: демонстрационный цикл держит
      // peer_review, который стенду без агента-ревьюера не пройти, и настоящий
      // ответ пуст. Поля записи — как отдаёт сервер.
      const a = cfg.approvals;
      const records = Object.keys(a.items).map((key) => {
        const rec = {
          task: {key, title: a.title, type: 'task', priority: 'normal', workflow_id: a.workflow, status_key: 'analysis', status_name: 'Analysis'},
          transition: {key: 'analysis_done', name: 'Аналитика готова', to_status: 'architecture', lands_in: 'architecture', lands_in_name: 'Architecture'},
          gate: {gate_key: 'human_approval', gate_name: 'Апрув человеком', type: 'human_approval', blocking: true, status: 'pending'},
          stage_run: {id: '00000000-0000-0000-0000-000000000001', attempt: 1, lease_held: false, latest_artifact_id: null},
        };
        if (!a.legacy) rec.can_decide = a.items[key];
        return rec;
      });
      return json({approvals: a.top ? records : [], can_decide: a.top, truncated: false});
    }
    return res;
  };
`;

const s = await session(BASE + '/projects');
await s.addInitScript(STUB);
const run = (body) => s.evaluate(helpers + body);
const setup = async (cfg) => {
  await s.evaluate(`sessionStorage.setItem('e2e.rights', ${JSON.stringify(JSON.stringify(cfg))}); return 1;`);
};
const open = async (path) => {
  await s.goto(BASE + path);
  await sleep(2200);
};
// Кнопки действий карточки: тексты, которыми они подписаны.
const BUTTONS = ['Апрув', 'Отклонить', 'Перевести', 'Держат гейты', 'Недоступен', 'Сохранить отметки'];
const buttons = () => run(`
  const root = document.body;
  const names = ${JSON.stringify(BUTTONS)};
  return all('button').map((b) => (b.innerText || '').trim()).filter((t) => names.includes(t));
`);
const count = (list, name) => list.filter((t) => t === name).length;

const task = `/p/SDLC/tasks/${PENDING}`;
const pendingDetail = (await call('GET', `/tasks/${PENDING}`)).body.task;
await open(task);
const realTransitions = (await call('GET', `/tasks/${PENDING}/transitions`)).body.transitions;
const gateCount = realTransitions.flatMap((t) => t.gates).filter((g) => g.type === 'human_approval').length;

// ── ПР-1: свой этап ─────────────────────────────────────────────────────────
console.log('карточка: свой этап (actor_decisions = passed, failed)');
await setup({mode: 'own', keys: [PENDING]});
await open(task);
let b = await buttons();
check('«Апрув» и «Отклонить» — по одной на гейт апрува', count(b, 'Апрув') === gateCount && count(b, 'Отклонить') === gateCount, JSON.stringify(b));
let page = await run('return texts();');
check('«Перевести»/«Держат гейты» у analysis_done есть', b.includes('Держат гейты') || b.includes('Перевести'), JSON.stringify(b));
check('cancel без кнопки, с текстом сервера дословно', page.includes(DENY_CANCEL) && count(b, 'Перевести') === 0, JSON.stringify(b));

// ── ПР-2: чужой этап ────────────────────────────────────────────────────────
console.log('карточка: чужой этап (actor_may = false)');
await setup({mode: 'foreign', keys: [PENDING]});
await open(task);
b = await buttons();
page = await run('return texts();');
check('ни «Апрув», ни «Отклонить», ни «Перевести»', b.length === 0, JSON.stringify(b));
check('на месте кнопок — текст сервера дословно', page.includes(DENY), page.slice(0, 500));
check('отказ показан у перехода', (await run(`return document.querySelectorAll('[data-transition-deny]').length;`)) >= 2);
const denyGate = await run(`
  const open = document.querySelector('[data-slot=collapsible-trigger]');
  if (open && open.getAttribute('data-state') !== 'open') { open.click(); await sleep(600); }
  return document.querySelectorAll('[data-gate-deny]').length;
`);
check('в раскрытом списке отказ есть у гейта апрува', denyGate >= 1, String(denyGate));
check('при открытой карточке не ушло ни одного POST перехода или решения', (await run('return window.__posts.length;')) === 0, String(await run('return JSON.stringify(window.__posts);')));

// ── ПР-7: сервер прежней версии ─────────────────────────────────────────────
console.log('карточка: ответ без полей права (сервер прежней версии)');
await setup({mode: 'legacy', keys: [PENDING]});
await open(task);
b = await buttons();
check('«Апрув» и «Отклонить» — как до изменения', count(b, 'Апрув') === gateCount && count(b, 'Отклонить') === gateCount, JSON.stringify(b));
check('кнопка отмены «Перевести» есть', count(b, 'Перевести') >= 1, JSON.stringify(b));
check('текстов отказа нет', (await run(`return document.querySelectorAll('[data-transition-deny], [data-gate-deny]').length;`)) === 0);

// ── ПР-9: сопровождающий ────────────────────────────────────────────────────
console.log('карточка: сопровождающий (все вердикты, все переходы)');
await setup({mode: 'maintainer', keys: [PENDING]});
await open(task);
b = await buttons();
check('те же кнопки, что без полей права', count(b, 'Апрув') === gateCount && count(b, 'Отклонить') === gateCount && count(b, 'Перевести') >= 1, JSON.stringify(b));
check('текстов отказа нет', (await run(`return document.querySelectorAll('[data-transition-deny], [data-gate-deny]').length;`)) === 0);

// ── ПР-5, ПР-9: лента ───────────────────────────────────────────────────────
console.log('лента: самоапрув');
await setup({});
await open(`/p/SDLC/tasks/${SELF}`);
await run('await openSection("timeline"); return true;');
await sleep(900);
const marks = await run(`
  return all('[data-event="gate.decided"]').map((el) => ({
    text: el.innerText.replace(/\\s+/g, ' '),
    mark: el.querySelector('[data-self-approval]') !== null,
  }));
`);
check('решение по гейту в ленте — одно', marks.length === 1, JSON.stringify(marks));
check('«решил X» и «исполнитель этапа сам»', marks[0]?.mark && marks[0].text.includes(`решил ${OWNER}, исполнитель этапа сам`), JSON.stringify(marks));
await open(`/p/SDLC/tasks/${OTHER}`);
await run('await openSection("timeline"); return true;');
await sleep(900);
const other = await run(`
  return all('[data-event="gate.decided"]').map((el) => ({
    text: el.innerText.replace(/\\s+/g, ' '),
    mark: el.querySelector('[data-self-approval]') !== null,
  }));
`);
check('решение того, кто этап не вёл, — без пометки', other.length === 1 && !other[0].mark && !other[0].text.includes('сам'), JSON.stringify(other));

// ── ПР-4: «Ждут меня» ───────────────────────────────────────────────────────
console.log('«Ждут меня»');
const APPROVALS = {title: pendingDetail.title, workflow: pendingDetail.workflow_id};
const zone = async () => {
  await open('/p/SDLC');
  return run(`
    const z = document.querySelector('[data-zone="decisions"]');
    const card = (key) => all('[data-zone="decisions"] [data-density="card"]').find((c) => c.innerText.includes(key));
    const row = (key) => { const c = card(key); return c ? {text: c.innerText.replace(/\\s+/g, ' '), buttons: c.querySelectorAll('button').length} : null; };
    return {
      note: z ? z.querySelector('[data-viewer-note]') !== null : null,
      pending: row(${JSON.stringify(PENDING)}),
      zoneText: z ? z.innerText.replace(/\\s+/g, ' ') : '',
    };
  `);
};
await setup({approvals: {...APPROVALS, top: true, items: {[PENDING]: true}}});
let z = await zone();
check('can_decide: true — строка с гейтом, как раньше', z.pending && /Апрув/.test(z.pending.text) && !z.pending.text.includes('решение сопровождающего'), JSON.stringify(z.pending));
check('наблюдательной пометки нет', z.note === false);
await setup({approvals: {...APPROVALS, top: true, items: {[PENDING]: false}}});
z = await zone();
check('can_decide: false — строка без кнопок, причина «решение сопровождающего»', z.pending && z.pending.text.includes('решение сопровождающего'), JSON.stringify(z.pending));
await setup({approvals: {...APPROVALS, top: false, items: {[PENDING]: false}}});
z = await zone();
check('верхний can_decide: false — пометка наблюдателя', z.note === true, z.zoneText.slice(0, 300));
check('и «решения сопровождающего» на строках нет', !z.zoneText.includes('решение сопровождающего'));
await setup({approvals: {...APPROVALS, top: true, items: {[PENDING]: true}, legacy: true}});
z = await zone();
check('ответ без can_decide у записей — как раньше', z.pending && !z.pending.text.includes('решение сопровождающего'), JSON.stringify(z.pending));
await setup({});

console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
