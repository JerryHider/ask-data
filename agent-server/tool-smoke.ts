import { randomUUID } from 'node:crypto';
import { createAgentTools } from './agent-tools.js';

const registryUrl = process.env.REGISTRY_URL ?? 'http://127.0.0.1:8004';
const artifactParserUrl = process.env.ARTIFACT_PARSER_URL ?? 'http://127.0.0.1:8001';
const metricFlowUrl = process.env.METRICFLOW_BRIDGE_URL ?? 'http://127.0.0.1:8002';
const sandboxUrl = process.env.SQL_SANDBOX_URL ?? 'http://127.0.0.1:8003';

async function main(): Promise<void> {
  const response = await fetch(`${registryUrl}/semantic-models?status=published`);
  if (!response.ok) throw new Error(`Registry request failed: ${response.status}`);
  const semanticModels = (await response.json()) as Parameters<
    typeof createAgentTools
  >[0]['semanticModels'];
  const tools = createAgentTools(
    {
      registryUrl,
      artifactParserUrl,
      metricFlowUrl,
      sandboxUrl,
      user: 'admin',
      sessionId: randomUUID(),
      requestId: randomUUID(),
      semanticModels,
    },
    () => undefined
  );

  const search = await tools
    .find((tool) => tool.name === 'search_metrics')
    ?.execute('smoke', { query: '营收是多少' });
  console.log('SEARCH_METRICS', JSON.stringify(search?.details));

  const query = await tools
    .find((tool) => tool.name === 'query_metric')
    ?.execute('smoke', {
      metric: 'premium',
      dimensions: ['order_effective_year'],
      where: "{{ Dimension('order__insure_unit_province') }} = '湖北省'",
    });
  console.log(
    'QUERY_METRIC',
    JSON.stringify({
      columns: query?.details.columns,
      rowCount: query?.details.rowCount,
      sql: query?.details.sql,
    })
  );

  try {
    await tools
      .find((tool) => tool.name === 'run_sql')
      ?.execute('smoke', { sql: 'DELETE FROM order_detail', reason: 'guard test' });
  } catch (error) {
    console.log('SQL_GUARD', (error as Error).message);
  }

  const clarify = await tools
    .find((tool) => tool.name === 'clarify')
    ?.execute('smoke', { question: '口径确认', options: ['是', '否'] });
  console.log('CLARIFY', JSON.stringify(clarify?.details));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
