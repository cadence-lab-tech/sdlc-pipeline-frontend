// Роли на странице «Пайплайн» (CLAB-346): панель роли вместо прежней страницы
// ролей. Роль выбирается адресом /pipeline?role=X.
//
// Документы версии (CLAB-347): своя роль с тремя документами и двумя
// версиями, заведённая ручками API, — документы, подгрузка прежней версии и
// её сбой, дифф по документам, форма новой версии документами, отказы 400 и
// 403, состояние в адресе, ответ прежнего backend без documents, узкий экран.
// Отказы, которых стенд в режиме header не даёт (403, 500 подгрузки, ответ без
// documents), подменяются в браузере ответом одной ручки.
import {writeFileSync} from 'node:fs';
import {session, helpers} from './driver.mjs';

const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
const API = process.env.SDLC_API_URL ?? 'http://localhost:8088';
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const call = (method, path, body, actor = 'e2e') =>
  fetch(API + '/v1' + path, {
    method,
    headers: {'X-SDLC-Actor': actor, 'Content-Type': 'application/json'},
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null)}));

const s = await session(BASE + '/p/SDLC/pipeline?role=analyst');
// Ожидание опоры: страница грузит версию цикла и роли несколькими запросами.
const waitFor = `
  const waitFor = async (sel) => {
    for (let i = 0; i < 50 && !document.querySelector(sel); i++) await sleep(100);
    const el = document.querySelector(sel);
    if (!el) throw new Error('нет на странице: ' + sel);
    return el;
  };
`;
const run = (body) => s.evaluate(helpers + waitFor + body);
// Широкий экран: обзор цикла — в боковой панели (на узком он за кнопкой «Обзор»).
await s.resize(1440, 900);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
await pause(2500);

console.log('адрес «Пайплайна» с выбором роли');
const where = await run('return location.pathname + location.search;');
check('/pipeline?role=analyst остаётся в адресе', where === '/p/SDLC/pipeline?role=analyst', where);

console.log('панель роли');
const api = (await call('GET', '/projects/SDLC/roles/analyst')).body;
let t = await run('return texts();');
const panel = await run(`
  const p = await waitFor('[data-role-panel="analyst"]').catch(() => null);
  return p ? p.innerText.replace(/\\s+/g, ' ') : '';
`);
check('панель роли открыта', panel.includes('Аналитик') && panel.includes('analyst'), panel.slice(0, 200));
check('документы версии показаны', panel.includes('main.md') && panel.includes('так документы отдаются агенту'), panel.slice(0, 300));
// Инструкцию пишут разметкой: на экране она должна быть отрисованной, а не
// абзацем сырого текста. Текст документа — по раскрытию строки.
const instruction = await run(`
  document.querySelector('[data-role-document="main.md"] button').click();
  await sleep(300);
  return Boolean(all('[data-role-panel] .prose-sdlc').find((el) => (el.innerText || '').includes('Ты аналитик')));
`);
check('документ раскрывается разметкой', instruction === true);
check('контракт вывода показан', panel.includes('analysis.acceptance_criteria'));
const usage = await run(`return all('[data-role-usage-status]').map((el) => el.getAttribute('data-role-usage-status') + ':' + el.getAttribute('data-role-usage-state'));`);
const wantUsage = (api.used_on ?? []).map((u) => `${u.status_key}:${u.workflow_state}`);
check('«Стоит на статусах» совпадает с used_on', usage.length > 0 && usage.join() === wantUsage.join(), `${usage.join()} / ${wantUsage.join()}`);

console.log('правка инструкции — новая версия');
// Сценарий повторяется на той же базе: номер новой версии — следующий после
// тех, что уже есть, текст — с отметкой прогона.
const before = (api.versions ?? []).length;
const next = before + 1;
const runMark = Date.now().toString(36);
await run('await clickExact("Новая версия"); return true;');
const wide = await run(`return document.querySelector('[data-pipeline-inspector]').getBoundingClientRect().width;`);
check('форма новой версии шире панели', wide > 600, String(wide));
await run(`
  await fill("Что изменилось", "уточнили формулировку требований");
  await fill("Содержимое", 'Ты аналитик. Уточнённая инструкция ${runMark}.');
  await clickExact("Сохранить версию");
  await sleep(1500);
  return true;
`);
t = await run('return texts();');
const card = await run(`
  const c = document.querySelector('[data-role-version]');
  return c ? {v: c.getAttribute('data-role-version'), text: c.innerText.replace(/\\s+/g, ' ')} : null;
`);
check(`создана версия ${next}, раскрыта она`, card?.v === String(next) && card.text.includes(`Уточнённая инструкция ${runMark}`), JSON.stringify(card));
check(`версия ${next} помечена актуальной`, new RegExp(`Версия ${next} актуальная`).test(card?.text ?? ''), card?.text);
const rows = await run(`return all('[data-role-version-row]').map((el) => el.getAttribute('data-role-version-row'));`);
// Текст версии 1 виден только убранными строками диффа: её карточки нет.
const v1card = await run(`return Boolean(document.querySelector('[data-role-version="1"]'));`);
check('прежние версии — строками, без карточки', rows.length === before && rows[rows.length - 1] === '1' && !v1card, rows.join());
await run(`document.querySelector('[data-role-version-row="1"]').click(); await sleep(900); return true;`);
const v1 = await run(`
  await waitFor('[data-role-version="1"] [data-role-document="main.md"] button');
  document.querySelector('[data-role-version="1"] [data-role-document="main.md"] button').click();
  await sleep(300);
  const c = document.querySelector('[data-role-version]');
  return {v: c?.getAttribute('data-role-version'), text: (c?.innerText || '').replace(/\\s+/g, ' '), url: location.search};
`);
check('клик раскрывает версию 1 нетронутой', v1.v === '1' && v1.text.includes('Разбери задачу до уровня'), JSON.stringify(v1).slice(0, 300));
check('раскрытая версия — в адресе', v1.url.includes('v=1'), v1.url);
const created = (await call('GET', `/projects/SDLC/roles/analyst/versions/${next}`)).body;
check(`версия ${next} есть в API`, created?.version === next && created.instructions.includes(runMark), JSON.stringify(created).slice(0, 200));
check(`версия ${next} — один документ main.md`, created?.documents?.length === 1 && created.documents[0].name === 'main.md', JSON.stringify(created?.documents));

