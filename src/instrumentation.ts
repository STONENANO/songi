/**
 * Next.js runs register() once when a server instance starts.
 * Refuse to boot in production with an unsafe configuration (see assertSafeForProduction).
 *
 * A throw here is only reported by Next as an unhandled rejection: the server keeps
 * running and answers every request with a 500. Exit instead, so the deploy fails
 * its healthcheck and the previous deployment keeps serving.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertSafeForProduction } = await import("./lib/env");
  try {
    assertSafeForProduction();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
