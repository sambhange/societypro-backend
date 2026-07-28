const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const pool       = require('./db/pool');

const app  = express();
const PORT = process.env.PORT || 5000;

// Trust proxy for Railway/Vercel
app.set('trust proxy', 1);

// CORS — allow all origins
app.use(cors({
  origin: '*',
  methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: false
}));

app.use(express.json({ limit:'10mb' }));
app.use(express.urlencoded({ extended:true }));

// Rate limiter — fixed for Railway
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  validate: { xForwardedForHeader: false },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// ── HEALTH CHECK — first, no auth ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status:    'ok',
    service:   'SocietyPro Backend',
    timestamp: new Date().toISOString(),
    version:   '1.0.0',
    env:       process.env.NODE_ENV || 'development',
  });
});

// ── ROUTES ───────────────────────────────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/tenants',       require('./routes/tenants'));
app.use('/api/maintenance',   require('./routes/maintenance'));
app.use('/api/payments',      require('./routes/payments'));
app.use('/api/announcements', require('./routes/content'));
app.use('/api/complaints',    require('./routes/complaints'));
app.use('/api/parking',       require('./routes/parking'));
app.use('/api/visitors',      require('./routes/visitors'));
app.use('/api/committee',     require('./routes/committee'));
app.use('/api/polls',         require('./routes/polls'));
app.use('/api/forum',         require('./routes/forum'));
app.use('/api/files',         require('./routes/files'));
app.use('/api/facilities',    require('./routes/facilities'));
app.use('/api/sms',           require('./routes/sms'));
app.use('/api/saas',          require('./routes/saas'));
app.use('/api/super',         require('./routes/super'));

// Dashboard route
app.get('/api/dashboard', async (req, res) => {
  try {
    const tenants     = await pool.query('SELECT COUNT(*) FROM tenants').catch(()=>({rows:[{count:0}]}));
    const maintenance = await pool.query("SELECT COUNT(*) FROM maintenance WHERE status='Pending'").catch(()=>({rows:[{count:0}]}));
    const complaints  = await pool.query("SELECT COUNT(*) FROM complaints WHERE status='Open'").catch(()=>({rows:[{count:0}]}));
    const collected   = await pool.query("SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE status='completed'").catch(()=>({rows:[{total:0}]}));
    res.json({
      success: true,
      stats: {
        total_tenants:      parseInt(tenants.rows[0].count)||0,
        pending_dues:       parseInt(maintenance.rows[0].count)||0,
        open_complaints:    parseInt(complaints.rows[0].count)||0,
        total_collected:    parseFloat(collected.rows[0].total)||0,
        collection_rate:    88,
        total_flats:        48,
      }
    });
  } catch (err) {
    res.json({ success:true, stats:{ total_tenants:0, pending_dues:0, open_complaints:0, total_collected:0, collection_rate:0, total_flats:0 }});
  }
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success:false, message:'Route not found: ' + req.path });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  res.status(500).json({ success:false, message:'Internal server error' });
});

// ── Auto DB Setup ─────────────────────────────────────────────────────────────
async function setupDatabase() {
  try {
    console.log('🔍 Checking database connection...');
    await pool.query('SELECT 1');
    console.log('✅ Database connected!');

    const check = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'tenants'
      )
    `);

    if (!check.rows[0].exists) {
      console.log('📦 Running database setup...');
      try { await require('./db/setup')();    console.log('✅ Tables created!'); } catch(e){ console.log('Setup:', e.message); }
      try { await require('./db/setup-saas')(); console.log('✅ SaaS tables!'); } catch(e){ console.log('SaaS:', e.message); }
      try { await require('./db/seed')();     console.log('✅ Seed data done!'); } catch(e){ console.log('Seed:', e.message); }
    } else {
      console.log('✅ Database tables already exist!');
    }
  } catch (err) {
    console.error('⚠️  DB error:', err.message);
    console.log('⚠️  Starting server without DB — check DATABASE_URL in Railway Variables');
  }
}

// ── Prevent crash on unhandled errors ────────────────────────────────────────
process.on('uncaughtException',  (err) => console.error('⚠️  Uncaught:', err.message));
process.on('unhandledRejection', (r)   => console.error('⚠️  Unhandled:', r));

// ── Start Server ──────────────────────────────────────────────────────────────
(async () => {
  await setupDatabase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🏢 SocietyPro Backend running!`);
    console.log(`📡 Port:   ${PORT}`);
    console.log(`🌐 Health: http://localhost:${PORT}/health`);
    console.log(`🚀 Ready to accept connections!\n`);
  });
})();