console.log('версия на узле обновилась');
await s.goto(BASE + '/p/SDLC/pipeline?type=task');
await pause(2000);
const node = await run(`
  const b = await waitFor('[data-pipeline-role="analyst"]').catch(() => null);
  return b ? b.getAttribute('data-pipeline-role-version') : null;
`);
check(`узел показывает v${next}`, node === String(next), String(node));

console.log('архивирование роли, которая стоит на активном цикле');
await run(`document.querySelector('[data-pipeline-role="analyst"]').click(); await sleep(1500); return true;`);
await run('await clickExact("В архив"); return true;');
// Архив необратим для выбора ролей у статусов: сначала подтверждение с именем
// роли, запрос уходит после него.
const dialog = await run(`
  const d = document.querySelector('[role=alertdialog]');
  return d ? d.innerText.replace(/\\s+/g, ' ') : '';
`);
check('архив просит подтверждения с именем роли',
  dialog.includes('Отправить роль в архив?') && dialog.includes('Аналитик') && dialog.includes('(analyst)'), dialog);
t = await run('return texts();');
check('до подтверждения отказа нет', !t.includes('Роль не заархивирована'), t.slice(0, 400));
await run('return confirm("В архив");');
await pause(800);
t = await run('return texts();');
check('архивирование отклонено', t.includes('Роль не заархивирована'), t.slice(0, 400));
check('показано, где роль занята', t.includes('analysis'), t.slice(0, 500));
// Отказ бэкенда остаётся в Failure рядом с формой; тоста об успехе нет.
const toastsAfterRefusal = await run('return toasts();');
check('тоста при отказе нет', toastsAfterRefusal.length === 0, toastsAfterRefusal.join(' | '));
// Место отказа на этом цикле — кнопка: выбирает статус.
const picked = await run(`
  const b = all('[data-role-panel] button').find((x) => (x.innerText || '').trim().startsWith('analysis ('));
  if (!b) return 'нет кнопки';
  b.click();
  await sleep(900);
  return new URLSearchParams(location.search).get('status');
`);
check('место отказа выбирает статус', picked === 'analysis', String(picked));

console.log('обзор: роли на цикле, остальные, архивные');
await s.goto(BASE + '/p/SDLC/pipeline?type=task');
await pause(2000);
t = await run(`return (await waitFor('[data-pipeline-overview]')).innerText.replace(/\\s+/g, ' ');`);
check('роли перечислены', t.includes('Роли на этом цикле') && t.includes('Аналитик') && t.includes('Ревьюер'), t.slice(0, 300));
check('остальные роли — своим разделом', t.includes('Остальные роли проекта') && t.includes('Не стоят ни на одном статусе этого цикла'), t.slice(0, 500));
const stamp = Date.now().toString(36);
const LONELY = `e2e-lonely-${stamp}`;
const ARCH = `e2e-arch-${stamp}`;
await call('POST', '/projects/SDLC/roles', {key: LONELY, name: `Одинокая ${stamp}`, version: {instructions: 'Роль без статуса.'}});
await call('POST', '/projects/SDLC/roles', {key: ARCH, name: `Архивная ${stamp}`, version: {instructions: 'Роль в архиве.'}});
await call('DELETE', `/projects/SDLC/roles/${ARCH}`);
await s.goto(BASE + '/p/SDLC/pipeline?type=task');
await pause(2000);
const lonely = await run(`return (document.querySelector('[data-pipeline-role-row="${LONELY}"]')?.innerText || '').replace(/\\s+/g, ' ');`);
check('роль без статуса — «ни на одном статусе»', lonely.includes('ни на одном статусе'), lonely);
const archHidden = await run(`return Boolean(document.querySelector('[data-pipeline-role-row="${ARCH}"]'));`);
check('архивная скрыта, пока переключатель выключен', archHidden === false);
await run(`
  const l = all('label').find((x) => x.innerText.trim().startsWith('Показать архивные'));
  document.getElementById(l.getAttribute('for')).click();
  await sleep(500);
  return true;
`);
const arch = await run(`return (document.querySelector('[data-pipeline-role-row="${ARCH}"]')?.innerText || '').replace(/\\s+/g, ' ');`);
check('«Показать архивные» добавляет архивную с пометкой', arch.includes('в архиве'), arch);

// ── документы версии на своей роли (CLAB-347) ───────────────────────────────
const DOCS = `e2e-docs-${stamp}`;
const SHOTS = process.env.SDLC_E2E_SHOTS;
// Снимок целиком проходит через окно 1×1: на широком экране панель на миг
// становится Sheet и открытая форма закрывается. Поэтому форму снимаем только
// на узком экране, а на широком — панель без формы.
const shot = async (name) => {
  if (SHOTS) writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(await s.screenshot(), 'base64'));
};
// Длинный документ: правки в начале и в конце, между ними 12 неизменённых
// строк — свёртка.
const rulesV1 = ['# Правила', '', '- первое правило', ...Array.from({length: 12}, (_, i) => `строка ${i + 1}`), '- последнее правило', ''].join('\n');
const rulesV2 = ['# Правила', '', '- первое правило, точнее', ...Array.from({length: 12}, (_, i) => `строка ${i + 1}`), '- последнее правило', '- новое правило', ''].join('\n');
const v1Docs = [
  {name: 'a-rules.md', kind: 'instructions', content: rulesV1},
  {name: 'b-check.md', kind: 'checklist', content: '- [ ] проверить\n- [ ] сдать\n'},
  {name: 'z-gone.md', kind: 'reference', content: 'уйдёт во второй версии\n'},
];
const v2Docs = [
  {name: 'a-rules.md', kind: 'instructions', content: rulesV2},
  {name: 'b-check.md', kind: 'checklist', content: '- [ ] проверить\n- [ ] сдать\n'},
  {name: 'c-ref.md', kind: 'reference', content: 'Справка: где что лежит.\n'},
];
const madeRole = await call('POST', '/projects/SDLC/roles', {
  key: DOCS,
  name: `Документы ${stamp}`,
  version: {documents: v1Docs, output_contract: [{kind: 'e2e.docs_report', required: true}], input_kinds: ['e2e.input']},
});
const madeV2 = await call('POST', `/projects/SDLC/roles/${DOCS}/versions`, {
  documents: v2Docs,
  changelog: 'вторая версия документами',
  output_contract: [{kind: 'e2e.docs_report', required: true}],
  input_kinds: ['e2e.input'],
  model_level: 'high',
});
check('своя роль с документами заведена (API)', madeRole.status === 201 && madeV2.status === 201 && madeV2.body?.version === 2,
  JSON.stringify([madeRole.status, madeV2.status, madeV2.body]).slice(0, 300));
