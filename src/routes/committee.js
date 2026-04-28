const express = require('express');
const pool    = require('../db/pool');
const auth    = require('../middleware/auth');
const router  = express.Router();

// GET /api/committee  — public, residents can see committee
router.get('/', async (req, res) => {
  try {
    const { tenure } = req.query;
    let query  = "SELECT * FROM committee_members WHERE active = TRUE";
    const params = [];
    if (tenure) { params.push(tenure); query += ` AND tenure = $${params.length}`; }
    query += " ORDER BY CASE role WHEN 'chairman' THEN 1 WHEN 'vice_chairman' THEN 2 WHEN 'secretary' THEN 3 WHEN 'joint_secretary' THEN 4 WHEN 'treasurer' THEN 5 ELSE 6 END";
    const { rows } = await pool.query(query, params);
    res.json({ success: true, count: rows.length, members: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/committee/tenures
router.get('/tenures', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT DISTINCT tenure FROM committee_members ORDER BY tenure DESC');
    res.json({ success: true, tenures: rows.map(r => r.tenure) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/committee/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM committee_members WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, member: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/committee  — admin only
router.post('/', auth, async (req, res) => {
  try {
    const { name, role, flat, phone, email, tenure, since, bio } = req.body;
    if (!name || !role) return res.status(400).json({ success: false, message: 'Name and role required.' });
    const { rows } = await pool.query(
      `INSERT INTO committee_members (name, role, flat, phone, email, tenure, member_since, bio)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, role, flat, phone, email, tenure || '2024–2026', since, bio]
    );
    res.status(201).json({ success: true, member: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PUT /api/committee/:id
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, role, flat, phone, email, tenure, since, bio } = req.body;
    const { rows } = await pool.query(
      `UPDATE committee_members SET name=$1, role=$2, flat=$3, phone=$4, email=$5,
       tenure=$6, member_since=$7, bio=$8, updated_at=NOW() WHERE id=$9 RETURNING *`,
      [name, role, flat, phone, email, tenure, since, bio, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, member: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// DELETE /api/committee/:id — soft delete
router.delete('/:id', auth, async (req, res) => {
  try {
    await pool.query('UPDATE committee_members SET active=FALSE, updated_at=NOW() WHERE id=$1', [req.params.id]);
    res.json({ success: true, message: 'Member removed.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
