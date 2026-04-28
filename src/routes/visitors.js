const express = require('express');
const pool    = require('../db/pool');
const auth    = require('../middleware/auth');
const router  = express.Router();

// ── DB table ──────────────────────────────────────────────────────────────────
// CREATE TABLE IF NOT EXISTS visitors (
//   id          SERIAL PRIMARY KEY,
//   name        VARCHAR(100) NOT NULL,
//   mobile      VARCHAR(15),
//   flat        VARCHAR(20) NOT NULL,
//   meet_to     VARCHAR(100),
//   type        VARCHAR(30) DEFAULT 'guest',
//   purpose     TEXT,
//   vehicle_no  VARCHAR(20),
//   gate        VARCHAR(20) DEFAULT 'Main',
//   in_time     TIMESTAMP DEFAULT NOW(),
//   out_time    TIMESTAMP,
//   status      VARCHAR(20) DEFAULT 'Inside',
//   logged_by   VARCHAR(100),
//   created_at  TIMESTAMP DEFAULT NOW()
// );

// GET /api/visitors — list with filters
router.get('/', auth, async (req, res) => {
  try {
    const { status, type, flat, date, limit = 100 } = req.query;
    let query  = 'SELECT * FROM visitors WHERE 1=1';
    const params = [];

    if (status) { params.push(status); query += ` AND status = $${params.length}`; }
    if (type)   { params.push(type);   query += ` AND type = $${params.length}`; }
    if (flat)   { params.push(flat);   query += ` AND flat ILIKE $${params.length}`; }
    if (date)   { params.push(date);   query += ` AND DATE(in_time) = $${params.length}`; }

    query += ` ORDER BY in_time DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const { rows } = await pool.query(query, params);

    const today = new Date().toISOString().split('T')[0];
    const todayRows = rows.filter(r => r.in_time?.toString().startsWith(today));

    const summary = {
      total:          rows.length,
      inside_now:     rows.filter(r => r.status === 'Inside').length,
      today_total:    todayRows.length,
      today_checkout: todayRows.filter(r => r.status === 'CheckedOut').length,
    };

    res.json({ success: true, summary, visitors: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/visitors/inside — currently inside
router.get('/inside', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM visitors WHERE status = 'Inside' ORDER BY in_time ASC"
    );
    res.json({ success: true, count: rows.length, visitors: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/visitors/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM visitors WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, visitor: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/visitors — check in a new visitor
router.post('/', async (req, res) => {
  try {
    const { name, mobile, flat, meet_to, type, purpose, vehicle_no, gate, logged_by } = req.body;
    if (!name || !flat) return res.status(400).json({ success: false, message: 'Name and flat are required.' });

    const { rows } = await pool.query(
      `INSERT INTO visitors (name, mobile, flat, meet_to, type, purpose, vehicle_no, gate, logged_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name, mobile, flat, meet_to, type || 'guest', purpose, vehicle_no?.toUpperCase(), gate || 'Main', logged_by || 'Gate Keeper']
    );
    res.status(201).json({ success: true, visitor: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PATCH /api/visitors/:id/checkout — check out visitor
router.patch('/:id/checkout', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE visitors SET status='CheckedOut', out_time=NOW() WHERE id=$1 AND status='Inside' RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(400).json({ success: false, message: 'Visitor not found or already checked out.' });
    res.json({ success: true, visitor: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PATCH /api/visitors/checkout/flat/:flat — checkout all visitors of a flat
router.patch('/checkout/flat/:flat', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE visitors SET status='CheckedOut', out_time=NOW()
       WHERE flat ILIKE $1 AND status='Inside' RETURNING id`,
      [req.params.flat]
    );
    res.json({ success: true, checked_out: rows.length });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/visitors/stats/daily — daily stats for last 7 days
router.get('/stats/daily', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DATE(in_time) AS date, COUNT(*) AS count,
             COUNT(*) FILTER (WHERE type='guest')    AS guests,
             COUNT(*) FILTER (WHERE type='delivery') AS deliveries,
             COUNT(*) FILTER (WHERE type='service')  AS service
      FROM visitors
      WHERE in_time >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(in_time)
      ORDER BY date DESC
    `);
    res.json({ success: true, daily_stats: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// DELETE /api/visitors/:id — admin only
router.delete('/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM visitors WHERE id=$1', [req.params.id]);
    res.json({ success: true, message: 'Record deleted.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
