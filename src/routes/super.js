const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const pool    = require('../db/pool');
const { superAdminAuth } = require('../middleware/tenancy');
const router  = express.Router();

// ── POST /api/super/login ────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows } = await pool.query('SELECT * FROM super_admins WHERE email=$1', [email]);
    if (!rows.length) return res.status(401).json({ success: false, message: 'Invalid credentials.' });

    const match = await bcrypt.compare(password, rows[0].password);
    if (!match) return res.status(401).json({ success: false, message: 'Invalid credentials.' });

    const token = jwt.sign(
      { id:rows[0].id, email:rows[0].email, role:'super_admin', name:rows[0].name },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ success: true, token, admin: { id:rows[0].id, name:rows[0].name, email:rows[0].email } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST /api/super/setup — first-time super admin creation ─────────────────
router.post('/setup', async (req, res) => {
  try {
    const count = await pool.query('SELECT COUNT(*) FROM super_admins');
    if (Number(count.rows[0].count) > 0)
      return res.status(400).json({ success: false, message: 'Super admin already exists.' });

    const { name, email, password } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO super_admins (name, email, password) VALUES ($1,$2,$3) RETURNING id, name, email',
      [name, email, hash]
    );
    res.status(201).json({ success: true, message: 'Super admin created.', admin: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GET /api/super/dashboard — master stats ──────────────────────────────────
router.get('/dashboard', superAdminAuth, async (req, res) => {
  try {
    const [societies, revenue, plans, recent, expiring] = await Promise.all([

      pool.query(`
        SELECT
          COUNT(*)                                       AS total,
          COUNT(*) FILTER (WHERE status='active')        AS active,
          COUNT(*) FILTER (WHERE status='trial')         AS trial,
          COUNT(*) FILTER (WHERE status='suspended')     AS suspended,
          COUNT(*) FILTER (WHERE plan='starter')         AS starter,
          COUNT(*) FILTER (WHERE plan='standard')        AS standard,
          COUNT(*) FILTER (WHERE plan='premium')         AS premium,
          SUM(total_flats)                               AS total_flats,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS new_this_month
        FROM societies
      `),

      pool.query(`
        SELECT
          COALESCE(SUM(amount),0)                                          AS total_revenue,
          COALESCE(SUM(amount) FILTER (WHERE issued_at >= DATE_TRUNC('month',NOW())),0) AS this_month,
          COALESCE(SUM(amount) FILTER (WHERE issued_at >= DATE_TRUNC('year',NOW())),0)  AS this_year,
          COUNT(*)                                                          AS total_invoices
        FROM invoices WHERE status='paid'
      `),

      pool.query(`
        SELECT p.slug, p.name, p.price_per_flat,
               COUNT(s.id) AS society_count,
               COALESCE(SUM(s.total_flats),0) AS total_flats,
               COALESCE(SUM(s.total_flats) * p.price_per_flat, 0) AS monthly_arr
        FROM plans p
        LEFT JOIN societies s ON s.plan=p.slug AND s.status='active'
        GROUP BY p.id, p.slug, p.name, p.price_per_flat
        ORDER BY p.price_per_flat ASC
      `),

      pool.query(`
        SELECT id, name, slug, plan, status, total_flats, secretary_email, secretary_name, created_at
        FROM societies ORDER BY created_at DESC LIMIT 10
      `),

      pool.query(`
        SELECT id, name, slug, plan, total_flats, secretary_email, trial_ends_at
        FROM societies
        WHERE status='trial' AND trial_ends_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
        ORDER BY trial_ends_at ASC
      `),
    ]);

    const s = societies.rows[0];
    const r = revenue.rows[0];
    const arr = plans.rows.reduce((sum, p) => sum + Number(p.monthly_arr), 0);

    res.json({
      success: true,
      stats: {
        societies: {
          total:       +s.total,
          active:      +s.active,
          trial:       +s.trial,
          suspended:   +s.suspended,
          new_month:   +s.new_this_month,
          total_flats: +s.total_flats,
          by_plan:     { starter:+s.starter, standard:+s.standard, premium:+s.premium },
        },
        revenue: {
          total:    +r.total_revenue,
          month:    +r.this_month,
          year:     +r.this_year,
          invoices: +r.total_invoices,
          arr_monthly: arr,
          arr_yearly:  arr * 12,
        },
      },
      plans: plans.rows,
      recent_societies:   recent.rows,
      expiring_trials:    expiring.rows,
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GET /api/super/societies — all societies ─────────────────────────────────
router.get('/societies', superAdminAuth, async (req, res) => {
  try {
    const { status, plan, search } = req.query;
    let query  = `
      SELECT s.*,
        sub.plan_slug, sub.current_period_end, sub.status AS sub_status,
        (SELECT COUNT(*) FROM tenants t WHERE t.society_id=s.id)::int AS tenant_count
      FROM societies s
      LEFT JOIN subscriptions sub ON sub.society_id=s.id AND sub.status='active'
      WHERE 1=1`;
    const params = [];
    if (status) { params.push(status); query += ` AND s.status=$${params.length}`; }
    if (plan)   { params.push(plan);   query += ` AND s.plan=$${params.length}`; }
    if (search) { params.push(`%${search}%`); query += ` AND (s.name ILIKE $${params.length} OR s.secretary_email ILIKE $${params.length})`; }
    query += ' ORDER BY s.created_at DESC';
    const { rows } = await pool.query(query, params);
    res.json({ success: true, count: rows.length, societies: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GET /api/super/societies/:id ─────────────────────────────────────────────
router.get('/societies/:id', superAdminAuth, async (req, res) => {
  try {
    const society  = await pool.query('SELECT * FROM societies WHERE id=$1', [req.params.id]);
    if (!society.rows.length) return res.status(404).json({ success: false, message: 'Not found.' });
    const invoices = await pool.query('SELECT * FROM invoices WHERE society_id=$1 ORDER BY issued_at DESC', [req.params.id]);
    const subs     = await pool.query('SELECT * FROM subscriptions WHERE society_id=$1 ORDER BY created_at DESC', [req.params.id]);
    const counts   = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM tenants WHERE society_id=$1)::int         AS tenants,
        (SELECT COUNT(*) FROM announcements WHERE society_id=$1)::int   AS announcements,
        (SELECT COUNT(*) FROM maintenance WHERE society_id=$1)::int     AS maintenance,
        (SELECT COUNT(*) FROM visitors WHERE society_id=$1)::int        AS visitors
    `, [req.params.id]);
    res.json({ success: true, society: society.rows[0], invoices: invoices.rows, subscriptions: subs.rows, usage: counts.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── PATCH /api/super/societies/:id/status — suspend/activate ─────────────────
router.patch('/societies/:id/status', superAdminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const { rows } = await pool.query(
      'UPDATE societies SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING id, name, status',
      [status, req.params.id]
    );
    res.json({ success: true, society: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── PATCH /api/super/societies/:id/plan — change plan ────────────────────────
router.patch('/societies/:id/plan', superAdminAuth, async (req, res) => {
  try {
    const { plan } = req.body;
    const { rows } = await pool.query(
      'UPDATE societies SET plan=$1, updated_at=NOW() WHERE id=$2 RETURNING id, name, plan',
      [plan, req.params.id]
    );
    res.json({ success: true, society: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GET /api/super/revenue — monthly revenue chart ───────────────────────────
router.get('/revenue', superAdminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', issued_at), 'Mon YYYY') AS month,
        DATE_TRUNC('month', issued_at)                      AS month_date,
        SUM(total)::int                                      AS revenue,
        COUNT(*)::int                                        AS invoices,
        COUNT(DISTINCT society_id)::int                      AS societies
      FROM invoices WHERE status='paid'
      GROUP BY DATE_TRUNC('month', issued_at)
      ORDER BY month_date DESC LIMIT 12
    `);
    res.json({ success: true, monthly: rows.reverse() });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
