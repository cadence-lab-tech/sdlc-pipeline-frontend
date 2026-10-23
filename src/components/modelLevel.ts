// Уровень модели (решение 0060): подписи, строка прогона и право правки
// уровня задачи. Без разметки, чтобы правила проверялись в e2e/labels.mjs без
// браузера, а панель этапа CLAB-231 взяла их отсюда, а не написала свои.
import type {Me, ModelLevel, ProjectTeam, StageRun} from '../api/types';

// Уровни — перечень сервера, а не данные проекта: набор фиксирован, как у
// приоритетов. «Авто» — не уровень, а его отсутствие: в запросе это "", в
// ответе null или нет поля.
export const MODEL_LEVELS: ModelLevel[] = ['low', 'medium', 'high'];

export const AUTO_LABEL = 'авто';

// Подпись уровня — сам ключ: low, medium и high читаются без перевода и
// совпадают с тем, что пишут в CLI и MCP. Незнакомый ключ показывается как
// есть — уровень может появиться на сервере раньше, чем здесь.
const LEVEL_LABELS: Record<string, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
};

export function modelLevelLabel(level: string | null | undefined): string {
  if (!level) return AUTO_LABEL;
  return LEVEL_LABELS[level] ?? level;
}

// Строка прогона «рекомендован high · фактически claude-opus-5-5».
//
// Рекомендованная часть — из снимка при захвате: источник none — «авто»,
// снимка нет (прогон до миграции или ещё не забран) — части нет. Фактическая
// — из учёта: модели в порядке отчётов; отчёта нет — «нет данных», но только
// рядом со снимком: прогон без снимка и без отчёта строки не получает
// вовсе. Объекта usage нет (бэкенд без CLAB-264) — фактической части нет.
// Источник, стоимость и токены сюда не входят.
export function runModelLine(
  run: Pick<StageRun, 'model_level' | 'model_level_source' | 'usage'>,
): string | null {
  const hasSnapshot = Boolean(run.model_level_source || run.model_level);
  const parts: string[] = [];

  if (hasSnapshot) {
    parts.push(
      run.model_level_source === 'none' || !run.model_level
        ? `рекомендован: ${AUTO_LABEL}`
        : `рекомендован ${modelLevelLabel(run.model_level)}`,
    );
  }

  const usage = run.usage;
  if (usage) {
    const models = (usage.models ?? []).filter(Boolean);
    if (usage.reported && models.length > 0) parts.push(`фактически ${models.join(', ')}`);
    else if (hasSnapshot) parts.push('фактически: нет данных');
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

const EDITOR_LEVELS = new Set(['maintainer', 'admin']);

// Может ли человек сдвинуть уровень задачи — подсказка интерфейса, а не
// проверка: решает сервер. Поэтому «не знаю» (кто я или команды проекта не
// загрузились) — это «можно», и отказ покажется у ползунка.
//
// Право — уровень maintainer или admin в проекте, тем же максимумом путей,
// что у бэкенда: поимённое участие, команда проекта, лид команды-владельца;
// плюс администратор системы. В режиме header ограничений нет. Агент правит
// уровень только своей задачи с живой арендой — через CLI и MCP, поэтому в
// интерфейсе ему ползунок только для чтения.
export function canEditTaskLevel({
  me,
  projectKey,
  ownerTeamKey,
  projectTeams,
}: {
  me: Me | undefined;
  projectKey: string;
  ownerTeamKey?: string;
  // undefined — состав команд проекта неизвестен (не загрузился).
  projectTeams: ProjectTeam[] | undefined;
}): boolean {
  if (!me) return true;
  if (me.mode === 'header') return true;
  if (me.principal?.is_admin) return true;
  if ((me.memberships ?? []).some((m) => m.project_key === projectKey && EDITOR_LEVELS.has(m.role))) {
    return true;
  }
  const myTeams = me.teams ?? [];
  if (ownerTeamKey && myTeams.some((t) => t.team_key === ownerTeamKey && t.role === 'lead')) return true;
  if (!projectTeams) return true;
  const mine = new Set(myTeams.map((t) => t.team_key));
  return projectTeams.some((pt) => mine.has(pt.team_key) && EDITOR_LEVELS.has(pt.level));
}

// Нужен ли состав команд проекта, чтобы ответить на вопрос выше: без него
// обходятся режим header, администратор системы и прямое право.
export function needsProjectTeams(me: Me | undefined, projectKey: string, ownerTeamKey?: string): boolean {
  if (!me || me.mode === 'header' || me.principal?.is_admin) return false;
  return !canEditTaskLevel({me, projectKey, ownerTeamKey, projectTeams: []});
}
