/*
 * Steff Store — Supabase front-end logic.
 * Login screen + Home (sales/profit) | Checkout (cashier) | Inventory | History
 * all in one page. The app shell stays hidden until a valid session exists.
 *
 * UI layer (liquid-glass redesign): page transitions, the filling shopping cart,
 * modal motion, number count-ups. The Supabase / login / sale logic is unchanged.
 */

const CURRENCY_SYMBOL = '₱';
const LOW_STOCK_THRESHOLD = 5;
const SESSION_KEY = 'steffStoreSession';

let allProducts = [];   // cached product list — used for Inventory table + Checkout search
let cart = [];          // current sale in progress

const $ = id => document.getElementById(id);
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

document.addEventListener('DOMContentLoaded', () => {
    $('footer-year').textContent = new Date().getFullYear();

    setupTabs();
    setupInventorySearch();
    setupHistoryFilter();
    setupCheckout();
    setupProductModal();
    setupModalBehaviour();
    setupLogin();
    setupLogout();
    setupGlassLight();

    $('cart-count').setAttribute('aria-live', 'polite');

    const session = getSession();
    if (session) {
        enterApp(session, { instant: true });
    } else {
        showLoginScreen();
    }
});

/* ============================================================
   SUPABASE
============================================================ */
function isSupabaseConfigured() {
    return SUPABASE_CONFIG.URL &&
        SUPABASE_CONFIG.ANON_KEY &&
        !SUPABASE_CONFIG.URL.startsWith('YOUR_') &&
        !SUPABASE_CONFIG.ANON_KEY.startsWith('YOUR_');
}

async function supabaseFetch(table, options = {}) {
    if (!isSupabaseConfigured()) {
        throw new Error('Configure SUPABASE_CONFIG.URL and SUPABASE_CONFIG.ANON_KEY in js/config.js first.');
    }

    const method = options.method || 'GET';
    const query = options.query || '';
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);

    const response = await fetch(`${SUPABASE_CONFIG.URL}/rest/v1/${table}${query}`, {
        method,
        headers: {
            'apikey': SUPABASE_CONFIG.ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': options.prefer || (method === 'POST' || method === 'PATCH' ? 'return=representation' : undefined),
            ...(options.headers || {}),
        },
        body,
    });

    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }

    if (!response.ok) {
        const message = data?.message || data?.hint || data?.details || text || `Supabase request failed (HTTP ${response.status})`;
        throw new Error(message);
    }

    return data;
}

/* ============================================================
   LOGIN / SESSION
============================================================ */
function getSession() {
    try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (_) {
        return null;
    }
}

function setupLogin() {
    $('login-form').addEventListener('submit', handleLogin);
    $('register-form').addEventListener('submit', handleRegister);
    $('register-toggle-btn').addEventListener('click', toggleRegisterForm);
}

function setupLogout() {
    $('logout-btn').addEventListener('click', () => {
        sessionStorage.removeItem(SESSION_KEY);
        cart = [];
        clearSprites();
        renderCart();
        showLoginScreen();
    });
}

async function handleLogin(e) {
    e.preventDefault();

    const username = $('login-username').value.trim();
    const password = $('login-password').value;
    const btn = $('login-btn');

    $('login-alert').style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Signing in...';

    try {
        const rows = await supabaseFetch(TABLES.USERS, {
            query: `?select=id,username,password_hash,full_name,role&username=eq.${encodeURIComponent(username)}&limit=1`,
        });

        const user = rows && rows[0];
        const invalidMessage = 'Invalid username or password.';

        if (!user) {
            showLoginError(invalidMessage);
            return;
        }

        const passwordMatches = dcodeIO.bcrypt.compareSync(password, user.password_hash);
        if (!passwordMatches) {
            showLoginError(invalidMessage);
            return;
        }

        const session = {
            id: user.id,
            username: user.username,
            full_name: user.full_name,
            role: user.role,
            logged_in_at: new Date().toISOString(),
        };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));

        $('login-form').reset();
        enterApp(session);
    } catch (err) {
        console.error(err);
        showLoginError(`Could not reach the login database. (${err.message})`);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Log In';
    }
}

