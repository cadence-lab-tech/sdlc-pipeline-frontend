// Модули src/ импортируют друг друга без расширения, как требует сборщик, а
// node расширение сам не подставляет: хук добавляет `.ts` к относительному
// пути, который не нашёлся. Нужен сценариям, читающим исходники прямо из src/
// (components/cli.ts тянет за собой settings/tabs.ts). Подключать до импорта
// этих модулей и импортировать их динамически: статические импорты
// разрешаются раньше, чем выполнится любой код сценария.
import {registerHooks} from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(specifier + '.ts', context);
      throw err;
    }
  },
});
