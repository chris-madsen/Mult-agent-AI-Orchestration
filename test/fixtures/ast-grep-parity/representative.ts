export function parityFixture(value: string): string {
  return value.trim();
}

export class ParityClass {
  method(value: string): string {
    return parityFixture(value);
  }
}

export interface ParityInterface {
  field: string;
}

export type ParityType = string | number;

export enum ParityEnum {
  One,
  Two,
}
