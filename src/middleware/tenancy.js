const jwt  = require('jsonwebtoken');
const pool = require('../db/pool');

// ── Society auth middleware ───────────────────────────────────────────────────
// Verifies JWT, loads society, injects req.society and req.societyId
const societyAuth = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ success: false, message: 'No token. Please login.' });

  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Super admin bypass — no society restriction
    if (decoded.role === 'super_admin') {
      req.admin      = decoded;
      req.isSuperAdmin = true;
      return next();
    }

    // Load society and check active subscription
    const { rows } = await pool.query(
      'SELECT * FROM societies WHERE id = $1', [decoded.society_id]
    );
    if (!rows.length)
      return res.status(401).json({ success: false, message: 'Society not found.' });

    const society = rows[0];

    // Check plan status
    if (society.status === 'suspended')
      return res.status(403).json({
        success: false,
        message: 'Your subscription is suspended. Please renew to continue.',
        code: 'SUBSCRIPTION_SUSPENDED'
      });

    if (society.status === 'trial') {
      const now      = new Date();
      const trialEnd = new Date(society.trial_ends_at);
      if (now > trialEnd)
        return res.status(403).json({
          success: false,
          message: 'Your 30-day free trial has ended. Please subscribe to continue.',
          code: 'TRIAL_EXPIRED',
          trial_ended: true,
        });
    }

    req.admin      = decoded;
    req.society    = society;
    req.societyId  = society.id;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
};

// ── Super admin only ─────────────────────────────────────────────────────────
const superAdminAuth = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ success: false, message: 'No token.' });

  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'super_admin')
      return res.status(403).json({ success: false, message: 'Super admin access required.' });
    req.superAdmin = decoded;
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid token.' });
  }
};

// ── Plan feature gate ─────────────────────────────────────────────────────────
// Usage: planGate(['standard','premium'])
const planGate = (allowedPlans) => (req, res, next) => {
  if (req.isSuperAdmin) return next();
  const plan = req.society?.plan || 'starter';
  if (!allowedPlans.includes(plan))
    return res.status(403).json({
      success: false,
      message: `This feature requires the ${allowedPlans[0]} plan or higher. Please upgrade.`,
      code: 'PLAN_UPGRADE_REQUIRED',
      current_plan: plan,
      required_plan: allowedPlans[0],
    });
  next();
};

module.exports = { societyAuth, superAdminAuth, planGate };
