const express = require('express');
const pool    = require('../db/pool');
const auth    = require('../middleware/auth');
const router  = express.Router();

// GET /api/dashboard — complete stats for the dashboard
router.get('/', auth, async (req, res) => {
  try {
    const [tenants, maintenance, announcements, meetings, payments, bookings] = await Promise.all([
      pool.query("SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status='Active') AS active FROM tenants"),
      pool.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status='Paid')    AS paid,
          COUNT(*) FILTER (WHERE status='Pending') AS pending,
          COUNT(*) FILTER (WHERE status='Overdue') AS overdue,
          SUM(amount) FILTER (WHERE status='Paid') AS collected,
          SUM(amount) FILTER (WHERE status<>'Paid') AS pending_amount
        FROM maintenance
        WHERE month = TO_CHAR(NOW(), 'Month YYYY')
      `),
      pool.query("SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE pinned) AS pinned FROM announcements"),
      pool.query("SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status='Upcoming') AS upcoming FROM meetings"),
      pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE status='Success' AND DATE_TRUNC('month',paid_at)=DATE_TRUNC('month',NOW())"),
      pool.query("SELECT COUNT(*) AS total FROM service_bookings WHERE status='Confirmed'"),
    ]);

    // Monthly collection trend (last 6 months)
    const trend = await pool.query(`
      SELECT TO_CHAR(DATE_TRUNC('month', paid_at), 'Mon') AS month,
             SUM(amount)::int AS collected
      FROM payments
      WHERE status = 'Success' AND paid_at >= NOW() - INTERVAL '6 months'
      GROUP BY DATE_TRUNC('month', paid_at)
      ORDER BY DATE_TRUNC('month', paid_at)
    `);

    // Recent announcements
    const recent = await pool.query(
      "SELECT id, title, type, pinned, created_at FROM announcements ORDER BY pinned DESC, created_at DESC LIMIT 5"
    );

    // Upcoming meetings
    const upcoming = await pool.query(
      "SELECT * FROM meetings WHERE status='Upcoming' ORDER BY date ASC LIMIT 3"
    );

    res.json({
      success: true,
      stats: {
        tenants:     { total: +tenants.rows[0].total,     active: +tenants.rows[0].active },
        maintenance: {
          paid:            +maintenance.rows[0].paid,
          pending:         +maintenance.rows[0].pending,
          overdue:         +maintenance.rows[0].overdue,
          collected:       +maintenance.rows[0].collected  || 0,
          pending_amount:  +maintenance.rows[0].pending_amount || 0,
        },
        announcements: { total: +announcements.rows[0].total, pinned: +announcements.rows[0].pinned },
        meetings:      { total: +meetings.rows[0].total, upcoming: +meetings.rows[0].upcoming },
        payments:      { monthly_total: +payments.rows[0].total },
        services:      { active_bookings: +bookings.rows[0].total },
      },
      monthly_trend:        trend.rows,
      recent_announcements: recent.rows,
      upcoming_meetings:    upcoming.rows,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/dashboard/send-reminder — send WhatsApp/SMS reminders for pending dues
router.post('/send-reminder', auth, async (req, res) => {
  try {
    const { month } = req.body;
    const { rows } = await pool.query(`
      SELECT m.flat, m.name, m.amount, t.phone
      FROM maintenance m
      LEFT JOIN tenants t ON t.flat = m.flat
      WHERE m.month = $1 AND m.status IN ('Pending','Overdue') AND t.phone IS NOT NULL`,
      [month]
    );

    // Log notifications (actual SMS/WhatsApp needs Twilio — see .env)
    if (rows.length) {
      const values = rows.map((_, i) =>
        `($${i*3+1},'sms',$${i*3+2},$${i*3+3})`
      ).join(',');
      const params = rows.flatMap(r => [
        r.phone,
        `Dear ${r.name}, your maintenance of ₹${r.amount} for ${month} is pending. Please pay at ${process.env.FRONTEND_URL}/payments`,
        'sent'
      ]);
      await pool.query(`INSERT INTO notifications (recipient, type, message, status) VALUES ${values}`, params);
    }

    res.json({ success: true, sent: rows.length, message: `Reminders queued for ${rows.length} tenants.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
