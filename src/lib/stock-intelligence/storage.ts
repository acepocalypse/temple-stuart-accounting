import type { ApprovalLog, OpenPosition } from './types';

export interface AuditRecord {
  provider: string;
  key: string;
  fetchedAt: string;
  status: number;
  source: 'network' | 'cache';
  payload: unknown;
}

const auditLog: AuditRecord[] = [];
const approvals: ApprovalLog[] = [];

export function appendAudit(record: AuditRecord): void {
  auditLog.push(record);
  if (auditLog.length > 10_000) {
    auditLog.splice(0, auditLog.length - 10_000);
  }
}

export function getAuditRecords(limit = 200): AuditRecord[] {
  return auditLog.slice(-limit);
}

export function logApproval(entry: ApprovalLog): void {
  approvals.push(entry);
}

export function listApprovals(): ApprovalLog[] {
  return [...approvals].sort((a, b) => b.approvedAt.localeCompare(a.approvedAt));
}

export function listOpenPositions(): OpenPosition[] {
  return approvals
    .filter((a) => a.status === 'OPEN')
    .map((a) => ({
      ticker: a.ticker,
      entry: a.plan.triggerPrice,
      stop: a.plan.stopPrice,
      openedAt: a.approvedAt,
    }));
}
