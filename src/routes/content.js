const express = require('express');
const pool    = require('../db/pool');
const auth    = require('../middleware/auth');

// ═══════════════════════════════════════════════════════════════════════════
//  ANNOUNCEMENTS
// ═══════════════════════════════════════════════════════════════════════════
const announceRouter = express.Router();

announceRouter.get('/', async (req, res) => {
  try {
    const { type, pinned } = req.query;
    let query = 'SELECT * FROM announcements WHERE 1=1';
    const params = [];
    if (type)   { params.push(type);   query += ` AND type = $${params.length}`; }
    if (pinned) { params.push(pinned === 'true'); query += ` AND pinned = $${params.length}`; }
    query += ' ORDER BY pinned DESC, created_at DESC';
    const { rows } = await pool.query(query, params);
    res.json({ success: true, count: rows.length, announcements: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

announceRouter.post('/', auth, async (req, res) => {
  try {
    const { title, body, type, pinned, posted_by } = req.body;
    if (!title || !body) return res.status(400).json({ success: false, message: 'Title and body required.' });
    const { rows } = await pool.query(
      `INSERT INTO announcements (title, body, type, pinned, posted_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [title, body, type || 'info', pinned || false, posted_by || 'Society Admin']
    );
    res.status(201).json({ success: true, announcement: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

announceRouter.put('/:id', auth, async (req, res) => {
  try {
    const { title, body, type, pinned } = req.body;
    const { rows } = await pool.query(
      `UPDATE announcements SET title=$1, body=$2, type=$3, pinned=$4, updated_at=NOW() WHERE id=$5 RETURNING *`,
      [title, body, type, pinned, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, announcement: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

announceRouter.patch('/:id/pin', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE announcements SET pinned = NOT pinned, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    res.json({ success: true, announcement: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

announceRouter.delete('/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM announcements WHERE id=$1', [req.params.id]);
    res.json({ success: true, message: 'Deleted.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


// ═══════════════════════════════════════════════════════════════════════════
//  MEETINGS
// ═══════════════════════════════════════════════════════════════════════════
const meetingsRouter = express.Router();

meetingsRouter.get('/', auth, async (req, res) => {
  try {
    const { status } = req.query;
    let query = 'SELECT * FROM meetings WHERE 1=1';
    const params = [];
    if (status) { params.push(status); query += ` AND status = $${params.length}`; }
    query += ' ORDER BY date DESC';
    const { rows } = await pool.query(query, params);
    res.json({ success: true, meetings: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

meetingsRouter.get('/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM meetings WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, meeting: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

meetingsRouter.post('/', auth, async (req, res) => {
  try {
    const { title, date, time, venue, agenda } = req.body;
    if (!title || !date) return res.status(400).json({ success: false, message: 'Title and date required.' });
    const { rows } = await pool.query(
      `INSERT INTO meetings (title, date, time, venue, agenda) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [title, date, time, venue, agenda]
    );
    res.status(201).json({ success: true, meeting: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

meetingsRouter.put('/:id', auth, async (req, res) => {
  try {
    const { title, date, time, venue, agenda, status, attendees, minutes } = req.body;
    const { rows } = await pool.query(
      `UPDATE meetings SET title=$1, date=$2, time=$3, venue=$4, agenda=$5,
       status=$6, attendees=$7, minutes=$8, updated_at=NOW() WHERE id=$9 RETURNING *`,
      [title, date, time, venue, agenda, status, attendees, minutes, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, meeting: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

meetingsRouter.patch('/:id/complete', auth, async (req, res) => {
  try {
    const { attendees, minutes } = req.body;
    const { rows } = await pool.query(
      `UPDATE meetings SET status='Completed', attendees=$1, minutes=$2, updated_at=NOW() WHERE id=$3 RETURNING *`,
      [attendees || 0, minutes, req.params.id]
    );
    res.json({ success: true, meeting: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

meetingsRouter.delete('/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM meetings WHERE id=$1', [req.params.id]);
    res.json({ success: true, message: 'Deleted.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


// ═══════════════════════════════════════════════════════════════════════════
//  GALLERY
// ═══════════════════════════════════════════════════════════════════════════
const galleryRouter = express.Router();

galleryRouter.get('/', async (req, res) => {
  try {
    const { rows: events } = await pool.query(`
      SELECT ge.*, COUNT(gp.id)::int AS photo_count
      FROM gallery_events ge
      LEFT JOIN gallery_photos gp ON gp.event_id = ge.id
      GROUP BY ge.id ORDER BY ge.date DESC
    `);
    res.json({ success: true, events });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

galleryRouter.get('/:id/photos', async (req, res) => {
  try {
    const event  = await pool.query('SELECT * FROM gallery_events WHERE id=$1', [req.params.id]);
    const photos = await pool.query('SELECT * FROM gallery_photos WHERE event_id=$1 ORDER BY created_at DESC', [req.params.id]);
    if (!event.rows.length) return res.status(404).json({ success: false, message: 'Event not found.' });
    res.json({ success: true, event: event.rows[0], photos: photos.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

galleryRouter.post('/', auth, async (req, res) => {
  try {
    const { title, description, date, tag, emoji } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'Title required.' });
    const { rows } = await pool.query(
      `INSERT INTO gallery_events (title, description, date, tag, emoji) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [title, description, date, tag, emoji || '🎉']
    );
    res.status(201).json({ success: true, event: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/gallery/:id/photos — upload photo URL (Cloudinary URL from frontend)
galleryRouter.post('/:id/photos', auth, async (req, res) => {
  try {
    const { url, public_id, caption } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'Photo URL required.' });
    const { rows } = await pool.query(
      `INSERT INTO gallery_photos (event_id, url, public_id, caption, uploaded_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, url, public_id, caption, req.admin?.name]
    );
    res.status(201).json({ success: true, photo: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

galleryRouter.delete('/photos/:photoId', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM gallery_photos WHERE id=$1', [req.params.photoId]);
    res.json({ success: true, message: 'Photo deleted.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

galleryRouter.delete('/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM gallery_events WHERE id=$1', [req.params.id]);
    res.json({ success: true, message: 'Event and all photos deleted.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = { announceRouter, meetingsRouter, galleryRouter };
