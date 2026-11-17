const { Pool } = require('pg');
require('dotenv').config();

// Build connection config — tries with SSL first, falls back to without SSL
function buildConfig() {
  const url = process.env.DATABASE_URL;
  if (url) {
    // Strip sslmode from URL — we control SSL via the pool option
    const cleanUrl = url.replace(/[?&]sslmode=[^&]*/g, '').replace(/\?$/, '');
    // Railway public TCP proxy URLs don't need SSL from client side
    // Railway internal URLs need SSL — try no-ssl for public, ssl for internal
    const isInternal = cleanUrl.includes('.railway.internal') || cleanUrl.includes('railway.internal');
    return {
      connectionString: cleanUrl,
      ssl: isInternal ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 15000,
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
    ssl:      false,
    connectionTimeoutMillis: 15000,
  };
}

const pool = new Pool(buildConfig());

pool.on('connect', () => console.log('✅ PostgreSQL connected'));
pool.on('error',   (err) => console.error('❌ PostgreSQL error:', err));

module.exports = pool;
