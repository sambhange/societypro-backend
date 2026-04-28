const pool = require('./pool');

const createTables = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Admins (society secretary / committee) ──────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(100) NOT NULL,
        email       VARCHAR(150) UNIQUE NOT NULL,
        password    VARCHAR(255) NOT NULL,
        role        VARCHAR(50)  DEFAULT 'secretary',
        phone       VARCHAR(15),
        avatar_url  TEXT,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);

    // ── Tenants ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id          SERIAL PRIMARY KEY,
        flat        VARCHAR(20)  NOT NULL UNIQUE,
        name        VARCHAR(100) NOT NULL,
        phone       VARCHAR(15),
        email       VARCHAR(150),
        members     INTEGER DEFAULT 1,
        status      VARCHAR(20)  DEFAULT 'Active',
        join_date   DATE DEFAULT CURRENT_DATE,
        aadhaar     VARCHAR(20),
        notes       TEXT,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);

    // ── Maintenance ──────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS maintenance (
        id          SERIAL PRIMARY KEY,
        tenant_id   INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
        flat        VARCHAR(20)  NOT NULL,
        name        VARCHAR(100) NOT NULL,
        month       VARCHAR(30)  NOT NULL,
        amount      NUMERIC(10,2) NOT NULL DEFAULT 2500,
        paid_on     DATE,
        status      VARCHAR(20)  DEFAULT 'Pending',
        txn_id      VARCHAR(100),
        mode        VARCHAR(30),
        notes       TEXT,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);

    // ── Announcements ────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id          SERIAL PRIMARY KEY,
        title       VARCHAR(200) NOT NULL,
        body        TEXT         NOT NULL,
        type        VARCHAR(30)  DEFAULT 'info',
        pinned      BOOLEAN      DEFAULT FALSE,
        posted_by   VARCHAR(100),
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);

    // ── Meetings ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS meetings (
        id          SERIAL PRIMARY KEY,
        title       VARCHAR(200) NOT NULL,
        date        DATE         NOT NULL,
        time        VARCHAR(20),
        venue       VARCHAR(150),
        agenda      TEXT,
        status      VARCHAR(30)  DEFAULT 'Upcoming',
        attendees   INTEGER      DEFAULT 0,
        minutes     TEXT,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);

    // ── Gallery Events ────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS gallery_events (
        id          SERIAL PRIMARY KEY,
        title       VARCHAR(200) NOT NULL,
        description TEXT,
        date        DATE,
        tag         VARCHAR(50),
        emoji       VARCHAR(10)  DEFAULT '🎉',
        created_at  TIMESTAMP DEFAULT NOW()
      );
    `);

    // ── Gallery Photos ────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS gallery_photos (
        id          SERIAL PRIMARY KEY,
        event_id    INTEGER REFERENCES gallery_events(id) ON DELETE CASCADE,
        url         TEXT NOT NULL,
        public_id   TEXT,
        caption     TEXT,
        uploaded_by VARCHAR(100),
        created_at  TIMESTAMP DEFAULT NOW()
      );
    `);

    // ── Payments ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id              SERIAL PRIMARY KEY,
        tenant_id       INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
        maintenance_id  INTEGER REFERENCES maintenance(id) ON DELETE SET NULL,
        flat            VARCHAR(20)  NOT NULL,
        name            VARCHAR(100) NOT NULL,
        amount          NUMERIC(10,2) NOT NULL,
        mode            VARCHAR(30),
        status          VARCHAR(30)  DEFAULT 'Pending',
        razorpay_order_id   VARCHAR(100),
        razorpay_payment_id VARCHAR(100),
        razorpay_signature  VARCHAR(255),
        txn_id          VARCHAR(100),
        paid_at         TIMESTAMP,
        notes           TEXT,
        created_at      TIMESTAMP DEFAULT NOW()
      );
    `);

    // ── Properties ────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS properties (
        id          SERIAL PRIMARY KEY,
        flat        VARCHAR(20)  NOT NULL,
        type        VARCHAR(10)  NOT NULL,
        bhk         INTEGER      NOT NULL,
        floor       INTEGER,
        area        INTEGER,
        price       NUMERIC(12,2) NOT NULL,
        owner       VARCHAR(100) NOT NULL,
        phone       VARCHAR(15),
        email       VARCHAR(150),
        furnished   VARCHAR(30)  DEFAULT 'Semi-Furnished',
        available   VARCHAR(50),
        facing      VARCHAR(20),
        bathrooms   INTEGER      DEFAULT 1,
        description TEXT,
        amenities   TEXT[],
        emoji       VARCHAR(10)  DEFAULT '🏢',
        views       INTEGER      DEFAULT 0,
        likes       INTEGER      DEFAULT 0,
        active      BOOLEAN      DEFAULT TRUE,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);

    // ── Services ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS services (
        id          SERIAL PRIMARY KEY,
        category    VARCHAR(50)  NOT NULL,
        title       VARCHAR(200) NOT NULL,
        description TEXT,
        price       NUMERIC(10,2) NOT NULL,
        unit        VARCHAR(50),
        time_needed VARCHAR(50),
        providers   INTEGER      DEFAULT 1,
        rating      NUMERIC(3,1) DEFAULT 4.5,
        reviews     INTEGER      DEFAULT 0,
        includes    TEXT[],
        emoji       VARCHAR(10)  DEFAULT '🔧',
        popular     BOOLEAN      DEFAULT FALSE,
        active      BOOLEAN      DEFAULT TRUE,
        created_at  TIMESTAMP DEFAULT NOW()
      );
    `);

    // ── Service Bookings ──────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS service_bookings (
        id          SERIAL PRIMARY KEY,
        service_id  INTEGER REFERENCES services(id) ON DELETE SET NULL,
        tenant_id   INTEGER REFERENCES tenants(id)  ON DELETE SET NULL,
        flat        VARCHAR(20)  NOT NULL,
        name        VARCHAR(100),
        phone       VARCHAR(15),
        date        DATE         NOT NULL,
        time_slot   VARCHAR(20),
        status      VARCHAR(30)  DEFAULT 'Confirmed',
        notes       TEXT,
        booking_ref VARCHAR(30)  UNIQUE,
        amount      NUMERIC(10,2),
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);










    // ── SMS Logs & Notification Settings ─────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS sms_logs (
        id              SERIAL PRIMARY KEY,
        type            VARCHAR(50),
        recipient_phone VARCHAR(20),
        flat            VARCHAR(20),
        recipient_name  VARCHAR(100),
        message         TEXT,
        status          VARCHAR(20) DEFAULT 'Pending',
        twilio_sid      VARCHAR(50),
        sent_at         TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_settings (
        id                    SERIAL PRIMARY KEY,
        maintenance_reminder  BOOLEAN DEFAULT TRUE,
        payment_confirm       BOOLEAN DEFAULT TRUE,
        overdue_alert         BOOLEAN DEFAULT TRUE,
        announcement          BOOLEAN DEFAULT TRUE,
        meeting_invite        BOOLEAN DEFAULT TRUE,
        complaint_update      BOOLEAN DEFAULT TRUE,
        visitor_alert         BOOLEAN DEFAULT TRUE,
        booking_confirm       BOOLEAN DEFAULT TRUE,
        whatsapp_enabled      BOOLEAN DEFAULT FALSE,
        sms_enabled           BOOLEAN DEFAULT TRUE,
        sender_id             VARCHAR(20) DEFAULT 'SCIETY',
        updated_at            TIMESTAMP DEFAULT NOW()
      );
    `);

    // ── Facilities & Bookings ─────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS facilities (
        id              SERIAL PRIMARY KEY,
        name            VARCHAR(100) NOT NULL,
        emoji           VARCHAR(10),
        capacity        INTEGER,
        price_per_hour  NUMERIC(10,2) DEFAULT 0,
        description     TEXT,
        amenities       TEXT[],
        timings         VARCHAR(50),
        min_hours       INTEGER DEFAULT 1,
        max_hours       INTEGER DEFAULT 8,
        rules           TEXT[],
        status          VARCHAR(20) DEFAULT 'Available',
        rating          NUMERIC(3,1) DEFAULT 4.5,
        active          BOOLEAN DEFAULT TRUE,
        created_at      TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS facility_bookings (
        id          SERIAL PRIMARY KEY,
        facility_id INTEGER REFERENCES facilities(id) ON DELETE SET NULL,
        flat        VARCHAR(20) NOT NULL,
        booked_by   VARCHAR(100),
        date        DATE NOT NULL,
        from_time   VARCHAR(20),
        to_time     VARCHAR(20),
        purpose     TEXT,
        hours       NUMERIC(4,1),
        amount      NUMERIC(10,2) DEFAULT 0,
        deposit     NUMERIC(10,2) DEFAULT 0,
        status      VARCHAR(20) DEFAULT 'Pending',
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);

    const facCount = await client.query('SELECT COUNT(*) FROM facilities');
    if (Number(facCount.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO facilities (name, emoji, capacity, price_per_hour, description, amenities, timings, min_hours, max_hours, rules) VALUES
        ('Community Hall','🏛️',150,500,'Spacious hall for events and AGMs',ARRAY['AC','Sound System','Projector','Stage'],'8:00 AM – 10:00 PM',2,12,ARRAY['No outside catering','Cleaning deposit ₹1000']),
        ('Terrace / Rooftop','🌇',80,300,'Open-air terrace for parties',ARRAY['Open Air','Fairy Lights','Seating','BBQ'],'6:00 AM – 9:00 PM',2,8,ARRAY['No glass items','No cooking without approval']),
        ('Gymnasium','💪',20,0,'Fully equipped gym',ARRAY['Cardio Equipment','Weights','Yoga Mat'],'5:00 AM – 10:00 PM',1,2,ARRAY['Proper attire required','Wipe equipment after use']),
        ('Swimming Pool','🏊',30,0,'Olympic pool with kids section',ARRAY['Changing Room','Lifeguard','Kids Pool'],'6:00 AM – 8:00 PM',1,2,ARRAY['Swim cap mandatory','Shower before entering']),
        ('Mini Conference Room','🖥️',15,200,'Professional meeting room',ARRAY['AC','Projector','WiFi','Whiteboard'],'8:00 AM – 9:00 PM',1,8,ARRAY['No food or drinks','Prior booking mandatory'])
      `);
    }

    // ── File Repository ───────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS society_files (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(255) NOT NULL,
        category    VARCHAR(50)  DEFAULT 'other',
        size        BIGINT       DEFAULT 0,
        url         TEXT,
        public_id   TEXT,
        access      VARCHAR(20)  DEFAULT 'public',
        description TEXT,
        uploaded_by VARCHAR(100),
        starred     BOOLEAN      DEFAULT FALSE,
        downloads   INTEGER      DEFAULT 0,
        deleted     BOOLEAN      DEFAULT FALSE,
        uploaded_at TIMESTAMP    DEFAULT NOW(),
        updated_at  TIMESTAMP    DEFAULT NOW()
      );
    `);

    // ── Discussion Forum ──────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS forum_threads (
        id         SERIAL PRIMARY KEY,
        title      VARCHAR(300) NOT NULL,
        body       TEXT NOT NULL,
        category   VARCHAR(50) DEFAULT 'general',
        flat       VARCHAR(20),
        author     VARCHAR(100),
        tags       TEXT[],
        pinned     BOOLEAN DEFAULT FALSE,
        views      INTEGER DEFAULT 0,
        deleted    BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS forum_replies (
        id         SERIAL PRIMARY KEY,
        thread_id  INTEGER REFERENCES forum_threads(id) ON DELETE CASCADE,
        author     VARCHAR(100),
        flat       VARCHAR(20),
        text       TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS forum_likes (
        id         SERIAL PRIMARY KEY,
        thread_id  INTEGER REFERENCES forum_threads(id) ON DELETE CASCADE,
        voter_flat VARCHAR(20),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(thread_id, voter_flat)
      );
    `);

    // ── Polls ─────────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS polls (
        id          SERIAL PRIMARY KEY,
        title       VARCHAR(300) NOT NULL,
        description TEXT,
        category_id VARCHAR(50) DEFAULT 'general',
        status      VARCHAR(20) DEFAULT 'Active',
        winner      VARCHAR(5),
        created_by  VARCHAR(100),
        start_date  DATE DEFAULT CURRENT_DATE,
        end_date    DATE,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS poll_options (
        id        SERIAL PRIMARY KEY,
        poll_id   INTEGER REFERENCES polls(id) ON DELETE CASCADE,
        option_id VARCHAR(5) NOT NULL,
        label     VARCHAR(200) NOT NULL,
        votes     INTEGER DEFAULT 0
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS poll_votes (
        id          SERIAL PRIMARY KEY,
        poll_id     INTEGER REFERENCES polls(id) ON DELETE CASCADE,
        option_id   VARCHAR(5),
        voter_flat  VARCHAR(20),
        voted_at    TIMESTAMP DEFAULT NOW(),
        UNIQUE(poll_id, voter_flat)
      );
    `);

    // ── Committee Members ─────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS committee_members (
        id           SERIAL PRIMARY KEY,
        name         VARCHAR(100) NOT NULL,
        role         VARCHAR(50)  NOT NULL,
        flat         VARCHAR(20),
        phone        VARCHAR(15),
        email        VARCHAR(150),
        tenure       VARCHAR(20)  DEFAULT '2024-2026',
        member_since VARCHAR(30),
        bio          TEXT,
        active       BOOLEAN DEFAULT TRUE,
        created_at   TIMESTAMP DEFAULT NOW(),
        updated_at   TIMESTAMP DEFAULT NOW()
      );
    `);

    // ── Visitors ──────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS visitors (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(100) NOT NULL,
        mobile      VARCHAR(15),
        flat        VARCHAR(20) NOT NULL,
        meet_to     VARCHAR(100),
        type        VARCHAR(30) DEFAULT 'guest',
        purpose     TEXT,
        vehicle_no  VARCHAR(20),
        gate        VARCHAR(20) DEFAULT 'Main',
        in_time     TIMESTAMP DEFAULT NOW(),
        out_time    TIMESTAMP,
        status      VARCHAR(20) DEFAULT 'Inside',
        logged_by   VARCHAR(100),
        created_at  TIMESTAMP DEFAULT NOW()
      );
    `);

    // ── Parking slots ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS parking_slots (
        id        SERIAL PRIMARY KEY,
        slot_no   VARCHAR(10) UNIQUE NOT NULL,
        slot_type VARCHAR(20) DEFAULT 'Four Wheeler',
        wing      VARCHAR(5),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Seed default 40 slots if empty
    const slotCount = await client.query('SELECT COUNT(*) FROM parking_slots');
    if (Number(slotCount.rows[0].count) === 0) {
      const slotVals = [];
      for (let i = 1; i <= 24; i++) {
        const wing = ['A','B','C','D'][Math.floor((i-1)/6)];
        slotVals.push(`('P${String(i).padStart(2,'0')}','Four Wheeler','${wing}')`);
      }
      for (let i = 25; i <= 40; i++) {
        const wing = ['A','B','C','D'][Math.floor((i-25)/4)];
        slotVals.push(`('P${String(i).padStart(2,'0')}','Two Wheeler','${wing}')`);
      }
      await client.query(`INSERT INTO parking_slots (slot_no, slot_type, wing) VALUES ${slotVals.join(',')}`);
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS parking_vehicles (
        id         SERIAL PRIMARY KEY,
        flat       VARCHAR(20) NOT NULL,
        owner      VARCHAR(100),
        slot_no    VARCHAR(10),
        type       VARCHAR(20) DEFAULT 'Four Wheeler',
        brand      VARCHAR(50),
        model      VARCHAR(50),
        vehicle_no VARCHAR(20) UNIQUE NOT NULL,
        color      VARCHAR(30),
        charges    NUMERIC(10,2) DEFAULT 500,
        status     VARCHAR(20) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // ── Complaints ────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS complaints (
        id          SERIAL PRIMARY KEY,
        ticket_no   VARCHAR(20) UNIQUE NOT NULL,
        flat        VARCHAR(20) NOT NULL,
        name        VARCHAR(100) NOT NULL,
        category    VARCHAR(50)  DEFAULT 'other',
        title       VARCHAR(200) NOT NULL,
        description TEXT,
        priority    VARCHAR(20)  DEFAULT 'Medium',
        status      VARCHAR(30)  DEFAULT 'Open',
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS complaint_replies (
        id           SERIAL PRIMARY KEY,
        complaint_id INTEGER REFERENCES complaints(id) ON DELETE CASCADE,
        replied_by   VARCHAR(100),
        message      TEXT NOT NULL,
        created_at   TIMESTAMP DEFAULT NOW()
      );
    `);

    // ── Notifications log ─────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id          SERIAL PRIMARY KEY,
        type        VARCHAR(30),
        recipient   VARCHAR(150),
        message     TEXT,
        status      VARCHAR(20)  DEFAULT 'sent',
        sent_at     TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query('COMMIT');
    console.log('✅ All tables created successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Table creation failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
};

createTables().then(() => process.exit(0)).catch(() => process.exit(1));