const roleApi = (await call('GET', `/projects/SDLC/roles/${DOCS}`)).body;
const apiV1 = (await call('GET', `/projects/SDLC/roles/${DOCS}/versions/1`)).body;
const apiV2 = (await call('GET', `/projects/SDLC/roles/${DOCS}/versions/2`)).body;

console.log('документы последней версии (AC-347.10)');
await s.resize(1440, 900);
// Тема явно: «системная» в headless-Chrome следует за машиной.
await run(`localStorage.setItem('sdlc.theme', 'light'); return true;`);
await s.goto(`${BASE}/p/SDLC/pipeline?role=${DOCS}`);
await pause(1500);
// Сеть: какие ручки версии роли ушли из страницы.
const trackFetch = `
  if (!window.__urls) {
    window.__urls = [];
    const orig = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      window.__urls.push(((init?.method || 'GET').toUpperCase()) + ' ' + url);
      return orig(input, init);
    };
  }
`;
const rowsV2 = await run(`
  ${trackFetch}
  await waitFor('[data-role-version="2"] [data-role-documents]');
  return all('[data-role-version="2"] [data-role-document]').map((el) => ({
    name: el.getAttribute('data-role-document'), kind: el.getAttribute('data-role-document-kind'), sha: el.getAttribute('data-role-document-sha'),
    text: (el.innerText || '').replace(/\\s+/g, ' '),
  }));
`);
const wantV2 = (roleApi.latest_version?.documents ?? []).map((d) => ({name: d.name, kind: d.kind, sha: d.sha256.slice(0, 7)}));
check('строки документов в порядке position, имя, тип и sha256[0:7] равны API',
  rowsV2.length === 3 && JSON.stringify(rowsV2.map(({name, kind, sha}) => ({name, kind, sha}))) === JSON.stringify(wantV2) &&
    rowsV2.every((r) => r.text.includes(r.name) && r.text.includes(r.kind) && r.text.includes(r.sha)),
  JSON.stringify([rowsV2, wantV2]));
const prose = await run(`
  document.querySelector('[data-role-version="2"] [data-role-document="a-rules.md"] button').click();
  await sleep(300);
  const p = document.querySelector('[data-role-document="a-rules.md"] .prose-sdlc');
  return p ? {h1: Boolean(p.querySelector('h1')), li: p.querySelectorAll('li').length, url: location.search} : null;
`);
check('документ раскрывается отрисованным markdown: заголовок и список', prose?.h1 && prose.li >= 2, JSON.stringify(prose));
check('раскрытый документ — в адресе', prose?.url.includes('doc=a-rules.md'), prose?.url);
const meta = await run(`return document.querySelector('[data-role-version="2"]').innerText.replace(/\\s+/g, ' ');`);
check('рядом контракт вывода, вход и уровень', meta.includes('e2e.docs_report') && meta.includes('e2e.input') && /уровень/.test(meta) && meta.includes('Документы (3)'), meta.slice(0, 400));
await shot('role-docs-light');

console.log('прежняя версия по клику (AC-347.11)');
const v1Rows = await run(`
  document.querySelector('[data-role-version-row="1"]').click();
  await waitFor('[data-role-version="1"] [data-role-documents]');
  return {
    docs: all('[data-role-version="1"] [data-role-document]').map((el) => el.getAttribute('data-role-document') + ':' + el.getAttribute('data-role-document-sha')),
    urls: window.__urls.filter((u) => u.includes('/roles/${DOCS}/versions/')),
    first: (document.querySelector('[data-role-version-first]')?.innerText || '').trim(),
  };
`);
const wantV1 = apiV1.documents.map((d) => `${d.name}:${d.sha256.slice(0, 7)}`);
check('в сети виден GET …/versions/1', v1Rows.urls.some((u) => u.startsWith('GET ') && u.endsWith(`/roles/${DOCS}/versions/1`)), v1Rows.urls.join());
check('документы версии 1 совпадают с API', v1Rows.docs.join() === wantV1.join(), `${v1Rows.docs.join()} / ${wantV1.join()}`);
check('у версии 1 — «Первая версия: сравнивать не с чем»', v1Rows.first === 'Первая версия: сравнивать не с чем', v1Rows.first);

// Сбой подгрузки: подмена ответа GET …/versions/1 до кода страницы.
const failScript = await s.addInitScript(`
  (() => {
    const orig = window.fetch;
    window.__failStatus = Number(sessionStorage.getItem('e2e.failStatus') || 0);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (window.__failStatus && /\\/roles\\/${DOCS}\\/versions\\/1$/.test(url) && !(init?.method && init.method !== 'GET')) {
        const status = window.__failStatus;
        const body = status === 404 ? {error: {code: 'not_found', message: 'версия 1 роли не найдена'}} : {error: {code: 'internal', message: 'внутренняя ошибка сервера'}};
        return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
      }
      return orig(input, init);
    };
  })();
`);
await run(`sessionStorage.setItem('e2e.failStatus', '500'); return true;`);
await s.goto(`${BASE}/p/SDLC/pipeline?role=${DOCS}&v=1`);
await pause(1500);
let failed = await run(`
  const c = await waitFor('[data-role-version="1"]');
  await sleep(500);
  return {text: c.innerText.replace(/\\s+/g, ' '), retry: Boolean(Array.from(c.querySelectorAll('button')).find((b) => b.innerText.trim() === 'Повторить')),
    panel: Boolean(document.querySelector('[data-role-panel]')), rows: all('[data-role-version-row]').length};
`);
check('сбой 500 — Failure «Версия 1 не загрузилась» с «Повторить» внутри карточки',
  failed.text.includes('Версия 1 не загрузилась') && failed.text.includes('внутренняя ошибка сервера') && failed.retry, failed.text.slice(0, 300));
