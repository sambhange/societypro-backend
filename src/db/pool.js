const { Pool } = require('pg');
require('dotenv').config();

// Build connection config — parse URL into individual params to avoid
// pg connection-string SSL quirks with Railway's postgres-ssl image
function buildConfig() {
  const url = process.env.DATABASE_URL;
  if (url) {
    try {
      const parsed = new URL(url);
      const sslConfig = {
        rejectUnauthorized: false,
        checkServerIdentity: () => undefined,
        // Lower OpenSSL security level to allow self-signed certs with smaller keys
        // (postgres-ssl:18 may generate keys that Node.js 18 / OpenSSL 3 rejects by default)
        ciphers: 'DEFAULT:@SECLEVEL=0',
        secureOptions: require('constants').SSL_OP_LEGACY_SERVER_CONNECT,
      };
      return {
        host:     parsed.hostname,
        port:     parseInt(parsed.port) || 5432,
        user:     parsed.username,
        password: decodeURIComponent(parsed.password || ''),
        database: parsed.pathname.replace(/^\//, ''),
        ssl:      sslConfig,
        connectionTimeoutMillis: 15000,
        idleTimeoutMillis:       30000,
        max:                     10,
      };
    } catch (e) {
      console.warn('⚠️ Could not parse DATABASE_URL, using connection string:', e.message);
      const cleanUrl = url.replace(/[?&]sslmode=[^&]*/g, '').replace(/\?$/, '');
      return {
        connectionString: cleanUrl,
        ssl: { rejectUnauthorized: false, checkServerIdentity: () => undefined },
        connectionTimeoutMillis: 15000,
        idleTimeoutMillis:       30000,
        max:                     10,
      };
    }
  }
  return {
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME     || 'society_db',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl:      false,
    connectionTimeoutMillis: 15000,
  };
}

const pool = new Pool(buildConfig());

pool.on('connect', () => console.log('✅ PostgreSQL connected'));
pool.on('error',   (err) => console.error('❌ PostgreSQL error:', err));

module.exports = pool;
