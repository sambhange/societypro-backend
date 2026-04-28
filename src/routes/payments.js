const express  = require('express');
const Razorpay = require('razorpay');
const crypto   = require('crypto');
const pool     = require('../db/pool');
const auth     = require('../middleware/auth');
const router   = express.Router();

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// GET /api/payments
router.get('/', auth, async (req, res) => {
  try {
    const { status, month, flat } = req.query;
    let query = 'SELECT * FROM payments WHERE 1=1';
    const params = [];
    if (status) { params.push(status); query += ` AND status = $${params.length}`; }
    if (flat)   { params.push(flat);   query += ` AND flat ILIKE $${params.length}`; }
    query += ' ORDER BY created_at DESC';
    const { rows } = await pool.query(query, params);

    const summary = {
      total_collected: rows.filter(r => r.status === 'Success').reduce((s,r) => s + Number(r.amount), 0),
      total_pending:   rows.filter(r => r.status !== 'Success').reduce((s,r) => s + Number(r.amount), 0),
      success_count:   rows.filter(r => r.status === 'Success').length,
      pending_count:   rows.filter(r => r.status !== 'Success').length,
    };

    res.json({ success: true, summary, payments: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/payments/create-order — create Razorpay order
router.post('/create-order', async (req, res) => {
  try {
    const { flat, name, amount, maintenance_id } = req.body;
    if (!flat || !amount) return res.status(400).json({ success: false, message: 'Flat and amount required.' });

    const order = await razorpay.orders.create({
      amount:   amount * 100,  // paise
      currency: 'INR',
      receipt:  `receipt_${flat}_${Date.now()}`,
      notes:    { flat, name, maintenance_id: maintenance_id?.toString() },
    });

    // Save pending payment
    await pool.query(
      `INSERT INTO payments (flat, name, amount, status, razorpay_order_id, maintenance_id)
       VALUES ($1,$2,$3,'Pending',$4,$5)`,
      [flat, name, amount, order.id, maintenance_id]
    );

    res.json({
      success: true,
      order_id:   order.id,
      amount:     order.amount,
      currency:   order.currency,
      key_id:     process.env.RAZORPAY_KEY_ID,
      society:    process.env.SOCIETY_NAME,
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/payments/verify — verify Razorpay signature after payment
router.post('/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const body      = razorpay_order_id + '|' + razorpay_payment_id;
    const expected  = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expected !== razorpay_signature) {
      await pool.query(
        `UPDATE payments SET status='Failed' WHERE razorpay_order_id=$1`,
        [razorpay_order_id]
      );
      return res.status(400).json({ success: false, message: 'Payment verification failed.' });
    }

    // Mark payment success
    const { rows } = await pool.query(
      `UPDATE payments
       SET status='Success', razorpay_payment_id=$1, razorpay_signature=$2,
           paid_at=NOW(), mode='UPI', txn_id=$1
       WHERE razorpay_order_id=$3 RETURNING *`,
      [razorpay_payment_id, razorpay_signature, razorpay_order_id]
    );

    // Also mark maintenance record as paid
    if (rows[0]?.maintenance_id) {
      await pool.query(
        `UPDATE maintenance SET status='Paid', paid_on=CURRENT_DATE, txn_id=$1, mode='UPI', updated_at=NOW()
         WHERE id=$2`,
        [razorpay_payment_id, rows[0].maintenance_id]
      );
    }

    res.json({ success: true, message: 'Payment verified!', payment: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/payments/cash — record cash payment manually
router.post('/cash', auth, async (req, res) => {
  try {
    const { flat, name, amount, maintenance_id, notes } = req.body;
    const txn_id = `CASH${Date.now()}`;

    const { rows } = await pool.query(
      `INSERT INTO payments (flat, name, amount, mode, status, txn_id, paid_at, maintenance_id, notes)
       VALUES ($1,$2,$3,'Cash','Success',$4,NOW(),$5,$6) RETURNING *`,
      [flat, name, amount, txn_id, maintenance_id, notes]
    );

    if (maintenance_id) {
      await pool.query(
        `UPDATE maintenance SET status='Paid', paid_on=CURRENT_DATE, txn_id=$1, mode='Cash', updated_at=NOW() WHERE id=$2`,
        [txn_id, maintenance_id]
      );
    }

    res.status(201).json({ success: true, payment: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/payments/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM payments WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Payment not found.' });
    res.json({ success: true, payment: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
