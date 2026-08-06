/* ═══════════════════════════════════════════════════
   shared.js — Carnitas Don Vic
   Funciones comunes entre admin.html y cliente.html.
   Debe incluirse DESPUÉS de config.js y ANTES de admin.js / cliente.js.
═══════════════════════════════════════════════════ */

/* ── Cliente HTTP mínimo para Supabase (sin SDK) ── */
const sb = {
  // Usa el token de la sesión iniciada (si existe) en vez de siempre
  // el anon key — así Supabase sabe que la petición viene de un
  // usuario autenticado (auth.role() = 'authenticated'), necesario
  // para las reglas RLS que protegen el panel admin.
  headers: () => {
    const sesion = sb.getSesion();
    return {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${sesion ? sesion.access_token : SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation'
    };
  },

  async get(table, query = '') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: sb.headers()
    });
    if (!res.ok) throw await res.json();
    return res.json();
  },

  async post(table, body) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: sb.headers(),
      body: JSON.stringify(body)
    });
    if (!res.ok) throw await res.json();
    return res.json();
  },

  async patch(table, filter, body) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
      method: 'PATCH',
      headers: sb.headers(),
      body: JSON.stringify(body)
    });
    if (!res.ok) throw await res.json();
    return res.json();
  },

  async delete(table, filter) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
      method: 'DELETE',
      headers: sb.headers()
    });
    if (!res.ok) throw await res.json();
    return res.json();
  },

  /* ── Autenticación (login del panel admin) ── */
  async signIn(email, password) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw data;
    localStorage.setItem('cdv_sesion', JSON.stringify(data));
    return data;
  },

  async signOut() {
    localStorage.removeItem('cdv_sesion');
  },

  getSesion() {
    const raw = localStorage.getItem('cdv_sesion');
    return raw ? JSON.parse(raw) : null;
  }
};

/* ── Utilidades generales ── */
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  if (!t) { console.log(msg); return; }
  t.textContent = (type === 'success' ? '✅  ' : '❌  ') + msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove('show'), 3500);
}

function fmt(val) {
  return '$' + Number(val).toLocaleString('es-MX', { minimumFractionDigits: 2 });
}

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ── Emojis / clasificación de categorías del menú ── */
const EMOJIS = {
  'Taco':        '🌮', 'Quesadilla':  '🧀', 'Gringa':    '🌯',
  'Volcán':      '🌋', 'Sope':        '🫓', 'Torta':     '🥖',
  'Gordita':     '🫓',
  'Costilla':    '🍖', 'Chicharrón':  '🥓', 'Consomé':   '🍲',
  'Agua':        '🥤', 'Refresco':    '🥤', 'Cerveza':   '🍺',
  'Salsa':       '🌶️', 'default':     '🍽️'
};
function getEmoji(nombre) {
  for (const [key, emoji] of Object.entries(EMOJIS)) {
    if (key !== 'default' && nombre.toLowerCase().includes(key.toLowerCase())) return emoji;
  }
  return EMOJIS.default;
}
function catClass(cat) {
  const c = (cat || '').toLowerCase();
  if (c.includes('bebida'))  return 'cat-bebida';
  if (c.includes('extra') || c.includes('salsa')) return 'cat-postre';
  if (c.includes('orden') || c.includes('kilo'))  return 'cat-entrada';
  return 'cat-principal';
}

/* ── Formatea una línea de detalle_orden: gramos para carne por
   peso ("416 g de Maciza"), o cantidad normal ("3× Taco de Maciza") ── */
function etiquetaDetalle(d) {
  const nombre = esc(d.platillo?.nombre || '?');
  const esPeso = d.platillo?.categorias?.nombre === 'Órdenes por kilo' && !/chamorro/i.test(d.platillo?.nombre || '');
  return esPeso ? `${d.cantidad} g de ${nombre}` : `${d.cantidad}× ${nombre}`;
}

/* ── Precio real de una línea de detalle_orden: $0 si es una bebida
   de regalo por promoción (nota empieza con "PROMO"), si no, el
   precio normal del platillo × cantidad ── */
function precioLinea(d) {
  if (d.nota && /^promo/i.test(d.nota)) return 0;
  return (d.platillo?.precio || 0) * d.cantidad;
}

/* ── Efecto de navbar al hacer scroll (si la página tiene #navbar) ── */
window.addEventListener('scroll', () => {
  const nav = document.getElementById('navbar');
  if (nav) nav.classList.toggle('scrolled', window.scrollY > 50);
});
