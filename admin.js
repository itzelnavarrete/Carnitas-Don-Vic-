/* ═══════════════════════════════════════════════════
   admin.js — Carnitas Don Vic (PANEL INTERNO)
   Backend: Supabase (PostgreSQL en la nube)
   Requiere: config.js + shared.js cargados ANTES que este archivo.
   Este archivo es solo para el panel de administración
   (admin.html). La página pública de clientes vive en
   cliente.html + cliente.js.
   
   MAPEO DE TABLAS:
   ┌──────────────────────────────────────────────────┐
   │  Tabla DDL          Columna PK / relevante        │
   │  categorias         id, nombre                    │
   │  platillo           id, nombre, precio, id_cate.. │
   │  ingredientes       id, nombre, unidad, minimo    │
   │  inventario         id, id_ingrediente, cantidad  │
   │  empleado           id, nombre, paterno, telefono │
   │  roles              id, nombre_rol                │
   │  orden              id, fecha, empleado (FK)      │
   │  detalle_orden      id, id_orden, id_platillo     │
   │  ingreso            id, id_orden, monto, fecha    │
   │  mesa*              id, numero, estado, ...       │
   │  resena*            id, numero_mesa, calificacion │
   │  (* tablas extra — ver TABLAS_SUPABASE_v2.sql)   │
   └──────────────────────────────────────────────────┘
═══════════════════════════════════════════════════ */

// ── Estado global ────────────────────────────────────
let carrito        = {};   // { id_platillo: { nombre, precio, cantidad } }
let allPlatillos   = [];
let allCategorias  = [];
let allIngredientes = [];
let currentFilter  = 'all';
let allMesas       = [];   // catálogo de nombres de mesa (Banqueta, Ara, ...) — solo se usa para poblar el selector del modal "Nueva Orden"
let allEmpleados   = [];   // era "allMeseros" — ahora usa tabla empleado
let allRoles       = [];
let allOrdenes     = [];
let notifInterval  = null;
let pagoMetodoActual = 'Efectivo';
let pagoOrdenActual  = null;
let pagoMontoActual  = 0;
let estrellaSeleccionada = 0;

/* [movido a shared.js / cliente.js] */
/* ════════════════════════════════════════════════
   MODALES
════════════════════════════════════════════════ */
function openModal(id) {
  document.getElementById(id).classList.add('open');
  if (id === 'modalOrden') {
    renderPlatillosOrden(ordenarParaPedido(allPlatillos.filter(p => p.activo !== false)));
    poblarMesaSelectorOrden();
    seleccionarTipoOrden('llevar');
  }
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (id === 'modalOrden' && typeof resetModoModalOrden === 'function') resetModoModalOrden();
}
function closeModalOutside(e, id) {
  if (e.target === e.currentTarget) closeModal(id);
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open')
    .forEach(m => m.classList.remove('open'));
});

/* ════════════════════════════════════════════════
   CARRITO
════════════════════════════════════════════════ */
function agregarAlCarrito(id, nombre, precio, categoria = '') {
  // Los "combinados"/"dobles" se agregan como línea separada cada vez,
  // porque cada uno puede llevar una nota distinta (ej. distinta carne).
  if (/combinad|doble/i.test(nombre)) {
    const key = `combo_${id}_${Date.now()}`;
    carrito[key] = { idPlatillo: id, nombre, precio: Number(precio), cantidad: 1, nota: '', categoria };
    renderCarrito();
    return;
  }
  if (carrito[id]) {
    carrito[id].cantidad++;
  } else {
    carrito[id] = { nombre, precio: Number(precio), cantidad: 1, nota: '', categoria };
  }
  renderCarrito();
}

/* ── Carne por peso: cuarto/medio/kilo o monto en pesos ── */
let pesoModalActual = null; // { id, nombre, precioPorGramo }

function abrirModalPeso(id, nombre, precioPorGramo) {
  pesoModalActual = { id, nombre, precioPorGramo };
  document.getElementById('pesoTitulo').textContent = nombre;
  document.getElementById('pesoBtnCuarto').textContent = `Cuarto de kilo (250 g) — ${fmt(precioPorGramo * 250)}`;
  document.getElementById('pesoBtnMedio').textContent  = `Medio kilo (500 g) — ${fmt(precioPorGramo * 500)}`;
  document.getElementById('pesoBtnKilo').textContent   = `Kilo completo (1000 g) — ${fmt(precioPorGramo * 1000)}`;
  document.getElementById('pesoMonto').value = '';
  document.getElementById('modalPeso').style.display = 'flex';
}

function cerrarModalPeso() {
  document.getElementById('modalPeso').style.display = 'none';
  pesoModalActual = null;
}

function agregarPesoFijo(fraccionKg) {
  const { id, nombre, precioPorGramo } = pesoModalActual;
  const gramos = Math.round(fraccionKg * 1000);
  const etiqueta = fraccionKg === 1 ? '1 kg' : fraccionKg === 0.5 ? '1/2 kg' : '1/4 kg';
  const key = `peso_${id}_${Date.now()}`;
  carrito[key] = {
    idPlatillo: id,
    nombre: `${nombre} (${etiqueta})`,
    precio: precioPorGramo,
    cantidad: gramos,
    nota: '',
    esPeso: true
  };
  cerrarModalPeso();
  renderCarrito();
}

function agregarPorMonto() {
  const monto = parseFloat(document.getElementById('pesoMonto').value);
  if (!monto || monto <= 0) return showToast('Escribe un monto válido', 'error');
  const { id, nombre, precioPorGramo } = pesoModalActual;
  const gramos = Math.round(monto / precioPorGramo);
  const key = `peso_${id}_${Date.now()}`;
  carrito[key] = {
    idPlatillo: id,
    nombre: `${nombre} ($${monto} ≈ ${gramos} g)`,
    precio: precioPorGramo,
    cantidad: gramos,
    nota: '',
    esPeso: true
  };
  cerrarModalPeso();
  renderCarrito();
}

function actualizarNota(id, valor) {
  if (!carrito[id]) return;
  carrito[id].nota = valor;
}

function cambiarCantidad(id, delta) {
  if (!carrito[id]) return;
  carrito[id].cantidad += delta;
  if (carrito[id].cantidad <= 0) delete carrito[id];
  renderCarrito();
}

function limpiarCarrito() {
  carrito = {};
  renderCarrito();
}

function esBebida(v)  { return v.categoria === 'Bebidas'; }
function esCombo(v)    { return /combinad|doble/i.test(v.nombre); }
function esTaco(v)     { return v.categoria === 'Tacos'; }
function esGordita(v)  { return /gordita/i.test(v.nombre); }
function llevaCebollaCilantro(v) { return esTaco(v) || esGordita(v); }
function sinExtras(v) {
  if (v.categoria === 'Órdenes por kilo') return true;
  if (/salsa extra/i.test(v.nombre)) return true;
  if (/quesadilla/i.test(v.nombre) && !esCombo(v)) return true; // quesadillas sencillas
  return false;
}
function togglePref(id, campo, valor) {
  if (!carrito[id]) return;
  carrito[id][campo] = valor;
  renderCarrito();
}

function notaFinal(v) {
  const partes = [];
  if (v.nota) partes.push(v.nota);
  if (llevaCebollaCilantro(v)) {
    partes.push(v.sinCebolla ? 'Sin cebolla' : 'Con cebolla');
    partes.push(v.sinCilantro ? 'Sin cilantro' : 'Con cilantro');
  }
  if (esGordita(v)) partes.push(v.sinQueso ? 'Sin queso' : 'Con queso');
  return partes.length ? partes.join(' — ') : null;
}

