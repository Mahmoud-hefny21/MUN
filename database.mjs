import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

export async function createDatabase({ migrate = false } = {}) {
  const context = new AsyncLocalStorage();
  let query, transaction, close;
  let initialize;
  if (process.env.NODE_ENV === 'test' && process.env.MUN_TEST_POSTGRES === 'memory') {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite();
    query = db.query.bind(db);
    transaction = callback => db.transaction(callback);
    close = () => db.close();
    initialize = schema => db.exec(schema);
  } else {
    if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to your Neon Postgres connection string.');
    const url = new URL(process.env.DATABASE_URL);
    const useChannelBinding = url.searchParams.get('channel_binding') === 'require';
    url.searchParams.delete('channel_binding');
    url.searchParams.delete('sslmode');
    const pool = new Pool({
      connectionString: url.href,
      ssl: { rejectUnauthorized: true },
      enableChannelBinding: useChannelBinding,
      connectionTimeoutMillis: 12000,
      max: 5
    });
    pool.on('error', error => console.error('Postgres pool error:', error.code || error.name));
    query = pool.query.bind(pool);
    close = () => pool.end();
    transaction = async callback => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    };
    initialize = schema => transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(1282370241)');
      await client.query(schema);
    });
  }
  if (migrate || process.env.NODE_ENV === 'test') {
    const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
    await initialize(schema);
  }
  function execute(sql, args) {
    let index = 0;
    const statement = sql.replace(/\?/g, () => '$' + ++index);
    const current = context.getStore();
    return current ? current.query(statement, args) : query(statement, args);
  }
  return {
    run: async (sql, ...args) => {
      const result = await execute(sql, args);
      return { changes: result.rowCount ?? result.affectedRows };
    },
    all: async (sql, ...args) => (await execute(sql, args)).rows,
    get: async (sql, ...args) => (await execute(sql, args)).rows[0],
    transact: callback => transaction(client => context.run(client, callback)),
    close
  };
}
