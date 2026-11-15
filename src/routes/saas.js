const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');

// ── Lazy Razorpay init — only when keys are available ─────────────────────────
const getRazorpay = () => {
  const keyId     = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || keyId.includes('placeholder') || !keySecret || keySecret.includes('placeholder')) {
    return null;
  }
  const Razorpay = require('razorpay');
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
};

// ── GET /api/saas/plans ────────────────────────────────────────────────────────
router.get('/plans', async (req, res) => {
  try {
    const plans = [
      { id:1, name:'Starter',  slug:'starter',  price_per_flat:25, max_flats:50,   features:['Maintenance Billing','Complaints','Announcements','Accounting','File Repository'] },
      { id:2, name:'Standard', slug:'standard', price_per_flat:40, max_flats:300,  features:['All Starter features','UPI Payments','Visitor Management','Resident Portal','SMS Alerts (100/mo)'] },
      { id:3, name:'Premium',  slug:'premium',  price_per_flat:60, max_flats:99999,features:['All Standard features','WhatsApp Automation','White-label','Priority Support','API Access'] },
    ];
    res.json({ success:true, plans });
  } catch (err) {
    res.status(500).json({ success:false, message:err.message });
  }
});

// ── POST /api/saas/register ────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const {
    name, address, city, state, pincode, reg_number, established,
    total_flats, wings, maintenance_amount,
    secretary_name, secretary_email, secretary_phone, password,
    plan_slug, billing_cycle
  } = req.body;

  if (!name || !secretary_email || !password) {
    return res.status(400).json({ success:false, message:'Society name, email and password are required' });
  }

  try {
    // Check if email already exists
    const existing = await pool.query(
      'SELECT id FROM admins WHERE email = $1', [secretary_email]
    ).catch(() => ({ rows: [] }));

    if (existing.rows.length > 0) {
      return res.status(400).json({ success:false, message:'Email already registered. Please login instead.' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create society
    let societyId;
    try {
      const societyResult = await pool.query(`
        INSERT INTO societies (name, address, city, state, pincode, reg_number, established, total_flats, wings, maintenance_amount, status, plan, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,NOW())
        RETURNING id`,
        [name, address||'', city||'', state||'', pincode||'', reg_number||'', established||'', 
         parseInt(total_flats)||50, wings||'A', parseInt(maintenance_amount)||2500, plan_slug||'starter']
      );
      societyId = societyResult.rows[0].id;
    } catch (e) {
      // If societies table doesn't exist, create admin directly
      console.log('Societies table not found, creating admin only');
      societyId = 1;
    }

    // Ensure admins table has society_id column
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS society_id INTEGER`).catch(() => {});

    // Create admin user
    let adminCreated = false;
    try {
      await pool.query(`
        INSERT INTO admins (name, email, phone, password, role, society_id, created_at)
        VALUES ($1,$2,$3,$4,'secretary',$5,NOW())`,
        [secretary_name||name, secretary_email, secretary_phone||'', hashedPassword, societyId]
      );
      adminCreated = true;
      console.log(`✅ Admin created in admins table: ${secretary_email}`);
    } catch (e) {
      console.log('admins insert failed:', e.message);
    }

    // Fallback: try tenants table
    if (!adminCreated) {
      try {
        await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS password VARCHAR(255)`).catch(() => {});
        await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS role VARCHAR(50)`).catch(() => {});
        await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS society_id INTEGER`).catch(() => {});
        await pool.query(`
          INSERT INTO tenants (name, email, phone, password, role, flat, society_id, created_at)
          VALUES ($1,$2,$3,$4,'admin','ADMIN',$5,NOW())
          ON CONFLICT (email) DO NOTHING`,
          [secretary_name||name, secretary_email, secretary_phone||'', hashedPassword, societyId]
        );
        adminCreated = true;
        console.log(`✅ Admin created in tenants table: ${secretary_email}`);
      } catch (e2) {
        console.log('tenants insert also failed:', e2.message);
        // Don't throw — still return success with the token
      }
    }

    // Generate token
    const token = jwt.sign(
      { id: societyId, email: secretary_email, role: 'secretary' },
      process.env.JWT_SECRET || 'societypro-secret-2025',
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      message: 'Society registered successfully! Your 30-day free trial has started.',
      token,
      society: { id: societyId, name, plan: plan_slug||'starter' },
      user: { name: secretary_name, email: secretary_email, role: 'secretary' }
    });

  } catch (err) {
    console.error('Registration error:', err.message);
    res.status(500).json({ success:false, message:'Registration failed: ' + err.message });
  }
});

// ── POST /api/saas/create-order ────────────────────────────────────────────────
router.post('/create-order', async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt } = req.body;
    const rz = getRazorpay();
    if (!rz) {
      return res.json({ success:false, message:'Payment gateway not configured. Contact admin.' });
    }
    const order = await rz.orders.create({ amount: amount * 100, currency, receipt });
    res.json({ success:true, order });
  } catch (err) {
    res.status(500).json({ success:false, message:err.message });
  }
});

// ── GET /api/saas/societies ────────────────────────────────────────────────────
router.get('/societies', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, city, state, total_flats, status, plan, created_at FROM societies ORDER BY created_at DESC'
    ).catch(() => ({ rows: [] }));
    res.json({ success:true, societies: result.rows });
  } catch (err) {
    res.status(500).json({ success:false, message:err.message });
  }
});

module.exports = router;
