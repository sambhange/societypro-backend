const express = require('express');
const pool    = require('../db/pool');
const auth    = require('../middleware/auth');
const router  = express.Router();

// GET /api/facilities — list all facilities
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM facilities WHERE active=TRUE ORDER BY id ASC');
    res.json({ success: true, facilities: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/facilities/:id
router.get('/:id', async (req, res) => {
  try {
    const fac  = await pool.query('SELECT * FROM facilities WHERE id=$1', [req.params.id]);
    const bkgs = await pool.query(
      "SELECT * FROM facility_bookings WHERE facility_id=$1 AND status NOT IN ('Cancelled','Rejected') ORDER BY date DESC LIMIT 20",
      [req.params.id]
    );
    if (!fac.rows.length) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, facility: fac.rows[0], bookings: bkgs.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/facilities/bookings/all
router.get('/bookings/all', auth, async (req, res) => {
  try {
    const { status, date_from, date_to } = req.query;
    let query  = `
      SELECT fb.*, f.name AS facility_name, f.emoji
      FROM facility_bookings fb
      JOIN facilities f ON f.id = fb.facility_id
      WHERE 1=1`;
    const params = [];
    if (status)    { params.push(status);    query += ` AND fb.status = $${params.length}`; }
    if (date_from) { params.push(date_from); query += ` AND fb.date >= $${params.length}`; }
    if (date_to)   { params.push(date_to);   query += ` AND fb.date <= $${params.length}`; }
    query += ' ORDER BY fb.date DESC, fb.from_time ASC';
    const { rows } = await pool.query(query, params);

    const stats = {
      total:    rows.length,
      pending:  rows.filter(r=>r.status==='Pending').length,
      approved: rows.filter(r=>r.status==='Approved').length,
      revenue:  rows.filter(r=>!['Cancelled','Rejected'].includes(r.status)).reduce((s,r)=>s+Number(r.amount)+Number(r.deposit),0),
    };
    res.json({ success: true, stats, bookings: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/facilities/book — create booking
router.post('/book', async (req, res) => {
  try {
    const { facility_id, flat, booked_by, date, from_time, to_time, purpose, hours, amount, deposit } = req.body;
    if (!facility_id || !flat || !date || !from_time || !to_time)
      return res.status(400).json({ success: false, message: 'Facility, flat, date and times are required.' });

    // Check availability — no overlapping approved bookings
    const conflict = await pool.query(`
      SELECT id FROM facility_bookings
      WHERE facility_id=$1 AND date=$2 AND status IN ('Approved','Pending')
        AND NOT (to_time <= $3 OR from_time >= $4)`,
      [facility_id, date, from_time, to_time]
    );
    if (conflict.rows.length)
      return res.status(409).json({ success: false, message: 'This time slot is already booked. Please choose another time.' });

    const { rows } = await pool.query(
      `INSERT INTO facility_bookings (facility_id, flat, booked_by, date, from_time, to_time, purpose, hours, amount, deposit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [facility_id, flat, booked_by, date, from_time, to_time, purpose, hours||1, amount||0, deposit||0]
    );
    res.status(201).json({ success: true, booking: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PATCH /api/facilities/bookings/:id/status — approve/reject/complete
router.patch('/bookings/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['Approved','Rejected','Completed','Cancelled'];
    if (!valid.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status.' });
    const { rows } = await pool.query(
      'UPDATE facility_bookings SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [status, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Booking not found.' });
    res.json({ success: true, booking: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/facilities/bookings/calendar?year=2025&month=4
router.get('/bookings/calendar', auth, async (req, res) => {
  try {
    const { year = new Date().getFullYear(), month = new Date().getMonth()+1 } = req.query;
    const { rows } = await pool.query(`
      SELECT fb.*, f.name AS facility_name, f.emoji
      FROM facility_bookings fb
      JOIN facilities f ON f.id = fb.facility_id
      WHERE EXTRACT(YEAR FROM fb.date)=$1 AND EXTRACT(MONTH FROM fb.date)=$2
        AND fb.status NOT IN ('Rejected','Cancelled')
      ORDER BY fb.date, fb.from_time`,
      [year, month]
    );
    res.json({ success: true, bookings: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
