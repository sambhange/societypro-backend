const pool = require('./pool');
const bcrypt = require('bcryptjs');

const seed = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('🌱 Seeding database...');

    // Admin
    const hash = await bcrypt.hash('admin123', 10);
    await client.query(`
      INSERT INTO admins (name, email, password, role, phone) VALUES
      ('Rajesh Kumar', 'admin@sunrise.in', $1, 'secretary', '9820012345')
      ON CONFLICT (email) DO NOTHING;
    `, [hash]);

    // Tenants
    await client.query(`
      INSERT INTO tenants (flat, name, phone, email, members, status, join_date) VALUES
      ('A-101', 'Ramesh Sharma',  '9823456710', 'ramesh@email.com',  4, 'Active',   '2021-01-15'),
      ('A-102', 'Priya Mehta',    '9876543210', 'priya@email.com',   2, 'Active',   '2020-03-10'),
      ('B-201', 'Anjali Verma',   '9765432198', 'anjali@email.com',  3, 'Active',   '2019-06-20'),
      ('B-202', 'Suresh Patel',   '9654321987', 'suresh@email.com',  5, 'Inactive', '2022-02-01'),
      ('C-301', 'Neha Singh',     '9543219876', 'neha@email.com',    2, 'Active',   '2021-08-05'),
      ('C-302', 'Vikram Joshi',   '9432198765', 'vikram@email.com',  3, 'Active',   '2020-11-12'),
      ('D-401', 'Meena Iyer',     '9321987654', 'meena@email.com',   4, 'Active',   '2018-04-18'),
      ('D-402', 'Arjun Nair',     '9210987643', 'arjun@email.com',   2, 'Active',   '2023-09-01')
      ON CONFLICT (flat) DO NOTHING;
    `);

    // Maintenance records
    await client.query(`
      INSERT INTO maintenance (flat, name, month, amount, paid_on, status, txn_id, mode) VALUES
      ('A-101', 'Ramesh Sharma', 'April 2025', 2500, '2025-04-02', 'Paid',    'TXN001', 'UPI'),
      ('A-102', 'Priya Mehta',   'April 2025', 2500, NULL,         'Pending', NULL,     NULL),
      ('B-201', 'Anjali Verma',  'April 2025', 2500, '2025-04-01', 'Paid',    'TXN003', 'NEFT'),
      ('B-202', 'Suresh Patel',  'April 2025', 2500, NULL,         'Overdue', NULL,     NULL),
      ('C-301', 'Neha Singh',    'April 2025', 2500, '2025-04-03', 'Paid',    'TXN005', 'UPI'),
      ('C-302', 'Vikram Joshi',  'April 2025', 2500, NULL,         'Pending', NULL,     NULL),
      ('D-401', 'Meena Iyer',    'April 2025', 2500, '2025-04-04', 'Paid',    'TXN007', 'Cash'),
      ('D-402', 'Arjun Nair',    'April 2025', 2500, '2025-04-05', 'Paid',    'TXN008', 'UPI')
      ON CONFLICT DO NOTHING;
    `);

    // Announcements
    await client.query(`
      INSERT INTO announcements (title, body, type, pinned, posted_by) VALUES
      ('Water Supply Interruption',  'Water supply will be interrupted on 30th April from 9AM–1PM for tank cleaning.', 'urgent', TRUE,  'Society Admin'),
      ('Annual General Meeting',     'AGM is scheduled for 5th May at 6:30 PM in the community hall. All owners must attend.', 'event', TRUE, 'Secretary'),
      ('Holi Celebration Photos',    'Photos from Holi 2025 are now in the Gallery section.', 'info', FALSE, 'Events Team'),
      ('Parking Allocation Update',  'New parking slot numbering effective from 1st May.', 'info', FALSE, 'Society Admin'),
      ('Lift Maintenance Notice',    'Wing B lift maintenance on 2nd May from 10AM–4PM.', 'urgent', FALSE, 'Maintenance Dept')
      ON CONFLICT DO NOTHING;
    `);

    // Meetings
    await client.query(`
      INSERT INTO meetings (title, date, time, venue, agenda, status) VALUES
      ('Annual General Meeting',     '2025-05-05', '6:30 PM', 'Community Hall', 'Budget review, new committee election, maintenance fee revision', 'Upcoming'),
      ('Emergency Security Meeting', '2025-05-01', '7:00 PM', 'Garden Area',    'CCTV installation, night guard hiring, gate lock upgrade', 'Upcoming'),
      ('Garden Maintenance Meeting', '2025-03-15', '5:00 PM', 'Community Hall', 'New plants, budget, contractor selection', 'Completed'),
      ('Holi Event Planning',        '2025-02-20', '6:00 PM', 'Terrace Area',   'Holi planning, budget, decoration committee', 'Completed')
      ON CONFLICT DO NOTHING;
    `);

    // Gallery events
    await client.query(`
      INSERT INTO gallery_events (title, description, date, tag, emoji) VALUES
      ('Holi 2025',            'Colourful Holi celebration with all residents', '2025-03-14', 'Festival',    '🎨'),
      ('New Year Party',       'New Year countdown at the terrace',             '2025-01-01', 'Celebration', '🎉'),
      ('Sports Day 2024',      'Annual inter-wing sports competition',          '2024-11-15', 'Sports',      '🏆'),
      ('Diwali Night',         'Diwali rangoli and lighting decoration',        '2024-11-01', 'Festival',    '🪔'),
      ('Tree Plantation Drive','Society annual green initiative',               '2024-06-05', 'Green',       '🌳')
      ON CONFLICT DO NOTHING;
    `);

    // Properties
    await client.query(`
      INSERT INTO properties (flat, type, bhk, floor, area, price, owner, phone, email, furnished, available, facing, bathrooms, description, amenities, emoji) VALUES
      ('A-301', 'Sale', 2, 3, 950,  8500000,  'Suresh Mehta', '9820011234', 'suresh@email.com', 'Semi-Furnished', 'Immediate',    'East',  2, 'Beautiful 2BHK with city view. Recently renovated with modular kitchen.', ARRAY['Parking','Gym','Garden'], '🏢'),
      ('B-102', 'Rent', 1, 1, 620,  22000,    'Priya Verma',  '9876512345', 'priya@email.com',  'Fully Furnished', '1 May 2025',  'West',  1, 'Cozy 1BHK fully furnished. Ideal for working professionals.',            ARRAY['Parking','Security'],     '🏠'),
      ('C-401', 'Sale', 3, 4, 1350, 12500000, 'Rajesh Iyer',  '9765123456', 'rajesh@email.com', 'Unfurnished',    'Immediate',    'North', 3, 'Spacious 3BHK corner flat with panoramic view. Large balcony.',         ARRAY['Parking','Gym','Pool','Garden','Club House'], '🏗️'),
      ('D-203', 'Rent', 2, 2, 880,  35000,    'Anita Sharma', '9654321987', 'anita@email.com',  'Semi-Furnished', '15 May 2025', 'South', 2, 'Well-maintained 2BHK. Newly painted, modular kitchen, 24x7 security.',  ARRAY['Parking','Gym','Security','Garden'], '🏡')
      ON CONFLICT DO NOTHING;
    `);

    // Services
    await client.query(`
      INSERT INTO services (category, title, description, price, unit, time_needed, providers, rating, reviews, includes, emoji, popular) VALUES
      ('cleaning',   'Home Deep Cleaning',       'Full home deep clean including kitchen, bathroom and all rooms.',   799,  '1BHK',       '3-4 hrs', 12, 4.8, 234, ARRAY['Kitchen deep clean','Bathroom scrubbing','Floor mopping','Window cleaning'], '🧹', TRUE),
      ('cleaning',   'Bathroom Deep Clean',      'Professional bathroom cleaning with high-pressure jet.',           349,  'per bathroom','1-2 hrs',  8, 4.7, 189, ARRAY['Toilet deep clean','Floor scrubbing','Disinfection'], '🚿', FALSE),
      ('plumbing',   'Plumber Visit',            'Experienced plumber for leaks, tap repair, drain cleaning.',       199,  'visit',       '30 min',  15, 4.7, 312, ARRAY['Leak repair','Tap fixing','Drain unclogging','Free diagnosis'], '🔧', TRUE),
      ('plumbing',   'Water Tank Cleaning',      'Full tank cleaning with disinfection.',                            999,  '500 litres',  '2-3 hrs',  5, 4.5,  88, ARRAY['Tank draining','High-pressure wash','Disinfection','Report'], '🪣', FALSE),
      ('electrical', 'Electrician Visit',        'Licensed electrician for switch, fan, wiring issues.',             199,  'visit',       '30 min',  14, 4.8, 278, ARRAY['Switch repair','Fan fitting','Wiring check','Free quote'], '⚡', TRUE),
      ('electrical', 'AC Service',               'AC servicing, deep cleaning, gas check for all brands.',           599,  'per AC',      '1-2 hrs',  9, 4.6, 196, ARRAY['Filter cleaning','Coil wash','Gas check','Service report'], '❄️', TRUE),
      ('painting',   'Room Painting',            'Professional painting with premium emulsion. Includes putty.',    2999, 'per room',    '1-2 days', 7, 4.7, 167, ARRAY['Wall putty','Primer coat','2 paint coats','1 year warranty'], '🖌️', TRUE),
      ('painting',   'Full Home Painting',       'Complete interior painting. Asian Paints options available.',    18999, '2BHK',        '4-5 days', 5, 4.8,  93, ARRAY['All rooms','Putty + primer','Top coat','Clean-up included'], '🏠', FALSE),
      ('beauty',     'Women''s Haircut & Style', 'Professional stylist at home. Haircut, blow-dry and styling.',     399,  'per session', '45 min',  10, 4.9, 445, ARRAY['Haircut','Blow-dry','Styling','Head massage'], '✂️', TRUE),
      ('beauty',     'Waxing Full Body',         'Full body waxing at home by certified professionals.',             799,  'per session', '1-1.5 hrs',12, 4.8, 389, ARRAY['Full body','Rica wax','Aloe gel','Disposable strips'], '💅', TRUE),
      ('beauty',     'Men''s Grooming',          'Haircut, beard trim and face cleanup at home.',                    299,  'per session', '45 min',   8, 4.7, 221, ARRAY['Haircut','Beard trim','Face cleanup','Styling'], '💈', FALSE),
      ('appliance',  'Washing Machine Repair',   'Repair for all brands — LG, Samsung, Whirlpool.',                 349,  'visit',       '1-2 hrs',  7, 4.6, 134, ARRAY['Diagnosis','Part replacement','Testing','6 month warranty'], '🫧', FALSE),
      ('appliance',  'RO Water Purifier Service','RO service, filter change, UV lamp replacement.',                 299,  'visit',       '45 min',   9, 4.7, 178, ARRAY['Filter change','UV lamp check','TDS test','Tank cleaning'], '💧', TRUE),
      ('pest',       'Cockroach Treatment',      'Gel-based treatment. No smell, safe for children and pets.',       599,  '1BHK',        '1 hr',     8, 4.6, 203, ARRAY['Gel treatment','All rooms','3 month guarantee','Odourless'], '🦟', TRUE)
      ON CONFLICT DO NOTHING;
    `);

    await client.query('COMMIT');
    console.log('✅ Database seeded successfully');
    console.log('   Admin login → admin@sunrise.in / admin123');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
};

seed().then(() => process.exit(0)).catch(() => process.exit(1));
