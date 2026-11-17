const { Pool } = require('pg');
require('dotenv').config();

// Build connection config — handle both Railway internal and public URLs
function buildConfig() {
  const url = process.env.DATABASE_URL;
  if (url) {
    // Strip any existing sslmode param so we control SSL ourselves
    const cleanUrl = url.replace(/[?&]sslmode=[^&]*/g, '').replace(/\?$/, '');
    return {
      connectionString: cleanUrl,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis:       30000,
      max:                     10,
    };
  }
  return {
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME     || 'society_db',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl:      { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  };
}

const pool = new Pool(buildConfig());

pool.on('connect', () => console.log('✅ PostgreSQL connected'));
pool.on('error',   (err) => console.error('❌ PostgreSQL error:', err));

module.exports = pool;
