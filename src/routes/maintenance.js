const express = require('express');
const pool    = require('../db/pool');
const auth    = require('../middleware/auth');
const router  = express.Router();

// GET /api/maintenance?month=April 2025
router.get('/', auth, async (req, res) => {
  try {
    const { month, status, flat } = req.query;
    let query = 'SELECT * FROM maintenance WHERE 1=1';
    const params = [];

    if (month)  { params.push(month);   query += ` AND month = $${params.length}`; }
    if (status) { params.push(status);  query += ` AND status = $${params.length}`; }
    if (flat)   { params.push(flat);    query += ` AND flat ILIKE $${params.length}`; }

    query += ' ORDER BY flat ASC';
    const { rows } = await pool.query(query, params);

    const summary = {
      total:         rows.length,
      paid:          rows.filter(r => r.status === 'Paid').length,
      pending:       rows.filter(r => r.status === 'Pending').length,
      overdue:       rows.filter(r => r.status === 'Overdue').length,
      total_collected: rows.filter(r => r.status === 'Paid').reduce((s, r) => s + Number(r.amount), 0),
      total_pending:   rows.filter(r => r.status !== 'Paid').reduce((s, r) => s + Number(r.amount), 0),
    };

    res.json({ success: true, summary, records: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/maintenance/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM maintenance WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Record not found.' });
    res.json({ success: true, record: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/maintenance — add single record
router.post('/', auth, async (req, res) => {
  try {
    const { tenant_id, flat, name, month, amount, mode, notes } = req.body;
    if (!flat || !month) return res.status(400).json({ success: false, message: 'Flat and month required.' });

    const { rows } = await pool.query(
      `INSERT INTO maintenance (tenant_id, flat, name, month, amount, mode, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [tenant_id, flat, name, month, amount || 2500, mode, notes]
    );
    res.status(201).json({ success: true, record: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/maintenance/bulk-generate — auto-create records for all tenants for a month
router.post('/bulk-generate', auth, async (req, res) => {
  try {
    const { month, amount = 2500 } = req.body;
    if (!month) return res.status(400).json({ success: false, message: 'Month is required.' });

    const existing = await pool.query('SELECT flat FROM maintenance WHERE month = $1', [month]);
    const existingFlats = new Set(existing.rows.map(r => r.flat));

    const tenants = await pool.query("SELECT id, flat, name FROM tenants WHERE status = 'Active'");
    const newRecords = tenants.rows.filter(t => !existingFlats.has(t.flat));

    if (!newRecords.length) {
      return res.json({ success: true, message: 'Records already exist for all active tenants.', created: 0 });
    }

    const values = newRecords.map((t, i) =>
      `($${i * 4 + 1},$${i * 4 + 2},$${i * 4 + 3},$${i * 4 + 4})`
    ).join(',');

    const params = newRecords.flatMap(t => [t.id, t.flat, t.name, month]);
    // amount and status defaults applied by DB
    await pool.query(
      `INSERT INTO maintenance (tenant_id, flat, name, month) VALUES ${values}`,
      params
    );

    res.json({ success: true, message: `${newRecords.length} records created for ${month}`, created: newRecords.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/maintenance/:id/mark-paid
router.put('/:id/mark-paid', auth, async (req, res) => {
  try {
    const { mode, txn_id, notes } = req.body;
    const { rows } = await pool.query(
      `UPDATE maintenance SET status='Paid', paid_on=CURRENT_DATE, mode=$1, txn_id=$2, notes=$3, updated_at=NOW()
       WHERE id=$4 RETURNING *`,
      [mode || 'Cash', txn_id, notes, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Record not found.' });
    res.json({ success: true, record: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/maintenance/:id — update record
router.put('/:id', auth, async (req, res) => {
  try {
    const { status, amount, paid_on, txn_id, mode, notes } = req.body;
    const { rows } = await pool.query(
      `UPDATE maintenance SET status=$1, amount=$2, paid_on=$3, txn_id=$4, mode=$5, notes=$6, updated_at=NOW()
       WHERE id=$7 RETURNING *`,
      [status, amount, paid_on, txn_id, mode, notes, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Record not found.' });
    res.json({ success: true, record: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/maintenance/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM maintenance WHERE id=$1 RETURNING id', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Record not found.' });
    res.json({ success: true, message: 'Record deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/maintenance/months — get list of distinct months
router.get('/meta/months', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT DISTINCT month FROM maintenance ORDER BY month DESC');
    res.json({ success: true, months: rows.map(r => r.month) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