check('остальная панель на месте', failed.panel && failed.rows >= 1);
const retried = await run(`
  window.__failStatus = 0;
  Array.from(document.querySelector('[data-role-version="1"]').querySelectorAll('button')).find((b) => b.innerText.trim() === 'Повторить').click();
  await waitFor('[data-role-version="1"] [data-role-documents]');
  return all('[data-role-version="1"] [data-role-document]').length;
`);
check('«Повторить» восстанавливает карточку', retried === 3, String(retried));
await run(`sessionStorage.setItem('e2e.failStatus', '404'); return true;`);
await s.goto(`${BASE}/p/SDLC/pipeline?role=${DOCS}&v=1`);
await pause(1500);
failed = await run(`
  const c = await waitFor('[data-role-version="1"]');
  await sleep(500);
  return {text: c.innerText.replace(/\\s+/g, ' '), retry: Boolean(Array.from(c.querySelectorAll('button')).find((b) => b.innerText.trim() === 'Повторить'))};
`);
check('404 подгрузки — Failure с текстом сервера, без «Повторить»', failed.text.includes('версия 1 роли не найдена') && !failed.retry, failed.text.slice(0, 300));
await run(`sessionStorage.removeItem('e2e.failStatus'); return true;`);
await s.removeInitScript(failScript);

console.log('изменения против предыдущей версии (AC-347.12)');
await s.goto(`${BASE}/p/SDLC/pipeline?role=${DOCS}`);
await pause(1500);
const diff = await run(`
  await waitFor('[data-role-version="2"]');
  await press('Изменения против v1', 'button');
  await waitFor('[data-role-diff]');
  const d = document.querySelector('[data-role-diff]');
  const changed = d.querySelector('[data-diff-change="changed"]');
  return {
    docs: all('[data-role-diff] [data-diff-doc]').map((el) => el.getAttribute('data-diff-doc') + ':' + el.getAttribute('data-diff-change')),
    summary: (d.querySelector('[data-role-diff-summary]')?.innerText || '').trim(),
    plus: changed ? changed.querySelectorAll('[data-diff-line="added"]').length : 0,
    minus: changed ? changed.querySelectorAll('[data-diff-line="removed"]').length : 0,
    sr: changed ? Array.from(changed.querySelectorAll('.sr-only')).map((x) => x.textContent.trim()).filter(Boolean) : [],
    signs: changed ? (changed.querySelector('[data-diff-lines]')?.innerText || '') : '',
    folds: all('[data-role-diff] [data-diff-fold]').map((b) => b.innerText.trim()),
    url: location.search,
  };
`);
// Ожидаемое — по двум GET версии: имена и sha256.
const byName1 = new Map(apiV1.documents.map((d) => [d.name, d]));
const byName2 = new Map(apiV2.documents.map((d) => [d.name, d]));
const wantDiff = new Set([
  ...apiV2.documents.map((d) => `${d.name}:${!byName1.has(d.name) ? 'added' : byName1.get(d.name).sha256 === d.sha256 ? 'same' : 'changed'}`),
  ...apiV1.documents.filter((d) => !byName2.has(d.name)).map((d) => `${d.name}:removed`),
]);
check('по одному [data-diff-doc] на документ, пары «имя → изменение» равны вычисленным из двух GET',
  diff.docs.length === wantDiff.size && diff.docs.every((x) => wantDiff.has(x)), `${diff.docs.join()} / ${[...wantDiff].join()}`);
check('порядок: изменённые, добавленные, убранные, без изменений', diff.docs.join() === 'a-rules.md:changed,c-ref.md:added,z-gone.md:removed,b-check.md:same', diff.docs.join());
check('сводка', diff.summary === 'изменён 1 · добавлен 1 · убран 1 · без изменений 1', diff.summary);
check('у changed есть строки «+» и «−»', diff.plus === 2 && diff.minus === 1 && diff.signs.includes('+') && diff.signs.includes('−'), JSON.stringify(diff));
check('экранному чтецу — «добавлено:» и «убрано:»', diff.sr.includes('добавлено:') && diff.sr.includes('убрано:'), diff.sr.join());
check('неизменённый кусок свёрнут', diff.folds.some((f) => /^⋯ 13 строк без изменений — показать$/.test(f)), diff.folds.join(' | '));
check('режим — в адресе', diff.url.includes('view=diff'), diff.url);
const unfolded = await run(`
  document.querySelector('[data-role-diff] [data-diff-fold]').click();
  await sleep(300);
  const c = document.querySelector('[data-diff-change="changed"]');
  return {folds: c.querySelectorAll('[data-diff-fold]').length, same: c.querySelectorAll('[data-diff-line="same"]').length};
`);
check('свёрнутый кусок раскрывается кликом', unfolded.folds === 0 && unfolded.same >= 13, JSON.stringify(unfolded));
await shot('role-diff-light');

