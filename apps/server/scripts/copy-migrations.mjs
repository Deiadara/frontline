// Copies SQL migrations next to the compiled db module so the runtime
// `new URL('./migrations/', import.meta.url)` resolution works from dist/.
import { cp } from 'node:fs/promises';

const src = new URL('../src/db/migrations/', import.meta.url);
const dest = new URL('../dist/db/migrations/', import.meta.url);
await cp(src, dest, { recursive: true, force: true });
