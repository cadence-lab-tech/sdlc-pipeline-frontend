// Сцена для терминала на странице входа: статичные данные, без единого
// запроса к API. Команды настоящие — сверены с `clab --help` и
// `docs/MCP_CONTRACT.md`; выдуманного вывода здесь быть не должно, иначе
// первое, что увидит коллега, окажется неправдой.

export type Line =
  | {kind: 'prompt'; text: string}
  | {kind: 'output'; text: string}
  | {kind: 'accent'; text: string};

export type Scene = {
  title: string;
  lines: Line[];
};

export const SCENES: Scene[] = [
  {
    title: 'Вход с машины разработчика',
    lines: [
      {kind: 'prompt', text: 'clab auth login --host https://sdlc.example.com'},
      {kind: 'output', text: 'Код подтверждения: KRTX-9QFD'},
      {kind: 'output', text: 'Откройте в браузере: https://sdlc.example.com/login/cli'},
      {kind: 'accent', text: 'Вошли на sdlc.example.com как user:anna, токен до 12.09.2027.'},
    ],
  },
  {
    title: 'Агент подключается к проекту',
    lines: [
      {kind: 'prompt', text: 'clab mcp install --project SDLC'},
      {kind: 'output', text: 'MCP-сервер sdlc подключён к проекту SDLC (local).'},
      {kind: 'output', text: 'В агенте: /mcp__sdlc__work_on_task <ключ задачи>'},
      {kind: 'accent', text: 'агент видит задачи проекта со своей машины'},
    ],
  },
  {
    title: 'Агент берёт этап и сдаёт работу',
    lines: [
      {kind: 'prompt', text: '/mcp__sdlc__work_on_task SDLC-42'},
      {kind: 'output', text: 'этап analysis, роль analytics, аренда на 30 минут'},
      {kind: 'output', text: 'контракт: analysis.requirements, analysis.acceptance_criteria'},
      {kind: 'accent', text: 'Сдан analysis.requirements v1 «Требования», 4812 байт (5f187335)'},
    ],
  },
  {
    title: 'Переход закрыт гейтами',
    lines: [
      {kind: 'prompt', text: 'clab gates SDLC-42'},
      {kind: 'output', text: '✗ analysis_done → development (Аналитика готова)'},
      {kind: 'output', text: '    [passed] artifacts (artifacts_required)'},
      {kind: 'output', text: '    [pending] human_approval (human_approval) — апрувов 0 из 1'},
      {kind: 'accent', text: 'последнее слово за человеком'},
    ],
  },
  {
    title: 'Человек утвердил — задача идёт дальше',
    lines: [
      {kind: 'prompt', text: 'clab transition SDLC-42 --to analysis_done'},
      {kind: 'output', text: 'SDLC-42: analysis → development'},
      {kind: 'accent', text: 'дальше этап забирает агент в роли разработчика'},
    ],
  },
];
