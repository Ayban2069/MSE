# Steff Store — Supabase Version

A static HTML/CSS/JS page that talks to Supabase directly. Login is now
**merged into `index.html`** — one page, no separate URL: it shows a login
screen first, and only loads/reveals the store once your credentials are
verified against the database.

Tabs once logged in:
- **Home** — sales report + profit report (today's/month's profit, margin %, most profitable products)
- **Checkout** — cash-register style: live search by product name or code (filters as you type, no button), tap to add to cart, adjust quantity, enter cash, see change, complete sale
- **Inventory** — product list with search, **Add Product**, **Edit** (including stock), and **Delete**
- **History** — receipts grouped by transaction, with a date filter

The header also shows who's logged in and a **Log Out** button.

## 1. Database

Run **`schema.sql`** (from earlier) in the Supabase SQL Editor — it creates
`products`, `purchase_history`, and `users`, plus the RLS policies below.

### `users` — login accounts

| Column | Type | Notes |
|---|---|---|
| `id` | `int8` | Primary key, identity |
| `username` | `varchar` | Unique |
| `password_hash` | `varchar` | A **bcrypt hash**, never the plain password |
| `full_name` | `varchar` | Shown in the header after login |
| `role` | `varchar` | e.g. `admin`, `cashier` |
| `created_at` | `timestamptz` | Default `now()` |

### Creating your first login

You can create cashier accounts from the registration form on the login
page. Passwords are hashed with bcrypt in the browser before they are sent
to Supabase. Admin accounts should still be created or promoted manually
from the Supabase Table Editor.

### RLS for `users`

Allow `SELECT` and `INSERT` on `users` for the `anon` role. The insert policy
must restrict new rows to `role = 'cashier'`; the registration form never
accepts a role from the user. Do **not** allow `UPDATE`/`DELETE` on `users`
for `anon` — create and edit privileged accounts from the Supabase dashboard
only. Run the latest `schema.sql` to apply these policies.

Note: because the password check happens client-side, the anon key can read
full rows from `users`, including `password_hash`. That's an accepted
trade-off here — bcrypt hashes can't be reversed into the password — but if
you'd rather the hash never leave the database at all, the fix is moving
the check into a Postgres function (RPC). Ask if you'd like that built
instead.

## 2. Run it

Static — just open `index.html`, or serve the folder:
```bash
python3 -m http.server 8000
```

## How login works

1. `index.html` loads with the login screen showing and the app hidden.
2. On submit, it looks up the username in `users`, checks the password
   against `password_hash` with bcrypt, entirely in the browser.
3. On success, a small session (`id`, `username`, `full_name`, `role` —
   never the password or hash) is saved to `sessionStorage`, the login
   screen hides, the app shell shows, and all data loads.
4. **Log Out** clears the session and shows the login screen again.
5. The session is per-browser-tab (`sessionStorage`), so closing the tab
   or browser signs you out; refreshing the page keeps you signed in.
6. On failure, it shows a generic "Invalid username or password" — it
   doesn't reveal whether the username exists.

## How Checkout works

1. Type in the search box — results filter immediately (name or product code).
2. Tap a product card to add it to the cart (blocked if out of stock or over available stock).
3. Adjust quantity with +/− or remove an item.
4. Enter cash — Change updates live; "Complete Sale" enables once cash covers the total.
5. On **Complete Sale**: all cart lines insert into `purchase_history` under one receipt number, each product's `stock_quantity` is reduced, a printable receipt appears, and Home/Inventory/History all refresh.

## How the Profit Report works

`purchase_history` stores `subtotal` (revenue) and `subtotal_cost` (cost)
per line. Home fetches this month's rows and computes, client-side:
- Today's / this month's profit = `sum(subtotal) − sum(subtotal_cost)`
- Margin % = profit ÷ revenue for the month
- Most profitable products = grouped by `product_name`, sorted by profit

## Inventory management

- **+ Add Product** opens a form for all columns and inserts a new row.
- **Edit** on any product opens the same form pre-filled — including stock, handy for restocking without a sale.
- **Delete** removes a product from inventory after confirmation. Existing sales are retained, with their product reference cleared. The initial `schema.sql` setup includes the required permissions and relationship.
- For an existing Supabase database, apply this migration in the SQL Editor (the full schema setup is for initial database creation):

```sql
alter table purchase_history
    drop constraint if exists purchase_history_product_id_fkey;
alter table purchase_history
    add constraint purchase_history_product_id_fkey
    foreign key (product_id) references products(id) on delete set null;

create policy "anon can delete products"
    on products for delete to anon using (true);
```
- A product's name turns red when `stock_quantity <= reorder_level`.

## UI notes (liquid glass redesign)

The liquid-glass redesign changed the front-end look while preserving the existing login and sales flows. Inventory deletion now also uses Supabase directly.

- **Glass theme** — frosted surfaces over a soft mango/pink/sky/lime backdrop. Follows the system light/dark setting. Edit the colour tokens at the top of `css/style.css`.
- **Page transitions** — switching tabs slides the old page out and brings the new one in, in the direction of travel. The tab bar highlight slides between tabs.
- **Cart animation** — tapping a product flies it into a real shopping cart, where it drops into the basket. Removing items pops them out, **Void Sale** tips everything out, **Complete Sale** rolls the full cart away and an empty one rolls in before the receipt prints. The basket shows up to 21 items; the list and total always show everything.
- **Product pictures** — shelves have no photos, so each product gets an emoji matched from its name/category (see `EMOJI_RULES` in `js/app.js` to add your own brands).
- Respects `prefers-reduced-motion` (animations are skipped).
- Fonts load from Google Fonts; offline it falls back to system fonts.
