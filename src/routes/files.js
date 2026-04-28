const express    = require('express');
const pool       = require('../db/pool');
const auth       = require('../middleware/auth');
const multer     = require('multer');
const cloudinary = require('cloudinary').v2;
const router     = express.Router();

cloudinary.config({
  cloud_name:  process.env.CLOUDINARY_CLOUD_NAME,
  api_key:     process.env.CLOUDINARY_API_KEY,
  api_secret:  process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// GET /api/files
router.get('/', async (req, res) => {
  try {
    const { category, access, search, sort = 'date', starred } = req.query;
    let query  = 'SELECT * FROM society_files WHERE deleted = FALSE';
    const params = [];

    if (category) { params.push(category);      query += ` AND category = $${params.length}`; }
    if (access)   { params.push(access);         query += ` AND access = $${params.length}`; }
    if (starred === 'true') { query += ' AND starred = TRUE'; }
    if (search)   { params.push(`%${search}%`);  query += ` AND (name ILIKE $${params.length} OR description ILIKE $${params.length})`; }

    const orderMap = { date:'uploaded_at DESC', name:'name ASC', size:'size DESC', downloads:'downloads DESC' };
    query += ` ORDER BY ${orderMap[sort] || 'uploaded_at DESC'}`;

    const { rows } = await pool.query(query, params);
    const stats = {
      total:      rows.length,
      public:     rows.filter(r => r.access === 'public').length,
      private:    rows.filter(r => r.access === 'private').length,
      total_size: rows.reduce((s, r) => s + Number(r.size), 0),
      downloads:  rows.reduce((s, r) => s + r.downloads, 0),
    };
    res.json({ success: true, stats, files: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/files/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM society_files WHERE id=$1 AND deleted=FALSE', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'File not found.' });
    res.json({ success: true, file: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/files/upload — upload to Cloudinary then save metadata
router.post('/upload', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file provided.' });

    const { category, access, description, uploaded_by } = req.body;

    // Upload to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'society_files', resource_type: 'auto', public_id: req.file.originalname.replace(/\.[^/.]+$/, '') },
        (err, result) => err ? reject(err) : resolve(result)
      );
      stream.end(req.file.buffer);
    });

    const { rows } = await pool.query(
      `INSERT INTO society_files (name, category, size, url, public_id, access, description, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.file.originalname, category || 'other', req.file.size, uploadResult.secure_url, uploadResult.public_id, access || 'public', description, uploaded_by || 'Society Admin']
    );
    res.status(201).json({ success: true, file: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/files — add file metadata only (URL already exists)
router.post('/', auth, async (req, res) => {
  try {
    const { name, category, size, url, access, description, uploaded_by } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'File name required.' });
    const { rows } = await pool.query(
      `INSERT INTO society_files (name, category, size, url, access, description, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, category || 'other', size || 0, url, access || 'public', description, uploaded_by || 'Admin']
    );
    res.status(201).json({ success: true, file: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PATCH /api/files/:id/star — toggle star
router.patch('/:id/star', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE society_files SET starred = NOT starred WHERE id=$1 RETURNING starred', [req.params.id]
    );
    res.json({ success: true, starred: rows[0]?.starred });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PATCH /api/files/:id/download — increment download count
router.patch('/:id/download', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE society_files SET downloads = downloads + 1 WHERE id=$1 RETURNING url, name, downloads', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'File not found.' });
    res.json({ success: true, url: rows[0].url, name: rows[0].name, downloads: rows[0].downloads });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PUT /api/files/:id
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, category, access, description } = req.body;
    const { rows } = await pool.query(
      `UPDATE society_files SET name=$1, category=$2, access=$3, description=$4, updated_at=NOW()
       WHERE id=$5 RETURNING *`,
      [name, category, access, description, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'File not found.' });
    res.json({ success: true, file: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// DELETE /api/files/:id — soft delete
router.delete('/:id', auth, async (req, res) => {
  try {
    await pool.query('UPDATE society_files SET deleted=TRUE WHERE id=$1', [req.params.id]);
    res.json({ success: true, message: 'File deleted.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
