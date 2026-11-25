const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const pool      = require('./db/pool');

const app  = express();
const PORT = process.env.PORT || 5000;

app.set('trust proxy', 1);

// CORS
app.use(cors({ origin:'*', methods:['GET','POST','PUT','DELETE','PATCH','OPTIONS'], allowedHeaders:['Content-Type','Authorization'] }));
app.use(express.json({ limit:'10mb' }));
app.use(express.urlencoded({ extended:true }));

// Rate limiter
const limiter = rateLimit({ windowMs:15*60*1000, max:500, validate:{ xForwardedForHeader:false } });
app.use(limiter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status:'ok', service:'SocietyPro Backend', timestamp:new Date().toISOString() });
});

// ── Safe route loader — prevents crash if any route file has issues ─────────
function safeRoute(path) {
  try {
    const mod = require(path);
    // Handle both module.exports = router AND module.exports = { router }
    if (typeof mod === 'function') return mod;
    if (mod && typeof mod.default === 'function') return mod.default;
    if (mod && typeof mod.router === 'function') return mod.router;
    console.warn(`⚠️  Route ${path} did not export a function — skipping`);
    return (req, res, next) => next(); // passthrough middleware
  } catch(e) {
    console.warn(`⚠️  Could not load route ${path}: ${e.message}`);
    return (req, res, next) => next();
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',          safeRoute('./routes/auth'));
app.use('/api/tenants',       safeRoute('./routes/tenants'));
app.use('/api/maintenance',   safeRoute('./routes/maintenance'));
app.use('/api/payments',      safeRoute('./routes/payments'));
app.use('/api/announcements', safeRoute('./routes/content'));
app.use('/api/complaints',    safeRoute('./routes/complaints'));
app.use('/api/parking',       safeRoute('./routes/parking'));
app.use('/api/visitors',      safeRoute('./routes/visitors'));
app.use('/api/committee',     safeRoute('./routes/committee'));
app.use('/api/polls',         safeRoute('./routes/polls'));
app.use('/api/forum',         safeRoute('./routes/forum'));
app.use('/api/files',         safeRoute('./routes/files'));
app.use('/api/facilities',    safeRoute('./routes/facilities'));
app.use('/api/sms',           safeRoute('./routes/sms'));
app.use('/api/saas',          safeRoute('./routes/saas'));
app.use('/api/super',         safeRoute('./routes/super'));

// ── Dashboard ─────────────────────────────────────────────────────────────────
app.get('/api/dashboard', async (req, res) => {
  try {
    // Extract society_id from JWT if present
    let society_id = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET || 'societypro-secret-2025');
        society_id = decoded.society_id;
      } catch(_) {}
    }

    // Filter by society_id when available
    const sid = society_id;
    const where = sid ? ' WHERE society_id = $1' : '';
    const args  = sid ? [sid] : [];

    const t = await pool.query(`SELECT COUNT(*) FROM tenants${where}`,        args).catch(()=>({rows:[{count:0}]}));
    const m = await pool.query(`SELECT COUNT(*) FROM maintenance${where} ${sid ? "AND status='Pending'" : "WHERE status='Pending'"}`, args).catch(()=>({rows:[{count:0}]}));
    const c = await pool.query(`SELECT COUNT(*) FROM complaints${where} ${sid ? "AND status='Open'" : "WHERE status='Open'"}`,         args).catch(()=>({rows:[{count:0}]}));
    const p = await pool.query(`SELECT COALESCE(SUM(amount),0) as total FROM payments${where}`, args).catch(()=>({rows:[{total:0}]}));

    // Get society info for total_flats
    let total_flats = 50;
    if (sid) {
      const soc = await pool.query('SELECT total_flats FROM societies WHERE id=$1', [sid]).catch(()=>({rows:[]}));
      if (soc.rows.length > 0) total_flats = soc.rows[0].total_flats || 50;
    }

    const paid    = parseInt(t.rows[0].count) || 0;
    const pending = parseInt(m.rows[0].count) || 0;
    const collected = parseFloat(p.rows[0].total) || 0;
    const rate = total_flats > 0 ? Math.round((paid / total_flats) * 100) : 0;

    res.json({ success:true, stats:{
      total_tenants:   paid,
      pending_dues:    pending,
      open_complaints: parseInt(c.rows[0].count)||0,
      total_collected: collected,
      collection_rate: Math.min(rate, 100),
      total_flats,
    }});
  } catch(e) {
    res.json({ success:true, stats:{ total_tenants:0,pending_dues:0,open_complaints:0,total_collected:0,collection_rate:0,total_flats:0 }});
  }
});

// ── 404 & Error handlers ──────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ success:false, message:'Route not found: '+req.path }));
app.use((err, req, res, next) => {
  console.error('❌', err.message);
  res.status(500).json({ success:false, message:'Internal server error' });
});

// ── Auto DB Setup ─────────────────────────────────────────────────────────────
async function setupDatabase() {
  try {
    await pool.query('SELECT 1');
    console.log('✅ Database connected!');
    const check = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema='public' AND table_name='tenants'
      )`);
    // Always run setup and setup-saas (they use IF NOT EXISTS so safe to re-run)
    console.log('📦 Ensuring all tables exist...');
    try { const s=require('./db/setup');    await (typeof s==='function'?s():Promise.resolve()); console.log('✅ Tables done!'); }    catch(e){ console.log('⚠️ setup:',e.message); }
    try { const s=require('./db/setup-saas'); await (typeof s==='function'?s():Promise.resolve()); console.log('✅ SaaS done!'); }  catch(e){ console.log('⚠️ saas:',e.message); }
    if (!check.rows[0].exists) {
      try { const s=require('./db/seed'); await (typeof s==='function'?s():Promise.resolve()); console.log('✅ Seed done!'); } catch(e){ console.log('⚠️ seed:',e.message); }
    }

    // ── Auto-create default super admin if none exists ────────────────────────
    try {
      const bcrypt = require('bcryptjs');
      const existing = await pool.query('SELECT COUNT(*) FROM super_admins').catch(()=>({rows:[{count:'1'}]}));
      if (Number(existing.rows[0].count) === 0) {
        const hash = await bcrypt.hash('SuperAdmin@2025', 10);
        await pool.query(
          `INSERT INTO super_admins (name, email, password) VALUES ($1,$2,$3)`,
          ['SocietyPro Admin', 'admin@societyproapp.com', hash]
        );
        console.log('✅ Super admin created: admin@societyproapp.com / SuperAdmin@2025');
      } else {
        console.log('✅ Super admin already exists');
      }
    } catch(e) { console.log('⚠️ Super admin setup:', e.message); }
  } catch(e) {
    console.error('⚠️ DB error:', e.message || JSON.stringify(e) || String(e));
    console.error('⚠️ DB error code:', e.code);
    try {
      const u = new URL(process.env.DATABASE_URL || '');
      console.error('⚠️ DB host:', u.hostname, '| port:', u.port || '5432');
    } catch(_) {
      console.error('⚠️ DATABASE_URL prefix:', (process.env.DATABASE_URL||'').substring(0,40));
    }
    console.log('⚠️ Check DATABASE_URL in Railway Variables!');
  }
}

process.on('uncaughtException',  e => console.error('⚠️ Uncaught:',  e.message));
process.on('unhandledRejection', e => console.error('⚠️ Unhandled:', e));

// ── Start ─────────────────────────────────────────────────────────────────────
(async () => {
  await setupDatabase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🏢 SocietyPro Backend running on port ${PORT}`);
    console.log(`🌐 Health: http://localhost:${PORT}/health\n`);
  });
})();
