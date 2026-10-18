export type Result<Value, ErrorValue> =
  | { readonly _tag: 'Ok'; readonly value: Value }
  | { readonly _tag: 'Err'; readonly error: ErrorValue };

export const ok = <Value>(value: Value): Result<Value, never> => ({
  _tag: 'Ok',
  value,
});

export const err = <ErrorValue>(error: ErrorValue): Result<never, ErrorValue> => ({
  _tag: 'Err',
  error,
});

export const isOk = <Value, ErrorValue>(
  result: Result<Value, ErrorValue>,
): result is { readonly _tag: 'Ok'; readonly value: Value } => result._tag === 'Ok';

export const isErr = <Value, ErrorValue>(
  result: Result<Value, ErrorValue>,
): result is { readonly _tag: 'Err'; readonly error: ErrorValue } => result._tag === 'Err';

export const mapResult = <Value, NextValue, ErrorValue>(
  result: Result<Value, ErrorValue>,
  map: (value: Value) => NextValue,
): Result<NextValue, ErrorValue> => (isOk(result) ? ok(map(result.value)) : result);