async function handleRegister(e) {
    e.preventDefault();

    const fullName = $('register-full-name').value.trim();
    const username = $('register-username').value.trim();
    const password = $('register-password').value;
    const confirmation = $('register-password-confirm').value;
    const btn = $('register-btn');

    $('register-alert').style.display = 'none';
    if (password !== confirmation) {
        showRegisterError('Passwords do not match.');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Creating account...';

    try {
        await supabaseFetch(TABLES.USERS, {
            method: 'POST',
            body: {
                username,
                password_hash: dcodeIO.bcrypt.hashSync(password, 10),
                full_name: fullName,
                role: 'cashier',
            },
        });

        $('register-form').reset();
        toggleRegisterForm();
        showLoginError('Account created. You can now log in.');
    } catch (err) {
        console.error(err);
        const message = err.message.includes('duplicate') || err.message.includes('unique')
            ? 'That username is already taken.'
            : `Could not create the account. (${err.message})`;
        showRegisterError(message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Create Account';
    }
}

function toggleRegisterForm() {
    const loginForm = $('login-form');
    const registerForm = $('register-form');
    const toggleBtn = $('register-toggle-btn');
    const registering = registerForm.style.display === 'none';

    loginForm.style.display = registering ? 'none' : 'block';
    registerForm.style.display = registering ? 'block' : 'none';
    toggleBtn.textContent = registering ? 'Back to login' : 'Create a new account';
    document.querySelector('.login-subtitle').textContent = registering ? 'Create your cashier account' : 'Sign in to continue';
    $('login-alert').style.display = 'none';
    $('register-alert').style.display = 'none';
}

function showRegisterError(message) {
    const alertEl = $('register-alert');
    alertEl.textContent = message;
    alertEl.style.display = 'block';
}

function showLoginError(message) {
    const alertEl = $('login-alert');
    alertEl.textContent = message;
    alertEl.style.display = 'block';
}

function showLoginScreen() {
    const login = $('login-screen');
    $('app-shell').style.display = 'none';
    login.classList.remove('leaving');
    login.style.display = 'flex';

    // replay the card's entrance
    const card = login.querySelector('.login-card');
    card.style.animation = 'none';
    void card.offsetWidth;
    card.style.animation = '';
}

function enterApp(session, { instant = false } = {}) {
    const shell = $('app-shell');
    const login = $('login-screen');
    const name = session.full_name || session.username || '';

    $('session-name').textContent = name || '—';
    $('session-role').textContent = session.role || '—';
    $('session-avatar').textContent = (name.trim()[0] || 'S').toUpperCase();
    $('home-greeting').textContent = greetingFor(name);

    const reveal = () => {
        login.style.display = 'none';
        shell.style.display = 'block';

        // keep each page's own stagger; the top bar drops in on its own
        shell.classList.add('booting');
        setTimeout(() => shell.classList.remove('booting'), 1400);
        const active = document.querySelector('.tab-panel.active');
        if (active && !reduceMotion()) playPanelEnter(active, 1);

        requestAnimationFrame(() => positionTabIndicator(false));
    };

    if (instant || reduceMotion() || login.style.display === 'none') {
        reveal();
    } else {
        login.classList.add('leaving');
        setTimeout(reveal, 380);
    }

    refreshAll();
}

function greetingFor(name) {
    const h = new Date().getHours();
    const part = h < 12 ? 'Maayong buntag' : h < 13 ? 'Maayong udto' : h < 18 ? 'Maayong hapon' : 'Maayong gabii';
    const first = (name || '').trim().split(/\s+/)[0];
    const date = new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' });
    return `${part}${first ? ', ' + first : ''}. ${date}.`;
}

function refreshAll() {
    loadProducts();
    loadHomeReport();
    loadPurchaseHistory();
}

/* ============================================================
   TABS — liquid indicator + directional page transitions
============================================================ */
const PANEL_TARGETS = '.page-head, .section-heading, .glass, .receipt-card, .empty-msg';
let tabSwap = null;

function setupTabs() {
    const tabButtons = [...document.querySelectorAll('.tab-btn')];
    const order = tabButtons.map(b => b.dataset.tab);

    function updateNav(tabId) {
        tabButtons.forEach(btn => {
            const on = btn.dataset.tab === tabId;
            btn.classList.toggle('active', on);
            if (on) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
        });
        document.body.dataset.tab = tabId;
        positionTabIndicator(true);
        try { localStorage.setItem('steffStoreActiveTab', tabId); } catch (_) {}
    }

    function activateTab(tabId, instant) {
        const from = document.querySelector('.tab-panel.active');
        const to = $(tabId);
        if (!to) return;
        if (from === to) { updateNav(tabId); return; }

        updateNav(tabId);

        // finish any swap that is still in flight
        if (tabSwap) { clearTimeout(tabSwap); tabSwap = null; }
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('leaving', 'entering'));

        if (!from || instant || reduceMotion() || $('app-shell').style.display === 'none') {
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p === to));
            return;
        }

        const dir = order.indexOf(tabId) > order.indexOf(from.id) ? 1 : -1;
        stagger(from, dir, 12, 240);
        from.classList.add('leaving');

        tabSwap = setTimeout(() => {
            tabSwap = null;
            from.classList.remove('active', 'leaving');
            to.classList.add('active');
            window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
            playPanelEnter(to, dir);
        }, 230);
    }

    tabButtons.forEach(btn => btn.addEventListener('click', () => activateTab(btn.dataset.tab)));
    window.addEventListener('resize', () => positionTabIndicator(false));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => positionTabIndicator(false));

    try {
        const savedTab = localStorage.getItem('steffStoreActiveTab');
        if (savedTab && $(savedTab)) activateTab(savedTab, true);
    } catch (_) {}
}

/* number each glass surface so they arrive one after another */
function stagger(panel, dir, cap, _total) {
    panel.style.setProperty('--dir', dir);
    let i = 0;
    panel.querySelectorAll(PANEL_TARGETS).forEach(el => {
        el.style.setProperty('--i', Math.min(i++, cap));
    });
}

function playPanelEnter(panel, dir) {
    stagger(panel, dir, 10);
    panel.classList.remove('entering');
    void panel.offsetWidth;
    panel.classList.add('entering');
    clearTimeout(panel._enterTimer);
    panel._enterTimer = setTimeout(() => panel.classList.remove('entering'), 1500);
}

function positionTabIndicator(animate) {
    const ind = $('tab-indicator');
    const active = document.querySelector('.tab-btn.active');
    if (!ind || !active || !active.offsetWidth) return;

    if (!animate) ind.style.transition = 'none';
    ind.style.width = active.offsetWidth + 'px';
    ind.style.transform = `translateX(${active.offsetLeft}px)`;

    if (animate && !reduceMotion()) {
        ind.classList.remove('moving');
        void ind.offsetWidth;
        ind.classList.add('moving');
    } else {
        void ind.offsetWidth;
        ind.style.transition = '';
    }
}

/* a soft highlight that follows the pointer across interactive glass */
function setupGlassLight() {
    document.addEventListener('pointermove', e => {
        const el = e.target.closest && e.target.closest('.glass-lit');
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        el.style.setProperty('--my', (e.clientY - r.top) + 'px');
    }, { passive: true });
}

/* ============================================================
   HELPERS
============================================================ */
function money(n) {
    const num = Number(n) || 0;
    return CURRENCY_SYMBOL + num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return d.toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function dateOnly(date) {
    return date.toISOString().slice(0, 10);
}

function showGlobalAlert(message) {
    const el = $('global-alert');
    el.innerHTML = message;
    el.style.display = 'block';
}

function hideGlobalAlert() {
    $('global-alert').style.display = 'none';
}

function generateReceiptNumber() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `R${y}${m}${d}-${rand}`;
}

/* A picture for every product: a sari-sari shelf has no photos, so we match the name/category. */
const EMOJI_RULES = [
    [/noodle|pancit|lucky me|payless|nissin|ramen|instant/i, '🍜'],
    [/coffee|kopiko|nescafe|great taste|3 ?in ?1/i, '☕'],
    [/milk|birch|bear brand|alaska|nido|dairy/i, '🥛'],
    [/water|wilkins|summit|mineral/i, '💧'],
    [/coke|cola|sprite|royal|pepsi|mountain dew|soda|c2|soft ?drink|beverage/i, '🥤'],
    [/juice|tang|zesto|minute maid/i, '🧃'],
    [/beer|red horse|san mig|pilsen|gin\b|rum\b|tanduay|emperador|liquor|wine/i, '🍺'],
    [/egg|itlog/i, '🥚'],
    [/rice|bigas/i, '🍚'],
    [/bread|pandesal|tinapay|bakery/i, '🍞'],
    [/chocolate|choco|kitkat|snickers|cloud ?9|dutchmill/i, '🍫'],
    [/candy|sweets|lollipop|yema|gum\b|mentos|hany|storck|pastillas/i, '🍬'],
    [/chips|chippy|piattos|nova|oishi|tortillos|pillows|snack|chicharon|cracklings/i, '🍟'],
    [/biscuit|cookie|skyflakes|fita|marie|oreo|cracker|hansel|rebisco/i, '🍪'],
    [/soap|safeguard|palmolive|detergent|surf\b|tide\b|ariel|zonrox|bleach|downy|fabcon|laundry|cleaning/i, '🧼'],
    [/shampoo|conditioner|sunsilk|creamsilk|pantene|lotion|toothpaste|colgate|hapee|toothbrush|personal care/i, '🧴'],
    [/sardines|tuna|corned|canned|ligo|mega\b|555|spam|argentina|can goods/i, '🥫'],
    [/sugar|asukal|salt\b|asin|seasoning|magic sarap|knorr|vetsin|ajinomoto|spice/i, '🧂'],
    [/oil|mantika|vinegar|suka|toyo|soy|patis|catsup|ketchup|sauce|condiment/i, '🍶'],
    [/ice cream|sorbetes|magnolia|selecta|cornetto|frozen/i, '🍦'],
    [/banana|saging|fruit|apple|mansanas|orange|mango|gulay|vegetable|produce/i, '🍌'],
    [/medicine|biogesic|paracetamol|neozep|vitamin|tablet|capsule/i, '💊'],
    [/tissue|napkin|diaper|pad\b|toilet/i, '🧻'],
    [/battery|candle|lighter|matches|bulb/i, '🔋'],
    [/load|prepaid|gcash|sim\b/i, '📱'],
    [/pen\b|paper|notebook|school|ballpen|pad paper|stationery/i, '✏️'],
];

