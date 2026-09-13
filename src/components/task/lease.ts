import type {StageRun} from '../../api/types';

// Аренда жива, пока не истекла: агент продлевает её heartbeat'ом, и по этому
// же признаку карточка решает, перезапрашивать ли себя.
export function isLeaseLive(run: StageRun): boolean {
  return Boolean(run.lease_expires_at && new Date(run.lease_expires_at) > new Date());
}
