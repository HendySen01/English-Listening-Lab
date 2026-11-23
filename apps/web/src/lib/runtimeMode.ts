let detected: boolean | null = null;

export async function multiUserRuntime() {
  if (detected != null) return detected;
  try {
    const response = await fetch("/api/user-runtime/health", { credentials: "include" });
    detected = response.ok && await response.text() === "{\"ok\":true}";
  } catch {
    detected = false;
  }
  return detected;
}