function productEmoji(p) {
    const text = `${p.product_name || ''} ${p.category || ''}`;
    for (const [re, emoji] of EMOJI_RULES) if (re.test(text)) return emoji;
    return '🛍️';
}

/* numbers that count up to their value so a refresh is visible */
function setStat(id, value, format = money) {
    const el = $(id);
    const from = el._value ?? 0;
    el._value = value;
    cancelAnimationFrame(el._raf);

    if (reduceMotion() || from === value) { el.textContent = format(value); return; }

    const start = performance.now();
    const dur = 1000;
    const tick = now => {
        const t = Math.min(1, (now - start) / dur);
        const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
        el.textContent = format(from + (value - from) * eased);
        if (t < 1) el._raf = requestAnimationFrame(tick);
    };
    el._raf = requestAnimationFrame(tick);
}

/* ============================================================
   HOME — SALES + PROFIT REPORT
============================================================ */
async function loadHomeReport() {
    try {
        const products = await supabaseFetch(TABLES.PRODUCTS, {
            query: '?select=id,stock_quantity,reorder_level',
        });

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        const rows = await supabaseFetch(TABLES.PURCHASE_HISTORY, {
            query: `?select=receipt_number,product_name,quantity,subtotal,subtotal_cost,purchase_date&purchase_date=gte.${encodeURIComponent(startOfMonth)}&order=purchase_date.desc`,
        }) || [];

        const todayKey = dateOnly(now);

        let totalToday = 0, totalMonth = 0, profitToday = 0, profitMonth = 0;
        const todayReceipts = new Set();
        const last7Days = {};
        for (let i = 6; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(now.getDate() - i);
            last7Days[dateOnly(d)] = 0;
        }

        const byProduct = {};

        rows.forEach(row => {
            const subtotal = Number(row.subtotal) || 0;
            const subtotalCost = Number(row.subtotal_cost) || 0;
            const date = new Date(row.purchase_date);
            if (isNaN(date)) return;
            const rowDay = dateOnly(date);

            totalMonth += subtotal;
            profitMonth += (subtotal - subtotalCost);

            if (rowDay === todayKey) {
                totalToday += subtotal;
                profitToday += (subtotal - subtotalCost);
                if (row.receipt_number) todayReceipts.add(row.receipt_number);
            }

            if (rowDay in last7Days) last7Days[rowDay] += subtotal;

            const name = row.product_name || 'Unknown';
            if (!byProduct[name]) byProduct[name] = { qty: 0, revenue: 0, cost: 0 };
            byProduct[name].qty += Number(row.quantity) || 0;
            byProduct[name].revenue += subtotal;
            byProduct[name].cost += subtotalCost;
        });

        const lowStockCount = (products || []).filter(p => {
            const qty = Number(p.stock_quantity) || 0;
            const reorder = p.reorder_level ?? LOW_STOCK_THRESHOLD;
            return qty <= Number(reorder);
        }).length;

        const whole = v => Math.round(v).toLocaleString('en-PH');
        setStat('stat-today-sales', totalToday);
        setStat('stat-today-transactions', todayReceipts.size, whole);
        setStat('stat-month-sales', totalMonth);
        setStat('stat-total-products', products?.length || 0, whole);
        setStat('stat-low-stock', lowStockCount, whole);
        $('stat-low-stock-card').classList.toggle('stat-warning', lowStockCount > 0);

        setStat('stat-today-profit', profitToday);
        setStat('stat-month-profit', profitMonth);
        const margin = totalMonth > 0 ? (profitMonth / totalMonth) * 100 : 0;
        setStat('stat-month-margin', margin, v => v.toFixed(1) + '%');

        renderBarChart(last7Days, todayKey);

        const topByQty = Object.entries(byProduct)
            .map(([name, v]) => ({ product_name: name, ...v }))
            .sort((a, b) => b.qty - a.qty)
            .slice(0, 5);
        renderTopProducts(topByQty);

        const topByProfit = Object.entries(byProduct)
            .map(([name, v]) => ({ product_name: name, profit: v.revenue - v.cost, ...v }))
            .sort((a, b) => b.profit - a.profit)
            .slice(0, 5);
        renderProfitTable(topByProfit);

        hideGlobalAlert();
    } catch (err) {
        console.error(err);
        showGlobalAlert(
            `<strong>Could not load the sales/profit report.</strong> Check your Supabase configuration and table permissions.
             <div class="alert-detail">${escapeHtml(err.message)}</div>`
        );
        $('bar-chart').innerHTML = '<p class="empty-msg">No data available.</p>';
        $('top-products-wrap').innerHTML = '<p class="empty-msg">No data available.</p>';
        $('profit-table-wrap').innerHTML = '<p class="empty-msg">No data available.</p>';
    }
}

function renderBarChart(days, todayKey) {
    const maxTotal = Math.max(1, ...Object.values(days));
    const chartEl = $('bar-chart');
    chartEl.innerHTML = '';

    Object.entries(days).forEach(([dateStr, total], i) => {
        const pct = Math.max(4, Math.round((total / maxTotal) * 100));
        const label = new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
        const col = document.createElement('div');
        col.className = 'bar-col' + (dateStr === todayKey ? ' today' : '');
        col.style.setProperty('--i', i);
        col.innerHTML = `
            <div class="bar-track"><div class="bar" style="height:${pct}%" data-val="${escapeHtml(money(total))}"></div></div>
            <span class="bar-label">${label}</span>
        `;
        chartEl.appendChild(col);
    });
}