console.log('новая версия документами (AC-347.13)');
const versionsBefore = (await call('GET', `/projects/SDLC/roles/${DOCS}`)).body.versions.length;
await run(`
  window.__versionBodies = [];
  const orig = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if ((init?.method || '').toUpperCase() === 'POST' && /\\/roles\\/${DOCS}\\/versions$/.test(url)) window.__versionBodies.push(JSON.parse(init.body));
    return orig(input, init);
  };
  await clickExact('Новая версия');
  await waitFor('[data-new-version] [data-doc-editor]');
  return true;
`);
const form = await run(`
  const f = document.querySelector('[data-new-version]');
  return {
    width: f.getBoundingClientRect().width,
    rows: all('[data-new-version] [data-doc-row]').map((el) => el.getAttribute('data-doc-row') + ':' + el.getAttribute('data-doc-mark')),
    counter: (f.querySelector('[data-form-counter]')?.innerText || '').trim(),
    live: f.querySelector('[data-form-counter]')?.getAttribute('aria-live'),
    focus: document.activeElement?.id,
    up: all('[data-new-version] button[aria-label^="Поднять "]').map((b) => b.getAttribute('aria-label')),
    down: all('[data-new-version] button[aria-label^="Опустить "]').map((b) => b.getAttribute('aria-label')),
  };
`);
check('форма шире 600 px', form.width > 600, String(form.width));
check('копия последней версии без отметок', form.rows.join() === 'a-rules.md:same,b-check.md:same,c-ref.md:same', form.rows.join());
check('счётчик «Изменено 0 · добавлено 0 · убрано 0» в aria-live="polite"', form.counter === 'Изменено 0 · добавлено 0 · убрано 0' && form.live === 'polite', JSON.stringify(form));
check('кнопки порядка подписаны «Поднять <имя>»/«Опустить <имя>»', form.up.includes('Поднять c-ref.md') && form.down.includes('Опустить a-rules.md'), form.up.join());
check('фокус — в «Имя» первого документа', form.focus === 'role-doc-name', form.focus);
const edited = await run(`
  await fill('Содержимое', ${JSON.stringify(rulesV2 + '- ещё правило\n')});
  await clickExact('Добавить документ');
  const focusAfterAdd = document.activeElement?.id;
  await fill('Имя', 'd-new.md');
  await fill('Содержимое', 'Новый документ.');
  document.querySelector('button[aria-label="Поднять c-ref.md"]').click();
  await sleep(300);
  await fill('Что изменилось', 'правка, добавление, перестановка');
  return {
    focusAfterAdd,
    rows: all('[data-new-version] [data-doc-row]').map((el) => el.getAttribute('data-doc-row') + ':' + el.getAttribute('data-doc-mark')),
    counter: (document.querySelector('[data-form-counter]')?.innerText || '').trim(),
  };
`);
check('после «Добавить документ» фокус в «Имя» нового', edited.focusAfterAdd === 'role-doc-name', edited.focusAfterAdd);
check('строки: изменён, переставлен без отметки, новый', edited.rows.join() === 'a-rules.md:changed,c-ref.md:same,b-check.md:same,d-new.md:added', edited.rows.join());
check('счётчик «Изменено 1 · добавлено 1 · убрано 0»', edited.counter === 'Изменено 1 · добавлено 1 · убрано 0', edited.counter);
const saved = await run(`
  await clickExact('Сохранить версию');
  await sleep(1800);
  const card = document.querySelector('[data-role-version]');
  return {
    bodies: window.__versionBodies,
    form: Boolean(document.querySelector('[data-new-version]')),
    toasts: toasts(),
    card: card?.getAttribute('data-role-version'),
    view: card?.querySelector('[data-role-version-view]')?.getAttribute('data-role-version-view'),
    diff: all('[data-role-diff] [data-diff-doc]').map((el) => el.getAttribute('data-diff-doc') + ':' + el.getAttribute('data-diff-change')),
    moved: all('[data-role-diff] [data-diff-mark="moved"]').length,
    movedName: document.querySelector('[data-role-diff] [data-diff-mark="moved"]')?.closest('[data-diff-doc]')?.getAttribute('data-diff-doc'),
    focus: document.activeElement?.tagName,
  };
`);
const sentBody = saved.bodies[saved.bodies.length - 1] ?? {};
check('один POST …/versions', saved.bodies.length === 1, String(saved.bodies.length));
check('тело: documents по строкам {name, kind, content}, без instructions',
  JSON.stringify((sentBody.documents ?? []).map((d) => Object.keys(d).sort().join('|') + ':' + d.name)) ===
    JSON.stringify(['content|kind|name:a-rules.md', 'content|kind|name:c-ref.md', 'content|kind|name:b-check.md', 'content|kind|name:d-new.md']) &&
    !('instructions' in sentBody), JSON.stringify(sentBody).slice(0, 400));
check('тело: changelog, input_kinds, контракт и уровень базы',
  sentBody.changelog === 'правка, добавление, перестановка' && JSON.stringify(sentBody.input_kinds) === '["e2e.input"]' &&
    sentBody.output_contract?.[0]?.kind === 'e2e.docs_report' && sentBody.model_level === 'high', JSON.stringify(sentBody).slice(0, 400));
const apiV3 = (await call('GET', `/projects/SDLC/roles/${DOCS}/versions/3`)).body;
check('ответ — версия 3 с документами в порядке строк', apiV3?.documents?.map((d) => d.name).join() === 'a-rules.md,c-ref.md,b-check.md,d-new.md', JSON.stringify(apiV3?.documents?.map((d) => d.name)));
const sha2 = new Map(apiV2.documents.map((d) => [d.name, d.sha256]));
check('у неизменённых документов sha256 тот же, что у версии 2',
  ['b-check.md', 'c-ref.md'].every((n) => apiV3.documents.find((d) => d.name === n)?.sha256 === sha2.get(n)));
check('тост «Версия 3 роли <ключ> создана»', saved.toasts.some((x) => x.includes(`Версия 3 роли ${DOCS} создана`)), saved.toasts.join(' | '));
check('форма закрыта, раскрыта версия 3 в режиме «Изменения»', !saved.form && saved.card === '3' && saved.view === 'diff', JSON.stringify(saved));
check('в изменениях один changed, один added, остальные same, отметка «переставлен»',
  saved.diff.join() === 'a-rules.md:changed,d-new.md:added,c-ref.md:same,b-check.md:same' && saved.moved === 1 && saved.movedName === 'c-ref.md', JSON.stringify(saved.diff) + saved.moved);
check('фокус — на заголовке новой версии', saved.focus === 'H3', saved.focus);
const versionsAfter = (await call('GET', `/projects/SDLC/roles/${DOCS}`)).body.versions.length;
check('число версий выросло ровно на одну', versionsAfter === versionsBefore + 1, `${versionsBefore} → ${versionsAfter}`);
// Роль не стоит на статусах (своя, а не демонстрационная), поэтому vN+1
// сверяется в обзоре; узел схемы с vN+1 проверен выше на analyst.
await s.goto(BASE + '/p/SDLC/pipeline?type=task');
await pause(1500);
const overviewRow = await run(`return (await waitFor('[data-pipeline-role-row="${DOCS}"]')).innerText.replace(/\\s+/g, ' ');`);
check('в обзоре у роли v3 после перезапроса', overviewRow.includes('v3'), overviewRow);
await s.goto(`${BASE}/p/SDLC/pipeline?role=${DOCS}&view=diff`);
await pause(1500);
await run(`await waitFor('[data-role-diff]'); return true;`);