function renderCarrito() {
  const wrap    = document.getElementById('carritoItems');
  const totalEl = document.getElementById('carritoTotal');
  const keys    = Object.keys(carrito);

  if (!keys.length) {
    wrap.innerHTML = '<p class="carrito-empty">Selecciona platillos del menú →</p>';
    totalEl.textContent = '$0.00';
    return;
  }

  let total = 0;
  wrap.innerHTML = keys.map(id => {
    const item = carrito[id];
    const sub  = item.precio * item.cantidad;
    total += sub;

    if (item.esPeso) {
      return `
        <div class="carrito-item">
          <div class="ci-info">
            <span class="ci-nombre">${esc(item.nombre)}</span>
          </div>
          <button class="ci-btn" onclick="delete carrito['${id}']; renderCarrito();">✕</button>
          <span class="ci-sub">${fmt(sub)}</span>
        </div>
      `;
    }
    const filaExtra = (esBebida(item) || sinExtras(item)) ? '' : `
      <div style="grid-column:1/-1; display:flex; align-items:center; gap:.4rem; margin-top:4px; flex-wrap:wrap;">
        ${esCombo(item) ? `
        <input type="text" placeholder="¿Qué 2 carnes? Ej. maciza + buche"
               value="${esc(item.nota || '')}" oninput="actualizarNota('${id}', this.value)"
               style="flex:1; min-width:140px; padding:4px 8px; font-size:12px; border:1px solid var(--border); border-radius:6px; box-sizing:border-box;"/>
        ` : ''}
        ${llevaCebollaCilantro(item) ? `
          <span style="font-size:11px;color:var(--text-light)">🧅</span>
          <button class="ci-btn" style="padding:1px 6px;font-size:11px; ${!item.sinCebolla ? 'background:var(--success);color:#fff;' : ''}" onclick="togglePref('${id}','sinCebolla',false)">✓</button>
          <button class="ci-btn" style="padding:1px 6px;font-size:11px; ${item.sinCebolla ? 'background:var(--danger);color:#fff;' : ''}" onclick="togglePref('${id}','sinCebolla',true)">✗</button>
          <span style="font-size:11px;color:var(--text-light);margin-left:4px">🌿</span>
          <button class="ci-btn" style="padding:1px 6px;font-size:11px; ${!item.sinCilantro ? 'background:var(--success);color:#fff;' : ''}" onclick="togglePref('${id}','sinCilantro',false)">✓</button>
          <button class="ci-btn" style="padding:1px 6px;font-size:11px; ${item.sinCilantro ? 'background:var(--danger);color:#fff;' : ''}" onclick="togglePref('${id}','sinCilantro',true)">✗</button>
          ${esGordita(item) ? `
          <span style="font-size:11px;color:var(--text-light);margin-left:4px">🧀</span>
          <button class="ci-btn" style="padding:1px 6px;font-size:11px; ${!item.sinQueso ? 'background:var(--success);color:#fff;' : ''}" onclick="togglePref('${id}','sinQueso',false)">✓</button>
          <button class="ci-btn" style="padding:1px 6px;font-size:11px; ${item.sinQueso ? 'background:var(--danger);color:#fff;' : ''}" onclick="togglePref('${id}','sinQueso',true)">✗</button>
          ` : ''}
        ` : ''}
      </div>`;

    return `
      <div class="carrito-item">
        <div class="ci-info">
          <span class="ci-nombre">${esc(item.nombre)}</span>
          <span class="ci-precio">${fmt(item.precio)} c/u</span>
        </div>
        <div class="ci-controls">
          <button class="ci-btn" onclick="cambiarCantidad('${id}', -1)">−</button>
          <span class="ci-cant">${item.cantidad}</span>
          <button class="ci-btn" onclick="cambiarCantidad('${id}', 1)">+</button>
        </div>
        <span class="ci-sub">${fmt(sub)}</span>
        ${filaExtra}
      </div>
    `;
  }).join('');
  totalEl.textContent = fmt(total);
}

function ordenarParaPedido(lista) {
  // Orden pedido: Tacos → Bebidas → Quesadillas → Gorditas → (resto de Antojitos) → Órdenes por kilo
  const rango = (p) => {
    if (p.categoria === 'Tacos') return 0;
    if (p.categoria === 'Bebidas') return 1;
    if (p.categoria === 'Antojitos') return /quesadilla/i.test(p.nombre) ? 2 : 3;
    if (p.categoria === 'Órdenes por kilo') return 4;
    return 5;
  };
  return [...lista].sort((a, b) => rango(a) - rango(b) || a.nombre.localeCompare(b.nombre));
}

function filtrarPlatillosOrden(q) {
  const lista = allPlatillos.filter(p =>
    p.activo !== false && p.nombre.toLowerCase().includes(q.toLowerCase())
  );
  renderPlatillosOrden(ordenarParaPedido(lista));
}

function renderPlatillosOrden(lista) {
  const wrap = document.getElementById('platillosOrdenList');
  if (!lista.length) {
    wrap.innerHTML = '<p class="carrito-empty">No se encontraron platillos.</p>';
    return;
  }
  // DDL: platillo.id (no id_platillo)
  wrap.innerHTML = lista.map(p => {
    const esPeso = p.categoria === 'Órdenes por kilo' && !/chamorro/i.test(p.nombre);
    const recargo = (esPeso && tipoOrdenActual === 'mesa') ? 10 / 1000 : 0;
    const precioEfectivo = p.precio + recargo;
    const accion = esPeso
      ? `abrirModalPeso(${p.id}, '${esc(p.nombre)}', ${precioEfectivo})`
      : `agregarAlCarrito(${p.id}, '${esc(p.nombre)}', ${p.precio}, '${esc(p.categoria || '')}')`;
    return `
    <div class="plat-orden-item" onclick="${accion}">
      <div class="poi-info">
        <span class="poi-nombre">${esc(p.nombre)}</span>
        <span class="poi-cat">${esc(p.categoria || 'Sin categoría')}</span>
      </div>
      <div class="poi-right">
        <span class="poi-precio">${esPeso ? fmt(precioEfectivo * 1000) + '/kg' : fmt(p.precio)}</span>
        <span class="poi-add">+</span>
      </div>
    </div>
  `;
  }).join('');
}

/* ════════════════════════════════════════════════
   STATS
════════════════════════════════════════════════ */
async function loadStats() {
  try {
    // DDL: tabla "categorias" (plural), PK "id"
    // DDL: tabla "ingredientes" (plural), PK "id"
    // DDL: tabla "orden", PK "id"
    const [plat, ord, ing] = await Promise.all([
      sb.get('platillo',     'select=id'),
      sb.get('orden',        'select=id,fecha&fecha=gte.' + new Date().toISOString().slice(0, 10)),
      sb.get('ingredientes', 'select=id'),
    ]);
    document.getElementById('statPlatillos').textContent    = plat.length;
    document.getElementById('statOrdenes').textContent      = ord.length;
    document.getElementById('statIngredientes').textContent = ing.length;
  } catch(e) { console.warn('Stats no disponibles', e); }
}

/* ════════════════════════════════════════════════
   CATEGORÍAS
   DDL: tabla "categorias", PK "id", campo "nombre"
════════════════════════════════════════════════ */
async function loadCategorias() {
  try {
    // DDL usa "categorias" (plural)
    allCategorias = await sb.get('categorias', 'select=id,nombre&order=nombre.asc');

    // Llenar select del modal de platillo
    const sel = document.getElementById('plat-cat');
    sel.innerHTML = allCategorias.map(c =>
      `<option value="${c.id}">${esc(c.nombre)}</option>`
    ).join('');

    // Botones de filtro
    const wrap = document.getElementById('menuFilters');
    wrap.innerHTML = `<button class="filter-btn active" data-filter="all">Todo 🌟</button>`;
    allCategorias.forEach(c => {
      const btn = document.createElement('button');
      btn.className   = 'filter-btn';
      btn.dataset.filter = c.nombre;
      btn.textContent = c.nombre;
      wrap.appendChild(btn);
    });

    wrap.addEventListener('click', e => {
      if (!e.target.classList.contains('filter-btn')) return;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentFilter = e.target.dataset.filter;
      renderMenu(allPlatillos);
    });
  } catch(e) {
    console.error('Error al cargar categorías:', e);
    document.getElementById('menuFilters').innerHTML =
      `<button class="filter-btn active" data-filter="all">Todo 🌟</button>`;
  }
}

/* ════════════════════════════════════════════════
   MENÚ
   DDL: platillo.id, platillo.precio, platillo.id_categorias → categorias.id
════════════════════════════════════════════════ */
async function loadMenu() {
  try {
    // DDL no tiene columna "frecuencia" — no la pedimos
    const [platillos, cats] = await Promise.all([
      sb.get('platillo',   'select=id,nombre,precio,id_categorias,activo&order=nombre.asc'),
      sb.get('categorias', 'select=id,nombre')
    ]);

    // Mapear id_categorias → nombre de categoría
    const catMap = {};
    cats.forEach(c => { catMap[c.id] = c.nombre; });

    allPlatillos = platillos.map(p => ({
      ...p,
      categoria: catMap[p.id_categorias] || 'Sin categoría'
    }));
    renderMenu(allPlatillos);
    renderPlatillosOrden(ordenarParaPedido(allPlatillos.filter(p => p.activo !== false)));
  } catch(e) {
    document.getElementById('menuGrid').innerHTML =
      '<div class="menu-loading"><p>⚠️ No se pudo cargar el menú. Verifica config.js</p></div>';
    console.error(e);
  }
}

/* [movido a shared.js / cliente.js] */
function renderMenu(platillos) {
  const grid = document.getElementById('menuGrid');
  const list = currentFilter === 'all'
    ? platillos
    : platillos.filter(p => p.categoria === currentFilter);

  if (!list.length) {
    grid.innerHTML = '<div class="menu-loading"><p>No hay platillos en esta categoría 🍃</p></div>';
    return;
  }
  // DDL: platillo.id (no id_platillo)
  grid.innerHTML = list.map(p => {
    const esPeso = p.categoria === 'Órdenes por kilo' && !/chamorro/i.test(p.nombre);
    const accion = esPeso
      ? `openModal('modalOrden'); abrirModalPeso(${p.id}, '${esc(p.nombre)}', ${p.precio})`
      : `agregarDesdeMenu(${p.id}, '${esc(p.nombre)}', ${p.precio}, '${esc(p.categoria || '')}')`;
    return `
    <div class="menu-card ${p.activo === false ? 'menu-card-inactivo' : ''}">
      <button class="mesero-delete" onclick="event.stopPropagation(); toggleActivoPlatillo(${p.id}, ${p.activo === false})" title="${p.activo === false ? 'Reactivar' : 'Marcar como agotado'}" style="font-size:11px; white-space:nowrap;">
        ${p.activo === false ? '✅ Reactivar' : '🚫 Agotar'}
      </button>
      <div onclick="${accion}">
        <span class="menu-card-emoji">${getEmoji(p.nombre)}</span>
        <span class="menu-card-cat ${catClass(p.categoria)}">${esc(p.categoria)}</span>
        <h3>${esc(p.nombre)}</h3>
        ${p.activo === false ? '<p style="color:var(--danger);font-weight:600;font-size:13px">Agotado — oculto para clientes</p>' : '<p>Delicioso platillo preparado al momento con ingredientes frescos.</p>'}
        <div class="menu-card-footer">
          <div class="menu-price">${esPeso ? fmt(p.precio * 1000) + '/kg' : fmt(p.precio)}</div>
          <span class="menu-add-hint">${esPeso ? 'Toca para elegir cantidad' : 'Toca para ordenar'}</span>
        </div>
      </div>
    </div>
  `;
  }).join('');
}