function renderTopProducts(topProducts) {
    const wrap = $('top-products-wrap');
    if (!topProducts.length) {
        wrap.innerHTML = '<p class="empty-msg">No sales data yet this month.</p>';
        return;
    }
    const rows = topProducts.map(p => `
        <tr>
            <td><div class="product-cell"><span class="emoji-chip">${productEmoji(p)}</span>${escapeHtml(p.product_name)}</div></td>
            <td>${p.qty}</td><td>${money(p.revenue)}</td>
        </tr>
    `).join('');
    wrap.innerHTML = `
        <div class="table-wrap">
        <table class="mini-table">
            <thead><tr><th>Product</th><th>Qty Sold</th><th>Revenue</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        </div>
    `;
}

function renderProfitTable(topByProfit) {
    const wrap = $('profit-table-wrap');
    if (!topByProfit.length) {
        wrap.innerHTML = '<p class="empty-msg">No sales data yet this month.</p>';
        return;
    }
    const rows = topByProfit.map(p => `
        <tr>
            <td><div class="product-cell"><span class="emoji-chip">${productEmoji(p)}</span>${escapeHtml(p.product_name)}</div></td>
            <td>${p.qty}</td>
            <td>${money(p.revenue)}</td>
            <td>${money(p.cost)}</td>
            <td><strong>${money(p.profit)}</strong></td>
        </tr>
    `).join('');
    wrap.innerHTML = `
        <div class="table-wrap">
        <table class="mini-table">
            <thead><tr><th>Product</th><th>Qty Sold</th><th>Revenue</th><th>Cost</th><th>Profit</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        </div>
    `;
}

/* ============================================================
   MODALS — shared open/close motion
============================================================ */
let lastFocus = null;

function openModal(backdrop, focusEl) {
    lastFocus = document.activeElement;
    clearTimeout(backdrop._closeTimer);
    backdrop.style.display = 'flex';
    backdrop.classList.remove('open');
    void backdrop.offsetWidth;
    requestAnimationFrame(() => backdrop.classList.add('open'));
    setTimeout(() => { if (focusEl) focusEl.focus(); }, 80);
}

function closeModal(backdrop) {
    backdrop.classList.remove('open');
    backdrop._closeTimer = setTimeout(() => {
        if (!backdrop.classList.contains('open')) backdrop.style.display = 'none';
    }, reduceMotion() ? 0 : 340);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
}

function setupModalBehaviour() {
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        const open = [...document.querySelectorAll('.modal-backdrop.open')].pop();
        if (!open) return;
        if (open.id === 'receipt-modal-backdrop') closeReceiptModal(); else closeProductModal();
    });
    ['product-modal-backdrop', 'receipt-modal-backdrop'].forEach(id => {
        $(id).addEventListener('mousedown', e => {
            if (e.target !== e.currentTarget) return;
            if (id === 'receipt-modal-backdrop') closeReceiptModal(); else closeProductModal();
        });
    });
}

/* ============================================================
   INVENTORY — PRODUCTS (list, search, add, edit)
============================================================ */
async function loadProducts() {
    try {
        allProducts = await supabaseFetch(TABLES.PRODUCTS, { query: '?select=*&order=product_name.asc' }) || [];
        renderProducts(allProducts);
        renderCheckoutProducts(allProducts);
    } catch (err) {
        console.error(err);
        $('inventory-table-wrap').innerHTML = `
            <div class="alert alert-error">
                <strong>Could not load products.</strong> Check your Supabase table permissions and configuration.
                <div class="alert-detail">${escapeHtml(err.message)}</div>
            </div>
        `;
        $('checkout-product-grid').innerHTML = '<p class="empty-msg">Could not load products.</p>';
    }
}

function renderProducts(products) {
    const wrap = $('inventory-table-wrap');
    if (!products.length) {
        wrap.innerHTML = '<p class="empty-msg">No products found.</p>';
        return;
    }

    const rows = products.map(p => {
        const qty = Number(p.stock_quantity) || 0;
        const reorder = p.reorder_level ?? LOW_STOCK_THRESHOLD;
        const needsReorder = qty <= Number(reorder);
        let badge = '<span class="badge badge-ok">In Stock</span>';
        if (qty <= 0) badge = '<span class="badge badge-danger">Out of Stock</span>';
        else if (needsReorder) badge = '<span class="badge badge-warning">Low Stock</span>';

        return `
            <tr>
                <td>${escapeHtml(p.product_code || '—')}</td>
                <td class="${needsReorder ? 'product-name-alert' : ''}"><div class="product-cell"><span class="emoji-chip">${productEmoji(p)}</span>${escapeHtml(p.product_name)}</div></td>
                <td>${escapeHtml(p.category || '—')}</td>
                <td>${money(p.price)}</td>
                <td>${money(p.cost)}</td>
                <td>${qty}</td>
                <td>${badge}</td>
                <td class="inv-actions">
                    <button type="button" class="link-btn" data-action="edit" data-id="${p.id}">Edit</button>
                </td>
            </tr>
        `;
    }).join('');

    wrap.innerHTML = `
        <div class="glass table-wrap">
            <div class="scroll-x">
            <table class="data-table">
                <thead>
                    <tr><th>Code</th><th>Product</th><th>Category</th><th>Price</th><th>Cost</th><th>Stock</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            </div>
        </div>
    `;

    wrap.querySelectorAll('button[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const product = allProducts.find(p => String(p.id) === btn.dataset.id);
            if (product) openProductModal('edit', product);
        });
    });
}

function setupInventorySearch() {
    const form = $('inventory-search-form');
    const input = $('inventory-search');
    const clearLink = $('inventory-clear');

    form.addEventListener('submit', e => {
        e.preventDefault();
        const term = input.value.trim().toLowerCase();
        clearLink.style.display = term ? 'inline' : 'none';
        if (!term) { renderProducts(allProducts); return; }
        const filtered = allProducts.filter(p =>
            (p.product_name || '').toLowerCase().includes(term) ||
            (p.product_code || '').toLowerCase().includes(term) ||
            (p.category || '').toLowerCase().includes(term)
        );
        renderProducts(filtered);
    });

    clearLink.addEventListener('click', e => {
        e.preventDefault();
        input.value = '';
        clearLink.style.display = 'none';
        renderProducts(allProducts);
    });
}

/* ---------- Add / Edit product modal ---------- */
function setupProductModal() {
    $('add-product-btn').addEventListener('click', () => openProductModal('add'));
    $('product-cancel-btn').addEventListener('click', closeProductModal);
    $('product-form').addEventListener('submit', handleProductFormSubmit);
}