console.log('отказ 400 у формы (AC-347.14)');
const refused400 = await run(`
  window.__versionBodies = [];
  const orig = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if ((init?.method || '').toUpperCase() === 'POST' && /\\/roles\\/${DOCS}\\/versions$/.test(url)) window.__versionBodies.push(JSON.parse(init.body));
    return orig(input, init);
  };
  await clickExact('Новая версия');
  await waitFor('[data-new-version] [data-doc-editor]');
  document.querySelector('[data-doc-row="b-check.md"] button').click();
  await sleep(200);
  await fill('Имя', 'a-rules.md');
  document.querySelector('[data-doc-row="d-new.md"] button').click();
  await sleep(200);
  await fill('Содержимое', 'Новый документ, правка до отказа.');
  await clickExact('Сохранить версию');
  await sleep(1200);
  const fail = document.querySelector('[data-form-failure]');
  const name = document.getElementById('role-doc-name');
  return {
    text: fail ? fail.innerText.replace(/\\s+/g, ' ') : '',
    focused: document.activeElement === fail,
    name: name?.value, invalid: name?.getAttribute('aria-invalid'),
    row: document.querySelector('[data-doc-row][aria-invalid="true"]')?.getAttribute('data-doc-row'),
    current: document.querySelector('[data-new-version] [aria-current="true"]')?.closest('[data-doc-row]')?.getAttribute('data-doc-row'),
    body: window.__versionBodies[window.__versionBodies.length - 1],
  };
`);
const direct = await call('POST', `/projects/SDLC/roles/${DOCS}/versions`, refused400.body);
check('сервер отклоняет то же тело 400', direct.status === 400, JSON.stringify(direct).slice(0, 200));
check('над формой «Версия не создана» с текстом сервера дословно',
  refused400.text.includes('Версия не создана') && refused400.text.includes(direct.body?.error?.message ?? '—'), `${refused400.text} / ${direct.body?.error?.message}`);
check('фокус на сообщении отказа', refused400.focused === true);
check('поле имени названного документа aria-invalid, строка подсвечена и выбрана',
  refused400.invalid === 'true' && refused400.name === 'a-rules.md' && refused400.row === 'a-rules.md' && refused400.current === 'a-rules.md', JSON.stringify(refused400));
const kept = await run(`
  document.querySelector('[data-doc-row="d-new.md"] button').click();
  await sleep(200);
  return document.getElementById('role-doc-content').value;
`);
check('введённый текст на месте', kept === 'Новый документ, правка до отказа.', kept);
const cleared = await run(`
  document.querySelector('[data-doc-row][aria-invalid="true"] button').click();
  await sleep(200);
  await fill('Имя', 'b-check.md');
  return {invalid: document.getElementById('role-doc-name').getAttribute('aria-invalid'), rows: all('[data-doc-row][aria-invalid]').length,
    failure: Boolean(document.querySelector('[data-form-failure]'))};
`);
check('правка названного документа снимает подсветку, сообщение остаётся', cleared.invalid === null && cleared.rows === 0 && cleared.failure, JSON.stringify(cleared));
check('число версий не изменилось', (await call('GET', `/projects/SDLC/roles/${DOCS}`)).body.versions.length === versionsAfter);

console.log('отказ 403 у формы (AC-347.15)');
const refused403 = await run(`
  const orig = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if ((init?.method || '').toUpperCase() === 'POST' && /\\/roles\\/${DOCS}\\/versions$/.test(url)) {
      return new Response(JSON.stringify({error: {code: 'forbidden', message: 'нужен уровень maintainer в проекте SDLC'}}), {status: 403, headers: {'Content-Type': 'application/json'}});
    }
    return orig(input, init);
  };
  await clickExact('Сохранить версию');
  await sleep(900);
  window.fetch = orig;
  const btn = (t) => all('button').find((b) => (b.innerText || '').trim() === t);
  return {
    text: (document.querySelector('[data-form-failure]')?.innerText || '').replace(/\\s+/g, ' '),
    form: Boolean(document.querySelector('[data-new-version]')),
    newVersion: Boolean(btn('Новая версия')) && !btn('Новая версия').disabled,
    save: Boolean(btn('Сохранить версию')) && !btn('Сохранить версию').disabled,
  };
`);
check('403 — «Версия не создана» с текстом сервера', refused403.text.includes('Версия не создана') && refused403.text.includes('нужен уровень maintainer в проекте SDLC'), refused403.text);
check('кнопки «Новая версия» и «Сохранить версию» на месте и доступны, форма не закрыта', refused403.form && refused403.newVersion && refused403.save, JSON.stringify(refused403));
await run(`await clickExact('Отмена'); return true;`);

console.log('убрать, вернуть, переименовать (AC-347.5 на экране)');
const ops = await run(`
  await clickExact('Новая версия');
  await waitFor('[data-new-version] [data-doc-editor]');
  document.querySelector('[data-doc-row="b-check.md"] button').click();
  await sleep(200);
  await clickExact('Убрать документ');
  const removed = {
    mark: document.querySelector('[data-doc-row="b-check.md"]').getAttribute('data-doc-mark'),
    number: document.querySelector('[data-doc-row="b-check.md"] [data-doc-number]').innerText.trim(),
    card: Boolean(document.querySelector('[data-doc-card-removed]')),
    focus: document.activeElement?.innerText?.trim(),
    counter: document.querySelector('[data-form-counter]').innerText.trim(),
  };
  await clickExact('Вернуть документ');
  const restored = {mark: document.querySelector('[data-doc-row="b-check.md"]').getAttribute('data-doc-mark'), focus: document.activeElement?.id,
    counter: document.querySelector('[data-form-counter]').innerText.trim()};
  await fill('Имя', 'vcs.md');
  const renamed = {
    mark: document.querySelector('[data-doc-row="vcs.md"]')?.getAttribute('data-doc-mark'),
    was: (document.querySelector('[data-doc-row="vcs.md"] [data-doc-was]')?.innerText || '').trim(),
    hint: Boolean(document.querySelector('[data-rename-hint]')),
    counter: document.querySelector('[data-form-counter]').innerText.trim(),
  };
  await clickExact('Добавить документ');
  await fill('Содержимое', 'текст нового');
  await clickExact('Убрать документ');
  const dialog = (document.querySelector('[role=alertdialog]')?.innerText || '').replace(/\\s+/g, ' ');
  await confirm('Убрать документ');
  const gone = {rows: all('[data-new-version] [data-doc-row]').map((el) => el.getAttribute('data-doc-row')), counter: document.querySelector('[data-form-counter]').innerText.trim()};
  await clickExact('Отмена');
  return {removed, restored, renamed, dialog, gone};
`);
check('убранный документ остаётся строкой «убран» с номером «–», карточка «убран из новой версии»',
  ops.removed.mark === 'removed' && ops.removed.number === '–' && ops.removed.card && ops.removed.counter === 'Изменено 0 · добавлено 0 · убрано 1', JSON.stringify(ops.removed));
