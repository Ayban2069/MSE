/*
 * STEFF STORE — SUPABASE CONFIGURATION
 *
 * Put your Supabase Project URL and anon/publishable key below.
 * NEVER put the service_role/secret key in frontend code.
 */

const SUPABASE_CONFIG = {
    URL: 'https://wkvkzkmnayqvltpejohn.supabase.co',
    ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indrdmt6a21uYXlxdmx0cGVqb2huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1OTQyMTUsImV4cCI6MjEwMjE3MDIxNX0.5x0nZrkWPBJbgECstLnoAGcxemGw2pQEJKso7k59T60'
};

const TABLES = {
    PRODUCTS: 'products',
    PURCHASE_HISTORY: 'purchase_history',
    USERS: 'users'
};

/*
 * Expected columns — see schema.sql for the full CREATE TABLE statements.
 *
 * products
 *   id (int8, PK), product_code (varchar), product_name (varchar),
 *   category (varchar), price (numeric), stock_quantity (int4),
 *   reorder_level (int4), created_at (timestamptz), cost (numeric)
 *
 * purchase_history — ONE ROW PER ITEM SOLD, grouped by receipt_number
 *   id (int8, PK), receipt_number (varchar), product_id (int8),
 *   product_code (varchar), product_name (varchar), quantity (int4),
 *   unit_price (numeric), unit_cost (numeric), subtotal (numeric),
 *   subtotal_cost (numeric), total_amount (numeric),
 *   cash_received (numeric), change_due (numeric), purchase_date (timestamptz)
 *
 * users — login accounts
 *   id (int8, PK), username (varchar, unique), password_hash (varchar),
 *   full_name (varchar), role (varchar), created_at (timestamptz)
 *   password_hash must be a bcrypt hash — see tools/generate-password-hash.html
 *
 * IMPORTANT — Row Level Security:
 * The app reads/writes these tables directly from the browser using
 * the anon key. Make sure your Supabase RLS policies allow:
 *   - SELECT on products, purchase_history, users
 *   - INSERT on purchase_history
 *   - UPDATE on products (at least stock_quantity)
 *   - INSERT/UPDATE on products (for Add/Edit Product)
 * Do NOT allow INSERT/UPDATE/DELETE on users for anon — create and
 * edit accounts from the Supabase dashboard only. See schema.sql for
 * the exact policies.
 * Anyone with your anon key + open policies can read/write these
 * tables, so this setup is meant for a trusted, single-cashier tool —
 * not a public-facing page.
 */