function openProductModal(mode, product) {
    $('product-modal-title').textContent = mode === 'edit' ? 'Edit Product' : 'Add Product';
    $('product-form-alert').style.display = 'none';
    $('product-id').value = mode === 'edit' ? product.id : '';
    $('field-product_code').value = mode === 'edit' ? (product.product_code || '') : '';
    $('field-product_name').value = mode === 'edit' ? (product.product_name || '') : '';
    $('field-category').value = mode === 'edit' ? (product.category || '') : '';
    $('field-price').value = mode === 'edit' ? product.price : '';
    $('field-cost').value = mode === 'edit' ? product.cost : '';
    $('field-stock_quantity').value = mode === 'edit' ? product.stock_quantity : '';
    $('field-reorder_level').value = mode === 'edit' ? (product.reorder_level ?? '') : '';
    openModal($('product-modal-backdrop'), $('field-product_code'));
}

function closeProductModal() {
    closeModal($('product-modal-backdrop'));
}

async function handleProductFormSubmit(e) {
    e.preventDefault();
    const id = $('product-id').value;
    const alertEl = $('product-form-alert');
    const saveBtn = $('product-save-btn');

    const payload = {
        product_code: $('field-product_code').value.trim(),
        product_name: $('field-product_name').value.trim(),
        category: $('field-category').value.trim() || null,
        price: parseFloat($('field-price').value) || 0,
        cost: parseFloat($('field-cost').value) || 0,
        stock_quantity: parseInt($('field-stock_quantity').value, 10) || 0,
        reorder_level: $('field-reorder_level').value === ''
            ? null
            : parseInt($('field-reorder_level').value, 10),
    };

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    alertEl.style.display = 'none';

    try {
        if (id) {
            await supabaseFetch(TABLES.PRODUCTS, { method: 'PATCH', query: `?id=eq.${id}`, body: payload });
        } else {
            await supabaseFetch(TABLES.PRODUCTS, { method: 'POST', body: payload });
        }
        closeProductModal();
        loadProducts();
        loadHomeReport();
    } catch (err) {
        console.error(err);
        alertEl.textContent = err.message;
        alertEl.style.display = 'block';
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Product';
    }
}

/* ============================================================
   CHECKOUT — cash register
============================================================ */
function setupCheckout() {
    $('checkout-search').addEventListener('input', e => {
        const term = e.target.value.trim().toLowerCase();
        const filtered = term
            ? allProducts.filter(p =>
                (p.product_name || '').toLowerCase().includes(term) ||
                (p.product_code || '').toLowerCase().includes(term))
            : allProducts;
        renderCheckoutProducts(filtered);
    });

    // one listener for the whole grid, so re-rendering while typing stays cheap
    $('checkout-product-grid').addEventListener('click', e => {
        const card = e.target.closest('.pos-product-card');
        if (!card || card.disabled) return;
        const product = allProducts.find(p => String(p.id) === card.dataset.id);
        if (product) addToCart(product, card.querySelector('.pos-product-emoji'), card);
    });

    $('cash-received').addEventListener('input', updateCartTotals);
    $('checkout-btn').addEventListener('click', completeSale);
    $('void-btn').addEventListener('click', voidSale);
    $('receipt-close-btn').addEventListener('click', closeReceiptModal);
    $('receipt-print-btn').addEventListener('click', () => window.print());
    // the floating cart button only shows while the real cart is out of view
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(([entry]) => {
            document.body.classList.toggle('cart-in-view', entry.intersectionRatio > 0.35);
        }, { threshold: [0, 0.35, 1] }).observe($('pos-cart'));
    }
    $('cart-fab').addEventListener('click', () => {
        $('pos-cart').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
    });
}

function renderCheckoutProducts(products) {
    const grid = $('checkout-product-grid');
    if (!products.length) {
        grid.innerHTML = '<p class="empty-msg">No matching products.</p>';
        return;
    }

    grid.innerHTML = products.map(p => {
        const stock = Number(p.stock_quantity) || 0;
        const outOfStock = stock <= 0;
        const low = !outOfStock && stock <= Number(p.reorder_level ?? LOW_STOCK_THRESHOLD);
        return `
            <button type="button" class="pos-product-card glass glass-lit ${outOfStock ? 'out-of-stock' : ''} ${low ? 'low' : ''}"
                    data-id="${p.id}" ${outOfStock ? 'disabled' : ''}>
                <span class="pos-product-emoji" aria-hidden="true">${productEmoji(p)}</span>
                <span class="pos-product-code">${escapeHtml(p.product_code || '')}</span>
                <span class="pos-product-name">${escapeHtml(p.product_name)}</span>
                <span class="pos-product-price">${money(p.price)}</span>
                <span class="pos-product-stock">${outOfStock ? 'Out of stock' : stock + ' in stock'}</span>
            </button>
        `;
    }).join('');
}

function cartUnits() {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
}

function addToCart(product, sourceEl, cardEl) {
    const stock = Number(product.stock_quantity) || 0;
    const existing = cart.find(item => item.product_id === product.id);
    const emoji = productEmoji(product);

    if (existing) {
        if (existing.quantity >= stock) {
            showCheckoutAlert(`Only ${stock} in stock for "${product.product_name}".`);
            return;
        }
        existing.quantity += 1;
    } else {
        if (stock <= 0) return;
        cart.push({
            product_id: product.id,
            product_code: product.product_code,
            product_name: product.product_name,
            price: Number(product.price) || 0,
            cost: Number(product.cost) || 0,
            quantity: 1,
            stock,
            emoji,
        });
    }

    if (cardEl) {
        cardEl.classList.remove('pressed');
        void cardEl.offsetWidth;
        cardEl.classList.add('pressed');
    }

    renderCart();
    flyToCart(sourceEl, emoji, product.id);
}

function changeQty(productId, delta, sourceEl) {
    const item = cart.find(i => i.product_id === productId);
    if (!item) return;
    const newQty = item.quantity + delta;

    if (newQty <= 0) {
        removeFromCart(productId);
        return;
    }
    if (newQty > item.stock) {
        showCheckoutAlert(`Only ${item.stock} in stock for "${item.product_name}".`);
        return;
    }

    item.quantity = newQty;
    renderCart();
    if (delta > 0) flyToCart(sourceEl, item.emoji, productId);
    else { removeSprite(productId); fillMissingSprites(); }
}

function removeFromCart(productId) {
    const row = document.querySelector(`.cart-item[data-id="${productId}"]`);
    const finish = () => {
        cart = cart.filter(i => i.product_id !== productId);
        removeSprites(productId);
        renderCart();
    };
    if (row && !reduceMotion()) {
        row.classList.add('leaving');
        setTimeout(finish, 230);
    } else {
        finish();
    }
}