async function toggleActivoPlatillo(id, nuevoEstado) {
  try {
    await sb.patch('platillo', `id=eq.${id}`, { activo: nuevoEstado });
    showToast(nuevoEstado ? 'Platillo reactivado ✅' : 'Marcado como agotado 🚫');
    loadMenu();
  } catch (e) {
    showToast('Error al actualizar', 'error');
  }
}

function agregarDesdeMenu(id, nombre, precio, categoria = '') {
  agregarAlCarrito(id, nombre, precio, categoria);
  showToast(`${nombre} agregado a la orden`);
  const modal = document.getElementById('modalOrden');
  if (!modal.classList.contains('open')) openModal('modalOrden');
}

async function crearPlatillo() {
  const nombre  = document.getElementById('plat-nombre').value.trim();
  const cat_id  = document.getElementById('plat-cat').value;
  const precio  = parseFloat(document.getElementById('plat-precio').value);

  if (!nombre)                   return showToast('El nombre es obligatorio', 'error');
  if (isNaN(precio) || precio < 0) return showToast('Ingresa un precio válido', 'error');

  try {
    // DDL: no existe "frecuencia" en platillo — se omite
    await sb.post('platillo', {
      nombre,
      id_categorias: cat_id ? parseInt(cat_id) : null,
      precio
    });
    showToast('¡Platillo agregado al menú! 🎉');
    closeModal('modalPlatillo');
    document.getElementById('plat-nombre').value = '';
    document.getElementById('plat-precio').value = '';
    loadMenu(); loadStats();
  } catch(e) {
    showToast('Error al guardar: ' + (e.message || JSON.stringify(e)), 'error');
  }
}

/* ════════════════════════════════════════════════
   ÓRDENES
   DDL: orden.id (no id_orden), orden.empleado → empleado.id
        No existe orden.estado ni orden.cuenta_total
        El total se calcula desde detalle_orden × platillo.precio
        ingreso.id_orden registra el pago (reemplaza "pago" en v2)
════════════════════════════════════════════════ */
async function loadOrdenes() {
  const grid = document.getElementById('ordenesGrid');
  grid.innerHTML = '<div class="empty-state"><div class="spinner" style="margin:0 auto"></div><p style="margin-top:1rem">Cargando órdenes…</p></div>';
  try {
    const hoy = new Date().toISOString().slice(0, 10);

    // Traer órdenes de hoy con su empleado y detalles
    const ordenes = await sb.get('orden',
      `select=id,fecha,empleado,numero_mesa,nombre_cliente,detalle_orden(id,cantidad,platillo(id,nombre,precio,categorias(nombre)))&fecha=gte.${hoy}&order=id.desc`
    );

    // IDs de órdenes ya cobradas (tienen ingreso), con su método de pago
    const ingresos = await sb.get('ingreso', `select=id_orden,metodo&fecha=gte.${hoy}T00:00:00`).catch(() => []);
    const metodoMap = {};
    ingresos.forEach(i => { metodoMap[i.id_orden] = i.metodo; });
    const cobradas = new Set(ingresos.map(i => i.id_orden));

    if (!ordenes.length) {
      grid.innerHTML = '<div class="empty-state"><span class="empty-icon">🎉</span><p>Sin órdenes por ahora.</p></div>';
      return;
    }

    // Mapeo de empleados para mostrar nombre
    const empMap = {};
    allEmpleados.forEach(e => { empMap[e.id] = `${e.nombre} ${e.paterno}`; });

    const ICONO_METODO = { Efectivo: '💵', Tarjeta: '💳', Transferencia: '🏦' };
    grid.innerHTML = ordenes.map(o => {
      const detalles  = o.detalle_orden || [];
      const total     = detalles.reduce((s, d) => s + precioLinea(d), 0);
      const cobrada   = cobradas.has(o.id);
      const metodo    = metodoMap[o.id];
      const origen    = o.numero_mesa
        ? `🍽️ Mesa ${o.numero_mesa}${o.nombre_cliente ? ' — ' + esc(o.nombre_cliente) : ''}`
        : (o.empleado ? `👨‍💼 ${esc(empMap[o.empleado] || 'Emp. #' + o.empleado)}` : '🛒 Mostrador');
      return `
        <div class="orden-card ${cobrada ? 'servida' : ''}">
          <div class="orden-header">
            <div class="orden-mesa-num">${origen}</div>
            <span class="badge ${cobrada ? 'badge-cerrada' : 'badge-activa'}">
              ${cobrada ? `✓ Cobrada${metodo ? ' — ' + (ICONO_METODO[metodo] || '') + ' ' + esc(metodo) : ''}` : '● Pendiente'}
            </span>
          </div>
          <div class="orden-total">${fmt(total)}</div>
          <div class="orden-fecha">📅 ${new Date(o.fecha).toLocaleString('es-MX')}</div>
          <div style="font-size:13px;color:var(--gris);margin-top:0.4rem">
            ${detalles.map(d => etiquetaDetalle(d)).join(', ')}
          </div>
          ${!cobrada ? `
          <div style="display:flex; gap:.5rem; margin-top:0.75rem; flex-wrap:wrap;">
            <button class="action-btn" style="flex:1;" onclick="ampliarOrden(${o.id})">✏️ Modificar Nota</button>
            <button class="action-btn" style="flex:1;background:var(--success);color:#fff;" onclick="abrirModalPago(${o.id}, ${total})">✅ Finalizar y Cobrar</button>
          </div>` : ''}
        </div>
      `;
    }).join('');
  } catch(e) {
    grid.innerHTML = '<div class="empty-state"><span class="empty-icon">⚠️</span><p>Error al cargar las órdenes.</p></div>';
    console.error(e);
  }
}

async function crearOrden() {
  // DDL: orden.empleado es el ID (INT) del empleado en la tabla empleado
  const empId  = document.getElementById('ord-empleado').value.trim();
  const mesaSel = tipoOrdenActual === 'mesa' ? document.getElementById('ord-mesa-sel').value : '';
  const items  = Object.entries(carrito);

  if (!empId)        return showToast('Selecciona un empleado', 'error');
  if (!items.length) return showToast('Agrega al menos un platillo', 'error');
  if (tipoOrdenActual === 'mesa' && !mesaSel) return showToast('Selecciona a qué mesa es el pedido', 'error');

  try {
    // 1. Crear la cabecera de la orden — empleado siempre; numero_mesa solo si el
    //    mesero está tomando el pedido en una mesa (el cliente no usó el QR)
    const [orden] = await sb.post('orden', {
      empleado:    parseInt(empId),
      numero_mesa: mesaSel || null
      // fecha y estado se ponen solos con DEFAULT
    });

    // 2. Crear el detalle — DDL: id_orden refs orden.id, id_platillo refs platillo.id
    const detalles = items.map(([id, v]) => ({
      id_orden:    orden.id,
      id_platillo: v.idPlatillo ? parseInt(v.idPlatillo) : parseInt(id),
      cantidad:    v.cantidad,
      nota:        notaFinal(v)
    }));
    await sb.post('detalle_orden', detalles);

    const total = items.reduce((s, [, v]) => s + v.precio * v.cantidad, 0);
    showToast(`Orden #${orden.id} creada${mesaSel ? ' — Mesa ' + mesaSel : ''} — ${fmt(total)} 🛒`);
    closeModal('modalOrden');
    limpiarCarrito();
    document.getElementById('ord-empleado').value = '';
    document.getElementById('ord-mesa-sel').value = '';
    seleccionarTipoOrden('llevar');
    loadOrdenes();
    loadStats();
    loadCocina();
  } catch(e) {
    showToast('Error al crear la orden: ' + (e.message || JSON.stringify(e)), 'error');
    console.error(e);
  }
}

/* ════════════════════════════════════════════════
   INVENTARIO
   DDL: tabla "ingredientes" (plural), PK "id"
        tabla "inventario": id, id_ingrediente, fecha, cantidad
        No existe columna "existencia" — se suma desde inventario
════════════════════════════════════════════════ */
async function loadInventario() {
  try {
    // Traer ingredientes + suma de inventario agrupada
    const [ings, inv] = await Promise.all([
      sb.get('ingredientes', 'select=id,nombre,unidad,minimo&order=nombre.asc'),
      sb.get('inventario',   'select=id_ingrediente,cantidad,dia')
    ]);

    // Agrupar existencia total por ingrediente, y desglose Sábado/Domingo
    const stockMap = {};
    const diaMap   = {}; // { id: { Sábado: X, Domingo: Y } }
    inv.forEach(r => {
      stockMap[r.id_ingrediente] = (stockMap[r.id_ingrediente] || 0) + parseFloat(r.cantidad);
      if (r.dia) {
        diaMap[r.id_ingrediente] = diaMap[r.id_ingrediente] || { Sábado: 0, Domingo: 0 };
        diaMap[r.id_ingrediente][r.dia] = (diaMap[r.id_ingrediente][r.dia] || 0) + parseFloat(r.cantidad);
      }
    });

    allIngredientes = ings.map(i => ({
      ...i,
      existencia: stockMap[i.id] || 0,
      desglose: diaMap[i.id] || null
    }));

    renderInventario(allIngredientes);
    renderStockAlerts(allIngredientes);
  } catch(e) {
    const errRow = '<tr><td colspan="7" class="table-empty">⚠️ Error al cargar el inventario.</td></tr>';
    document.getElementById('invBodyBebidas').innerHTML = errRow;
    document.getElementById('invBodyCarne').innerHTML = errRow;
    console.error(e);
  }
}