check('фокус после «Убрать документ» — на «Вернуть документ»', ops.removed.focus === 'Вернуть документ', ops.removed.focus);
check('«Вернуть документ» — исходная отметка, фокус в «Имя»', ops.restored.mark === 'same' && ops.restored.focus === 'role-doc-name' && ops.restored.counter === 'Изменено 0 · добавлено 0 · убрано 0', JSON.stringify(ops.restored));
check('переименование — «новый», «было <имя>», пояснение и счётчик «добавлено 1 · убрано 1»',
  ops.renamed.mark === 'renamed' && ops.renamed.was === 'было b-check.md' && ops.renamed.hint && ops.renamed.counter === 'Изменено 0 · добавлено 1 · убрано 1', JSON.stringify(ops.renamed));
check('убрать новый документ с текстом — через подтверждение', ops.dialog.includes('Убрать новый документ?') && ops.dialog.includes('ещё не сохранён'), ops.dialog);
check('после подтверждения строка исчезла, счётчик назад', !ops.gone.rows.some((r) => r.startsWith('new-')) && ops.gone.counter === 'Изменено 0 · добавлено 1 · убрано 1', JSON.stringify(ops.gone));

console.log('состояние в адресе (AC-347.17)');
await s.goto(`${BASE}/p/SDLC/pipeline?role=${DOCS}`);
await pause(1500);
const addr = await run(`
  await waitFor('[data-role-version-row="2"]');
  document.querySelector('[data-role-version-row="2"]').click();
  await waitFor('[data-role-version="2"]');
  await press('Изменения против v1', 'button');
  await waitFor('[data-role-diff]');
  document.querySelector('[data-diff-doc="c-ref.md"] button').click();
  await sleep(500);
  return location.search;
`);
const qs = new URLSearchParams(addr);
check('адрес содержит v=2, view=diff и doc=<имя>', qs.get('v') === '2' && qs.get('view') === 'diff' && qs.get('doc') === 'c-ref.md', addr);
await s.goto(`${BASE}/p/SDLC/pipeline${addr}`);
await pause(1500);
const reloaded = await run(`
  await waitFor('[data-role-diff]');
  return {card: document.querySelector('[data-role-version]')?.getAttribute('data-role-version'),
    open: document.querySelector('[data-diff-doc="c-ref.md"] button')?.getAttribute('aria-expanded')};
`);
check('перезагрузка возвращает версию, режим и документ', reloaded.card === '2' && reloaded.open === 'true', JSON.stringify(reloaded));
const back = await run(`
  document.querySelector('[data-diff-doc="c-ref.md"] button').click();
  await sleep(400);
  const closed = location.search;
  history.back();
  await sleep(800);
  return {closed, back: location.search, open: document.querySelector('[data-diff-doc="c-ref.md"] button')?.getAttribute('aria-expanded')};
`);
check('«Назад» возвращает прежнее', new URLSearchParams(back.closed).get('doc') === null && new URLSearchParams(back.back).get('doc') === 'c-ref.md' && back.open === 'true', JSON.stringify(back));
await s.goto(`${BASE}/p/SDLC/pipeline?role=${DOCS}&v=2&view=bogus&doc=нет-такого`);
await pause(1500);
const bogus = await run(`
  await waitFor('[data-role-version="2"] [data-role-documents]');
  return {mode: document.querySelector('[data-role-version-view]')?.getAttribute('data-role-version-view'), open: all('[data-role-document] .prose-sdlc').length, failure: texts().includes('Не получилось')};
`);
check('view=bogus и doc=нет-такого — без ошибки, как отсутствие', bogus.mode === 'docs' && bogus.open === 0 && !bogus.failure, JSON.stringify(bogus));

console.log('ответ прежнего backend без documents (AC-347.18)');
const legacy = await s.addInitScript(`
  (() => {
    const orig = window.fetch;
    const strip = (v) => { if (v && typeof v === 'object') delete v.documents; return v; };
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      const res = await orig(input, init);
      if ((init?.method || 'GET').toUpperCase() !== 'GET' || !/\\/roles\\/${DOCS}(\\/versions\\/\\d+)?$/.test(url) || !res.ok) return res;
      const body = await res.json();
      (body.versions || []).forEach(strip);
      strip(body.latest_version);
      strip(body);
      return new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}});
    };
  })();
`);
await s.goto(`${BASE}/p/SDLC/pipeline?role=${DOCS}&v=2&view=diff`);
await pause(1800);
const old = await run(`
  await waitFor('[data-role-version="2"]');
  await sleep(500);
  return {
    diff: all('[data-role-diff] [data-diff-doc]').map((el) => el.getAttribute('data-diff-doc') + ':' + el.getAttribute('data-diff-change')),
  };
`);
await s.goto(`${BASE}/p/SDLC/pipeline?role=${DOCS}`);
await pause(1500);
const oldDocs = await run(`
  await waitFor('[data-role-version="3"] [data-role-documents]');
  return all('[data-role-version="3"] [data-role-document]').map((el) => el.getAttribute('data-role-document') + ':' + el.getAttribute('data-role-document-kind') + ':' + el.getAttribute('data-role-document-sha'));
`);
await s.removeInitScript(legacy);
check('без documents — один main.md типа instructions без sha256', oldDocs.join() === 'main.md:instructions:', oldDocs.join());
check('дифф v2 против v1 — по одному документу', old.diff.join() === 'main.md:changed', old.diff.join());

