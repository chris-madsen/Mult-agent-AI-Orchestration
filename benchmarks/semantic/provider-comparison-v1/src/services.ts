export class BaseService {
  run(value: string): string { return `base:${value}`; }
}

export class DerivedService extends BaseService {
  override run(value: string): string { return `derived:${value}`; }
}

export function invokeDerived(service: DerivedService, value: string): string {
  return service.run(value);
}

export function invokeBase(service: BaseService, value: string): string {
  return service.run(value);
}
