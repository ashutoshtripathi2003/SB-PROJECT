import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { env } from './env'

/**
 * SQLite via Node's built-in driver: a single file, no native modules.
 * For deployment, put DATABASE_PATH on a persistent disk/volume.
 */
if (env.databasePath !== ':memory:') mkdirSync(dirname(env.databasePath), { recursive: true })
export const db = new DatabaseSync(env.databasePath)
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  photo TEXT,
  phone TEXT NOT NULL DEFAULT '',
  student_id TEXT NOT NULL DEFAULT '',
  programme TEXT,
  gender TEXT NOT NULL DEFAULT 'undisclosed',
  commute TEXT,
  upi_id TEXT,
  preferences TEXT NOT NULL DEFAULT '[]',
  emergency_contacts TEXT NOT NULL DEFAULT '[]',
  onboarded INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  color TEXT NOT NULL,
  plate TEXT NOT NULL,
  seats INTEGER NOT NULL,
  fuel TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 1,
  window_start TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rides (
  id TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL REFERENCES users(id),
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  depart_at TEXT NOT NULL,
  seats_total INTEGER NOT NULL,
  fare_per_seat INTEGER NOT NULL,
  max_detour_km REAL NOT NULL,
  preferences TEXT NOT NULL DEFAULT '[]',
  vehicle_id TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  route TEXT NOT NULL,
  distance_km REAL NOT NULL,
  duration_min INTEGER NOT NULL,
  driver_location TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS rides_depart ON rides(status, depart_at);
CREATE INDEX IF NOT EXISTS rides_driver ON rides(driver_id);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  ride_id TEXT NOT NULL REFERENCES rides(id),
  rider_id TEXT NOT NULL REFERENCES users(id),
  pickup TEXT NOT NULL,
  drop_place TEXT NOT NULL,
  seats INTEGER NOT NULL,
  fare INTEGER NOT NULL,
  status TEXT NOT NULL,
  match_score INTEGER NOT NULL,
  message TEXT,
  payment_method TEXT,
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  payment_ref TEXT,
  paid_at TEXT,
  arrived_at TEXT,
  picked_up_at TEXT,
  dropped_at TEXT,
  cancelled_by TEXT,
  cancel_reason TEXT,
  rider_rating INTEGER,
  driver_rating INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bookings_ride ON bookings(ride_id);
CREATE INDEX IF NOT EXISTS bookings_rider ON bookings(rider_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  sender_id TEXT NOT NULL,
  text TEXT NOT NULL,
  system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_booking ON messages(booking_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, created_at);
`)

// Additive migrations for databases created by earlier versions.
function addColumn(table: string, column: string, type: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}
addColumn('bookings', 'gateway_order_id', 'TEXT')
addColumn('bookings', 'gateway_payment_id', 'TEXT')
addColumn('bookings', 'refund_id', 'TEXT')
// Safety: ride start PIN, live trip sharing, women-only rides, verified student ID.
addColumn('bookings', 'ride_pin', 'TEXT')
addColumn('bookings', 'pin_attempts', 'INTEGER NOT NULL DEFAULT 0')
addColumn('bookings', 'pin_locked_until', 'TEXT')
addColumn('bookings', 'share_token', 'TEXT')
addColumn('bookings', 'rider_location', 'TEXT')
// Trip alerts: driver nearly there, route deviation, 15-minute reminder.
addColumn('bookings', 'near_notified', 'INTEGER NOT NULL DEFAULT 0')
addColumn('bookings', 'off_route_strikes', 'INTEGER NOT NULL DEFAULT 0')
addColumn('bookings', 'off_route_alerted_at', 'TEXT')
addColumn('bookings', 'reminded', 'INTEGER NOT NULL DEFAULT 0')
addColumn('rides', 'reminded', 'INTEGER NOT NULL DEFAULT 0')
addColumn('rides', 'women_only', 'INTEGER NOT NULL DEFAULT 0')
// Fair fares (server/fare.ts): the driver's own mileage, the trip's real cost and each rider's equal share.
addColumn('vehicles', 'mileage_smooth', 'REAL')
addColumn('vehicles', 'mileage_city', 'REAL')
addColumn('vehicles', 'mileage_traffic', 'REAL')
addColumn('rides', 'fare_mode', "TEXT NOT NULL DEFAULT 'fixed'")
addColumn('rides', 'cost_total', 'INTEGER')
addColumn('rides', 'cost_detail', 'TEXT')
addColumn('rides', 'cost_final', 'INTEGER')
addColumn('bookings', 'fare_max', 'INTEGER')
addColumn('bookings', 'share_km', 'REAL')
addColumn('bookings', 'fare_final', 'INTEGER NOT NULL DEFAULT 1')
addColumn('bookings', 'paid_amount', 'INTEGER')
addColumn('bookings', 'order_amount', 'INTEGER')
addColumn('bookings', 'settle_due', 'INTEGER NOT NULL DEFAULT 0')
addColumn('users', 'id_card', 'TEXT')
addColumn('users', 'id_status', "TEXT NOT NULL DEFAULT 'none'")
addColumn('users', 'id_note', 'TEXT')
addColumn('users', 'id_submitted_at', 'TEXT')
addColumn('users', 'id_ocr', 'TEXT')
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS bookings_share ON bookings(share_token)')

// RideSync Wallet: every credit/debit is a row; the balance is their sum (in rupees).
db.exec(`
CREATE TABLE IF NOT EXISTS wallet_tx (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'done',
  note TEXT NOT NULL DEFAULT '',
  booking_id TEXT,
  gateway_order_id TEXT UNIQUE,
  gateway_payment_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS wallet_tx_user ON wallet_tx(user_id, created_at);
`)

export type Row = Record<string, unknown>

export const one = <T = Row>(sql: string, ...params: unknown[]) => db.prepare(sql).get(...(params as never[])) as T | undefined
export const all = <T = Row>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...(params as never[])) as T[]
export const run = (sql: string, ...params: unknown[]) => db.prepare(sql).run(...(params as never[]))

/** Run several statements atomically. */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
