const pool = require('../db/pool');

const setupSaaS = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('🏗️  Setting up SaaS multi-tenancy schema...');

    // ── Societies (each customer = one society) ──────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS societies (
        id              SERIAL PRIMARY KEY,
        name            VARCHAR(200) NOT NULL,
        slug            VARCHAR(100) UNIQUE NOT NULL,
        address         TEXT,
        city            VARCHAR(100),
        state           VARCHAR(100),
        pincode         VARCHAR(10),
        total_flats     INTEGER NOT NULL DEFAULT 10,
        wings           TEXT[],
        secretary_name  VARCHAR(100),
        secretary_phone VARCHAR(15),
        secretary_email VARCHAR(150) UNIQUE NOT NULL,
        password        VARCHAR(255) NOT NULL,
        logo_url        TEXT,
        plan            VARCHAR(30)  DEFAULT 'starter',
        status          VARCHAR(30)  DEFAULT 'trial',
        trial_ends_at   TIMESTAMP    DEFAULT (NOW() + INTERVAL '30 days'),
        created_at      TIMESTAMP    DEFAULT NOW(),
        updated_at      TIMESTAMP    DEFAULT NOW()
      );
    `);

    // ── Subscription plans ───────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS plans (
        id                SERIAL PRIMARY KEY,
        name              VARCHAR(50)  NOT NULL,
        slug              VARCHAR(30)  UNIQUE NOT NULL,
        price_per_flat    NUMERIC(8,2) NOT NULL,
        billing_cycle     VARCHAR(20)  DEFAULT 'monthly',
        max_flats         INTEGER,
        features          TEXT[],
        razorpay_plan_id  VARCHAR(100),
        active            BOOLEAN      DEFAULT TRUE,
        created_at        TIMESTAMP    DEFAULT NOW()
      );
    `);

    // Seed plans
    await client.query(`
      INSERT INTO plans (name, slug, price_per_flat, billing_cycle, max_flats, features) VALUES
      ('Starter',  'starter',  25, 'monthly', 50,   ARRAY['Dashboard','Tenants','Maintenance','Payments','Announcements','Meetings','Gallery']),
      ('Standard', 'standard', 40, 'monthly', 200,  ARRAY['Everything in Starter','SMS Alerts','Visitor Log','Parking','Complaints','Forum','Polls','Committee','File Repository']),
      ('Premium',  'premium',  60, 'monthly', NULL, ARRAY['Everything in Standard','Home Services','Properties Marketplace','Facility Booking','White-label','Priority Support'])
      ON CONFLICT (slug) DO NOTHING;
    `);

    // ── Subscriptions ────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id                      SERIAL PRIMARY KEY,
        society_id              INTEGER REFERENCES societies(id) ON DELETE CASCADE,
        plan_id                 INTEGER REFERENCES plans(id),
        plan_slug               VARCHAR(30),
        billing_cycle           VARCHAR(20) DEFAULT 'monthly',
        price_per_flat          NUMERIC(8,2),
        total_flats             INTEGER,
        amount                  NUMERIC(10,2),
        status                  VARCHAR(30) DEFAULT 'active',
        razorpay_subscription_id VARCHAR(100),
        razorpay_order_id       VARCHAR(100),
        current_period_start    DATE,
        current_period_end      DATE,
        cancelled_at            TIMESTAMP,
        created_at              TIMESTAMP DEFAULT NOW(),
        updated_at              TIMESTAMP DEFAULT NOW()
      );
    `);

    // ── Billing invoices ─────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id              SERIAL PRIMARY KEY,
        society_id      INTEGER REFERENCES societies(id),
        subscription_id INTEGER REFERENCES subscriptions(id),
        invoice_no      VARCHAR(30) UNIQUE NOT NULL,
        amount          NUMERIC(10,2) NOT NULL,
        tax             NUMERIC(10,2) DEFAULT 0,
        total           NUMERIC(10,2) NOT NULL,
        status          VARCHAR(20) DEFAULT 'paid',
        razorpay_payment_id VARCHAR(100),
        period_start    DATE,
        period_end      DATE,
        issued_at       TIMESTAMP DEFAULT NOW()
      );
    `);

    // ── Super admins (your team) ─────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS super_admins (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100) NOT NULL,
        email      VARCHAR(150) UNIQUE NOT NULL,
        password   VARCHAR(255) NOT NULL,
        role       VARCHAR(30)  DEFAULT 'admin',
        created_at TIMESTAMP    DEFAULT NOW()
      );
    `);

    // ── Add society_id to all existing tables ─────────────────────────────────
    const tables = [
      'admins','tenants','maintenance','announcements','meetings',
      'gallery_events','gallery_photos','payments','complaints','complaint_replies',
      'parking_slots','parking_vehicles','visitors','committee_members',
      'polls','poll_options','poll_votes','forum_threads','forum_replies',
      'forum_likes','society_files','facilities','facility_bookings',
      'sms_logs','notification_settings'
    ];

    for (const table of tables) {
      try {
        await client.query(`
          ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS society_id INTEGER REFERENCES societies(id) ON DELETE CASCADE;
        `);
      } catch (e) {
        // Table may not exist yet — skip
      }
    }

    // ── Indexes for performance ───────────────────────────────────────────────
    const idxTables = ['tenants','maintenance','announcements','meetings','payments','complaints','visitors','forum_threads'];
    for (const t of idxTables) {
      try {
        await client.query(`CREATE INDEX IF NOT EXISTS idx_${t}_society ON ${t}(society_id);`);
      } catch (e) {}
    }

    await client.query('COMMIT');
    console.log('✅ SaaS schema created successfully');
    console.log('   Tables: societies, plans, subscriptions, invoices, super_admins');
    console.log('   Added society_id to all existing tables');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ SaaS schema failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
};

setupSaaS().then(() => process.exit(0)).catch(() => process.exit(1));
