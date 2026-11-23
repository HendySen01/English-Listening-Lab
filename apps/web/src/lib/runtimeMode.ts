declare const __LAB_PROTECTED_RUNTIME__: boolean | undefined;

export function selectAccessMode(protectedFlag: boolean, healthOk: boolean) {
  if (protectedFlag) return "protected" as const;
  return healthOk ? "protected" as const : "local" as const;
}

export function protectedRuntimeRequested() {
  return typeof __LAB_PROTECTED_RUNTIME__ === "boolean" && __LAB_PROTECTED_RUNTIME__;
}

let detected: boolean | null = null;

export async function multiUserRuntime() {
  if (protectedRuntimeRequested()) return true;
  if (detected != null) return detected;
  try {
    const response = await fetch("/api/user-runtime/health", { credentials: "include" });
    detected = selectAccessMode(false, response.ok && await response.text() === "{\"ok\":true}") === "protected";
  } catch {
    detected = false;
  }
  return detected;
}
