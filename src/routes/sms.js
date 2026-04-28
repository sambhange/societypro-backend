const express = require('express');
const pool    = require('../db/pool');
const auth    = require('../middleware/auth');
const router  = express.Router();

// Twilio client — only initialise if credentials exist
let twilioClient = null;
const getTwilio = () => {
  if (!twilioClient && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    const twilio = require('twilio');
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
};

// ── Helper: send one SMS via Twilio ──────────────────────────────────────────
const sendSMS = async (to, message) => {
  const client = getTwilio();
  if (!client) {
    console.log(`[SMS DEMO] To: ${to} | Msg: ${message}`);
    return { sid: `DEMO_${Date.now()}`, status: 'demo' };
  }
  const result = await client.messages.create({
    body: message,
    from: process.env.TWILIO_PHONE_NUMBER,
    to:   to.startsWith('+') ? to : `+91${to}`,   // India default
  });
  return result;
};

// ── Helper: log SMS to DB ────────────────────────────────────────────────────
const logSMS = async (type, to, flat, name, message, status, sid) => {
  try {
    await pool.query(
      `INSERT INTO sms_logs (type, recipient_phone, flat, recipient_name, message, status, twilio_sid)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [type, to, flat, name, message, status, sid]
    );
  } catch (err) { console.error('SMS log error:', err.message); }
};

// ── POST /api/sms/send — send custom SMS to one/all ──────────────────────────
router.post('/send', auth, async (req, res) => {
  try {
    const { recipients, message, type = 'custom' } = req.body;
    // recipients: [{ phone, flat, name }]
    if (!recipients?.length || !message)
      return res.status(400).json({ success: false, message: 'Recipients and message are required.' });

    const results = [];
    for (const r of recipients) {
      try {
        const result = await sendSMS(r.phone, message);
        await logSMS(type, r.phone, r.flat, r.name, message, result.status === 'demo' ? 'Delivered' : result.status, result.sid);
        results.push({ flat: r.flat, name: r.name, status: 'Delivered' });
      } catch (err) {
        await logSMS(type, r.phone, r.flat, r.name, message, 'Failed', null);
        results.push({ flat: r.flat, name: r.name, status: 'Failed', error: err.message });
      }
    }

    const delivered = results.filter(r => r.status === 'Delivered').length;
    res.json({ success: true, sent: recipients.length, delivered, failed: recipients.length - delivered, results });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST /api/sms/maintenance-reminder — send to all pending flats ───────────
router.post('/maintenance-reminder', auth, async (req, res) => {
  try {
    const { month } = req.body;
    if (!month) return res.status(400).json({ success: false, message: 'Month is required.' });

    const { rows } = await pool.query(`
      SELECT m.flat, m.name, m.amount, t.phone
      FROM maintenance m
      LEFT JOIN tenants t ON t.flat = m.flat
      WHERE m.month = $1 AND m.status IN ('Pending','Overdue') AND t.phone IS NOT NULL`,
      [month]
    );

    const results = [];
    for (const r of rows) {
      const msg = `Dear ${r.name}, Your maintenance of ₹${r.amount} for ${month} is pending. Pay at ${process.env.FRONTEND_URL}/payments or contact society. - ${process.env.SOCIETY_NAME || 'Society Admin'}`;
      try {
        const result = await sendSMS(r.phone, msg);
        await logSMS('maintenance_due', r.phone, r.flat, r.name, msg, 'Delivered', result.sid);
        results.push({ flat: r.flat, status: 'Delivered' });
      } catch (err) {
        await logSMS('maintenance_due', r.phone, r.flat, r.name, msg, 'Failed', null);
        results.push({ flat: r.flat, status: 'Failed' });
      }
    }
    res.json({ success: true, sent: rows.length, results });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST /api/sms/payment-confirm — send receipt confirmation ────────────────
router.post('/payment-confirm', auth, async (req, res) => {
  try {
    const { flat, name, phone, amount, month, txn_id } = req.body;
    const msg = `Dear ${name}, ₹${amount} received for ${month} maintenance. Txn ID: ${txn_id}. Thank you! - ${process.env.SOCIETY_NAME || 'Society'}`;
    const result = await sendSMS(phone, msg);
    await logSMS('payment_received', phone, flat, name, msg, 'Delivered', result.sid);
    res.json({ success: true, message: 'Payment confirmation SMS sent.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST /api/sms/announcement — blast to all tenants ───────────────────────
router.post('/announcement', auth, async (req, res) => {
  try {
    const { title, body } = req.body;
    const { rows } = await pool.query("SELECT phone, flat, name FROM tenants WHERE status='Active' AND phone IS NOT NULL");
    const msg = `${process.env.SOCIETY_NAME || 'Society'}: ${title}. ${body.slice(0, 100)}`;
    const results = [];
    for (const t of rows) {
      try {
        const result = await sendSMS(t.phone, msg);
        await logSMS('announcement', t.phone, t.flat, t.name, msg, 'Delivered', result.sid);
        results.push({ flat: t.flat, status: 'Delivered' });
      } catch (err) {
        await logSMS('announcement', t.phone, t.flat, t.name, msg, 'Failed', null);
        results.push({ flat: t.flat, status: 'Failed' });
      }
    }
    res.json({ success: true, sent: rows.length, results });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST /api/sms/meeting-invite — invite all to a meeting ───────────────────
router.post('/meeting-invite', auth, async (req, res) => {
  try {
    const { title, date, time, venue } = req.body;
    const { rows } = await pool.query("SELECT phone, flat, name FROM tenants WHERE status='Active' AND phone IS NOT NULL");
    const msg = `Dear Resident, You are invited to ${title} on ${date} at ${time}, ${venue}. Please attend. - ${process.env.SOCIETY_NAME || 'Society'}`;
    const results = [];
    for (const t of rows) {
      try {
        const result = await sendSMS(t.phone, msg);
        await logSMS('meeting_invite', t.phone, t.flat, t.name, msg, 'Delivered', result.sid);
        results.push({ flat: t.flat, status: 'Delivered' });
      } catch { results.push({ flat: t.flat, status: 'Failed' }); }
    }
    res.json({ success: true, sent: rows.length, results });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST /api/sms/visitor-alert — alert resident about visitor ───────────────
router.post('/visitor-alert', async (req, res) => {
  try {
    const { flat, resident_name, phone, visitor_name, gate, time } = req.body;
    const msg = `Dear ${resident_name}, ${visitor_name} has arrived at ${gate} gate to meet you. Checked in at ${time}. - ${process.env.SOCIETY_NAME || 'Society'}`;
    const result = await sendSMS(phone, msg);
    await logSMS('visitor_alert', phone, flat, resident_name, msg, 'Delivered', result.sid);
    res.json({ success: true, message: 'Visitor alert sent.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST /api/sms/booking-confirmed ──────────────────────────────────────────
router.post('/booking-confirmed', auth, async (req, res) => {
  try {
    const { flat, name, phone, facility, date, from_time, to_time, amount } = req.body;
    const msg = `Dear ${name}, Your booking for ${facility} on ${date} (${from_time}–${to_time}) is CONFIRMED. Amount: ₹${amount}. - ${process.env.SOCIETY_NAME || 'Society'}`;
    const result = await sendSMS(phone, msg);
    await logSMS('booking_confirmed', phone, flat, name, msg, 'Delivered', result.sid);
    res.json({ success: true, message: 'Booking confirmation sent.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST /api/sms/complaint-update ───────────────────────────────────────────
router.post('/complaint-update', async (req, res) => {
  try {
    const { flat, name, phone, ticket_no, title, status, response } = req.body;
    const msg = `Dear ${name}, Your complaint #${ticket_no} (${title}) is now ${status}. ${response ? 'Response: ' + response : ''} - ${process.env.SOCIETY_NAME || 'Society'}`;
    const result = await sendSMS(phone, msg);
    await logSMS('complaint_update', phone, flat, name, msg, 'Delivered', result.sid);
    res.json({ success: true, message: 'Complaint update SMS sent.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GET /api/sms/logs — view SMS history ─────────────────────────────────────
router.get('/logs', auth, async (req, res) => {
  try {
    const { type, status, flat, limit = 100 } = req.query;
    let query  = 'SELECT * FROM sms_logs WHERE 1=1';
    const params = [];
    if (type)   { params.push(type);   query += ` AND type = $${params.length}`; }
    if (status) { params.push(status); query += ` AND status = $${params.length}`; }
    if (flat)   { params.push(flat);   query += ` AND flat ILIKE $${params.length}`; }
    query += ` ORDER BY sent_at DESC LIMIT $${params.length+1}`;
    params.push(limit);

    const { rows } = await pool.query(query, params);
    const stats = {
      total:     rows.length,
      delivered: rows.filter(r => r.status === 'Delivered').length,
      failed:    rows.filter(r => r.status === 'Failed').length,
    };
    res.json({ success: true, stats, logs: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GET /api/sms/settings — get notification settings ────────────────────────
router.get('/settings', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM notification_settings LIMIT 1');
    res.json({ success: true, settings: rows[0] || {} });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── PUT /api/sms/settings — update notification settings ─────────────────────
router.put('/settings', auth, async (req, res) => {
  try {
    const { maintenance_reminder, payment_confirm, overdue_alert, announcement,
            meeting_invite, complaint_update, visitor_alert, booking_confirm,
            whatsapp_enabled, sms_enabled, sender_id } = req.body;
    await pool.query(`
      INSERT INTO notification_settings
        (maintenance_reminder,payment_confirm,overdue_alert,announcement,
         meeting_invite,complaint_update,visitor_alert,booking_confirm,
         whatsapp_enabled,sms_enabled,sender_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT DO UPDATE SET
        maintenance_reminder=$1,payment_confirm=$2,overdue_alert=$3,announcement=$4,
        meeting_invite=$5,complaint_update=$6,visitor_alert=$7,booking_confirm=$8,
        whatsapp_enabled=$9,sms_enabled=$10,sender_id=$11,updated_at=NOW()`,
      [maintenance_reminder,payment_confirm,overdue_alert,announcement,
       meeting_invite,complaint_update,visitor_alert,booking_confirm,
       whatsapp_enabled,sms_enabled,sender_id]
    );
    res.json({ success: true, message: 'Settings saved.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
