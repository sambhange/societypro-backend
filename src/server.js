require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');
const path        = require('path');

const authRoutes      = require('./routes/auth');
const tenantRoutes    = require('./routes/tenants');
const maintenanceRoutes = require('./routes/maintenance');
const paymentRoutes   = require('./routes/payments');
const dashboardRoutes = require('./routes/dashboard');
const { announceRouter, meetingsRouter, galleryRouter } = require('./routes/content');
const { propertiesRouter, servicesRouter } = require('./routes/marketplace');
const complaintsRoutes = require('./routes/complaints');
const parkingRoutes    = require('./routes/parking');
const visitorsRoutes   = require('./routes/visitors');
const committeeRoutes  = require('./routes/committee');
const pollsRoutes      = require('./routes/polls');
const forumRoutes      = require('./routes/forum');
const filesRoutes      = require('./routes/files');
const facilitiesRoutes = require('./routes/facilities');
const smsRoutes        = require('./routes/sms');
const saasRoutes       = require('./routes/saas');
const superRoutes      = require('./routes/super');

const app  = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin:      process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 20,
  message: { success: false, message: 'Too many login attempts. Try again in 15 minutes.' }
}));
app.use('/api/', rateLimit({ windowMs: 60 * 1000, max: 200 }));

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status:  'OK',
    server:  'Society Management API',
    version: '1.0.0',
    time:    new Date().toISOString(),
  });
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/dashboard',     dashboardRoutes);
app.use('/api/tenants',       tenantRoutes);
app.use('/api/maintenance',   maintenanceRoutes);
app.use('/api/payments',      paymentRoutes);
app.use('/api/announcements', announceRouter);
app.use('/api/meetings',      meetingsRouter);
app.use('/api/gallery',       galleryRouter);
app.use('/api/properties',    propertiesRouter);
app.use('/api/services',      servicesRouter);
app.use('/api/complaints',    complaintsRoutes);
app.use('/api/parking',       parkingRoutes);
app.use('/api/visitors',      visitorsRoutes);
app.use('/api/committee',     committeeRoutes);
app.use('/api/polls',         pollsRoutes);
app.use('/api/forum',         forumRoutes);
app.use('/api/files',         filesRoutes);
app.use('/api/facilities',    facilitiesRoutes);
app.use('/api/sms',           smsRoutes);
app.use('/api/saas',          saasRoutes);
app.use('/api/super',         superRoutes);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found.` });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Server Error:', err.stack);
  res.status(500).json({ success: false, message: 'Internal server error.' });
});

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('🏢  Society Management Backend');
  console.log(`✅  Server running at http://localhost:${PORT}`);
  console.log(`📋  Health check: http://localhost:${PORT}/health`);
  console.log('');
  console.log('📡  Available API endpoints:');
  console.log(`    POST  /api/auth/login`);
  console.log(`    GET   /api/dashboard`);
  console.log(`    GET   /api/tenants`);
  console.log(`    GET   /api/maintenance`);
  console.log(`    GET   /api/announcements`);
  console.log(`    GET   /api/meetings`);
  console.log(`    GET   /api/gallery`);
  console.log(`    POST  /api/payments/create-order`);
  console.log(`    POST  /api/payments/verify`);
  console.log(`    GET   /api/properties`);
  console.log(`    POST  /api/services/book`);
  console.log('');
});

module.exports = app;
