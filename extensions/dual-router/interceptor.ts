export interface RouteContextState {
  searchedSchema?: boolean;
  matchedMetric?: string;
}

export interface ToolCallContext {
  name?: string;
  args?: unknown;
  state?: RouteContextState;
}

export interface InterceptorResult {
  block?: boolean;
  reason?: string;
}

export function shouldBlockExecuteSql(context: ToolCallContext): InterceptorResult {
  if (context.name !== "execute_sql") return {};
  if (!context.state?.searchedSchema) {
    return {
      block: true,
      reason: "????? search_schema ????",
    };
  }
  return {};
}

export function recordToolCall(
  context: ToolCallContext,
  metricNames: string[],
  writeAudit: (event: Record<string, unknown>) => void
): void {
  if (context.name === "search_schema") {
    context.state ??= {};
    context.state.searchedSchema = true;
  }

  const args = context.args as { sql?: string } | undefined;
  const sql = args?.sql ?? "";
  const matchedMetric = metricNames.find((metric) =>
    sql.toLowerCase().includes(metric.toLowerCase())
  );
  if (matchedMetric) {
    console.warn(`Metric semantics risk: SQL references metric ${matchedMetric}`);
  }

  writeAudit({
    event_type: "route_decision",
    route: matchedMetric
      ? "metric"
      : context.name === "execute_sql"
        ? "free_sql"
        : "clarify",
    matched_metric: matchedMetric ?? "",
  });
}
