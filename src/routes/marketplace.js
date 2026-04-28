const express = require('express');
const pool    = require('../db/pool');
const auth    = require('../middleware/auth');

// ═══════════════════════════════════════════════════════════════════════════
//  PROPERTIES
// ═══════════════════════════════════════════════════════════════════════════
const propertiesRouter = express.Router();

propertiesRouter.get('/', async (req, res) => {
  try {
    const { type, bhk, min_price, max_price } = req.query;
    let query = "SELECT * FROM properties WHERE active = TRUE";
    const params = [];
    if (type)      { params.push(type);      query += ` AND type = $${params.length}`; }
    if (bhk)       { params.push(bhk);       query += ` AND bhk = $${params.length}`; }
    if (min_price) { params.push(min_price); query += ` AND price >= $${params.length}`; }
    if (max_price) { params.push(max_price); query += ` AND price <= $${params.length}`; }
    query += ' ORDER BY created_at DESC';
    const { rows } = await pool.query(query, params);
    res.json({ success: true, count: rows.length, properties: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

propertiesRouter.get('/:id', async (req, res) => {
  try {
    await pool.query('UPDATE properties SET views = views + 1 WHERE id=$1', [req.params.id]);
    const { rows } = await pool.query('SELECT * FROM properties WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, property: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

propertiesRouter.post('/', async (req, res) => {
  try {
    const { flat, type, bhk, floor, area, price, owner, phone, email,
            furnished, available, facing, bathrooms, description, amenities, emoji } = req.body;
    if (!flat || !type || !owner || !price)
      return res.status(400).json({ success: false, message: 'Flat, type, owner and price required.' });
    const { rows } = await pool.query(
      `INSERT INTO properties (flat,type,bhk,floor,area,price,owner,phone,email,
        furnished,available,facing,bathrooms,description,amenities,emoji)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [flat,type,bhk,floor,area,price,owner,phone,email,
       furnished,available,facing,bathrooms,description,amenities,emoji||'🏢']
    );
    res.status(201).json({ success: true, property: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

propertiesRouter.put('/:id', auth, async (req, res) => {
  try {
    const { type, price, furnished, available, description, active } = req.body;
    const { rows } = await pool.query(
      `UPDATE properties SET type=$1, price=$2, furnished=$3, available=$4,
       description=$5, active=$6, updated_at=NOW() WHERE id=$7 RETURNING *`,
      [type, price, furnished, available, description, active !== false, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, property: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

propertiesRouter.patch('/:id/like', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE properties SET likes = likes + 1 WHERE id=$1 RETURNING likes', [req.params.id]
    );
    res.json({ success: true, likes: rows[0]?.likes });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

propertiesRouter.delete('/:id', auth, async (req, res) => {
  try {
    await pool.query('UPDATE properties SET active=FALSE WHERE id=$1', [req.params.id]);
    res.json({ success: true, message: 'Listing removed.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


// ═══════════════════════════════════════════════════════════════════════════
//  SERVICES
// ═══════════════════════════════════════════════════════════════════════════
const servicesRouter = express.Router();

servicesRouter.get('/', async (req, res) => {
  try {
    const { category, popular } = req.query;
    let query = "SELECT * FROM services WHERE active = TRUE";
    const params = [];
    if (category) { params.push(category); query += ` AND category = $${params.length}`; }
    if (popular === 'true') { query += ' AND popular = TRUE'; }
    query += ' ORDER BY popular DESC, rating DESC';
    const { rows } = await pool.query(query, params);
    res.json({ success: true, services: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

servicesRouter.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM services WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, service: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/services/book
servicesRouter.post('/book', async (req, res) => {
  try {
    const { service_id, flat, name, phone, date, time_slot, notes } = req.body;
    if (!service_id || !flat || !date || !time_slot)
      return res.status(400).json({ success: false, message: 'Service, flat, date and time slot required.' });

    const svc = await pool.query('SELECT * FROM services WHERE id=$1', [service_id]);
    if (!svc.rows.length) return res.status(404).json({ success: false, message: 'Service not found.' });

    const ref = `SRV${Date.now().toString().slice(-6)}`;
    const { rows } = await pool.query(
      `INSERT INTO service_bookings (service_id, flat, name, phone, date, time_slot, notes, booking_ref, amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [service_id, flat, name, phone, date, time_slot, notes, ref, svc.rows[0].price]
    );

    res.status(201).json({ success: true, booking: rows[0], service: svc.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/services/bookings/all
servicesRouter.get('/bookings/all', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT sb.*, s.title AS service_title, s.emoji, s.category
      FROM service_bookings sb
      LEFT JOIN services s ON s.id = sb.service_id
      ORDER BY sb.created_at DESC
    `);
    res.json({ success: true, bookings: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/services/bookings/:flat
servicesRouter.get('/bookings/:flat', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT sb.*, s.title AS service_title, s.emoji
      FROM service_bookings sb
      LEFT JOIN services s ON s.id = sb.service_id
      WHERE sb.flat ILIKE $1 ORDER BY sb.created_at DESC`,
      [req.params.flat]
    );
    res.json({ success: true, bookings: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PATCH /api/services/bookings/:id/status
servicesRouter.patch('/bookings/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;
    const { rows } = await pool.query(
      'UPDATE service_bookings SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [status, req.params.id]
    );
    res.json({ success: true, booking: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = { propertiesRouter, servicesRouter };