function renderStockAlerts(items) {
  const wrap  = document.getElementById('stockAlerts');
  const low   = items.filter(i => i.existencia > 0 && i.existencia < parseFloat(i.minimo));
  const empty = items.filter(i => i.existencia <= 0);
  let html = '';
  empty.forEach(i => { html += `<div class="alert-card danger">❌ <strong>${esc(i.nombre)}</strong> — AGOTADO</div>`; });
  low.forEach(i =>   { html += `<div class="alert-card">⚠️ <strong>${esc(i.nombre)}</strong> — Bajo (${i.existencia} ${i.unidad})</div>`; });
  wrap.innerHTML = html;
}

function renderInventario(items) {
  const bebidas = items.filter(i => i.unidad !== 'KG');
  const carne   = items.filter(i => i.unidad === 'KG');

  const tbodyB = document.getElementById('invBodyBebidas');
  if (!bebidas.length) {
    tbodyB.innerHTML = '<tr><td colspan="6" class="table-empty">🥤 Sin bebidas registradas.</td></tr>';
  } else {
    tbodyB.innerHTML = bebidas.map(i => {
      const ex = parseFloat(i.existencia), mn = parseFloat(i.minimo);
      let sc, sl;
      if (ex <= 0)      { sc = 'empty'; sl = '❌ Agotado'; }
      else if (ex < mn) { sc = 'low';   sl = '⚠️ Bajo'; }
      else              { sc = 'ok';    sl = '✅ OK'; }
      return `
        <tr>
          <td><strong>${esc(i.nombre)}</strong></td>
          <td>${i.existencia}</td>
          <td>${i.minimo}</td>
          <td>${esc(i.unidad)}</td>
          <td><span class="stock-pill ${sc}">${sl}</span></td>
          <td>
            <button class="action-btn" onclick="agregarStock(${i.id}, ${i.existencia}, '${i.unidad}')">+ Stock</button>
            <button class="action-btn del" onclick="eliminarIngrediente(${i.id})">Eliminar</button>
          </td>
        </tr>`;
    }).join('');
  }

  const tbodyC = document.getElementById('invBodyCarne');
  if (!carne.length) {
    tbodyC.innerHTML = '<tr><td colspan="7" class="table-empty">🥩 Sin cortes de carne registrados.</td></tr>';
  } else {
    tbodyC.innerHTML = carne.map(i => {
      const ex = parseFloat(i.existencia), mn = parseFloat(i.minimo);
      const sab = i.desglose ? (i.desglose['Sábado'] || 0) : 0;
      const dom = i.desglose ? (i.desglose['Domingo'] || 0) : 0;
      let sc, sl;
      if (ex <= 0)      { sc = 'empty'; sl = '❌ Agotado'; }
      else if (ex < mn) { sc = 'low';   sl = '⚠️ Bajo'; }
      else              { sc = 'ok';    sl = '✅ OK'; }
      return `
        <tr>
          <td><strong>${esc(i.nombre)}</strong></td>
          <td>${sab} kg</td>
          <td>${dom} kg</td>
          <td>${i.existencia} kg</td>
          <td>${i.minimo}</td>
          <td><span class="stock-pill ${sc}">${sl}</span></td>
          <td>
            <button class="action-btn" onclick="agregarStock(${i.id}, ${i.existencia}, '${i.unidad}')">+ Stock</button>
            <button class="action-btn del" onclick="eliminarIngrediente(${i.id})">Eliminar</button>
          </td>
        </tr>`;
    }).join('');
  }
}

function filterInventario(q) {
  renderInventario(allIngredientes.filter(i =>
    i.nombre.toLowerCase().includes(q.toLowerCase())
  ));
}

function toggleCamposIngrediente() {
  const esKg = document.getElementById('ing-unidad').value === 'KG';
  document.getElementById('ing-campos-kg').style.display     = esKg ? 'block' : 'none';
  document.getElementById('ing-campos-normal').style.display  = esKg ? 'none'  : 'block';
}

async function crearIngrediente() {
  const nombre = document.getElementById('ing-nombre').value.trim();
  const minimo = Number(document.getElementById('ing-minimo').value);
  const unidad = document.getElementById('ing-unidad').value;

  if (!nombre) return showToast('El nombre es obligatorio', 'error');

  try {
    // DDL: insertar en "ingredientes" (catálogo)
    const [ing] = await sb.post('ingredientes', { nombre, unidad, minimo });

    if (unidad === 'KG') {
      // Carne: se registra por separado Sábado y Domingo; el total es la suma
      const kgSabado  = Number(document.getElementById('ing-kg-sabado').value) || 0;
      const kgDomingo = Number(document.getElementById('ing-kg-domingo').value) || 0;
      const filas = [];
      if (kgSabado > 0)  filas.push({ id_ingrediente: ing.id, cantidad: kgSabado,  dia: 'Sábado' });
      if (kgDomingo > 0) filas.push({ id_ingrediente: ing.id, cantidad: kgDomingo, dia: 'Domingo' });
      if (filas.length) await sb.post('inventario', filas);
    } else {
      const cantidad = Number(document.getElementById('ing-existencia').value);
      if (cantidad > 0) await sb.post('inventario', { id_ingrediente: ing.id, cantidad });
    }

    showToast('¡Insumo registrado! 🧺');
    closeModal('modalIngrediente');
    ['ing-nombre', 'ing-existencia', 'ing-minimo', 'ing-kg-sabado', 'ing-kg-domingo'].forEach(id =>
      document.getElementById(id).value = ''
    );
    loadInventario(); loadStats();
  } catch(e) {
    showToast('Error: ' + (e.message || JSON.stringify(e)), 'error');
  }
}

async function agregarStock(idIngrediente, actual, unidad) {
  if (unidad === 'KG') {
    const dia = prompt('¿Para qué día es esta carne? Escribe "Sábado" o "Domingo":');
    if (!dia || !['Sábado', 'Domingo', 'sábado', 'domingo'].includes(dia.trim())) {
      return showToast('Escribe exactamente "Sábado" o "Domingo"', 'error');
    }
    const cantidad = prompt(`Existencia actual: ${actual} kg\n¿Cuántos KG quieres AÑADIR para ${dia}?`);
    if (cantidad === null || cantidad.trim() === '') return;
    const valor = parseFloat(cantidad);
    if (isNaN(valor)) return showToast('Cantidad inválida', 'error');
    try {
      await sb.post('inventario', {
        id_ingrediente: idIngrediente,
        cantidad: valor,
        dia: dia.trim()[0].toUpperCase() + dia.trim().slice(1).toLowerCase()
      });
      showToast('Stock actualizado ✅');
      loadInventario(); loadStats();
    } catch(e) { showToast('Error al actualizar stock', 'error'); }
    return;
  }

  // En lugar de editar directamente, se inserta un nuevo registro en inventario
  const entrada = prompt(`Stock actual acumulado: ${actual}\nIngresa la cantidad a AÑADIR:`);
  if (entrada === null || entrada.trim() === '') return;
  const cant = Number(entrada);
  if (cant <= 0) return showToast('La cantidad debe ser mayor a 0', 'error');
  try {
    await sb.post('inventario', { id_ingrediente: idIngrediente, cantidad: cant });
    showToast('Stock actualizado ✓');
    loadInventario();
  } catch(e) {
    showToast('Error al ajustar stock', 'error');
  }
}

async function eliminarIngrediente(id) {
  if (!confirm('¿Eliminar este ingrediente? Se borrarán también sus entradas de inventario.')) return;
  try {
    // inventario tiene ON DELETE CASCADE desde ingredientes
    await sb.delete('ingredientes', `id=eq.${id}`);
    showToast('Ingrediente eliminado');
    loadInventario(); loadStats();
  } catch(e) {
    showToast('Error al eliminar', 'error');
  }
}

/* ════════════════════════════════════════════════
   NOTIFICACIONES
════════════════════════════════════════════════ */
function toggleNotifPanel() {
  const panel = document.getElementById('notifPanel');
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) checkNotificaciones();
}

