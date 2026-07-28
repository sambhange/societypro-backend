const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');

// ── Lazy Razorpay init ────────────────────────────────────────────────────────
const getRazorpay = () => {
  const keyId     = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || keyId.includes('placeholder') || !keySecret || keySecret.includes('placeholder')) {
    return null;
  }
  const Razorpay = require('razorpay');
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
};

// ── GET /api/payments ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, t.name as tenant_name, t.flat_number
       FROM payments p
       LEFT JOIN tenants t ON p.tenant_id = t.id
       ORDER BY p.created_at DESC LIMIT 100`
    ).catch(() => ({ rows: [] }));
    res.json({ success:true, payments: result.rows });
  } catch (err) {
    res.status(500).json({ success:false, message:err.message });
  }
});

// ── POST /api/payments/create-order ──────────────────────────────────────────
router.post('/create-order', async (req, res) => {
  try {
    const { amount, tenant_id, maintenance_id } = req.body;

    // Check if society has their own Razorpay keys
    let societyKeyId, societyKeySecret;
    try {
      const settingsResult = await pool.query(
        'SELECT razorpay_key_id, razorpay_key_secret FROM society_settings WHERE id = 1'
      );
      if (settingsResult.rows[0]?.razorpay_key_id) {
        societyKeyId     = settingsResult.rows[0].razorpay_key_id;
        societyKeySecret = settingsResult.rows[0].razorpay_key_secret;
      }
    } catch (e) {
      // Table doesn't exist yet — use global keys
    }

    // Use society keys if available, else global keys
    const keyId     = societyKeyId     || process.env.RAZORPAY_KEY_ID;
    const keySecret = societyKeySecret || process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || keyId.includes('placeholder')) {
      return res.json({
        success: false,
        message: 'Online payments not configured. Please add Razorpay keys in Settings → Payment Gateway.',
        payment_method: 'manual'
      });
    }

    const Razorpay = require('razorpay');
    const rz = new Razorpay({ key_id: keyId, key_secret: keySecret });

    const order = await rz.orders.create({
      amount:   Math.round(amount * 100),
      currency: 'INR',
      receipt:  `maint_${maintenance_id || Date.now()}`,
    });

    res.json({ success:true, order, key_id: keyId });
  } catch (err) {
    console.error('Payment order error:', err.message);
    res.status(500).json({ success:false, message:err.message });
  }
});

// ── POST /api/payments/verify ─────────────────────────────────────────────────
router.post('/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, maintenance_id, tenant_id, amount } = req.body;

    const crypto = require('crypto');
    const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
    const sign      = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSign = crypto.createHmac('sha256', keySecret).update(sign).digest('hex');

    if (razorpay_signature !== expectedSign) {
      return res.status(400).json({ success:false, message:'Payment verification failed' });
    }

    // Mark maintenance as paid
    if (maintenance_id) {
      await pool.query(
        `UPDATE maintenance SET status='Paid', paid_date=NOW(), transaction_id=$1 WHERE id=$2`,
        [razorpay_payment_id, maintenance_id]
      ).catch(e => console.log('Update error:', e.message));
    }

    // Record payment
    await pool.query(
      `INSERT INTO payments (tenant_id, amount, payment_id, order_id, status, created_at)
       VALUES ($1,$2,$3,$4,'completed',NOW())`,
      [tenant_id||0, amount||0, razorpay_payment_id, razorpay_order_id]
    ).catch(e => console.log('Payment insert error:', e.message));

    res.json({ success:true, message:'Payment verified successfully', payment_id: razorpay_payment_id });
  } catch (err) {
    res.status(500).json({ success:false, message:err.message });
  }
});

// ── POST /api/payments/manual ─────────────────────────────────────────────────
router.post('/manual', async (req, res) => {
  try {
    const { maintenance_id, tenant_id, amount, payment_mode, notes } = req.body;

    if (maintenance_id) {
      await pool.query(
        `UPDATE maintenance SET status='Paid', paid_date=NOW(), payment_mode=$1, notes=$2 WHERE id=$3`,
        [payment_mode||'Cash', notes||'', maintenance_id]
      ).catch(e => console.log('Update error:', e.message));
    }

    await pool.query(
      `INSERT INTO payments (tenant_id, amount, payment_mode, status, notes, created_at)
       VALUES ($1,$2,$3,'completed',$4,NOW())`,
      [tenant_id||0, amount||0, payment_mode||'Cash', notes||'']
    ).catch(e => console.log('Payment insert error:', e.message));

    res.json({ success:true, message:'Payment recorded successfully' });
  } catch (err) {
    res.status(500).json({ success:false, message:err.message });
  }
});

// ── GET /api/payments/stats ───────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_transactions,
        SUM(amount) as total_collected,
        COUNT(CASE WHEN status='completed' THEN 1 END) as successful
      FROM payments
    `).catch(() => ({ rows:[{ total_transactions:0, total_collected:0, successful:0 }] }));
    res.json({ success:true, stats: stats.rows[0] });
  } catch (err) {
    res.status(500).json({ success:false, message:err.message });
  }
});

module.exports = router;
