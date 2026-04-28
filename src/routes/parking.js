const express = require('express');
const pool    = require('../db/pool');
const auth    = require('../middleware/auth');
const router  = express.Router();

// ── DB tables needed (added to db/setup.js) ─────────────────────────────────
// parking_slots  — all physical parking slots in the society
// parking_vehicles — registered vehicles linked to slots

// GET /api/parking/slots — all slots with occupancy status
router.get('/slots', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT ps.*, pv.flat, pv.owner, pv.vehicle_no, pv.brand, pv.model, pv.type AS vehicle_type
      FROM parking_slots ps
      LEFT JOIN parking_vehicles pv ON pv.slot_no = ps.slot_no AND pv.status = 'Active'
      ORDER BY ps.slot_no ASC
    `);
    const summary = {
      total:     rows.length,
      occupied:  rows.filter(r => r.flat).length,
      available: rows.filter(r => !r.flat).length,
      four_wheel: rows.filter(r => r.slot_type === 'Four Wheeler').length,
      two_wheel:  rows.filter(r => r.slot_type === 'Two Wheeler').length,
    };
    res.json({ success: true, summary, slots: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/parking/vehicles — all registered vehicles
router.get('/vehicles', auth, async (req, res) => {
  try {
    const { type, flat } = req.query;
    let query  = 'SELECT * FROM parking_vehicles WHERE 1=1';
    const params = [];
    if (type) { params.push(type); query += ` AND type = $${params.length}`; }
    if (flat) { params.push(flat); query += ` AND flat ILIKE $${params.length}`; }
    query += ' ORDER BY slot_no ASC';
    const { rows } = await pool.query(query, params);
    const monthly_revenue = rows.filter(r => r.status === 'Active').reduce((s, r) => s + Number(r.charges), 0);
    res.json({ success: true, count: rows.length, monthly_revenue, vehicles: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/parking/vehicles/:id
router.get('/vehicles/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM parking_vehicles WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Vehicle not found.' });
    res.json({ success: true, vehicle: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/parking/vehicles — register new vehicle
router.post('/vehicles', auth, async (req, res) => {
  try {
    const { flat, owner, slot_no, type, brand, model, vehicle_no, color, charges } = req.body;
    if (!flat || !vehicle_no || !slot_no)
      return res.status(400).json({ success: false, message: 'Flat, vehicle number and slot are required.' });

    // Check slot not already taken
    const taken = await pool.query(
      "SELECT id FROM parking_vehicles WHERE slot_no=$1 AND status='Active'", [slot_no]
    );
    if (taken.rows.length)
      return res.status(400).json({ success: false, message: `Slot ${slot_no} is already occupied.` });

    const { rows } = await pool.query(
      `INSERT INTO parking_vehicles (flat, owner, slot_no, type, brand, model, vehicle_no, color, charges)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [flat, owner, slot_no, type || 'Four Wheeler', brand, model, vehicle_no.toUpperCase(), color, charges || 500]
    );
    res.status(201).json({ success: true, vehicle: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'Vehicle number already registered.' });
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/parking/vehicles/:id — update vehicle
router.put('/vehicles/:id', auth, async (req, res) => {
  try {
    const { flat, owner, slot_no, type, brand, model, vehicle_no, color, charges, status } = req.body;
    const { rows } = await pool.query(
      `UPDATE parking_vehicles
       SET flat=$1, owner=$2, slot_no=$3, type=$4, brand=$5, model=$6,
           vehicle_no=$7, color=$8, charges=$9, status=$10, updated_at=NOW()
       WHERE id=$11 RETURNING *`,
      [flat, owner, slot_no, type, brand, model, vehicle_no?.toUpperCase(), color, charges, status || 'Active', req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Vehicle not found.' });
    res.json({ success: true, vehicle: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// DELETE /api/parking/vehicles/:id — deactivate (free up slot)
router.delete('/vehicles/:id', auth, async (req, res) => {
  try {
    await pool.query(
      "UPDATE parking_vehicles SET status='Inactive', updated_at=NOW() WHERE id=$1",
      [req.params.id]
    );
    res.json({ success: true, message: 'Vehicle deregistered and slot freed.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/parking/summary — dashboard stats
router.get('/summary', auth, async (req, res) => {
  try {
    const [vehicles, slots] = await Promise.all([
      pool.query(`SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE type='Four Wheeler') AS four_wheel,
        COUNT(*) FILTER (WHERE type='Two Wheeler')  AS two_wheel,
        SUM(charges) FILTER (WHERE status='Active') AS monthly_revenue
        FROM parking_vehicles WHERE status='Active'`),
      pool.query(`SELECT
        COUNT(*) AS total_slots,
        COUNT(*) FILTER (WHERE slot_type='Four Wheeler') AS four_wheel_slots,
        COUNT(*) FILTER (WHERE slot_type='Two Wheeler')  AS two_wheel_slots
        FROM parking_slots`),
    ]);
    const v = vehicles.rows[0];
    const s = slots.rows[0];
    res.json({
      success: true,
      summary: {
        total_vehicles:    +v.total,
        four_wheel:        +v.four_wheel,
        two_wheel:         +v.two_wheel,
        monthly_revenue:   +v.monthly_revenue || 0,
        total_slots:       +s.total_slots,
        available_slots:   +s.total_slots - +v.total,
        four_wheel_slots:  +s.four_wheel_slots,
        two_wheel_slots:   +s.two_wheel_slots,
      }
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
