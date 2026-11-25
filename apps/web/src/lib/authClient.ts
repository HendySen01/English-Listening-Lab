import { createAuthClient } from "better-auth/vue";
import { shallowRef } from "vue";

export const sessionUser = shallowRef<{ email: string; emailVerified: boolean } | null>(null);

export const authClient = createAuthClient({
  fetchOptions: { credentials: "include" },
});
