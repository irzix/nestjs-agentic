import type { ApprovalSignature, PendingApproval } from '../interfaces/approval.interface';

/**
 * Restores the `Date` fields of an approval read back from JSON: `createdAt`,
 * `expiresAt`, and each signature's `signedAt`.
 */
export function reviveApproval(parsed: PendingApproval): PendingApproval {
  const revived: PendingApproval = {
    ...parsed,
    createdAt: new Date(parsed.createdAt),
    expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : undefined,
  };
  if (parsed.signatures) {
    revived.signatures = parsed.signatures.map(reviveSignature);
  }
  return revived;
}

export function reviveSignature(signature: ApprovalSignature): ApprovalSignature {
  return { ...signature, signedAt: new Date(signature.signedAt) };
}

export function signatureCount(approval: PendingApproval): number {
  return approval.signatures?.length ?? 0;
}

export function hasSigned(approval: PendingApproval, userId: string): boolean {
  return approval.signatures?.some((signature) => signature.actor.userId === userId) ?? false;
}
