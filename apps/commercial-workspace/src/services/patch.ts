import type { PricingInput } from '@bondly/pricing-types';

type DeepPartialValue<V> = V extends readonly unknown[]
  ? V
  : V extends object
    ? { [K in keyof V]?: DeepPartialValue<V[K]> }
    : V;

export type DeepPartial<T> = {
  [K in keyof T]?: DeepPartialValue<NonNullable<T[K]>>;
};

export type InputPatch = DeepPartial<PricingInput>;
export type UpdateFn = (patch: InputPatch) => void;
