import { SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";

type LogAttributes = Record<string, string | number | boolean>;
type PostHogLogger = ReturnType<LoggerProvider["getLogger"]>;

let initialized = false;
let logger: PostHogLogger | null = null;

function getPostHogLogger(): PostHogLogger | null {
  if (initialized) return logger;
  initialized = true;

  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!token || !host) {
    if (process.env.NODE_ENV !== "production") {
      const missing = token ? "NEXT_PUBLIC_POSTHOG_HOST" : "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN";
      console.warn(`${missing} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missing} is configured`);
    }
    return null;
  }

  const endpoint = new URL(host);
  endpoint.pathname = "/i/v1/logs";
  endpoint.search = "";

  const provider = new LoggerProvider({
    resource: resourceFromAttributes({ "service.name": "songi" }),
    processors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({
          url: endpoint.toString(),
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }),
      }),
    ],
  });

  logger = provider.getLogger("songi.posthog");
  return logger;
}

/** Initialize dedicated PostHog log capture without attaching the app's existing loggers. */
export function initializePostHogLogCapture(): void {
  getPostHogLogger();
}

/** Emits only purpose-written, non-PII operational logs added for PostHog. */
export function logPostHogInfo(body: string, attributes: LogAttributes = {}): void {
  getPostHogLogger()?.emit({
    body,
    severityNumber: SeverityNumber.INFO,
    attributes,
  });
}