function renderCart() {
    const wrap = $('cart-items');
    hideCheckoutAlert();

    const focused = document.activeElement;
    const refocus = focused && wrap.contains(focused) ? { action: focused.dataset.action, id: focused.dataset.id } : null;

    const prev = renderCart.prev || (renderCart.prev = new Map());

    if (!cart.length) {
        wrap.innerHTML = '<p class="empty-msg">Cart is empty. Search and tap a product to add it.</p>';
    } else {
        wrap.innerHTML = cart.map(item => {
            const isNew = !prev.has(item.product_id);
            const changed = !isNew && prev.get(item.product_id) !== item.quantity;
            return `
            <div class="cart-item ${isNew ? 'enter' : ''}" data-id="${item.product_id}">
                <div class="cart-item-main">
                    <span class="emoji-chip" aria-hidden="true">${item.emoji || '🛍️'}</span>
                    <div class="cart-item-info">
                        <div class="cart-item-name">${escapeHtml(item.product_name)}</div>
                        <div class="cart-item-price">${money(item.price)} each</div>
                    </div>
                </div>
                <div class="cart-item-controls">
                    <button class="qty-btn" data-action="dec" data-id="${item.product_id}" aria-label="Remove one ${escapeHtml(item.product_name)}">−</button>
                    <span class="cart-item-qty ${changed ? 'pop' : ''}">${item.quantity}</span>
                    <button class="qty-btn" data-action="inc" data-id="${item.product_id}" aria-label="Add one ${escapeHtml(item.product_name)}">+</button>
                    <button class="cart-item-remove" data-action="remove" data-id="${item.product_id}" aria-label="Remove ${escapeHtml(item.product_name)} from the sale">✕</button>
                </div>
            </div>`;
        }).join('');

        wrap.querySelectorAll('button[data-action]').forEach(btn => {
            const id = Number(btn.dataset.id);
            btn.addEventListener('click', () => {
                if (btn.dataset.action === 'inc') changeQty(id, 1, btn);
                if (btn.dataset.action === 'dec') changeQty(id, -1, btn);
                if (btn.dataset.action === 'remove') removeFromCart(id);
            });
        });

        // keep keyboard focus on the same control after the list redraws
        if (refocus) {
            const again = wrap.querySelector(`button[data-action="${refocus.action}"][data-id="${refocus.id}"]`);
            if (again) again.focus({ preventScroll: true });
        }

        // bring a freshly added row into view
        // (scroll the list itself — scrollIntoView would also scroll the page)
        if (wrap.querySelector('.cart-item.enter')) {
            wrap.scrollTo({ top: wrap.scrollHeight, behavior: reduceMotion() ? 'auto' : 'smooth' });
        }
    }

    renderCart.prev = new Map(cart.map(i => [i.product_id, i.quantity]));

    const units = cartUnits();
    const countText = units === 1 ? '1 item' : `${units} items`;
    const countEl = $('cart-count');
    if (countEl.textContent !== countText) popEl(countEl);
    countEl.textContent = countText;
    $('cart-fab-count').textContent = units;

    updateCartTotals();
}

function popEl(el) {
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
}

