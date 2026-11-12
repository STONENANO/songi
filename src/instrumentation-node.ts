/** Node-only startup work, imported from instrumentation.ts so the edge bundle never sees it. */
export async function startupChecks() {
  const { env, productionConfigProblems } = await import("./lib/env");
  // A production server with a missing or default secret must not take traffic: stop here,
  // with every problem listed (setting names only, never values) in the deploy log.
  const problems = productionConfigProblems();
  if (problems.length) {
    console.error(`[config] Refusing to start: production settings are missing.\n- ${problems.join("\n- ")}`);
    const Sentry = await import("@sentry/nextjs");
    if (Sentry.isInitialized()) {
      Sentry.captureMessage("Refusing to start: production settings are missing", { level: "fatal", extra: { problems } });
      await Sentry.flush(3000);
    }
    process.exit(1);
  }
  if (env.storageDriver !== "s3") return;
  const missing = (["S3_BUCKET", "S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const).filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`[storage] STORAGE_DRIVER=s3 but ${missing.join(", ")} not set. Songs cannot be saved.`);
    return;
  }
  const { checkBucket } = await import("./lib/storage");
  const r = await checkBucket();
  console[r.ok ? "log" : "error"](`[storage] ${r.message}`);
}
