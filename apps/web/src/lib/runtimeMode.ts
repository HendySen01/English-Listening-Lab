import { withRequestTimeout } from "./requestTimeout";

declare const __LAB_PROTECTED_RUNTIME__: boolean | undefined;

export function selectAccessMode(protectedFlag: boolean, healthOk: boolean) {
  if (protectedFlag) return "protected" as const;
  return healthOk ? "protected" as const : "local" as const;
}

export function accessAfterProbe(protectedFlag: boolean, outcome: "ok" | "unavailable" | "network") {
  if (outcome === "network") return "protected" as const;
  return selectAccessMode(protectedFlag, outcome === "ok");
}

export function protectedRuntimeRequested() {
  return typeof __LAB_PROTECTED_RUNTIME__ === "boolean" && __LAB_PROTECTED_RUNTIME__;
}

let detected: boolean | null = null;

export async function multiUserRuntime() {
  if (protectedRuntimeRequested()) return true;
  if (detected != null) return detected;
  try {
    const response = await withRequestTimeout(6000, (signal) => fetch("/api/user-runtime/health", { credentials: "include", signal }));
    const outcome = response.ok && await response.text() === "{\"ok\":true}" ? "ok" : "unavailable";
    detected = accessAfterProbe(false, outcome) === "protected";
  } catch {
    return accessAfterProbe(false, "network") === "protected";
  }
  return detected;
}
