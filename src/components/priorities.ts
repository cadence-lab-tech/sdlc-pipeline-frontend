// Приоритеты — перечень схемы (`CHECK` в `migrations/000003_tasks.up.sql`), а
// не данные проекта: в отличие от статусов и ролей их набор фиксирован, и
// выбор из четырёх значений строится по нему. Список один на все формы, где
// приоритет задаётся: заводится задача или правится её постановка.
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export const PRIORITY_OPTIONS = PRIORITIES.map((p) => ({value: p, label: p}));
