// Значки типов гейтов: по типу (перечень движка), а не по ключу — проект
// называет гейты как хочет. Незнакомый тип — нейтральный кружок.
import {
  Braces,
  CircleCheckBig,
  CircleDot,
  FileCheck2,
  FolderTree,
  GitPullRequest,
  ListChecks,
  Network,
  ScanEye,
  UserCheck,
  Waves,
  type LucideIcon,
} from 'lucide-react';

import {cn} from '@/lib/utils';

import type {Gate} from '../../api/types';
import {isHumanGate, sortedGates} from './labels';

const GATE_ICON: Record<string, LucideIcon> = {
  artifacts_required: FileCheck2,
  checklist: ListChecks,
  human_approval: UserCheck,
  agent_review: ScanEye,
  repo_ref_required: GitPullRequest,
  repo_scope: FolderTree,
  drift_clear: Waves,
  schema_validation: Braces,
  external_check: CircleCheckBig,
  dependencies_closed: Network,
};

export function GateIcon({type, className}: {type: string; className?: string}) {
  const Icon = GATE_ICON[type] ?? CircleDot;
  return (
    <Icon
      aria-hidden
      className={cn('size-3.5 shrink-0', isHumanGate(type) ? 'text-amber-600 dark:text-amber-300' : 'text-muted-foreground', className)}
    />
  );
}

// Ряд значков: первые max, остальное — «+N».
export function GateIconRow({gates, max = 3}: {gates: Gate[] | undefined; max?: number}) {
  const list = sortedGates(gates);
  const shown = list.slice(0, max);
  return (
    <span className="flex items-center gap-0.5">
      {shown.map((g) => (
        <GateIcon key={g.id} type={g.type} />
      ))}
      {list.length > shown.length ? <span className="text-muted-foreground text-[11px]">+{list.length - shown.length}</span> : null}
    </span>
  );
}
