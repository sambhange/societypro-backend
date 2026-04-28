const express   = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const Razorpay  = require('razorpay');
const crypto    = require('crypto');
const pool      = require('../db/pool');
const { superAdminAuth, societyAuth } = require('../middleware/tenancy');
const router    = express.Router();

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ── GET /api/saas/plans — public, list all plans ────────────────────────────
router.get('/plans', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM plans WHERE active=TRUE ORDER BY price_per_flat ASC');
    res.json({ success: true, plans: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST /api/saas/register — new society signup ────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const {
      name, address, city, state, pincode,
      total_flats, wings,
      secretary_name, secretary_email, secretary_phone,
      password, plan = 'starter'
    } = req.body;

    if (!name || !secretary_email || !password || !total_flats)
      return res.status(400).json({ success: false, message: 'Name, email, password and total flats are required.' });

    // Check email not taken
    const existing = await pool.query('SELECT id FROM societies WHERE secretary_email=$1', [secretary_email]);
    if (existing.rows.length)
      return res.status(400).json({ success: false, message: 'An account with this email already exists.' });

    // Generate unique slug
    const baseSlug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 40);
    const { rows: slugCheck } = await pool.query('SELECT COUNT(*) FROM societies WHERE slug LIKE $1', [`${baseSlug}%`]);
    const slug = Number(slugCheck[0].count) > 0 ? `${baseSlug}-${Date.now().toString().slice(-4)}` : baseSlug;

    const hash = await bcrypt.hash(password, 10);

    const { rows } = await pool.query(`
      INSERT INTO societies
        (name, slug, address, city, state, pincode, total_flats, wings,
         secretary_name, secretary_email, secretary_phone, password, plan, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'trial')
      RETURNING id, name, slug, secretary_name, secretary_email, plan, status, trial_ends_at`,
      [name, slug, address, city, state, pincode, total_flats,
       wings || ['A'], secretary_name, secretary_email, secretary_phone, hash, plan]
    );

    const society = rows[0];

    // Auto-create default admin record for this society
    await pool.query(
      `INSERT INTO admins (name, email, password, role, society_id)
       VALUES ($1,$2,$3,'secretary',$4) ON CONFLICT DO NOTHING`,
      [secretary_name || 'Admin', secretary_email, hash, society.id]
    );

    // Generate token
    const token = jwt.sign(
      { id: society.id, society_id: society.id, email: secretary_email, role: 'secretary', name: secretary_name, plan: society.plan },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(201).json({
      success: true,
      message: `Welcome! Your 30-day free trial has started.`,
      token,
      society: { id:society.id, name:society.name, slug:society.slug, plan:society.plan, status:society.status, trial_ends_at:society.trial_ends_at },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/saas/login — society login ────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows } = await pool.query('SELECT * FROM societies WHERE secretary_email=$1', [email]);
    if (!rows.length)
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });

    const society = rows[0];
    const match   = await bcrypt.compare(password, society.password);
    if (!match)
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });

    const token = jwt.sign(
      { id:society.id, society_id:society.id, email:society.secretary_email, role:'secretary', name:society.secretary_name, plan:society.plan },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success: true, token,
      society: { id:society.id, name:society.name, slug:society.slug, plan:society.plan, status:society.status, total_flats:society.total_flats, trial_ends_at:society.trial_ends_at },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST /api/saas/subscribe — create Razorpay subscription ─────────────────
router.post('/subscribe', societyAuth, async (req, res) => {
  try {
    const { plan_slug, billing_cycle = 'monthly' } = req.body;
    const society   = req.society;

    const { rows: planRows } = await pool.query('SELECT * FROM plans WHERE slug=$1', [plan_slug]);
    if (!planRows.length) return res.status(404).json({ success: false, message: 'Plan not found.' });
    const plan = planRows[0];

    const amount = Math.round(plan.price_per_flat * society.total_flats * (billing_cycle === 'yearly' ? 10 : 1));

    // Create Razorpay order
    const order = await razorpay.orders.create({
      amount:   amount * 100,
      currency: 'INR',
      receipt:  `sub_${society.id}_${Date.now()}`,
      notes:    { society_id: String(society.id), plan: plan_slug, flats: String(society.total_flats) },
    });

    // Save pending subscription
    const now   = new Date();
    const end   = new Date(now);
    billing_cycle === 'yearly' ? end.setFullYear(end.getFullYear() + 1) : end.setMonth(end.getMonth() + 1);

    const { rows } = await pool.query(`
      INSERT INTO subscriptions (society_id, plan_id, plan_slug, billing_cycle, price_per_flat, total_flats, amount, status, razorpay_order_id, current_period_start, current_period_end)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10) RETURNING *`,
      [society.id, plan.id, plan_slug, billing_cycle, plan.price_per_flat, society.total_flats, amount, order.id, now.toISOString().split('T')[0], end.toISOString().split('T')[0]]
    );

    res.json({
      success: true,
      order_id: order.id,
      amount:   order.amount,
      currency: 'INR',
      key_id:   process.env.RAZORPAY_KEY_ID,
      subscription_id: rows[0].id,
      plan,
      society_name: society.name,
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST /api/saas/subscribe/verify — verify payment & activate ──────────────
router.post('/subscribe/verify', societyAuth, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, subscription_id, plan_slug } = req.body;

    const body     = razorpay_order_id + '|' + razorpay_payment_id;
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(body).digest('hex');
    if (expected !== razorpay_signature)
      return res.status(400).json({ success: false, message: 'Payment verification failed.' });

    // Activate subscription
    await pool.query(
      `UPDATE subscriptions SET status='active', razorpay_subscription_id=$1, updated_at=NOW() WHERE id=$2`,
      [razorpay_payment_id, subscription_id]
    );

    // Update society plan & status
    await pool.query(
      `UPDATE societies SET plan=$1, status='active', updated_at=NOW() WHERE id=$2`,
      [plan_slug, req.societyId]
    );

    // Generate invoice number
    const invCount = await pool.query('SELECT COUNT(*) FROM invoices');
    const invoiceNo = `INV-${new Date().getFullYear()}-${String(Number(invCount.rows[0].count)+1).padStart(4,'0')}`;

    const sub = await pool.query('SELECT * FROM subscriptions WHERE id=$1', [subscription_id]);
    const s   = sub.rows[0];
    await pool.query(
      `INSERT INTO invoices (society_id, subscription_id, invoice_no, amount, total, status, razorpay_payment_id, period_start, period_end)
       VALUES ($1,$2,$3,$4,$4,'paid',$5,$6,$7)`,
      [req.societyId, subscription_id, invoiceNo, s.amount, razorpay_payment_id, s.current_period_start, s.current_period_end]
    );

    res.json({ success: true, message: 'Subscription activated! Welcome aboard.', invoice_no: invoiceNo });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GET /api/saas/my-plan — current society's subscription info ───────────────
router.get('/my-plan', societyAuth, async (req, res) => {
  try {
    const society = req.society;
    const sub     = await pool.query(
      'SELECT * FROM subscriptions WHERE society_id=$1 ORDER BY created_at DESC LIMIT 1',
      [req.societyId]
    );
    const invoices = await pool.query(
      'SELECT * FROM invoices WHERE society_id=$1 ORDER BY issued_at DESC LIMIT 6',
      [req.societyId]
    );
    const plan = await pool.query('SELECT * FROM plans WHERE slug=$1', [society.plan]);

    const monthly_amount = (plan.rows[0]?.price_per_flat || 0) * society.total_flats;
    const yearly_amount  = monthly_amount * 10;

    res.json({
      success: true,
      society: { name:society.name, plan:society.plan, status:society.status, total_flats:society.total_flats, trial_ends_at:society.trial_ends_at },
      plan: plan.rows[0],
      subscription: sub.rows[0] || null,
      invoices: invoices.rows,
      pricing: { monthly: monthly_amount, yearly: yearly_amount, savings: monthly_amount * 2 },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GET /api/saas/invoices — billing history ─────────────────────────────────
router.get('/invoices', societyAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM invoices WHERE society_id=$1 ORDER BY issued_at DESC',
      [req.societyId]
    );
    res.json({ success: true, invoices: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
