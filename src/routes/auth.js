const express    = require('express');
const router     = express.Router();
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const pool       = require('../db/pool');

const JWT_SECRET = process.env.JWT_SECRET || 'societypro-secret-2025';

// ── POST /api/auth/login ───────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success:false, message:'Email and password are required' });
  }

  console.log(`🔐 Login attempt: ${email}`);

  try {
    let user    = null;
    let society = null;
    let role    = 'admin';

    // ── Check ALL possible tables ─────────────────────────────────────────────

    // 1. Check admins table
    try {
      const r = await pool.query(
        `SELECT a.*, s.name as society_name, s.id as soc_id, s.plan, s.total_flats, s.city, s.state
         FROM admins a
         LEFT JOIN societies s ON a.society_id = s.id
         WHERE LOWER(a.email) = LOWER($1) LIMIT 1`,
        [email.trim()]
      );
      if (r.rows.length > 0) {
        user    = r.rows[0];
        role    = user.role || 'secretary';
        society = { id: user.soc_id, name: user.society_name, plan: user.plan, total_flats: user.total_flats, city: user.city, state: user.state };
        console.log(`✅ Found in admins table`);
      }
    } catch(e) { console.log('admins check:', e.message); }

    // 2. Check tenants table with admin role
    if (!user) {
      try {
        const r = await pool.query(
          `SELECT * FROM tenants WHERE LOWER(email) = LOWER($1) LIMIT 1`,
          [email.trim()]
        );
        if (r.rows.length > 0) {
          user = r.rows[0];
          role = user.role || 'admin';
          console.log(`✅ Found in tenants table, role: ${role}`);
        }
      } catch(e) { console.log('tenants check:', e.message); }
    }

    // 3. Check super_admins table
    if (!user) {
      try {
        const r = await pool.query(
          `SELECT * FROM super_admins WHERE LOWER(email) = LOWER($1) LIMIT 1`,
          [email.trim()]
        );
        if (r.rows.length > 0) {
          user = r.rows[0];
          role = 'superadmin';
          console.log(`✅ Found in super_admins table`);
        }
      } catch(e) { console.log('super_admins check:', e.message); }
    }

    // 4. User not found anywhere
    if (!user) {
      console.log(`❌ User not found: ${email}`);
      return res.status(401).json({
        success: false,
        message: 'No account found with this email. Please register first at app.societyproapp.com/register'
      });
    }

    // ── Verify Password ───────────────────────────────────────────────────────
    let passwordMatch = false;

    // Try bcrypt
    try {
      if (user.password && user.password.startsWith('$2')) {
        passwordMatch = await bcrypt.compare(password, user.password);
        console.log(`bcrypt match: ${passwordMatch}`);
      }
    } catch(e) { console.log('bcrypt error:', e.message); }

    // Plain text fallback (seed data)
    if (!passwordMatch && user.password === password) {
      passwordMatch = true;
      console.log(`plain text match: true`);
    }

    if (!passwordMatch) {
      console.log(`❌ Password mismatch for: ${email}`);
      return res.status(401).json({
        success: false,
        message: 'Incorrect password. Please try again.'
      });
    }

    // ── Get Society if not found ──────────────────────────────────────────────
    if (!society || !society.name) {
      if (user.society_id) {
        try {
          const r = await pool.query('SELECT * FROM societies WHERE id = $1 LIMIT 1', [user.society_id]);
          if (r.rows.length > 0) society = r.rows[0];
        } catch(e) {}
      }
    }

    // Default society name
    if (!society || !society.name) {
      society = {
        id:          user.society_id || 1,
        name:        'SocietyPro',
        plan:        'standard',
        total_flats: 50,
        city:        '',
        state:       '',
      };
    }

    // ── Generate Token ────────────────────────────────────────────────────────
    const token = jwt.sign(
      { id: user.id, email: user.email, role, society_id: user.society_id || society.id },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    console.log(`✅ Login successful: ${email} | Role: ${role} | Society: ${society.name}`);

    return res.json({
      success: true,
      token,
      user: {
        id:    user.id,
        name:  user.name || user.secretary_name || 'Admin',
        email: user.email,
        role,
        phone: user.phone || '',
      },
      society: {
        id:          society.id,
        name:        society.name || 'SocietyPro',
        plan:        society.plan || 'standard',
        total_flats: society.total_flats || 50,
        city:        society.city || '',
        state:       society.state || '',
      },
    });

  } catch(err) {
    console.error('❌ Login error:', err.message);
    return res.status(500).json({ success:false, message:'Server error. Please try again.' });
  }
});

// ── POST /api/auth/resident-login ─────────────────────────────────────────────
router.post('/resident-login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }

  console.log(`🏠 Resident login attempt: ${email}`);

  try {
    // Ensure tenants has a password column (safe to run repeatedly)
    await pool.query(`
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS password VARCHAR(255);
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS society_id INTEGER;
    `).catch(() => {}); // ignore if fails (e.g. permissions)

    // Find tenant by email
    let result;
    try {
      result = await pool.query(
        `SELECT t.*, s.name as society_name
         FROM tenants t
         LEFT JOIN societies s ON t.society_id = s.id
         WHERE LOWER(t.email) = LOWER($1) LIMIT 1`,
        [email.trim()]
      );
    } catch(e) {
      // societies join might fail — try without it
      result = await pool.query(
        `SELECT * FROM tenants WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [email.trim()]
      );
    }

    if (result.rows.length === 0) {
      console.log(`❌ Resident not found: ${email}`);
      return res.status(401).json({
        success: false,
        message: 'No resident account found with this email. Please contact your society admin.',
      });
    }

    const tenant = result.rows[0];

    // Verify password:
    // 1. If password column exists and is set → check it (bcrypt or plaintext)
    // 2. Fallback: flat number is the default password (e.g. "A-101" or "101")
    let passwordMatch = false;

    if (tenant.password) {
      if (tenant.password.startsWith('$2')) {
        passwordMatch = await bcrypt.compare(password, tenant.password);
      } else {
        passwordMatch = tenant.password === password;
      }
    }

    // Flat number fallback (default password for residents without one set)
    if (!passwordMatch && tenant.flat) {
      passwordMatch = password === tenant.flat || password === tenant.flat.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    }

    // Phone number fallback
    if (!passwordMatch && tenant.phone) {
      passwordMatch = password === tenant.phone;
    }

    if (!passwordMatch) {
      console.log(`❌ Wrong password for resident: ${email}`);
      return res.status(401).json({
        success: false,
        message: 'Incorrect password. Default password is your flat number (e.g. A-101).',
      });
    }

    // Generate token
    const token = jwt.sign(
      { id: tenant.id, email: tenant.email, role: 'resident', society_id: tenant.society_id },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log(`✅ Resident login: ${email} | Flat: ${tenant.flat}`);

    return res.json({
      success:  true,
      token,
      userType: 'resident',
      user: {
        id:         tenant.id,
        name:       tenant.name,
        email:      tenant.email,
        flat:       tenant.flat,
        phone:      tenant.phone || '',
        society_id: tenant.society_id,
        society:    tenant.society_name || 'SocietyPro',
      },
    });

  } catch (err) {
    console.error('❌ Resident login error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// ── GET /api/auth/me ───────────────────────────────────────────────────────────
router.get('/me', async (req, res) => {
  try {
    const token   = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success:false, message:'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ success:true, user: decoded });
  } catch(e) {
    res.status(401).json({ success:false, message:'Invalid token' });
  }
});

module.exports = router;
