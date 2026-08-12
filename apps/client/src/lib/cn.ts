import clsx, { type ClassValue } from 'clsx';

/** Thin `clsx` alias so components share one class-merging helper. */
export function cn(...values: ClassValue[]): string {
  return clsx(...values);
}
