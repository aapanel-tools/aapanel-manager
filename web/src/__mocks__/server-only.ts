// Vitest stub for 'server-only'.
// Production code imports 'server-only' to prevent accidental use in client
// bundles. Under Vitest (Node environment, no RSC context) the real package
// throws, so this no-op stub is aliased in vitest.config.ts instead.
// This file must never be imported by production application code.
export {};
