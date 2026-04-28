const express = require('express');
const pool    = require('../db/pool');
const auth    = require('../middleware/auth');
const router  = express.Router();

// GET /api/polls
router.get('/', async (req, res) => {
  try {
    const { status, category } = req.query;
    let query  = `
      SELECT p.*,
        json_agg(json_build_object('id',po.option_id,'label',po.label,'votes',po.votes)
          ORDER BY po.option_id) AS options,
        SUM(po.votes)::int AS total_votes
      FROM polls p
      JOIN poll_options po ON po.poll_id = p.id
      WHERE 1=1`;
    const params = [];
    if (status)   { params.push(status);   query += ` AND p.status = $${params.length}`; }
    if (category) { params.push(category); query += ` AND p.category_id = $${params.length}`; }
    query += ' GROUP BY p.id ORDER BY p.created_at DESC';
    const { rows } = await pool.query(query, params);
    res.json({ success: true, polls: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/polls/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, json_agg(json_build_object('id',po.option_id,'label',po.label,'votes',po.votes) ORDER BY po.option_id) AS options,
        SUM(po.votes)::int AS total_votes
      FROM polls p JOIN poll_options po ON po.poll_id = p.id
      WHERE p.id = $1 GROUP BY p.id`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Poll not found.' });
    res.json({ success: true, poll: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/polls  — create poll with options
router.post('/', auth, async (req, res) => {
  try {
    const { title, description, category_id, end_date, options, created_by } = req.body;
    if (!title || !options || options.length < 2)
      return res.status(400).json({ success: false, message: 'Title and at least 2 options required.' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO polls (title, description, category_id, end_date, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [title, description, category_id || 'general', end_date, created_by || 'Society Admin']
      );
      const pollId = rows[0].id;
      for (let i = 0; i < options.length; i++) {
        await client.query(
          `INSERT INTO poll_options (poll_id, option_id, label) VALUES ($1,$2,$3)`,
          [pollId, String.fromCharCode(97 + i), options[i]]
        );
      }
      await client.query('COMMIT');
      res.status(201).json({ success: true, poll: rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/polls/:id/vote  — cast a vote
router.post('/:id/vote', async (req, res) => {
  try {
    const { option_id, voter_flat } = req.body;
    if (!option_id) return res.status(400).json({ success: false, message: 'option_id required.' });

    // Check poll is active
    const poll = await pool.query("SELECT * FROM polls WHERE id=$1 AND status='Active'", [req.params.id]);
    if (!poll.rows.length) return res.status(400).json({ success: false, message: 'Poll is not active.' });

    // Check flat hasn't already voted
    if (voter_flat) {
      const already = await pool.query('SELECT id FROM poll_votes WHERE poll_id=$1 AND voter_flat=$2', [req.params.id, voter_flat]);
      if (already.rows.length) return res.status(400).json({ success: false, message: 'This flat has already voted.' });
    }

    await pool.query(
      'UPDATE poll_options SET votes = votes + 1 WHERE poll_id=$1 AND option_id=$2',
      [req.params.id, option_id]
    );
    if (voter_flat) {
      await pool.query(
        'INSERT INTO poll_votes (poll_id, option_id, voter_flat) VALUES ($1,$2,$3)',
        [req.params.id, option_id, voter_flat]
      );
    }

    const { rows } = await pool.query(
      `SELECT json_agg(json_build_object('id',option_id,'label',label,'votes',votes)) AS options, SUM(votes)::int AS total
       FROM poll_options WHERE poll_id=$1`, [req.params.id]
    );
    res.json({ success: true, options: rows[0].options, total_votes: rows[0].total });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PATCH /api/polls/:id/close
router.patch('/:id/close', auth, async (req, res) => {
  try {
    const winner = await pool.query(
      'SELECT option_id FROM poll_options WHERE poll_id=$1 ORDER BY votes DESC LIMIT 1', [req.params.id]
    );
    const { rows } = await pool.query(
      `UPDATE polls SET status='Closed', winner=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
      [winner.rows[0]?.option_id, req.params.id]
    );
    res.json({ success: true, poll: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// DELETE /api/polls/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM polls WHERE id=$1', [req.params.id]);
    res.json({ success: true, message: 'Poll deleted.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
