/**
 * Runs once when the server starts. Logs whether file storage works, so a wrong
 * bucket key shows up in the deploy logs instead of after a song has been paid for.
 */
export async function register() {
  // Compile-time constant: the edge build drops this branch and its Node-only imports.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startupChecks } = await import("./instrumentation-node");
    await startupChecks();
  }
}
