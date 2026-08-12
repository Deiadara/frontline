/** Deserialize a JSON payload column as `unknown` so it is re-parsed through a shared Zod schema. */
export function readJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}