async function checkNotificaciones() {
  try {
    const alertas = [];
    const hoy     = new Date().toISOString().slice(0, 10);

    // Ingredientes con stock bajo (calculado desde inventario)
    const [ings, inv] = await Promise.all([
      sb.get('ingredientes', 'select=id,nombre,unidad,minimo').catch(() => []),
      sb.get('inventario',   'select=id_ingrediente,cantidad').catch(() => [])
    ]);
    const stockMap = {};
    inv.forEach(r => { stockMap[r.id_ingrediente] = (stockMap[r.id_ingrediente] || 0) + parseFloat(r.cantidad); });
    ings.forEach(i => {
      const ex = stockMap[i.id] || 0;
      const mn = parseFloat(i.minimo);
      if (ex <= 0)      alertas.push({ tipo: 'danger',  titulo: `❌ ${i.nombre} — AGOTADO`,    sub: 'Reabastecer urgente' });
      else if (ex < mn) alertas.push({ tipo: 'warning', titulo: `⚠️ ${i.nombre} — Stock bajo`, sub: `${ex} ${i.unidad} (mín ${mn})` });
    });

    // Órdenes de hoy sin ingreso asociado (pendientes de cobro)
    const ordenes  = await sb.get('orden',   `select=id&fecha=gte.${hoy}`).catch(() => []);
    const ingresos = await sb.get('ingreso', `select=id_orden&fecha=gte.${hoy}T00:00:00`).catch(() => []);
    const cobradas = new Set(ingresos.map(i => i.id_orden));
    const pendientes = ordenes.filter(o => !cobradas.has(o.id));
    if (pendientes.length > 0) {
      alertas.push({ tipo: 'warning', titulo: `💳 ${pendientes.length} orden(es) sin cobrar`, sub: 'Revisa la sección Órdenes' });
    }

    renderNotificaciones(alertas);
    const badge = document.getElementById('notifBadge');
    if (alertas.length > 0) {
      badge.textContent = alertas.length;
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
  } catch(e) { console.warn('Error en notificaciones:', e); }
}

function renderNotificaciones(alertas) {
  const body = document.getElementById('notifBody');
  if (!alertas.length) {
    body.innerHTML = '<p class="notif-empty">✅ Sin alertas por ahora</p>';
    return;
  }
  body.innerHTML = alertas.map(a => `
    <div class="notif-item ${a.tipo}">
      <strong>${a.titulo}</strong>
      <span>${a.sub}</span>
    </div>
  `).join('');
}

/* ════════════════════════════════════════════════
   EMPLEADOS (antes "Meseros")
   DDL: empleado.id, nombre, paterno, materno, telefono,
        fecha_ingreso, fecha_egreso, rol (FK a roles.id)
   ⚠️  No existe "turno" en DDL — se agrega como columna
       adicional en TABLAS_SUPABASE_v2.sql
════════════════════════════════════════════════ */
async function loadMeseros() {
  const grid = document.getElementById('mesesGrid');
  grid.innerHTML = '<div class="empty-state"><div class="spinner" style="margin:0 auto"></div><p style="margin-top:1rem">Cargando meseros…</p></div>';
  try {
    const [empleados, roles, ordenes] = await Promise.all([
      sb.get('empleado', 'select=id,nombre,paterno,fecha_ingreso,rol&fecha_egreso=is.null&order=nombre.asc'),
      sb.get('roles',    'select=id,nombre_rol'),
      sb.get('orden',    `select=id,empleado&fecha=gte.${new Date().toISOString().slice(0,10)}`)
    ]);

    allEmpleados = empleados;
    const rolMap = {};
    roles.forEach(r => { rolMap[r.id] = r.nombre_rol; });

    // Contar órdenes por empleado hoy
    const countMap = {};
    ordenes.forEach(o => { countMap[o.empleado] = (countMap[o.empleado] || 0) + 1; });

    // Stats bar
    const stats  = document.getElementById('mesesStats');
    stats.innerHTML = `
      <div class="mesero-stat"><span class="ms-icon">👥</span> <span>${empleados.length} empleados activos</span></div>
    `;

    if (!empleados.length) {
      grid.innerHTML = '<div class="empty-state"><span class="empty-icon">👨‍💼</span><p>No hay meseros activos.</p></div>';
      return;
    }

    grid.innerHTML = empleados.map(m => `
      <div class="mesero-card">
        <button class="mesero-delete" onclick="darBajaEmpleado(${m.id})" title="Dar de baja">🗑️</button>
        <div class="mesero-avatar">👨‍💼</div>
        <div class="mesero-nombre">${esc(m.nombre)}${m.paterno ? ' ' + esc(m.paterno) : ''}</div>
        <div style="font-size:12px;color:var(--gris);margin-top:0.3rem">${esc(rolMap[m.rol] || 'Sin rol')}</div>
        <div class="mesero-ordenes">📋 ${countMap[m.id] || 0} órdenes hoy</div>
      </div>
    `).join('');

    // Poblar selector de empleado en modal de orden
    poblarSelectorEmpleado(empleados);
  } catch(e) {
    grid.innerHTML = '<div class="empty-state"><span class="empty-icon">⚠️</span><p>Error al cargar meseros.</p></div>';
    console.error(e);
  }
}

function poblarSelectorEmpleado(empleados) {
  const sel = document.getElementById('ord-empleado-sel');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Selecciona empleado —</option>' +
    empleados.map(e => `<option value="${e.id}">${esc(e.nombre)}${e.paterno ? ' ' + esc(e.paterno) : ''}</option>`).join('');
}

let tipoOrdenActual = 'llevar';

function seleccionarTipoOrden(tipo) {
  tipoOrdenActual = tipo;
  document.getElementById('btnTipoLlevar').classList.toggle('selected', tipo === 'llevar');
  document.getElementById('btnTipoMesa').classList.toggle('selected', tipo === 'mesa');
  const sel = document.getElementById('ord-mesa-sel');
  sel.style.display = tipo === 'mesa' ? 'block' : 'none';
  if (tipo === 'llevar') sel.value = '';
  renderPlatillosOrden(ordenarParaPedido(allPlatillos.filter(p => p.activo !== false)));
}

function poblarMesaSelectorOrden() {
  const sel = document.getElementById('ord-mesa-sel');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Mostrador / para llevar —</option>' +
    allMesas.map(m => `<option value="${esc(m.numero)}">${esc(m.numero)}${m.estado ? ' (ocupada)' : ''}</option>`).join('');
}

/* ════════════════════════════════════════════════
   MESAS — catálogo de nombres, SIN mapa visual
   Ya no hay una sección dedicada para ver disponibilidad;
   esta función solo trae los nombres (Banqueta, Ara, ...)
   para llenar el selector de mesa en "Nueva Orden".
   DDL: tabla "mesa" — ver TABLAS_SUPABASE_v2.sql
════════════════════════════════════════════════ */
async function loadMesas() {
  try {
    allMesas = await sb.get('mesa', 'select=id_mesa,numero,estado&order=numero.asc');
  } catch(e) {
    console.error('Error al cargar el catálogo de mesas:', e);
  }
}

async function crearMesero() {
  const nombreCompleto = document.getElementById('mes-nombre').value.trim();
  const rolId          = document.getElementById('mes-rol').value;

  if (!nombreCompleto) return showToast('El nombre es obligatorio', 'error');
  if (!rolId)          return showToast('Selecciona un rol', 'error');

  try {
    // DDL: empleado.paterno es NOT NULL, pero ya no le pedimos ese dato
    // al usuario — se guarda vacío. Todo el nombre va en "nombre".
    await sb.post('empleado', {
      nombre:        nombreCompleto,
      paterno:       '',
      fecha_ingreso: new Date().toISOString().slice(0, 10),
      rol:           parseInt(rolId)
    });
    showToast(`¡Empleado ${nombreCompleto} registrado! 👨‍💼`);
    closeModal('modalMesero');
    document.getElementById('mes-nombre').value = '';
    loadMeseros();
  } catch(e) {
    showToast('Error: ' + (e.message || JSON.stringify(e)), 'error');
  }
}

async function darBajaEmpleado(id) {
  if (!confirm('¿Dar de baja a este empleado? Se registrará la fecha de egreso.')) return;
  try {
    // DDL: baja lógica — se llena fecha_egreso en lugar de borrar
    await sb.patch('empleado', `id=eq.${id}`, {
      fecha_egreso: new Date().toISOString().slice(0, 10)
    });
    showToast('Empleado dado de baja');
    loadMeseros();
  } catch(e) {
    showToast('Error al dar de baja', 'error');
  }
}

async function cargarRolesEnModal() {
  try {
    const roles = await sb.get('roles', 'select=id,nombre_rol&order=nombre_rol.asc');
    const sel   = document.getElementById('mes-rol');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Selecciona rol —</option>' +
      roles.map(r => `<option value="${r.id}">${esc(r.nombre_rol)}</option>`).join('');
  } catch(e) { console.warn('Error al cargar roles', e); }
}

/* ════════════════════════════════════════════════
   CAJA / COBRO
   DDL: tabla "ingreso" (no "pago")
        ingreso.id_orden → orden.id
        ingreso.monto, ingreso.fecha
   Tabla "pago" en TABLAS_SUPABASE_v2.sql es alias
   de ingreso con columna extra "metodo"
════════════════════════════════════════════════ */
/* ── Resumen Sábado/Domingo — SOLO visible para el rol "admin" ── */
async function loadResumenFinDeSemana() {
  if (rolActual !== 'admin') return;
  const cont = document.getElementById('resumenFinSemanaBody');
  try {
    const hace7dias = new Date();
    hace7dias.setDate(hace7dias.getDate() - 7);
    const desde = hace7dias.toISOString().slice(0, 10);

    const ingresos = await sb.get('ingreso', `select=monto,fecha&fecha=gte.${desde}`);
    const totales = { Sábado: 0, Domingo: 0 };
    let fechaSab = null, fechaDom = null;

    ingresos.forEach(i => {
      const f = new Date(i.fecha);
      const dia = f.getDay(); // 0 = domingo, 6 = sábado
      if (dia === 6) { totales['Sábado']  += Number(i.monto); fechaSab = f; }
      if (dia === 0) { totales['Domingo'] += Number(i.monto); fechaDom = f; }
    });

    const fmtFecha = f => f ? f.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '—';

    cont.innerHTML = `
      <div>
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-light)">Sábado (${fmtFecha(fechaSab)})</div>
        <div style="font-family:var(--heading-font);font-size:1.8rem;color:var(--accent-color)">${fmt(totales['Sábado'])}</div>
      </div>
      <div>
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-light)">Domingo (${fmtFecha(fechaDom)})</div>
        <div style="font-family:var(--heading-font);font-size:1.8rem;color:var(--accent-color)">${fmt(totales['Domingo'])}</div>
      </div>
      <div>
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-light)">Total</div>
        <div style="font-family:var(--heading-font);font-size:1.8rem;color:var(--success)">${fmt(totales['Sábado'] + totales['Domingo'])}</div>
      </div>
    `;
  } catch (e) {
    cont.innerHTML = '<p style="color:var(--danger)">No se pudo cargar el resumen.</p>';
  }
}

async function loadCaja() {
  loadResumenFinDeSemana();
  const grid = document.getElementById('cajaGrid');
  grid.innerHTML = '<div class="empty-state"><div class="spinner" style="margin:0 auto"></div><p style="margin-top:1rem">Cargando órdenes…</p></div>';
  try {
    const hoy = new Date().toISOString().slice(0, 10);

    // Traer órdenes de hoy con detalle para calcular total
    const ordenes = await sb.get('orden',
      `select=id,fecha,empleado,numero_mesa,nombre_cliente,detalle_orden(id,cantidad,platillo(id,nombre,precio,categorias(nombre)))&fecha=gte.${hoy}&order=id.desc`
    );

    // Órdenes ya con ingreso registrado
    const ingresos   = await sb.get('ingreso', `select=id_orden&fecha=gte.${hoy}T00:00:00`).catch(() => []);
    const cobradas   = new Set(ingresos.map(i => i.id_orden));
    const pendientes = ordenes.filter(o => !cobradas.has(o.id));

    if (!pendientes.length) {
      grid.innerHTML = '<div class="empty-state"><span class="empty-icon">🎉</span><p>Sin órdenes pendientes de cobro.</p></div>';
      return;
    }

    const empMap = {};
    allEmpleados.forEach(e => { empMap[e.id] = `${e.nombre} ${e.paterno}`; });

    grid.innerHTML = pendientes.map(o => {
      const detalles = o.detalle_orden || [];
      const total    = detalles.reduce((s, d) => s + precioLinea(d), 0);
      const origen   = o.numero_mesa
        ? `🍽️ Mesa ${o.numero_mesa}${o.nombre_cliente ? ' — ' + esc(o.nombre_cliente) : ''}`
        : (o.empleado ? `👨‍💼 ${esc(empMap[o.empleado] || 'Emp. #' + o.empleado)}` : '🛒 Mostrador');
      return `
        <div class="caja-card">
          <div class="caja-card-header">
            <div class="caja-orden-num">Orden #${o.id}</div>
            <span class="caja-badge">⏳ Pendiente</span>
          </div>
          <div class="caja-info">${origen}</div>
          <div class="caja-info">📅 ${new Date(o.fecha).toLocaleString('es-MX')}</div>
          <div class="caja-total">${fmt(total)}</div>
          <div class="caja-actions">
            <button class="btn-primary" onclick="abrirModalPago(${o.id}, ${total})">💳 Cobrar</button>
            <button class="btn-secondary" onclick="verTicket(${o.id}, ${total})">🧾 Ticket</button>
          </div>
        </div>
      `;
    }).join('');
  } catch(e) {
    grid.innerHTML = '<div class="empty-state"><span class="empty-icon">⚠️</span><p>Error al cargar la caja.</p></div>';
    console.error(e);
  }
}

const COMISION_TARJETA = 0.05; // 5% que se le carga al cliente al pagar con tarjeta

function montoConComision(monto, metodo) {
  return metodo === 'Tarjeta' ? monto * (1 + COMISION_TARJETA) : monto;
}

function abrirModalPago(idOrden, total) {
  pagoOrdenActual = idOrden;
  pagoMontoActual = total;
  pagoMetodoActual = 'Efectivo';
  actualizarTotalPago();
  document.querySelectorAll('.pago-metodo-btn').forEach(b => b.classList.remove('selected'));
  document.querySelector('.pago-metodo-btn[data-metodo="Efectivo"]').classList.add('selected');
  openModal('modalPago');
}

function seleccionarMetodo(metodo) {
  pagoMetodoActual = metodo;
  document.querySelectorAll('.pago-metodo-btn').forEach(b => b.classList.remove('selected'));
  document.querySelector(`.pago-metodo-btn[data-metodo="${metodo}"]`).classList.add('selected');
  actualizarTotalPago();
}

function actualizarTotalPago() {
  const total = montoConComision(pagoMontoActual, pagoMetodoActual);
  document.getElementById('pagoTotal').textContent = fmt(total);
  document.getElementById('pagoComisionNota').textContent =
    pagoMetodoActual === 'Tarjeta' ? `Incluye 5% de comisión por pago con tarjeta (base: ${fmt(pagoMontoActual)})` : '';
}

async function procesarPago() {
  if (!pagoOrdenActual) return;
  const montoFinal = montoConComision(pagoMontoActual, pagoMetodoActual);
  try {
    // DDL: tabla "ingreso" tiene id_orden y monto
    await sb.post('ingreso', {
      id_orden: pagoOrdenActual,
      monto:    montoFinal,
      metodo:   pagoMetodoActual
    });
    showToast(`✅ Cobro registrado — ${pagoMetodoActual} — ${fmt(montoFinal)}`);
    closeModal('modalPago');
    loadCaja();
    loadOrdenes();
    loadResumenFinDeSemana();
  } catch(e) {
    showToast('Error al registrar el cobro: ' + (e.message || JSON.stringify(e)), 'error');
  }
}

async function verTicket(idOrden, total) {
  const ticket = document.getElementById('ticketContenido');

  // Traer detalle de la orden para imprimir cada platillo
  let lineasDetalle = '';
  try {
    const detalles = await sb.get('detalle_orden',
      `select=cantidad,nota,platillo(nombre,precio,categorias(nombre))&id_orden=eq.${idOrden}`
    );
    lineasDetalle = detalles.map(d =>
      `<div class="ticket-line"><span>${etiquetaDetalle(d)}${d.nota ? ' — ' + esc(d.nota) : ''}</span><span>${fmt(precioLinea(d))}</span></div>`
    ).join('');
  } catch(e) { lineasDetalle = ''; }

  // Traer datos de la orden para saber si fue tomada por un mesero o es pedido para llevar
  let origenHTML = '';
  try {
    const [orden] = await sb.get('orden', `select=numero_mesa,nombre_cliente,empleado&id=eq.${idOrden}`);
    if (orden?.empleado) {
      const emp = allEmpleados.find(e => e.id === orden.empleado);
      origenHTML = orden.numero_mesa
        ? `<strong>MESA ${orden.numero_mesa}</strong><br>Atendió: ${esc(emp?.nombre || '—')}`
        : `<strong>PARA LLEVAR</strong><br>Atendió: ${esc(emp?.nombre || '—')}`;
    } else {
      origenHTML = orden?.numero_mesa
        ? `<strong>PEDIDO MESA ${orden.numero_mesa}</strong>${orden.nombre_cliente ? '<br>Cliente: ' + esc(orden.nombre_cliente) : ''}`
        : `<strong>PEDIDO PARA LLEVAR</strong>${orden?.nombre_cliente ? '<br>Cliente: ' + esc(orden.nombre_cliente) : ''}`;
    }
  } catch(e) { origenHTML = ''; }

  ticket.innerHTML = `
    <div style="text-align:center;margin-bottom:0.5rem">
      <strong>🌮 CARNITAS DON VIC</strong><br>
      ${new Date().toLocaleString('es-MX')}
    </div>
    <hr class="ticket-divider">
    <div style="text-align:center;margin-bottom:0.5rem">${origenHTML}</div>
    <hr class="ticket-divider">
    <div class="ticket-line"><span>Orden:</span><span>#${idOrden}</span></div>
    <hr class="ticket-divider">
    ${lineasDetalle}
    <hr class="ticket-divider">
    <div class="ticket-line ticket-total"><span>TOTAL</span><span>${fmt(total)}</span></div>
    <hr class="ticket-divider">
    <div style="text-align:center;margin-top:0.5rem">¡Gracias por su visita! 😊</div>
  `;
  openModal('modalTicket');
}

function imprimirTicket() {
  const contenido = document.getElementById('ticketContenido').innerHTML;
  const ventana   = window.open('', '_blank', 'width=400,height=500');
  ventana.document.write(`
    <html><head><title>Ticket</title>
    <style>body{font-family:'Courier New',monospace;font-size:14px;padding:20px}hr{border:none;border-top:1px dashed #999;margin:8px 0}.ticket-line{display:flex;justify-content:space-between}.ticket-total{font-weight:700}</style>
    </head><body>${contenido}</body></html>
  `);
  ventana.document.close();
  ventana.print();
}

/* ════════════════════════════════════════════════
   RESEÑAS / QR
   DDL: tabla "resena" — ver TABLAS_SUPABASE_v2.sql
════════════════════════════════════════════════ */
function generarQRUnico() {
  const wrap = document.getElementById('qrDisplay');
  if (!wrap) return;
  const baseUrl = window.location.href.replace(/admin\.html.*$/, '').replace(/index\.html.*$/, '');
  const url     = `${baseUrl}cliente.html`;
  const qrUrl   = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}&color=C6491E&bgcolor=FBF2DF`;
  wrap.innerHTML = `
    <img src="${qrUrl}" alt="QR Carnitas Don Vic" width="220" height="220"/>
    <p class="qr-url">${esc(url)}</p>
    <button class="btn-secondary" style="margin-top:0.5rem" onclick="window.open('${url}','_blank')">🔗 Abrir enlace</button>
  `;
}

async function loadResenas() {
  const lista      = document.getElementById('resenasLista');
  const statsWrap  = document.getElementById('resenasStats');
  lista.innerHTML  = '<div class="spinner" style="margin:2rem auto"></div>';
  try {
    const data = await sb.get('resena',
      'select=id_resena,numero_mesa,nombre_cliente,calificacion,comentario,fecha&order=fecha.desc&limit=20'
    );
    if (!data.length) {
      lista.innerHTML   = '<p style="color:var(--gris);text-align:center;padding:2rem">Sin reseñas aún. ¡Comparte los QRs!</p>';
      statsWrap.innerHTML = '';
      return;
    }
    const total    = data.length;
    const promedio = (data.reduce((s, r) => s + r.calificacion, 0) / total).toFixed(1);
    const dist     = [5, 4, 3, 2, 1].map(n => ({ stars: n, count: data.filter(r => r.calificacion === n).length }));
    statsWrap.innerHTML = `
      <div class="resena-stat-card"><div class="rsc-num">${promedio}⭐</div><div class="rsc-label">Promedio</div></div>
      <div class="resena-stat-card"><div class="rsc-num">${total}</div><div class="rsc-label">Reseñas</div></div>
      ${dist.map(d => `<div class="resena-stat-card"><div class="rsc-num">${d.count}</div><div class="rsc-label">${'⭐'.repeat(d.stars)}</div></div>`).join('')}
    `;
    lista.innerHTML = data.map(r => `
      <div class="resena-item">
        <div class="resena-stars">${'⭐'.repeat(r.calificacion)}${'☆'.repeat(5 - r.calificacion)}</div>
        <div class="resena-comentario">${esc(r.comentario || '(sin comentario)')}</div>
        <div class="resena-meta">${r.numero_mesa ? 'Mesa ' + esc(r.numero_mesa) : (r.nombre_cliente ? esc(r.nombre_cliente) + ' (para llevar)' : 'Para llevar')} · ${new Date(r.fecha).toLocaleString('es-MX')}</div>
      </div>
    `).join('');
  } catch(e) {
    lista.innerHTML = '<p style="color:var(--rojo)">Error al cargar reseñas. ¿Corriste TABLAS_SUPABASE_v2.sql?</p>';
  }
}

/* [movido a shared.js / cliente.js] */

/* [movido a shared.js / cliente.js] */

/* ════════════════════════════════════════════════
   AGREGAR MÁS A UNA ORDEN EXISTENTE (rondas)
════════════════════════════════════════════════ */
let ordenAmpliarId = null;

function ampliarOrden(idOrden) {
  ordenAmpliarId = idOrden;
  document.getElementById('modalOrdenTitulo').textContent = `Agregar más a la Orden #${idOrden}`;
  document.getElementById('modalOrdenBtnConfirm').textContent = 'Agregar Platillos';
  document.getElementById('modalOrdenAmpliarBanner').style.display = 'block';
  document.getElementById('ordenMetaFields').style.display = 'none';
  openModal('modalOrden');
}