function cartTotal() {
    return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function updateCartTotals() {
    const total = cartTotal();
    const cash = parseFloat($('cash-received').value) || 0;
    const change = cash - total;

    const totalEl = $('cart-total');
    const text = money(total);
    if (totalEl.textContent !== text) popEl(totalEl);
    totalEl.textContent = text;
    $('cart-change').textContent = money(Math.max(0, change));

    $('checkout-btn').disabled = !(cart.length > 0 && cash >= total && total > 0);
}

function showCheckoutAlert(message) {
    const el = $('checkout-alert');
    el.textContent = message;
    el.style.display = 'block';
}

function hideCheckoutAlert() {
    $('checkout-alert').style.display = 'none';
}

function voidSale() {
    if (cart.length && !reduceMotion()) tumbleSprites();
    else clearSprites();
    cart = [];
    $('cash-received').value = '';
    renderCart();
}

async function completeSale() {
    const total = cartTotal();
    const cash = parseFloat($('cash-received').value) || 0;
    if (!cart.length || cash < total) return;

    const checkoutBtn = $('checkout-btn');
    checkoutBtn.disabled = true;
    checkoutBtn.textContent = 'Processing...';

    const receiptNumber = generateReceiptNumber();
    const purchaseDate = new Date().toISOString();
    const changeDue = cash - total;

    const lineItems = cart.map(item => ({
        receipt_number: receiptNumber,
        product_id: item.product_id,
        product_code: item.product_code,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: item.price,
        unit_cost: item.cost,
        subtotal: item.price * item.quantity,
        subtotal_cost: item.cost * item.quantity,
        total_amount: total,
        cash_received: cash,
        change_due: changeDue,
        purchase_date: purchaseDate,
    }));

    try {
        await supabaseFetch(TABLES.PURCHASE_HISTORY, { method: 'POST', body: lineItems });

        await Promise.all(cart.map(item => {
            const newQty = Math.max(0, item.stock - item.quantity);
            return supabaseFetch(TABLES.PRODUCTS, {
                method: 'PATCH',
                query: `?id=eq.${item.product_id}`,
                body: { stock_quantity: newQty },
            });
        }));

        const receipt = {
            receipt_no: receiptNumber,
            purchase_date: purchaseDate,
            items: lineItems,
            total_amount: total,
            cash_received: cash,
            change_due: changeDue,
        };

        // the full cart rolls away, then the receipt prints
        const departing = driveAwayCart();
        cart = [];
        $('cash-received').value = '';
        renderCart();
        await departing;
        showReceiptModal(receipt);

        refreshAll();
    } catch (err) {
        console.error(err);
        showCheckoutAlert(`Could not complete the sale: ${err.message}`);
    } finally {
        checkoutBtn.disabled = !(cart.length > 0);
        checkoutBtn.textContent = 'Complete Sale';
    }
}

function showReceiptModal(receipt) {
    const itemRows = receipt.items.map(item => `
        <div class="r-row"><span>${escapeHtml(item.product_name)} x${item.quantity}</span><span>${money(item.subtotal)}</span></div>
    `).join('');

    $('receipt-modal-content').innerHTML = `
        <div class="printable-receipt">
            <div class="r-center r-brand">STEFF STORE</div>
            <div class="r-center">${formatDate(receipt.purchase_date)}</div>
            <div class="r-center">Receipt #${escapeHtml(receipt.receipt_no)}</div>
            <hr>
            ${itemRows}
            <hr>
            <div class="r-row r-total"><strong>Total</strong><strong>${money(receipt.total_amount)}</strong></div>
            <div class="r-row"><span>Cash</span><span>${money(receipt.cash_received)}</span></div>
            <div class="r-row"><span>Change</span><span>${money(receipt.change_due)}</span></div>
            <hr>
            <div class="r-center">Thank you, salamat sa pagpalit!</div>
        </div>
    `;
    openModal($('receipt-modal-backdrop'), $('receipt-close-btn'));
}

function closeReceiptModal() {
    closeModal($('receipt-modal-backdrop'));
}

/* ============================================================
   THE CART — items you tap fly in and settle in the basket
============================================================ */
// resting places inside the basket (240×170 drawing space), bottom row first
const CART_SLOTS = [
    [84, 88], [108, 88], [132, 88], [156, 88], [180, 88],
    [96, 68], [120, 68], [144, 68], [168, 68],
    [84, 49], [108, 49], [132, 49], [156, 49], [180, 49],
    [96, 31], [120, 31], [144, 31], [168, 31],
    [108, 14], [132, 14], [156, 14],
];

const cartSprites = [];   // [{ el, pid }] — one per unit shown in the basket
let pendingFlights = 0;   // items still in the air, so two quick taps don't aim at the same spot

function slotPos(i) {
    const [x, y] = CART_SLOTS[Math.min(i, CART_SLOTS.length - 1)];
    const a = Math.abs(Math.sin((i + 1) * 12.9898) * 43758.5453) % 1;
    const b = Math.abs(Math.sin((i + 1) * 78.233) * 12345.6789) % 1;
    return { x: x + (a - .5) * 6, y: y + (b - .5) * 4, r: (a - .5) * 36 };
}

function layoutSprites() {
    cartSprites.forEach((s, i) => {
        const p = slotPos(i);
        s.el.style.left = p.x + 'px';
        s.el.style.top = p.y + 'px';
        s.el.style.setProperty('--r', p.r + 'deg');
        s.el.style.zIndex = i;
    });
}

function addSprite(pid, emoji) {
    if (cartSprites.length >= CART_SLOTS.length) return null;
    const el = document.createElement('span');
    el.className = 'cart-sprite';
    el.textContent = emoji;
    el.style.transition = 'none';
    $('cart-contents').appendChild(el);
    cartSprites.push({ el, pid });
    layoutSprites();
    void el.offsetWidth;
    el.style.transition = '';
    return { el, index: cartSprites.length - 1 };
}

function bumpCart() {
    const rig = $('cart-rig');
    rig.classList.remove('bump');
    void rig.offsetWidth;
    rig.classList.add('bump');
    const fab = $('cart-fab');
    fab.classList.remove('bump');
    void fab.offsetWidth;
    fab.classList.add('bump');
}

function flyToCart(sourceEl, emoji, pid) {
    const stage = $('cart-stage');
    const contents = $('cart-contents');
    const slotIndex = cartSprites.length + pendingFlights;

    const settle = (drop) => {
        const added = addSprite(pid, emoji);
        if (added && drop) {
            const p = slotPos(added.index);
            const rise = p.y + 12;
            const dur = 620;
            added.el.animate([
                { translate: `0 ${-rise}px`, opacity: .9, easing: 'cubic-bezier(.5,0,1,.55)' },
                { translate: '0 0',     opacity: 1, offset: .52, easing: 'ease-out' },
                { translate: '0 -9px',  offset: .7,  easing: 'ease-in' },
                { translate: '0 0',     offset: .86, easing: 'ease-out' },
                { translate: '0 -2px',  offset: .94, easing: 'ease-in' },
                { translate: '0 0' },
            ], { duration: dur });
            setTimeout(bumpCart, dur * .5);
        } else {
            bumpCart();
        }
    };

    const stageRect = stage.getBoundingClientRect();
    const stageVisible = stageRect.width > 0 && stageRect.bottom > 70 && stageRect.top < window.innerHeight - 30;
    const fab = $('cart-fab');
    const fabVisible = fab.offsetParent !== null;

    if (reduceMotion() || !sourceEl || (!stageVisible && !fabVisible)) { settle(false); return; }

    const s = sourceEl.getBoundingClientRect();
    const sx = s.left + s.width / 2, sy = s.top + s.height / 2;
    let tx, ty, endScale;

    if (stageVisible) {
        const c = contents.getBoundingClientRect();
        const k = c.width / 240;  // the cart is drawn at 240px and scaled up on screen
        const p = slotPos(slotIndex);
        tx = c.left + p.x * k;
        ty = c.top - 4 * k;      // just above the rim — the drop finishes inside the basket
        endScale = (25 / 32) * k;
    } else {
        const f = fab.getBoundingClientRect();
        tx = f.left + f.width / 2;
        ty = f.top + f.height / 2;
        endScale = .45;
    }

    const flyer = document.createElement('span');
    flyer.className = 'cart-flyer';
    flyer.textContent = emoji;
    document.body.appendChild(flyer);

    const cx = (sx + tx) / 2;
    const cy = Math.min(sy, ty) - 150;
    const spin = (Math.random() < .5 ? -1 : 1) * (180 + Math.random() * 140);
    const frames = [];
    const N = 28;
    for (let i = 0; i <= N; i++) {
        const t = i / N, u = 1 - t;
        const x = u * u * sx + 2 * u * t * cx + t * t * tx;
        const y = u * u * sy + 2 * u * t * cy + t * t * ty;
        const sc = 1.25 + (endScale - 1.25) * t;
        frames.push({ transform: `translate(${x}px, ${y}px) scale(${sc}) rotate(${spin * t}deg)`, offset: t });
    }

    pendingFlights++;
    const anim = flyer.animate(frames, { duration: 600, easing: 'cubic-bezier(.45,.05,.55,.95)', fill: 'forwards' });
    anim.onfinish = () => {
        pendingFlights = Math.max(0, pendingFlights - 1);
        flyer.remove();
        settle(stageVisible);
    };
    anim.oncancel = () => { pendingFlights = Math.max(0, pendingFlights - 1); flyer.remove(); };
}

function popOutSprite(s, extra = {}) {
    const anim = s.el.animate([
        { translate: '0 0', scale: 1, opacity: 1 },
        { translate: `${extra.dx || 0}px ${extra.dy ?? -26}px`, scale: .2, opacity: 0 },
    ], { duration: extra.duration || 280, easing: 'ease-in', delay: extra.delay || 0, fill: 'forwards' });
    anim.onfinish = () => s.el.remove();
}

function removeSprite(pid) {
    for (let i = cartSprites.length - 1; i >= 0; i--) {
        if (cartSprites[i].pid === pid) {
            const [s] = cartSprites.splice(i, 1);
            if (reduceMotion()) s.el.remove(); else popOutSprite(s);
            layoutSprites();
            return;
        }
    }
}

function removeSprites(pid) {
    for (let i = cartSprites.length - 1; i >= 0; i--) {
        if (cartSprites[i].pid === pid) {
            const [s] = cartSprites.splice(i, 1);
            if (reduceMotion()) s.el.remove(); else popOutSprite(s, { dx: (Math.random() - .5) * 40 });
        }
    }
    layoutSprites();
    fillMissingSprites();
}

/* if more units are in the cart than fit in the basket, refill as space opens up */
function fillMissingSprites() {
    if (pendingFlights > 0) return;
    cart.forEach(item => {
        let shown = cartSprites.filter(s => s.pid === item.product_id).length;
        while (shown < item.quantity && cartSprites.length < CART_SLOTS.length) {
            const added = addSprite(item.product_id, item.emoji);
            if (!added) break;
            if (!reduceMotion()) added.el.animate([{ scale: 0 }, { scale: 1 }], { duration: 380, easing: 'cubic-bezier(.3,1.5,.5,1)' });
            shown++;
        }
    });
}

function clearSprites() {
    cartSprites.splice(0).forEach(s => s.el.remove());
}

/* Void: everything tumbles out of the basket */
function tumbleSprites() {
    const rig = $('cart-rig');
    rig.classList.remove('shake');
    void rig.offsetWidth;
    rig.classList.add('shake');

    cartSprites.splice(0).forEach((s, i) => {
        const dx = (Math.random() - .5) * 120;
        const turn = (Math.random() - .5) * 540;
        const anim = s.el.animate([
            { translate: '0 0', rotate: 'var(--r)', opacity: 1 },
            { translate: `${dx}px 150px`, rotate: `${turn}deg`, opacity: 0 },
        ], { duration: 650, delay: i * 18, easing: 'cubic-bezier(.5,0,1,.6)', fill: 'forwards' });
        anim.onfinish = () => s.el.remove();
    });
}

/* Complete sale: the cart rolls off with its goods and an empty one rolls back in */
async function driveAwayCart() {
    if (reduceMotion()) { clearSprites(); return; }

    const rig = $('cart-rig');
    rig.classList.add('rolling');

    const out = rig.animate([
        { translate: '0 0', opacity: 1 },
        { translate: '-8px 0', opacity: 1, offset: .14 },
        { translate: '420px 0', opacity: 0 },
    ], { duration: 760, easing: 'cubic-bezier(.55,0,.9,.55)', fill: 'forwards' });

    await out.finished.catch(() => {});

    clearSprites();
    out.cancel();

    const back = rig.animate([
        { translate: '-420px 0', opacity: 0 },
        { translate: '0 0', opacity: 1 },
    ], { duration: 900, easing: 'cubic-bezier(.15,.85,.3,1)' });
    await back.finished.catch(() => {});

    rig.classList.remove('rolling');
}

/* ============================================================
   HISTORY — PURCHASE RECEIPTS (grouped by receipt_number)
============================================================ */
async function loadPurchaseHistory(dateFilter) {
    const wrap = $('receipt-list-wrap');
    wrap.innerHTML = '<p class="empty-msg">Loading receipts...</p>';

    try {
        let query = '?select=*&order=purchase_date.desc';

        if (dateFilter) {
            const start = `${dateFilter}T00:00:00`;
            const endDate = new Date(`${dateFilter}T00:00:00`);
            endDate.setDate(endDate.getDate() + 1);
            const end = endDate.toISOString();
            query = `?select=*&purchase_date=gte.${encodeURIComponent(start)}&purchase_date=lt.${encodeURIComponent(end)}&order=purchase_date.desc`;
        }

        const rows = await supabaseFetch(TABLES.PURCHASE_HISTORY, { query }) || [];
        renderReceipts(groupReceipts(rows), !!dateFilter);
    } catch (err) {
        console.error(err);
        wrap.innerHTML = `
            <div class="alert alert-error">
                <strong>Could not load purchase history.</strong> Check your Supabase table permissions and configuration.
                <div class="alert-detail">${escapeHtml(err.message)}</div>
            </div>
        `;
    }
}

function groupReceipts(rows) {
    const receipts = {};
    rows.forEach(row => {
        const rid = row.receipt_number || ('#' + row.id);
        if (!receipts[rid]) {
            receipts[rid] = { receipt_no: rid, purchase_date: row.purchase_date, items: [], total: Number(row.total_amount) || 0 };
        }
        receipts[rid].items.push(row);
    });
    return receipts;
}

function renderReceipts(receipts, animate) {
    const wrap = $('receipt-list-wrap');
    const entries = Object.values(receipts);

    if (!entries.length) {
        wrap.innerHTML = '<p class="empty-msg">No receipts found.</p>';
        return;
    }

    entries.sort((a, b) => new Date(b.purchase_date) - new Date(a.purchase_date));

    const cards = entries.map((receipt, i) => {
        const itemRows = receipt.items.map(item => `
            <tr>
                <td>${escapeHtml(item.product_name)}</td>
                <td>${item.quantity}</td>
                <td>${money(item.unit_price)}</td>
                <td>${money(item.subtotal)}</td>
            </tr>
        `).join('');

        return `
            <div class="receipt-card glass glass-lit" style="--i:${Math.min(i, 10)}">
                <div class="receipt-head">
                    <span class="receipt-no">Receipt ${escapeHtml(receipt.receipt_no)}</span>
                    <span class="receipt-date">${formatDate(receipt.purchase_date)}</span>
                </div>
                <table class="mini-table">
                    <thead><tr><th>Item</th><th>Qty</th><th>Unit Price</th><th>Subtotal</th></tr></thead>
                    <tbody>${itemRows}</tbody>
                </table>
                <div class="receipt-total">${money(receipt.total)}</div>
            </div>
        `;
    }).join('');

    wrap.innerHTML = `<div class="receipt-list${animate ? ' entering' : ''}">${cards}</div>`;
    // a date filter is a user action: let the new cards arrive like a page does
    const list = wrap.firstElementChild;
    if (animate && list) {
        list.style.setProperty('--dir', 1);
        setTimeout(() => list.classList.remove('entering'), 1500);
    }
}

function setupHistoryFilter() {
    const form = $('history-filter-form');
    const input = $('history-date');
    const clearLink = $('history-clear');

    form.addEventListener('submit', e => {
        e.preventDefault();
        const date = input.value;
        clearLink.style.display = date ? 'inline' : 'none';
        loadPurchaseHistory(date || null);
    });

    clearLink.addEventListener('click', e => {
        e.preventDefault();
        input.value = '';
        clearLink.style.display = 'none';
        loadPurchaseHistory(null);
    });
}
