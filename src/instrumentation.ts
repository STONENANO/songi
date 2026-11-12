/**
 * Runs once when the server starts. Logs whether file storage works, so a wrong
 * bucket key shows up in the deploy logs instead of after a song has been paid for.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { env } = await import("./lib/env");
  if (env.storageDriver !== "s3") return;
  const { checkBucket } = await import("./lib/storage");
  const r = await checkBucket();
  console[r.ok ? "log" : "error"](`[storage] ${r.message}`);
}