function resetModoModalOrden() {
  ordenAmpliarId = null;
  document.getElementById('modalOrdenTitulo').textContent = 'Apertura de Orden';
  document.getElementById('modalOrdenBtnConfirm').textContent = 'Confirmar Orden';
  document.getElementById('modalOrdenAmpliarBanner').style.display = 'none';
  document.getElementById('ordenMetaFields').style.display = 'block';
}

async function agregarRondaOrden() {
  const items = Object.entries(carrito);
  if (!items.length) return showToast('Agrega al menos un platillo', 'error');

  try {
    const existentes = await sb.get('detalle_orden', `select=ronda&id_orden=eq.${ordenAmpliarId}`);
    const rondaActual = existentes.length ? Math.max(...existentes.map(d => d.ronda || 1)) + 1 : 1;

    const detalles = items.map(([id, v]) => ({
      id_orden:    ordenAmpliarId,
      id_platillo: v.idPlatillo ? parseInt(v.idPlatillo) : parseInt(id),
      cantidad:    v.cantidad,
      nota:        notaFinal(v),
      ronda:       rondaActual,
      entregado:   false
    }));
    await sb.post('detalle_orden', detalles);
    await sb.patch('orden', `id=eq.${ordenAmpliarId}`, { estado: 'pendiente' });

    showToast(`✅ Ronda ${rondaActual} agregada a la Orden #${ordenAmpliarId}`);
    closeModal('modalOrden');
    limpiarCarrito();
    resetModoModalOrden();
    loadCocina();
    loadOrdenes();
    loadStats();
  } catch(e) {
    showToast('Error al agregar platillos: ' + (e.message || JSON.stringify(e)), 'error');
  }
}

