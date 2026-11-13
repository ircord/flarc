export function loadAllowlistConfig(
  env?: Record<string, string | undefined>,
  cwd?: string,
): { bindings: { ALLOWLIST_YAML?: string }; file: string | null };
