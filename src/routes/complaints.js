const express = require('express');
const pool    = require('../db/pool');
const auth    = require('../middleware/auth');
const router  = express.Router();

// DB table creation (run once via db:setup)
// CREATE TABLE IF NOT EXISTS complaints (
//   id          SERIAL PRIMARY KEY,
//   ticket_no   VARCHAR(20) UNIQUE NOT NULL,
//   flat        VARCHAR(20) NOT NULL,
//   name        VARCHAR(100) NOT NULL,
//   category    VARCHAR(50),
//   title       VARCHAR(200) NOT NULL,
//   description TEXT,
//   priority    VARCHAR(20) DEFAULT 'Medium',
//   status      VARCHAR(30) DEFAULT 'Open',
//   created_at  TIMESTAMP DEFAULT NOW(),
//   updated_at  TIMESTAMP DEFAULT NOW()
// );
// CREATE TABLE IF NOT EXISTS complaint_replies (
//   id           SERIAL PRIMARY KEY,
//   complaint_id INTEGER REFERENCES complaints(id) ON DELETE CASCADE,
//   replied_by   VARCHAR(100),
//   message      TEXT NOT NULL,
//   created_at   TIMESTAMP DEFAULT NOW()
// );

// GET /api/complaints
router.get('/', auth, async (req, res) => {
  try {
    const { status, category, priority, flat } = req.query;
    let query = `
      SELECT c.*, COUNT(r.id)::int AS reply_count
      FROM complaints c
      LEFT JOIN complaint_replies r ON r.complaint_id = c.id
      WHERE 1=1`;
    const params = [];
    if (status)   { params.push(status);   query += ` AND c.status = $${params.length}`; }
    if (category) { params.push(category); query += ` AND c.category = $${params.length}`; }
    if (priority) { params.push(priority); query += ` AND c.priority = $${params.length}`; }
    if (flat)     { params.push(flat);     query += ` AND c.flat ILIKE $${params.length}`; }
    query += ' GROUP BY c.id ORDER BY c.created_at DESC';
    const { rows } = await pool.query(query, params);

    const summary = {
      total:       rows.length,
      open:        rows.filter(r => r.status === 'Open').length,
      in_progress: rows.filter(r => r.status === 'In Progress').length,
      resolved:    rows.filter(r => r.status === 'Resolved').length,
      closed:      rows.filter(r => r.status === 'Closed').length,
    };
    res.json({ success: true, summary, complaints: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/complaints/:id  — with replies
router.get('/:id', auth, async (req, res) => {
  try {
    const complaint = await pool.query('SELECT * FROM complaints WHERE id=$1', [req.params.id]);
    if (!complaint.rows.length) return res.status(404).json({ success: false, message: 'Not found.' });
    const replies = await pool.query(
      'SELECT * FROM complaint_replies WHERE complaint_id=$1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json({ success: true, complaint: complaint.rows[0], replies: replies.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/complaints  — raise new complaint (public — any resident)
router.post('/', async (req, res) => {
  try {
    const { flat, name, category, title, description, priority } = req.body;
    if (!flat || !title) return res.status(400).json({ success: false, message: 'Flat and title required.' });

    const count = await pool.query('SELECT COUNT(*) FROM complaints');
    const ticketNo = `TKT${String(Number(count.rows[0].count) + 1).padStart(3, '0')}`;

    const { rows } = await pool.query(
      `INSERT INTO complaints (ticket_no, flat, name, category, title, description, priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [ticketNo, flat, name, category || 'other', title, description, priority || 'Medium']
    );
    res.status(201).json({ success: true, complaint: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PATCH /api/complaints/:id/status  — update status (admin)
router.patch('/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['Open', 'In Progress', 'Resolved', 'Closed'];
    if (!valid.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status.' });
    const { rows } = await pool.query(
      `UPDATE complaints SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
      [status, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, complaint: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/complaints/:id/reply  — add reply (admin or resident)
router.post('/:id/reply', async (req, res) => {
  try {
    const { message, replied_by } = req.body;
    if (!message) return res.status(400).json({ success: false, message: 'Message required.' });
    const { rows } = await pool.query(
      `INSERT INTO complaint_replies (complaint_id, replied_by, message)
       VALUES ($1,$2,$3) RETURNING *`,
      [req.params.id, replied_by || 'Admin', message]
    );
    // Auto-update complaint status to In Progress if still Open
    await pool.query(
      `UPDATE complaints SET status='In Progress', updated_at=NOW()
       WHERE id=$1 AND status='Open'`,
      [req.params.id]
    );
    res.status(201).json({ success: true, reply: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// DELETE /api/complaints/:id  — admin only
router.delete('/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM complaints WHERE id=$1', [req.params.id]);
    res.json({ success: true, message: 'Complaint deleted.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
