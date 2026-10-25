import {session, helpers} from './driver.mjs';

// Схема цикла после смены версии (CLAB-284, решения 0016 и 0036). Идёт
// сразу после workflow.mjs: тот активирует новую версию цикла задач. Задача,
// начатая на прежней версии (SDLC-1), показывает прежнюю; задача из бэклога,
// которую не начинали, переехала на новую и показывает её. Версию и статусы
// сценарий сверяет с ответом GET /v1/workflows/:id по workflow_id задачи.
const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
const API = process.env.SDLC_API_URL ?? 'http://localhost:8088';
const get = (path) => fetch(API + path, {headers: {'X-SDLC-Actor': 'e2e'}}).then((r) => r.json());
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const {tasks} = await get('/v1/projects/SDLC/tasks');
const heads = await get('/v1/projects/SDLC/workflows');
const active = (Array.isArray(heads) ? heads : heads.workflows ?? [])
  .find((w) => w.state === 'active' && w.task_types.includes('task'));
const started = (await get('/v1/tasks/SDLC-1')).task;
const backlog = tasks.find((t) => t.key !== started.key && t.properties?.type !== 'epic' && t.workflow_id === active.id &&
  t.status_key === 'new');

const s = await session(BASE + '/p/SDLC/tasks/SDLC-1');
const run = (body) => s.evaluate(helpers + body);
const diagram = async (key) => {
  await s.goto(BASE + `/p/SDLC/tasks/${key}`);
  await wait(1800);
  return run(`
    const d = document.querySelector('[data-cycle-diagram]');
    return d ? {
      version: d.getAttribute('data-cycle-version'),
      keys: all('[data-cycle-status]').map((n) => n.getAttribute('data-cycle-status')),
    } : null;
  `);
};
const expected = async (workflowId) => {
  const w = await get(`/v1/workflows/${workflowId}`);
  return {version: String(w.version), keys: [...w.statuses].sort((a, b) => a.position - b.position).map((x) => x.key)};
};

console.log('схема цикла после активации новой версии');
const oldWant = await expected(started.workflow_id);
const oldShown = await diagram(started.key);
check(`${started.key} начата на прежней версии`, started.workflow_id !== active.id, started.workflow_id);
check(`${started.key} показывает свою версию, а не активную`,
  oldShown?.version === oldWant.version && oldShown.version !== String(active.version), JSON.stringify({oldShown, oldWant}));
check(`${started.key}: статусы своей версии в её порядке`, oldShown?.keys.join() === oldWant.keys.join(), JSON.stringify(oldShown?.keys));

if (backlog) {
  const newWant = await expected(backlog.workflow_id);
  const newShown = await diagram(backlog.key);
  check(`${backlog.key} из бэклога показывает новую версию`,
    newShown?.version === String(active.version) && newShown.version === newWant.version, JSON.stringify({newShown, newWant}));
  check(`${backlog.key}: статусы новой версии в её порядке`, newShown?.keys.join() === newWant.keys.join(), JSON.stringify(newShown?.keys));
} else {
  fail++;
  console.log('  ✗ на новой версии нет задачи из бэклога', JSON.stringify(tasks.map((t) => [t.key, t.status_key])));
}

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
