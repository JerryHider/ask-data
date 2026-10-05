import { MySQLConnector } from './connectors/mysql.js';
import type { BaseConnector } from './types.js';

interface RegistryConnection {
  id: number;
  name: string;
  type: string;
  host: string;
  port: number;
  database_name: string;
  username: string;
  password?: string;
}

const registryUrl = process.env.REGISTRY_URL ?? 'http://127.0.0.1:8004';

export class ConnectorRegistry {
  private readonly connectors = new Map<string, BaseConnector | null>();

  register(name: string, connector: BaseConnector | null): void {
    const previous = this.connectors.get(name);
    if (previous) void previous.close();
    this.connectors.set(name, connector);
  }

  get(name: string): BaseConnector {
    const connector = this.connectors.get(name);
    if (!connector) throw new Error(`Unknown datasource: ${name}`);
    return connector;
  }

  getOrNull(name: string): BaseConnector | null {
    return this.connectors.get(name) ?? null;
  }

  listNames(): string[] {
    return [...this.connectors.entries()]
      .filter(([, connector]) => connector !== null)
      .map(([name]) => name);
  }

  async refreshFromRegistry(): Promise<void> {
    const response = await fetch(`${registryUrl}/db-connections/runtime`, { method: 'POST' });
    if (!response.ok) {
      throw new Error(`Registry refresh failed: ${response.status}`);
    }
    const payload = (await response.json()) as RegistryConnection[] | { connections: RegistryConnection[] };
    const connections = Array.isArray(payload) ? payload : payload.connections;
    for (const connection of connections) {
      if (connection.type !== 'mysql') continue;
      const password = encodeURIComponent(connection.password ?? '');
      const url = `mysql://${encodeURIComponent(connection.username)}:${password}@${connection.host}:${connection.port}/${connection.database_name}`;
      this.register(connection.name, new MySQLConnector(url));
    }
  }
}

export const connectorRegistry = new ConnectorRegistry();

if (process.env.DATASOURCE_MYSQL_URL) {
  connectorRegistry.register('mysql', new MySQLConnector(process.env.DATASOURCE_MYSQL_URL));
}

// Reserved
connectorRegistry.register('postgresql', null);
connectorRegistry.register('clickhouse', null);
connectorRegistry.register('starrocks', null);
