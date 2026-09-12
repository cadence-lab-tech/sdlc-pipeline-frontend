import {useEffect, useState} from 'react';

import {SCENES, type Line, type Scene} from './scene';

// Терминал на странице входа: то, чего не видно ни на одном экране трекера —
// работу делает агент со своей машины, а сервис держит гейты. Сцена статична,
// в API не ходит и лежит отдельным модулем, который грузится лениво.

const TYPE_MS = 18;
const LINE_PAUSE_MS = 260;
const SCENE_PAUSE_MS = 2600;

export default function Terminal() {
  const reduced = usePrefersReducedMotion();
  return reduced ? <Frame scene={SCENES[SCENES.length - 1]} full /> : <Player />;
}

// Проигрыватель печатает строки по одной и переходит к следующей сцене по
// кругу. Таймер один и снимается на размонтировании: страница входа живёт
// ровно до перехода, и оставлять за собой тикающий таймер незачем.
function Player() {
  const [scene, setScene] = useState(0);
  const [line, setLine] = useState(0);
  const [chars, setChars] = useState(0);

  const current = SCENES[scene];
  const target = current.lines[line];

  useEffect(() => {
    if (!target) {
      const timer = setTimeout(() => {
        setScene((n) => (n + 1) % SCENES.length);
        setLine(0);
        setChars(0);
      }, SCENE_PAUSE_MS);
      return () => clearTimeout(timer);
    }
    if (chars < target.text.length) {
      const timer = setTimeout(() => setChars((n) => n + 1), TYPE_MS);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => {
      setLine((n) => n + 1);
      setChars(0);
    }, LINE_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [scene, line, chars, target]);

  const shown = current.lines.slice(0, line);
  return (
    <Frame
      scene={current}
      typing={target ? {...target, text: target.text.slice(0, chars)} : undefined}
      lines={shown}
    />
  );
}

// Кадр терминала. Цвета свои, не токены темы: блок остаётся тёмным в обеих
// темах, поэтому и промпт, и вывод здесь задаются явно.
function Frame({
  scene,
  lines,
  typing,
  full = false,
}: {
  scene: Scene;
  lines?: Line[];
  typing?: Line;
  full?: boolean;
}) {
  const body = full ? scene.lines : (lines ?? []);
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-zinc-950 shadow-lg">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-zinc-700" />
        <span className="size-2.5 rounded-full bg-zinc-700" />
        <span className="size-2.5 rounded-full bg-zinc-700" />
        <span className="ml-2 font-mono text-xs text-zinc-400">{scene.title}</span>
      </div>
      {/* Высота фиксирована: иначе колонка дёргалась бы на каждой строке. */}
      <div className="h-64 overflow-hidden p-4 font-mono text-xs leading-relaxed sm:text-sm">
        {body.map((l, i) => (
          <Row key={i} line={l} />
        ))}
        {typing ? <Row line={typing} caret /> : null}
      </div>
    </div>
  );
}

const TONE: Record<Line['kind'], string> = {
  prompt: 'text-zinc-100',
  output: 'text-zinc-400',
  accent: 'text-emerald-400',
};

function Row({line, caret = false}: {line: Line; caret?: boolean}) {
  return (
    <div className={`whitespace-pre-wrap ${TONE[line.kind]}`}>
      {line.kind === 'prompt' ? <span className="text-emerald-400">$ </span> : null}
      {line.text}
      {caret ? <span className="ml-0.5 inline-block w-1.5 animate-pulse bg-zinc-100">&nbsp;</span> : null}
    </div>
  );
}

// Настройка «меньше движения» — это просьба, а не пожелание: при ней сцена
// показывается готовым кадром, без таймеров.
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia(REDUCED).matches);

  useEffect(() => {
    const mq = window.matchMedia(REDUCED);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

const REDUCED = '(prefers-reduced-motion: reduce)';