/* ════════════════════════════════════════════════
   COCINA / TAQUERO — tablero de pedidos por preparar,
   agrupado por ronda (para no repetir lo ya entregado)
════════════════════════════════════════════════ */
let comandasCache = {};

async function loadCocina() {
  const grid = document.getElementById('cocinaGrid');
  grid.innerHTML = '<div class="empty-state"><div class="spinner" style="margin:0 auto"></div><p style="margin-top:1rem">Cargando comandas…</p></div>';
  try {
    const hoy = new Date().toISOString().slice(0, 10);
    const ordenes = await sb.get('orden',
      `select=id,fecha,numero_mesa,nombre_cliente,estado,empleado,detalle_orden(id,cantidad,nota,ronda,entregado,platillo(nombre,categorias(nombre)))&fecha=gte.${hoy}&order=id.asc`
    );
    const activas = ordenes.filter(o => (o.detalle_orden || []).some(d => !d.entregado));
    comandasCache = {};
    activas.forEach(o => { comandasCache[o.id] = o; });

    if (!activas.length) {
      grid.innerHTML = '<div class="empty-state"><span class="empty-icon">🎉</span><p>No hay comandas pendientes.</p></div>';
      return;
    }
    const empMap = {};
    allEmpleados.forEach(e => { empMap[e.id] = `${e.nombre} ${e.paterno}`; });

    grid.innerHTML = activas.map(o => {
      const detalles = o.detalle_orden || [];
      const origen = o.numero_mesa
        ? `🍽️ Mesa ${o.numero_mesa}${o.nombre_cliente ? ' — ' + esc(o.nombre_cliente) : ''}`
        : (o.empleado ? `👨‍💼 ${esc(empMap[o.empleado] || 'Mostrador')}` : '🛒 Mostrador');

      const rondas = {};
      detalles.forEach(d => { (rondas[d.ronda || 1] = rondas[d.ronda || 1] || []).push(d); });
      const numRondas = Object.keys(rondas).length;

      const lineasHTML = Object.keys(rondas).sort((a,b) => a - b).map(r => {
        const items = rondas[r];
        const tituloRonda = numRondas > 1 ? `<div style="font-size:11px;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:.5px;margin:.5rem 0 .25rem">Ronda ${r}</div>` : '';
        const itemsHTML = items.map(d => `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:2px 0;${d.entregado ? 'opacity:.5;text-decoration:line-through;' : ''}">
            <span style="flex:1">
              ${etiquetaDetalle(d)}
              ${d.nota ? `<br/><span style="font-size:12px;color:var(--accent-color);text-decoration:none;">↳ ${esc(d.nota)}</span>` : ''}
            </span>
            ${d.entregado
              ? '<span style="font-size:11px;white-space:nowrap;">✅ Dado</span>'
              : `<button class="action-btn" style="padding:2px 8px;font-size:11px;white-space:nowrap;" onclick="event.stopPropagation(); marcarLineaEntregada(${d.id}, ${o.id})">✅ Entregar</button>`}
          </div>
        `).join('');
        return tituloRonda + itemsHTML;
      }).join('');

      return `
        <div class="orden-card">
          <div onclick="abrirComandaGrande(${o.id})" style="cursor:pointer;">
            <div class="orden-header">
              <div class="orden-mesa-num">N.° ${o.id}</div>
              <span class="badge badge-activa">${esc(o.estado)}</span>
            </div>
            <div style="font-size:13px;color:var(--text-light);margin-bottom:.5rem">${origen}</div>
            <div style="font-size:14px;margin-bottom:.5rem">
              ${lineasHTML}
            </div>
          </div>
          <button class="action-btn" style="width:100%" onclick="ampliarOrden(${o.id})">➕ Agregar más a esta orden</button>
        </div>
      `;
    }).join('');
  } catch (e) {
    grid.innerHTML = '<div class="empty-state"><span class="empty-icon">⚠️</span><p>Error al cargar comandas. ¿Corriste la migración de ronda/entregado en schema.sql?</p></div>';
    console.error(e);
  }
}

async function marcarLineaEntregada(idDetalle, idOrden) {
  try {
    await sb.patch('detalle_orden', `id=eq.${idDetalle}`, { entregado: true });
    const restantes = await sb.get('detalle_orden', `select=entregado&id_orden=eq.${idOrden}`);
    const todoListo = restantes.every(d => d.entregado);
    await sb.patch('orden', `id=eq.${idOrden}`, { estado: todoListo ? 'entregado' : 'preparando' });
    await loadCocina();
    // Si la comanda grande de esta orden estaba abierta, la refrescamos también
    const modalGrande = document.getElementById('modalComandaGrande');
    if (modalGrande.classList.contains('open') && modalGrande.dataset.ordenId == idOrden) {
      if (comandasCache[idOrden]) abrirComandaGrande(idOrden); else closeModal('modalComandaGrande');
    }
  } catch (e) {
    showToast('Error al marcar como entregado', 'error');
  }
}

