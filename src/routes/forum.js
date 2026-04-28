const express = require('express');
const pool    = require('../db/pool');
const auth    = require('../middleware/auth');
const router  = express.Router();

// GET /api/forum — list all threads
router.get('/', async (req, res) => {
  try {
    const { category, search, sort = 'recent' } = req.query;
    let query = `
      SELECT t.*,
        COUNT(DISTINCT r.id)::int AS reply_count,
        COALESCE(SUM(tl.count),0)::int AS like_count
      FROM forum_threads t
      LEFT JOIN forum_replies r ON r.thread_id = t.id
      LEFT JOIN (SELECT thread_id, COUNT(*) AS count FROM forum_likes GROUP BY thread_id) tl ON tl.thread_id = t.id
      WHERE t.deleted = FALSE`;
    const params = [];

    if (category) { params.push(category); query += ` AND t.category = $${params.length}`; }
    if (search)   { params.push(`%${search}%`); query += ` AND (t.title ILIKE $${params.length} OR t.body ILIKE $${params.length})`; }

    query += ' GROUP BY t.id';
    query += sort === 'popular' ? ' ORDER BY like_count DESC' :
             sort === 'replies' ? ' ORDER BY reply_count DESC' :
             ' ORDER BY t.pinned DESC, t.created_at DESC';

    const { rows } = await pool.query(query, params);
    res.json({ success: true, count: rows.length, threads: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/forum/:id — thread with replies
router.get('/:id', async (req, res) => {
  try {
    await pool.query('UPDATE forum_threads SET views = views + 1 WHERE id=$1', [req.params.id]);
    const thread  = await pool.query('SELECT * FROM forum_threads WHERE id=$1 AND deleted=FALSE', [req.params.id]);
    if (!thread.rows.length) return res.status(404).json({ success: false, message: 'Thread not found.' });
    const replies = await pool.query('SELECT * FROM forum_replies WHERE thread_id=$1 ORDER BY created_at ASC', [req.params.id]);
    res.json({ success: true, thread: thread.rows[0], replies: replies.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/forum — create thread
router.post('/', async (req, res) => {
  try {
    const { title, body, category, flat, author, tags } = req.body;
    if (!title || !body) return res.status(400).json({ success: false, message: 'Title and body required.' });
    const { rows } = await pool.query(
      `INSERT INTO forum_threads (title, body, category, flat, author, tags)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [title, body, category || 'general', flat, author || 'Resident', tags || []]
    );
    res.status(201).json({ success: true, thread: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/forum/:id/reply — add reply
router.post('/:id/reply', async (req, res) => {
  try {
    const { text, author, flat } = req.body;
    if (!text) return res.status(400).json({ success: false, message: 'Reply text required.' });
    const { rows } = await pool.query(
      `INSERT INTO forum_replies (thread_id, author, flat, text) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, author || 'Resident', flat, text]
    );
    res.status(201).json({ success: true, reply: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/forum/:id/like — toggle like
router.post('/:id/like', async (req, res) => {
  try {
    const { flat } = req.body;
    const existing = await pool.query('SELECT id FROM forum_likes WHERE thread_id=$1 AND voter_flat=$2', [req.params.id, flat]);
    if (existing.rows.length) {
      await pool.query('DELETE FROM forum_likes WHERE thread_id=$1 AND voter_flat=$2', [req.params.id, flat]);
      res.json({ success: true, liked: false });
    } else {
      await pool.query('INSERT INTO forum_likes (thread_id, voter_flat) VALUES ($1,$2)', [req.params.id, flat]);
      res.json({ success: true, liked: true });
    }
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PATCH /api/forum/:id/pin — toggle pin (admin)
router.patch('/:id/pin', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE forum_threads SET pinned = NOT pinned WHERE id=$1 RETURNING pinned', [req.params.id]
    );
    res.json({ success: true, pinned: rows[0]?.pinned });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// DELETE /api/forum/:id — soft delete
router.delete('/:id', auth, async (req, res) => {
  try {
    await pool.query('UPDATE forum_threads SET deleted=TRUE WHERE id=$1', [req.params.id]);
    res.json({ success: true, message: 'Thread deleted.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// DELETE /api/forum/replies/:replyId
router.delete('/replies/:replyId', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM forum_replies WHERE id=$1', [req.params.replyId]);
    res.json({ success: true, message: 'Reply deleted.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
