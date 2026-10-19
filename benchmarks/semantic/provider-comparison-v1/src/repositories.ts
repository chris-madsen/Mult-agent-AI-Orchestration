export class UserRepository {
  save(value: string): string { return `user:${value}`; }
}

export class AuditRepository {
  save(value: string): string { return `audit:${value}`; }
}

export function persistUser(repo: UserRepository, value: string): string {
  return repo.save(value);
}

export function persistAudit(repo: AuditRepository, value: string): string {
  return repo.save(value);
}
