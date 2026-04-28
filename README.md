# 🏢 Society Management — Backend API

Complete Node.js + Express + PostgreSQL backend for the Society Management System.

---

## Quick Start

### 1. Install dependencies
```bash
cd society-backend
npm install
```

### 2. Setup environment
```bash
cp .env.example .env
# Edit .env with your database credentials
```

### 3. Create database (PostgreSQL)
```bash
# In PostgreSQL / pgAdmin, create a database:
CREATE DATABASE society_db;
```

### 4. Run database setup
```bash
npm run db:setup   # creates all tables
npm run db:seed    # adds sample data
```

### 5. Start server
```bash
npm run dev        # development (auto-restart)
npm start          # production
```

Server runs at: **http://localhost:5000**

---

## All API Endpoints

### 🔐 Auth
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/login` | Login with email + password | ❌ |
| POST | `/api/auth/register` | Register new admin | ❌ |
| GET  | `/api/auth/me` | Get logged-in admin profile | ✅ |
| PUT  | `/api/auth/change-password` | Change password | ✅ |

**Login request:**
```json
{ "email": "admin@sunrise.in", "password": "admin123" }
```
**Login response:**
```json
{ "success": true, "token": "eyJ...", "admin": { "name": "...", "role": "secretary" } }
```

---

### 📊 Dashboard
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET  | `/api/dashboard` | All stats, trends, upcoming meetings | ✅ |
| POST | `/api/dashboard/send-reminder` | Send payment reminders | ✅ |

---

### 👥 Tenants
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET    | `/api/tenants` | List all (search, filter) | ✅ |
| GET    | `/api/tenants/:id` | Get single tenant | ✅ |
| POST   | `/api/tenants` | Add new tenant | ✅ |
| PUT    | `/api/tenants/:id` | Update tenant | ✅ |
| DELETE | `/api/tenants/:id` | Delete tenant | ✅ |
| GET    | `/api/tenants/:id/maintenance` | Tenant's payment history | ✅ |

**Query params:** `?search=Ramesh&status=Active&wing=A`

---

### 🔧 Maintenance
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET    | `/api/maintenance` | All records (filter by month/status) | ✅ |
| POST   | `/api/maintenance` | Add single record | ✅ |
| POST   | `/api/maintenance/bulk-generate` | Auto-create for all tenants | ✅ |
| PUT    | `/api/maintenance/:id/mark-paid` | Mark as paid | ✅ |
| PUT    | `/api/maintenance/:id` | Update record | ✅ |
| DELETE | `/api/maintenance/:id` | Delete record | ✅ |
| GET    | `/api/maintenance/meta/months` | List all months | ✅ |

**Query params:** `?month=April 2025&status=Pending`

---

### 💳 Payments (Razorpay)
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET  | `/api/payments` | All payments | ✅ |
| POST | `/api/payments/create-order` | Create Razorpay order | ❌ |
| POST | `/api/payments/verify` | Verify payment signature | ❌ |
| POST | `/api/payments/cash` | Record cash payment | ✅ |
| GET  | `/api/payments/:id` | Single payment | ✅ |

**Razorpay flow:**
1. Call `/create-order` → get `order_id`
2. Open Razorpay checkout in browser
3. After payment → call `/verify` with signature
4. Payment auto-marks maintenance as Paid

---

### 📢 Announcements
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET    | `/api/announcements` | All (filter by type/pinned) | ❌ |
| POST   | `/api/announcements` | Create new | ✅ |
| PUT    | `/api/announcements/:id` | Update | ✅ |
| PATCH  | `/api/announcements/:id/pin` | Toggle pin | ✅ |
| DELETE | `/api/announcements/:id` | Delete | ✅ |

---

### 📅 Meetings
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET    | `/api/meetings` | All meetings | ✅ |
| GET    | `/api/meetings/:id` | Single meeting | ✅ |
| POST   | `/api/meetings` | Create meeting | ✅ |
| PUT    | `/api/meetings/:id` | Update meeting | ✅ |
| PATCH  | `/api/meetings/:id/complete` | Mark completed | ✅ |
| DELETE | `/api/meetings/:id` | Delete | ✅ |

---

### 🖼️ Gallery
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET    | `/api/gallery` | All events with photo count | ❌ |
| GET    | `/api/gallery/:id/photos` | Photos for an event | ❌ |
| POST   | `/api/gallery` | Create event album | ✅ |
| POST   | `/api/gallery/:id/photos` | Add photo URL | ✅ |
| DELETE | `/api/gallery/photos/:photoId` | Delete photo | ✅ |
| DELETE | `/api/gallery/:id` | Delete event | ✅ |

---

### 🏠 Properties
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET    | `/api/properties` | All listings | ❌ |
| GET    | `/api/properties/:id` | Single property | ❌ |
| POST   | `/api/properties` | Add listing | ❌ |
| PUT    | `/api/properties/:id` | Update listing | ✅ |
| PATCH  | `/api/properties/:id/like` | Increment likes | ❌ |
| DELETE | `/api/properties/:id` | Remove listing | ✅ |

**Query params:** `?type=Sale&bhk=2&min_price=5000000`

---

### 🛠️ Services
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET    | `/api/services` | All services | ❌ |
| GET    | `/api/services/:id` | Single service | ❌ |
| POST   | `/api/services/book` | Book a service | ❌ |
| GET    | `/api/services/bookings/all` | All bookings (admin) | ✅ |
| GET    | `/api/services/bookings/:flat` | Bookings for a flat | ❌ |
| PATCH  | `/api/services/bookings/:id/status` | Update booking status | ✅ |

---

## Connecting to Next.js Frontend

In your Next.js project, create `src/lib/api.js`:

```js
const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export const api = {
  login: (data) => fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).then(r => r.json()),

  get: (path, token) => fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then(r => r.json()),

  post: (path, data, token) => fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  }).then(r => r.json()),
};
```

---

## Deployment

### Local PostgreSQL
Install PostgreSQL → create `society_db` → run `npm run db:setup`

### Supabase (Free Cloud DB)
1. Create project at supabase.com
2. Copy connection string to `.env` as `DATABASE_URL`
3. Run `npm run db:setup` and `npm run db:seed`

### Deploy backend to Railway / Render (Free)
1. Push code to GitHub
2. Connect repo to railway.app or render.com
3. Add all `.env` variables in their dashboard
4. Deploy — get a live URL like `https://society-api.railway.app`

---

## Project Structure

```
society-backend/
├── src/
│   ├── server.js              # Main Express app
│   ├── db/
│   │   ├── pool.js            # PostgreSQL connection
│   │   ├── setup.js           # Create all tables
│   │   └── seed.js            # Sample data
│   ├── middleware/
│   │   └── auth.js            # JWT verification
│   └── routes/
│       ├── auth.js            # Login / register
│       ├── dashboard.js       # Stats API
│       ├── tenants.js         # Tenant CRUD
│       ├── maintenance.js     # Maintenance records
│       ├── payments.js        # Razorpay payments
│       ├── content.js         # Announcements, Meetings, Gallery
│       └── marketplace.js     # Properties, Services
├── .env.example
└── package.json
```