console.log('узкий экран и тёмная тема (AC-347.19)');
await s.resize(390, 844);
await s.goto(`${BASE}/p/SDLC/pipeline?role=${DOCS}`);
await pause(1800);
const narrow = await run(`
  await waitFor('[data-role-panel]');
  await clickExact('Новая версия');
  await waitFor('[data-new-version] [data-doc-editor]');
  await sleep(400);
  const sheet = document.querySelector('[data-pipeline-inspector]');
  const save = all('button').find((b) => (b.innerText || '').trim() === 'Сохранить версию');
  const r = save.getBoundingClientRect();
  const row = document.querySelector('[data-doc-row]').getBoundingClientRect();
  const up = document.querySelector('[data-new-version] button[aria-label^="Опустить "]').getBoundingClientRect();
  return {
    pageScroll: document.documentElement.scrollWidth - window.innerWidth,
    sheetScroll: sheet ? sheet.scrollWidth - sheet.clientWidth : -1,
    saveVisible: r.bottom <= window.innerHeight && r.top >= 0,
    row: row.height, up: [up.width, up.height],
  };
`);
check('на 390 px горизонтальной прокрутки нет', narrow.pageScroll <= 0 && narrow.sheetScroll <= 0, JSON.stringify(narrow));
check('«Сохранить версию» достижима (липкий подвал в первом экране)', narrow.saveVisible, JSON.stringify(narrow));
check('строка списка не ниже 44 px, кнопки порядка 32 px', narrow.row >= 44 && narrow.up[0] >= 32 && narrow.up[1] >= 32, JSON.stringify(narrow));
await shot('role-form-390');
await run(`localStorage.setItem('sdlc.theme', 'dark'); return true;`);
await s.goto(`${BASE}/p/SDLC/pipeline?role=${DOCS}&view=diff`);
await pause(1500);
const darkOk = await run(`await waitFor('[data-role-diff]'); return document.documentElement.classList.contains('dark');`);
check('дифф в тёмной теме рисуется', darkOk === true);
await shot('role-diff-dark-390');
await run(`localStorage.removeItem('sdlc.theme'); return true;`);
await s.resize(1440, 900);

console.log('пустой проект: «Завести роль»');
const KEY = 'ROLESE2E';
await call('DELETE', `/projects/${KEY}`, undefined, 'web');
const project = await call('POST', '/projects', {key: KEY, name: 'Роли: пустой проект'}, 'web');
if (project.status !== 201 && project.status !== 200) {
  check('пустой проект заведён', false, JSON.stringify(project).slice(0, 300));
} else {
  await s.goto(`${BASE}/p/${KEY}/pipeline`);
  await pause(2000);
  t = await run('return texts();');
  check('у проекта без цикла — «Цикла для типа … нет» с двумя путями', t.includes('Цикла для типа task нет') && t.includes('Пустой черновик'), t.slice(0, 400));
  check('в пустом проекте — «Заведите роль»', t.includes('Заведите роль'), t.slice(0, 400));
  await run(`
    window.__roleBodies = [];
    const orig = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if ((init?.method || '').toUpperCase() === 'POST' && /\\/roles$/.test(url)) window.__roleBodies.push(JSON.parse(init.body));
      return orig(input, init);
    };
    await clickExact("Завести роль");
    await fill("Ключ", "scout");
    await fill("Название", "Разведчик");
    await fill("Описание", "Смотрит, что есть");
    await fill("Содержимое", "Ты разведчик.");
    return true;
  `);
  const newRole = await run(`
    const f = document.querySelector('[data-new-role]');
    return f ? {rows: all('[data-new-role] [data-doc-row]').map((el) => el.getAttribute('data-doc-row') + ':' + el.getAttribute('data-doc-mark')),
      editor: Boolean(f.querySelector('[data-doc-editor]')), text: f.innerText.replace(/\\s+/g, ' ')} : null;
  `);
  check('«Завести роль»: ключ, название, описание и редактор с одним main.md',
    newRole?.editor && newRole.rows.join() === 'main.md:added' && newRole.text.includes('Ключ') && newRole.text.includes('Название') && newRole.text.includes('Описание'),
    JSON.stringify(newRole));
  // Отказ сервера — у формы, введённое не теряется.
  const refused = await run(`
    const orig = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if ((init?.method || '').toUpperCase() === 'POST' && /\\/roles$/.test(url)) {
        return new Response(JSON.stringify({error: {code: 'conflict', message: 'роль с таким ключом уже есть'}}), {status: 409, headers: {'Content-Type': 'application/json'}});
      }
      return orig(input, init);
    };
    all('button').filter((b) => (b.innerText || '').trim() === 'Завести роль').pop().click();
    await sleep(900);
    window.fetch = orig;
    const key = all('label').find((x) => x.innerText.trim().startsWith('Ключ'));
    return {text: texts(), key: document.getElementById(key.getAttribute('for')).value};
  `);
  check('отказ виден у формы, введённое осталось',
    refused.text.includes('Роль не заведена') && refused.text.includes('роль с таким ключом уже есть') && refused.key === 'scout', refused.text.slice(0, 300));
  const done = await run(`
    all('button').filter((b) => (b.innerText || '').trim() === 'Завести роль').pop().click();
    await sleep(1500);
    return {bodies: window.__roleBodies, url: location.search, panel: Boolean(document.querySelector('[data-role-panel="scout"]')), toasts: toasts()};
  `);
  const body = done.bodies[done.bodies.length - 1] ?? {};
  check('POST …/roles несёт ключ, название, описание и первую версию',
    body.key === 'scout' && body.name === 'Разведчик' && body.summary === 'Смотрит, что есть' &&
      JSON.stringify(body.version?.documents) === JSON.stringify([{name: 'main.md', kind: 'instructions', content: 'Ты разведчик.'}]) &&
      !('instructions' in (body.version ?? {})),
    JSON.stringify(done.bodies));
  check('роль заведена и открыта её панель', done.panel && done.url.includes('role=scout'), JSON.stringify(done));
  check('тост называет роль', done.toasts.some((x) => x.includes('scout') && x.includes('создана')), done.toasts.join(' | '));
  const v1api = (await call('GET', `/projects/${KEY}/roles/scout/versions/1`, undefined, 'web')).body;
  check('первая версия создана документами', v1api?.instructions === 'Ты разведчик.' && v1api.documents?.length === 1 && v1api.documents[0].name === 'main.md',
    JSON.stringify(v1api).slice(0, 300));
  await call('DELETE', `/projects/${KEY}`, undefined, 'web');
}

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
