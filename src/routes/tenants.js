const express = require('express');
const pool    = require('../db/pool');
const auth    = require('../middleware/auth');
const router  = express.Router();

// GET /api/tenants — list all with search and filter
router.get('/', auth, async (req, res) => {
  try {
    const { search = '', status = '', wing = '' } = req.query;
    let query  = 'SELECT * FROM tenants WHERE 1=1';
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (name ILIKE $${params.length} OR flat ILIKE $${params.length} OR phone ILIKE $${params.length})`;
    }
    if (status) { params.push(status); query += ` AND status = $${params.length}`; }
    if (wing)   { params.push(`${wing}-%`); query += ` AND flat ILIKE $${params.length}`; }

    query += ' ORDER BY flat ASC';
    const { rows } = await pool.query(query, params);
    res.json({ success: true, count: rows.length, tenants: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/tenants/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tenants WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Tenant not found.' });
    res.json({ success: true, tenant: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/tenants
router.post('/', auth, async (req, res) => {
  try {
    const { flat, name, phone, email, members, status, join_date, aadhaar, notes, password } = req.body;
    if (!flat || !name) return res.status(400).json({ success: false, message: 'Flat and name are required.' });

    // Get society_id from JWT token
    const society_id = req.user?.society_id || null;

    // Ensure tenants table has needed columns
    await pool.query(`
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS society_id INTEGER;
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS password VARCHAR(255);
    `).catch(() => {});

    // Default password = flat number (e.g. "A-101")
    const bcrypt = require('bcryptjs');
    const hashedPassword = password
      ? await bcrypt.hash(password, 10)
      : await bcrypt.hash(flat, 10);

    const { rows } = await pool.query(
      `INSERT INTO tenants (flat, name, phone, email, members, status, join_date, aadhaar, notes, society_id, password)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [flat, name, phone, email, members || 1, status || 'Active', join_date || new Date(), aadhaar, notes, society_id, hashedPassword]
    );
    res.status(201).json({ success: true, tenant: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'Flat number already exists.' });
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/tenants/:id
router.put('/:id', auth, async (req, res) => {
  try {
    const { flat, name, phone, email, members, status, aadhaar, notes } = req.body;
    const { rows } = await pool.query(
      `UPDATE tenants SET flat=$1, name=$2, phone=$3, email=$4, members=$5,
       status=$6, aadhaar=$7, notes=$8, updated_at=NOW()
       WHERE id=$9 RETURNING *`,
      [flat, name, phone, email, members, status, aadhaar, notes, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Tenant not found.' });
    res.json({ success: true, tenant: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/tenants/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM tenants WHERE id=$1 RETURNING id', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Tenant not found.' });
    res.json({ success: true, message: 'Tenant deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/tenants/:id/maintenance — maintenance history for a tenant
router.get('/:id/maintenance', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM maintenance WHERE tenant_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json({ success: true, records: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