function abrirComandaGrande(idOrden) {
  const o = comandasCache[idOrden];
  const modal = document.getElementById('modalComandaGrande');
  if (!o) { return; }
  modal.dataset.ordenId = idOrden;

  const empMap = {};
  allEmpleados.forEach(e => { empMap[e.id] = `${e.nombre} ${e.paterno}`; });
  const origen = o.numero_mesa
    ? `🍽️ Mesa ${o.numero_mesa}${o.nombre_cliente ? ' — ' + esc(o.nombre_cliente) : ''}`
    : (o.empleado ? `👨‍💼 ${esc(empMap[o.empleado] || 'Mostrador')}` : '🛒 Mostrador');

  const detalles = o.detalle_orden || [];
  const rondas = {};
  detalles.forEach(d => { (rondas[d.ronda || 1] = rondas[d.ronda || 1] || []).push(d); });
  const numRondas = Object.keys(rondas).length;

  const cuerpo = Object.keys(rondas).sort((a,b) => a - b).map(r => {
    const items = rondas[r];
    const tituloRonda = numRondas > 1
      ? `<div style="font-size:1rem;font-weight:800;color:var(--accent-color);text-transform:uppercase;letter-spacing:1px;margin:1.5rem 0 .75rem;border-bottom:2px solid var(--border);padding-bottom:.4rem;">Ronda ${r}</div>`
      : '';
    const itemsHTML = items.map(d => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 0;border-bottom:1px dashed var(--border); ${d.entregado ? 'opacity:.5;' : ''}">
        <div style="flex:1;">
          <div style="font-size:1.3rem;font-weight:700;${d.entregado ? 'text-decoration:line-through;' : ''}">${etiquetaDetalle(d)}</div>
          ${d.nota ? `<div style="font-size:1rem;color:var(--accent-color);margin-top:.3rem;">↳ ${esc(d.nota)}</div>` : ''}
        </div>
        ${d.entregado
          ? '<span style="font-size:1rem;white-space:nowrap;font-weight:700;">✅ Dado</span>'
          : `<button class="btn-primary" style="padding:10px 18px;font-size:1rem;white-space:nowrap;" onclick="marcarLineaEntregada(${d.id}, ${o.id})">✅ Entregar</button>`}
      </div>
    `).join('');
    return tituloRonda + itemsHTML;
  }).join('');

  document.getElementById('comandaGrandeContenido').innerHTML = `
    <div style="text-align:center;margin-bottom:1.5rem;">
      <div style="font-family:var(--heading-font);font-size:3rem;color:var(--accent-color);">N.° ${o.id}</div>
      <div style="font-size:1.2rem;color:var(--text-light);margin-top:.3rem;">${origen}</div>
      <span class="badge badge-activa" style="font-size:1rem;margin-top:.5rem;display:inline-block;">${esc(o.estado)}</span>
    </div>
    ${cuerpo}
  `;
  openModal('modalComandaGrande');
}

/* ════════════════════════════════════════════════
   COTIZACIONES DE EVENTOS
   DDL: cotizaciones_evento (nombre, telefono, numero_personas,
        direccion, fecha_evento, comentarios, atendido)
════════════════════════════════════════════════ */
/* [movido a shared.js / cliente.js] */

async function loadCotizaciones() {
  const lista = document.getElementById('cotizacionesLista');
  lista.innerHTML = '<div class="spinner" style="margin:2rem auto"></div>';
  try {
    const data = await sb.get('cotizaciones_evento',
      'select=id,nombre,telefono,numero_personas,direccion,fecha_evento,comentarios,fecha_solicitud,atendido&order=fecha_solicitud.desc&limit=30'
    );
    if (!data.length) {
      lista.innerHTML = '<p style="text-align:center;color:var(--text-light);padding:1rem">Sin solicitudes aún.</p>';
      return;
    }
    lista.innerHTML = data.map(c => `
      <div class="resena-item">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>${esc(c.nombre || 'Sin nombre')} · ${esc(c.telefono)}</strong>
          <span class="badge ${c.atendido ? 'badge-cerrada' : 'badge-activa'}">${c.atendido ? '✓ Contactado' : '● Pendiente'}</span>
        </div>
        <div class="resena-comentario" style="margin-top:.4rem">
          👥 ${c.numero_personas} personas · 📍 ${esc(c.direccion)}
          ${c.fecha_evento ? ' · 📅 ' + new Date(c.fecha_evento + 'T00:00').toLocaleDateString('es-MX') : ''}
        </div>
        ${c.comentarios ? `<div class="resena-comentario" style="margin-top:.2rem;color:var(--text-light)">${esc(c.comentarios)}</div>` : ''}
        <div class="resena-meta">Solicitado ${new Date(c.fecha_solicitud).toLocaleString('es-MX')}</div>
        ${!c.atendido ? `<button class="action-btn" style="margin-top:.5rem" onclick="marcarCotizacionContactada(${c.id})">Marcar como contactado</button>` : ''}
      </div>
    `).join('');
  } catch (e) {
    lista.innerHTML = '<p style="color:var(--danger);text-align:center">Error al cargar. ¿Corriste la migración de cotizaciones_evento en schema.sql?</p>';
    console.error(e);
  }
}

async function marcarCotizacionContactada(id) {
  try {
    await sb.patch('cotizaciones_evento', `id=eq.${id}`, { atendido: true });
    showToast('Marcado como contactado ✅');
    loadCotizaciones();
  } catch (e) {
    showToast('Error al actualizar', 'error');
  }
}

/* ════════════════════════════════════════════════
   ARRANQUE
════════════════════════════════════════════════ */
async function init() {
  if (SUPABASE_URL.includes('TU_PROYECTO') || SUPABASE_KEY.includes('TU_ANON_KEY')) {
    document.getElementById('menuGrid').innerHTML = `
      <div class="menu-loading" style="grid-column:1/-1;padding:4rem;text-align:center">
        <p style="font-size:2rem">⚙️</p>
        <p style="font-weight:700;margin-top:1rem;color:#E63946">Configura Supabase primero</p>
        <p style="color:#6B6558;margin-top:.5rem">Edita el archivo <code>config.js</code> con tus credenciales.</p>
      </div>`;
    return;
  }

  // Carga en paralelo lo que no depende de otros datos
  await Promise.all([
    loadCategorias(),
    loadMeseros(),    // necesario para poblar selector de empleado
  ]);
  loadMenu();
  loadStats();
  loadOrdenes();
  loadMesas();
  loadCocina();
  generarQRUnico();
  cargarRolesEnModal();
  loadCotizaciones();
  aplicarPermisosPorRol();
  loadResumenFinDeSemana();

  // Auto-check notificaciones cada 60 segundos
  checkNotificaciones();
  notifInterval = setInterval(checkNotificaciones, 60000);
}

async function intentarLogin() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn      = document.getElementById('loginBtn');
  const errEl    = document.getElementById('loginError');
  errEl.textContent = '';
  if (!email || !password) { errEl.textContent = 'Escribe tu correo y contraseña.'; return; }

  btn.disabled = true; btn.textContent = 'Entrando…';
  try {
    await sb.signIn(email, password);
    document.getElementById('loginOverlay').style.display = 'none';
    await cargarPerfilYPermisos();
    init();
  } catch (e) {
    errEl.textContent = 'Correo o contraseña incorrectos.';
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
}

function cerrarSesion() {
  sb.signOut();
  location.reload();
}

/* ── Permisos por rol: "admin" (dueño/principal) ve todo;
   "mesero" solo ve Órdenes, Cocina y Caja (sin el total del fin
   de semana ni Eventos). El rol se guarda en la tabla "perfiles". ── */
let rolActual = 'mesero'; // por seguridad, el más restringido por defecto hasta confirmar

async function cargarPerfilYPermisos() {
  try {
    const sesion = sb.getSesion();
    const userId = sesion?.user?.id;
    if (!userId) { rolActual = 'mesero'; aplicarPermisosPorRol(); return; }
    const [perfil] = await sb.get('perfiles', `select=rol&id=eq.${userId}`);
    rolActual = perfil?.rol === 'admin' ? 'admin' : 'mesero';
  } catch (e) {
    rolActual = 'mesero';
  }
  aplicarPermisosPorRol();
}

function aplicarPermisosPorRol() {
  const esAdmin = rolActual === 'admin';
  // Secciones que SOLO ve el principal/admin — el mesero solo debe ver
  // Órdenes, Cocina y Caja (que no están en esta lista, así que siempre
  // quedan visibles para ambos roles).
  const idsSoloAdmin = ['menu', 'inventario', 'meseros', 'eventos', 'resenas'];
  idsSoloAdmin.forEach(id => {
    // Esconde el link en el menú de navegación
    const link = document.querySelector(`.nav-links a[href="#${id}"]`);
    if (link) link.closest('li').style.display = esAdmin ? '' : 'none';
    // Esconde la sección completa en sí — así aunque el mesero entre
    // por URL directa (ej. admin.html#resenas) o haga scroll, no la ve.
    const seccion = document.getElementById(id);
    if (seccion) seccion.style.display = esAdmin ? '' : 'none';
  });
  const resumen = document.getElementById('resumenFinSemana');
  if (resumen) resumen.style.display = esAdmin ? 'block' : 'none';
}

document.addEventListener('DOMContentLoaded', async () => {
  if (sb.getSesion()) {
    document.getElementById('loginOverlay').style.display = 'none';
    await cargarPerfilYPermisos();
    init();
  } else {
    document.getElementById('loginOverlay').style.display = 'flex';
  }
});
