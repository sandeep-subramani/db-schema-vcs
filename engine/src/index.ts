// Package front door: re-exports only. The engine stays pure — no
// framework imports, no I/O, every export a plain function or type.

export * from "./types.ts";
export * from "./validate.ts";
export * from "./example.ts";
