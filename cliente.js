

let carrito = {};              // { id_platillo: { nombre, precio, cantidad, categoria } }
let estrellaSeleccionada = 0;
let bebidasDisponibles = [];   // se llena en loadMenuPublico, para las promos
let promo3TacosReclamada = false;

// Si vino de un QR de mesa: ?mesa=5  →  se liga el pedido/reseña a esa mesa.
// Si no, es "para llevar / mostrador" (numero_mesa null) y se pide la mesa
// manualmente solo en la reseña, por si el cliente quiere dejarla después.
const mesaActual = new URLSearchParams(window.location.search).get('mesa');

// Recargo de $10 por kilo en carne cuando es PARA COMER EN EL NEGOCIO (dine-in).
// Para llevar no aplica.
const RECARGO_KG_COMER_AQUI = mesaActual ? 10 / 1000 : 0; // por gramo

// Link directo para dejar reseña en la ficha real de Google del negocio
// (place_id fijo — no cambia). Se usa tanto en el carrusel como al
// terminar de enviar una reseña aquí.
const GOOGLE_REVIEW_URL = 'https://search.google.com/local/writereview?placeid=ChIJNwvxFDP60YUR90ryIu0r_vE';

/* ════════════════════════════════════════════════
   MENÚ + PEDIDO
════════════════════════════════════════════════ */
const ORDEN_CATEGORIAS = ['Tacos', 'Tortas', 'Quesadillas y Gorditas', 'Órdenes por kilo', 'Bebidas'];

async function loadMenuPublico() {
  const wrap = document.getElementById('menuPublicoGrid');
  try {
    const platillos = await sb.get('platillo', 'select=id,nombre,precio,imagen_url,categorias(nombre)&activo=eq.true&order=nombre.asc');
    if (!platillos.length) {
      wrap.innerHTML = '<div class="empty-state"><p>El menú no está disponible ahora mismo.</p></div>';
      return;
    }

    // Guardamos las bebidas disponibles para poder ofrecerlas en las promociones
    bebidasDisponibles = platillos.filter(p => p.categorias?.nombre === 'Bebidas');

    // Agrupar por categoría
    const grupos = {};
    platillos.forEach(p => {
      const cat = p.categorias?.nombre || 'Otros';
      (grupos[cat] = grupos[cat] || []).push(p);
    });

    // Orden fijo: Tacos → Antojitos → Órdenes por kilo → Bebidas → cualquier otra al final
    const categoriasOrdenadas = [
      ...ORDEN_CATEGORIAS.filter(c => grupos[c]),
      ...Object.keys(grupos).filter(c => !ORDEN_CATEGORIAS.includes(c))
    ];

    wrap.innerHTML = categoriasOrdenadas.map(cat => `
      <div class="menu-cat-seccion">
        <h3 class="menu-cat-titulo">${esc(cat)}</h3>
        <div class="menu-grid">
          ${grupos[cat].map(p => tarjetaPlatillo(p)).join('')}
        </div>
      </div>
    `).join('');
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state">
      <p>⚠️ No pudimos cargar el menú en este momento.</p>
      <p style="font-size:13px;margin-top:.5rem;color:var(--text-light)">
        Intenta recargar la página, o si tienes un bloqueador de anuncios activado,
        prueba desactivándolo para este sitio. Si el problema sigue, pídele ayuda al personal.
      </p>
      <button class="btn-primary" style="margin-top:1rem" onclick="location.reload()">Reintentar</button>
    </div>`;
    console.error(e);
  }
}

function catKey(nombreCategoria) {
  const c = (nombreCategoria || '').toLowerCase();
  if (c.includes('bebida')) return 'bebidas';
  if (c.includes('torta')) return 'tortas';
  if (c.includes('quesadilla') || c.includes('gordita') || c.includes('antojito')) return 'antojitos';
  if (c.includes('kilo') || c.includes('orden')) return 'kilo';
  return 'tacos';
}

function tarjetaPlatillo(p) {
  const esPeso = p.categorias?.nombre === 'Órdenes por kilo' && !/chamorro/i.test(p.nombre);
  const precioEfectivo = esPeso ? p.precio + RECARGO_KG_COMER_AQUI : p.precio;
  const accion = esPeso
    ? `abrirModalPeso(${p.id}, '${esc(p.nombre)}', ${precioEfectivo})`
    : `agregarAlCarrito(${p.id}, '${esc(p.nombre)}', ${p.precio}, '${esc(p.categorias?.nombre || '')}')`;

  // Los refrescos de marca (Coca-Cola, Fanta, Boing, etc.) no llevan ícono
  // ni foto — solo texto. Las aguas de sabor (hechas por el negocio) sí.
  const esRefrescoDeMarca = p.categorias?.nombre === 'Bebidas' && !/^agua de/i.test(p.nombre);

  return `
    <div class="menu-card" data-cat="${catKey(p.categorias?.nombre)}" id="tarjeta-${p.id}" onclick="animarTarjeta(${p.id}); ${accion}">
      ${esRefrescoDeMarca ? '' : `
      <div class="menu-card-plato">
        ${p.imagen_url
          ? `<img src="${esc(p.imagen_url)}" alt="${esc(p.nombre)}" class="menu-card-foto"/>`
          : `<div class="menu-card-emoji">${getEmoji(p.nombre)}</div>`}
      </div>`}
      <span class="menu-card-cat ${catClass(p.categorias?.nombre)}">${esc(p.categorias?.nombre || '')}</span>
      <h3>${esc(p.nombre)}</h3>
      ${/combinad|doble/i.test(p.nombre) ? '<p style="font-size:12px;color:var(--accent-color);margin:-.5rem 0 .5rem">Elige tu(s) carne(s) en "Nota" al agregarlo a tu pedido</p>' : ''}
      <div class="menu-card-footer">
        <div class="menu-price">${esPeso ? fmt(precioEfectivo * 1000) + ' / kg' : fmt(p.precio)}</div>
        <span class="menu-add-hint">${esPeso ? 'Elige la cantidad' : 'Toca para agregar'}</span>
      </div>
      ${esPeso && RECARGO_KG_COMER_AQUI ? '<p style="font-size:11px;color:var(--text-light);margin-top:.3rem">Incluye +$10/kg por consumir aquí</p>' : ''}
    </div>
  `;
}

function animarTarjeta(id) {
  const card = document.getElementById(`tarjeta-${id}`);
  if (!card) return;
  card.classList.remove('recien-agregado');
  void card.offsetWidth; // reinicia la animación aunque se toque varias veces seguidas
  card.classList.add('recien-agregado');

  const flotante = document.createElement('span');
  flotante.className = 'flotante-mas-uno';
  flotante.textContent = '+1';
  card.appendChild(flotante);
  setTimeout(() => flotante.remove(), 900);
}

function agregarAlCarrito(id, nombre, precio, categoria = '') {
  // Los "combinados"/"dobles" se agregan como línea separada cada vez,
  // porque cada uno puede llevar una nota distinta (ej. distinta carne).
  // Fusionarlos por cantidad perdería esa información.
  if (/combinad|doble/i.test(nombre)) {
    const key = `combo_${id}_${Date.now()}`;
    carrito[key] = { idPlatillo: id, nombre, precio, cantidad: 1, nota: '', categoria };
    renderCarrito();
    showToast(`${nombre} agregado — no olvides su nota`);
    return;
  }
  if (!carrito[id]) carrito[id] = { nombre, precio, cantidad: 0, nota: '', categoria };
  carrito[id].cantidad++;
  renderCarrito();
  showToast(`${nombre} agregado`);
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
  showToast(`${nombre} (${etiqueta}) agregado`);
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
  showToast(`${nombre} por $${monto} agregado`);
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

function quitarDelCarrito(id) {
  delete carrito[id];
  renderCarrito();
}

function esBebida(v) { return v.categoria === 'Bebidas'; }
function esCombo(v)  { return /combinad|doble/i.test(v.nombre); }
function esTaco(v)   { return v.categoria === 'Tacos'; }
function esTorta(v)  { return v.categoria === 'Tortas'; }
function esGordita(v) { return /gordita/i.test(v.nombre); }
function llevaCebollaCilantro(v) { return esTaco(v) || esTorta(v) || esGordita(v); }
const esParaLlevar = !mesaActual;
let verduraAparteGlobal = false;

function toggleVerduraAparteGlobal() {
  verduraAparteGlobal = !verduraAparteGlobal;
  renderCarrito();
}

function notaFinal(v) {
  const partes = [];
  if (v.nota) partes.push(v.nota);

  if (llevaCebollaCilantro(v)) {
    // Solo se anota lo que se sale de "lo normal" (con cebolla, con
    // cilantro, junto) — así el taquero no ve texto de más.
    const quiereCebolla  = !v.sinCebolla;
    const quiereCilantro = !v.sinCilantro;
    const aparte = esParaLlevar && verduraAparteGlobal;

    if (quiereCebolla && quiereCilantro) {
      if (aparte) partes.push('Aparte');
      // si quiere las dos y no es aparte (lo normal) — no se anota nada
    } else if (quiereCebolla) {
      partes.push(aparte ? 'Con cebolla, aparte' : 'Con cebolla');
    } else if (quiereCilantro) {
      partes.push(aparte ? 'Con cilantro, aparte' : 'Con cilantro');
    } else {
      partes.push('Sin cebolla ni cilantro');
    }
  } else if (!esBebida(v) && !sinExtras(v)) {
    if (v.sinVerdura) partes.push('Sin verdura');
  }
  if (esGordita(v) && v.sinQueso) partes.push('Sin queso');
  return partes.length ? partes.join(' — ') : null;
}

function toggleVerdura(id, valor) {
  if (!carrito[id]) return;
  carrito[id].sinVerdura = valor;
  renderCarrito();
}

function togglePref(id, campo, valor) {
  if (!carrito[id]) return;
  carrito[id][campo] = valor;
  renderCarrito();
}

function sinExtras(v) {
  if (/salsa extra/i.test(v.nombre)) return true;
  if (/quesadilla/i.test(v.nombre) && !esCombo(v)) return true; // quesadillas sencillas
  return false;
}

function renderCarrito() {
  const wrap = document.getElementById('clienteCarrito');
  const items = Object.entries(carrito);
  if (!items.length) {
    wrap.innerHTML = '<p style="text-align:center;color:var(--text-light);font-size:13px">Tu pedido está vacío. Toca un platillo para agregarlo.</p>';
    document.getElementById('clienteTotal').textContent = fmt(0);
    return;
  }
  wrap.innerHTML = items.map(([id, v]) => {
    if (v.esPeso) {
      return `
        <div style="padding:.5rem 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;">
            <span style="flex:1">${esc(v.nombre)}</span>
            <button class="btn-secondary" style="padding:2px 10px" onclick="quitarDelCarrito('${id}')">✕</button>
            <span style="min-width:70px;text-align:right">${fmt(v.precio * v.cantidad)}</span>
          </div>
        </div>`;
    }

    const filaExtra = (esBebida(v) || sinExtras(v)) ? '' : `
      <div style="display:flex; align-items:center; gap:.5rem; margin-top:6px; flex-wrap:wrap;">
        ${esCombo(v) ? `
        <input type="text" placeholder="¿Qué 2 carnes? Ej. maciza + buche"
               value="${esc(v.nota || '')}" oninput="actualizarNota('${id}', this.value)"
               style="flex:1; min-width:140px; padding:6px 10px; font-size:12px; border:1px solid var(--border); border-radius:6px; box-sizing:border-box;"/>
        ` : ''}
        ${llevaCebollaCilantro(v) ? `
          <span style="font-size:12px;color:var(--text-light)">🧅 Cebolla</span>
          <button class="btn-secondary" style="padding:2px 8px; ${!v.sinCebolla ? 'background:var(--success);color:#fff;border-color:var(--success);' : ''}" onclick="togglePref('${id}','sinCebolla',false)">✓</button>
          <button class="btn-secondary" style="padding:2px 8px; ${v.sinCebolla ? 'background:var(--danger);color:#fff;border-color:var(--danger);' : ''}" onclick="togglePref('${id}','sinCebolla',true)">✗</button>
          <span style="font-size:12px;color:var(--text-light);margin-left:6px">🌿 Cilantro</span>
          <button class="btn-secondary" style="padding:2px 8px; ${!v.sinCilantro ? 'background:var(--success);color:#fff;border-color:var(--success);' : ''}" onclick="togglePref('${id}','sinCilantro',false)">✓</button>
          <button class="btn-secondary" style="padding:2px 8px; ${v.sinCilantro ? 'background:var(--danger);color:#fff;border-color:var(--danger);' : ''}" onclick="togglePref('${id}','sinCilantro',true)">✗</button>
          ${esGordita(v) ? `
          <span style="font-size:12px;color:var(--text-light);margin-left:6px">🧀 Queso</span>
          <button class="btn-secondary" style="padding:2px 8px; ${!v.sinQueso ? 'background:var(--success);color:#fff;border-color:var(--success);' : ''}" onclick="togglePref('${id}','sinQueso',false)">✓</button>
          <button class="btn-secondary" style="padding:2px 8px; ${v.sinQueso ? 'background:var(--danger);color:#fff;border-color:var(--danger);' : ''}" onclick="togglePref('${id}','sinQueso',true)">✗</button>
          ` : ''}
        ` : `
          <span style="font-size:12px;color:var(--text-light)">¿Con verdura?</span>
          <button class="btn-secondary" style="padding:2px 10px; ${!v.sinVerdura ? 'background:var(--success);color:#fff;border-color:var(--success);' : ''}" onclick="toggleVerdura('${id}', false)">✓</button>
          <button class="btn-secondary" style="padding:2px 10px; ${v.sinVerdura ? 'background:var(--danger);color:#fff;border-color:var(--danger);' : ''}" onclick="toggleVerdura('${id}', true)">✗</button>
        `}
      </div>`;

    return `
    <div style="padding:.5rem 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;">
        <span style="flex:1">${esc(v.nombre)}</span>
        <button class="btn-secondary" style="padding:2px 10px" onclick="cambiarCantidad('${id}',-1)">−</button>
        <span>${v.cantidad}</span>
        <button class="btn-secondary" style="padding:2px 10px" onclick="cambiarCantidad('${id}',1)">+</button>
        <span style="min-width:70px;text-align:right">${fmt(v.precio * v.cantidad)}</span>
      </div>
      ${filaExtra}
    </div>
  `;
  }).join('');

  const hayTacoOGordita = items.some(([, v]) => llevaCebollaCilantro(v));
  const avisoAparte = (esParaLlevar && hayTacoOGordita) ? `
    <div style="display:flex;align-items:center;gap:.5rem;padding:.75rem 0;border-top:1px solid var(--border);margin-top:.5rem;">
      <span style="font-size:13px;flex:1">¿Quieres tu verdura (cebolla/cilantro) aparte para todo el pedido?</span>
      <button class="btn-secondary" style="padding:4px 12px; ${verduraAparteGlobal ? 'background:var(--marigold);color:#2B2018;border-color:var(--marigold);' : ''}" onclick="toggleVerduraAparteGlobal()">${verduraAparteGlobal ? '✓ Aparte' : 'Junto'}</button>
    </div>` : '';
  wrap.innerHTML += avisoAparte;

  const total = items.reduce((s, [, v]) => s + v.precio * v.cantidad, 0);
  document.getElementById('clienteTotal').textContent = fmt(total);
  renderPromoBanner();
  actualizarCarritoFlotante(items, total);
}

function actualizarCarritoFlotante(items, total) {
  const barra = document.getElementById('carritoFlotante');
  if (!barra) return;
  if (!items.length) { barra.style.display = 'none'; return; }
  barra.style.display = 'flex';
  // Contamos líneas de producto, no la cantidad cruda (los pesos usan gramos
  // como "cantidad" y eso se vería como un número absurdo, ej. "500").
  document.getElementById('cfCantidad').textContent = items.length;
  document.getElementById('cfTotal').textContent = fmt(total);
}

/* ════════════════════════════════════════════════
   PROMOCIONES
   - Primera compra en la página: bebida gratis (1 vez por navegador)
   - 3 tacos o más en el carrito: bebida gratis (agua o refresco)
   Ambas se reclaman UNA vez por pedido y regalan solo bebida (bajo
   costo para el negocio, mientras incentivan comprar más tacos).
════════════════════════════════════════════════ */
function contarTacosEnCarrito() {
  return Object.values(carrito)
    .filter(v => v.categoria === 'Tacos')
    .reduce((s, v) => s + v.cantidad, 0);
}

function yaHayPromoEnCarrito() {
  return Object.values(carrito).some(v => v.esPromo);
}

function renderPromoBanner() {
  const wrap = document.getElementById('promoBanner');
  if (!wrap) return;

  const primeraUsada = localStorage.getItem('cdv_promo_primera_usada') === '1';
  const tacos = contarTacosEnCarrito();
  const hayPromoYaEnCarrito = yaHayPromoEnCarrito();

  if (hayPromoYaEnCarrito) {
    wrap.innerHTML = `<div class="promo-activa">🎁 ¡Ya tienes tu bebida de regalo en el pedido!</div>`;
    return;
  }

  if (!primeraUsada) {
    wrap.innerHTML = `
      <div class="promo-disponible">
        <strong>🎉 ¡Bienvenido! Es tu primera compra aquí — llévate una bebida gratis.</strong>
        ${selectorBebidaPromo('primera')}
      </div>`;
    return;
  }

  if (tacos >= 3) {
    wrap.innerHTML = `
      <div class="promo-disponible">
        <strong>🌮 ¡Llevas ${tacos} tacos! Te regalamos una bebida (agua o refresco).</strong>
        ${selectorBebidaPromo('3tacos')}
      </div>`;
    return;
  }

  wrap.innerHTML = tacos > 0
    ? `<div class="promo-hint">🌮 Agrega ${3 - tacos} taco${3 - tacos === 1 ? '' : 's'} más y te regalamos una bebida.</div>`
    : '';
}

function selectorBebidaPromo(tipo) {
  if (!bebidasDisponibles.length) return '<p style="font-size:12px;margin-top:.5rem">Cargando bebidas…</p>';
  return `
    <div style="display:flex;gap:.5rem;margin-top:.6rem;">
      <select id="promoBebidaSel-${tipo}" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;">
        ${bebidasDisponibles.map(b => `<option value="${b.id}" data-nombre="${esc(b.nombre)}">${esc(b.nombre)}</option>`).join('')}
      </select>
      <button class="btn-primary" style="padding:6px 14px;font-size:13px;" onclick="reclamarPromo('${tipo}')">Reclamar</button>
    </div>`;
}

function reclamarPromo(tipo) {
  const sel = document.getElementById(`promoBebidaSel-${tipo}`);
  if (!sel || !sel.value) return;
  const idBebida = parseInt(sel.value);
  const nombreBebida = sel.selectedOptions[0].dataset.nombre;
  const etiqueta = tipo === 'primera' ? 'Bienvenida' : '3 Tacos';

  const key = `promo_${tipo}_${Date.now()}`;
  carrito[key] = {
    idPlatillo: idBebida,
    nombre: `${nombreBebida} 🎁 (Promo ${etiqueta} — gratis)`,
    precio: 0,
    cantidad: 1,
    nota: `PROMO ${etiqueta}`,
    categoria: 'Bebidas',
    esPromo: true
  };
  if (tipo === 'primera') localStorage.setItem('cdv_promo_primera_usada', '1');
  showToast(`¡${nombreBebida} de regalo agregada! 🎉`);
  renderCarrito();
}

async function enviarPedido() {
  const items = Object.entries(carrito);
  if (!items.length) return showToast('Agrega al menos un platillo', 'error');
  const nombreCliente = document.getElementById('clienteNombre').value.trim();

  try {
    const [orden] = await sb.post('orden', {
      numero_mesa:    mesaActual || null,
      nombre_cliente: nombreCliente || null,
      estado:         'pendiente'
      // numero_dia (el "N.° 1, 2, 3..." que se reinicia cada día) lo calcula
      // solo un trigger en Supabase — no hace falta mandarlo desde aquí.
    });
    const detalles = items.map(([id, v]) => ({
      id_orden:    orden.id,
      id_platillo: v.idPlatillo || parseInt(id),
      cantidad:    v.cantidad,
      nota:        notaFinal(v)
    }));
    await sb.post('detalle_orden', detalles);

    document.getElementById('clienteCarrito').innerHTML = '';
    document.getElementById('clienteTotal').parentElement.style.display = 'none';
    document.getElementById('clienteNombre').style.display = 'none';
    document.getElementById('clienteNombre').previousElementSibling.style.display = 'none';
    document.querySelector('#pedido button[onclick="enviarPedido()"]').style.display = 'none';

    const conf = document.getElementById('pedidoConfirmado');
    conf.style.display = 'block';
    conf.innerHTML = `
      <div style="font-size:3rem">🌮</div>
      <h3 style="margin-top:0.5rem">¡Pedido recibido!</h3>
      <div style="font-family:var(--heading-font);font-size:2.2rem;color:var(--accent-color);margin:0.75rem 0">N.° ${orden.numero_dia}</div>
      <p style="color:var(--text-light);font-size:14px">
        ${nombreCliente ? `Gracias, ${esc(nombreCliente)}. ` : ''}Guarda tu número de pedido — te avisaremos cuando esté listo.
      </p>`;
    carrito = {};
  } catch (e) {
    showToast('Error al enviar el pedido: ' + (e.message || JSON.stringify(e)), 'error');
  }
}

/* ════════════════════════════════════════════════
   COTIZACIÓN DE EVENTOS
════════════════════════════════════════════════ */
async function enviarCotizacionEvento() {
  const nombre      = document.getElementById('evt-nombre').value.trim();
  const telefono    = document.getElementById('evt-telefono').value.trim();
  const personas    = document.getElementById('evt-personas').value.trim();
  const direccion   = document.getElementById('evt-direccion').value.trim();
  const fechaEvento = document.getElementById('evt-fecha').value;
  const comentarios = document.getElementById('evt-comentarios').value.trim();

  if (!telefono)  return showToast('Escribe tu número de teléfono', 'error');
  if (!personas)  return showToast('Indica el número de personas', 'error');
  if (!direccion) return showToast('Escribe la dirección del evento', 'error');

  try {
    await sb.postSinRetorno('cotizaciones_evento', {
      nombre:          nombre || null,
      telefono,
      numero_personas: parseInt(personas),
      direccion,
      fecha_evento:    fechaEvento || null,
      comentarios:     comentarios || null
    });
    showToast('¡Solicitud enviada! Te contactaremos pronto 📞');
    ['evt-nombre','evt-telefono','evt-personas','evt-direccion','evt-fecha','evt-comentarios']
      .forEach(id => document.getElementById(id).value = '');
  } catch (e) {
    showToast('Error al enviar la solicitud: ' + (e.message || JSON.stringify(e)), 'error');
  }
}

/* ════════════════════════════════════════════════
   RESEÑA
════════════════════════════════════════════════ */
function seleccionarEstrella(n) {
  estrellaSeleccionada = n;
  document.querySelectorAll('.star-btn').forEach((b, i) => {
    b.textContent = i < n ? '⭐' : '☆';
  });
}

async function enviarResena() {
  const comentario = document.getElementById('resenaComentario').value.trim();
  const nombreManual = document.getElementById('resenaNombreManual')?.value.trim();
  if (!estrellaSeleccionada) return showToast('Selecciona una calificación', 'error');
  if (!nombreManual) return showToast('Escribe tu nombre', 'error');
  try {
    await sb.post('resena', {
      numero_mesa:    null,
      nombre_cliente: nombreManual,
      calificacion:   estrellaSeleccionada,
      comentario
    });
    // El botón de Google se muestra SIEMPRE, sin importar la calificación
    // que haya dado el cliente — filtrar por calificación ("review gating")
    // va contra las políticas de Google y puede penalizar la ficha del negocio.
    document.querySelector('#resena .qr-panel').innerHTML = `
      <div style="font-size:4rem">🎉</div>
      <h2>¡Gracias!</h2>
      <p style="color:var(--text-light);margin-top:1rem">Tu opinión nos ayuda a mejorar. ¡Vuelve pronto!</p>
      <div class="google-review-cta">
        <p>¿Nos regalas también una reseña en Google? Nos ayuda muchísimo a que más gente nos encuentre.</p>
        <a href="${GOOGLE_REVIEW_URL}" target="_blank" rel="noopener" class="btn-google">⭐ Escribir reseña en Google</a>
      </div>`;
    showToast('¡Reseña enviada! Gracias 🙏');
    loadResenasCarrusel(); // refresca el carrusel con la nueva reseña
  } catch (e) {
    showToast('Error al enviar: ' + (e.message || JSON.stringify(e)), 'error');
  }
}

/* ════════════════════════════════════════════════
   CARRUSEL DE RESEÑAS ("escalera eléctrica")
   Muestra las reseñas reales más recientes deslizándose sin parar.
   La lista se duplica una vez para que el loop de CSS sea perfecto.
════════════════════════════════════════════════ */
async function loadResenasCarrusel() {
  const track = document.getElementById('resenasCarruselTrack');
  const seccion = document.getElementById('resenasCarrusel');
  if (!track || !seccion) return;
  try {
    const data = await sb.get('resena',
      'select=nombre_cliente,numero_mesa,calificacion,comentario,fecha&order=fecha.desc&limit=12'
    );
    // Sin reseñas todavía: ocultamos la sección completa en vez de
    // mostrar un carrusel vacío.
    if (!data.length) { seccion.style.display = 'none'; return; }
    seccion.style.display = 'block';

    const tarjeta = (r) => `
      <div class="resena-carrusel-card">
        <div class="rc-stars">${'⭐'.repeat(r.calificacion)}${'☆'.repeat(5 - r.calificacion)}</div>
        <div class="rc-comentario">${esc(r.comentario || '¡Excelente!')}</div>
        <div class="rc-autor">${esc(r.nombre_cliente || (r.numero_mesa ? 'Mesa ' + r.numero_mesa : 'Cliente'))}</div>
      </div>`;

    const html = data.map(tarjeta).join('');
    // Se duplica el contenido para que la animación (translateX -50%)
    // haga un loop continuo sin salto visible.
    track.innerHTML = html + html;
  } catch (e) {
    seccion.style.display = 'none';
    console.warn('No se pudo cargar el carrusel de reseñas', e);
  }
}

/* ════════════════════════════════════════════════
   ARRANQUE
════════════════════════════════════════════════ */
function init() {
  if (typeof SUPABASE_URL === 'undefined' || SUPABASE_URL.includes('TU_PROYECTO') || SUPABASE_KEY.includes('TU_ANON_KEY')) {
    document.getElementById('menuPublicoGrid').innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <p style="font-size:2rem">⚙️</p>
        <p style="font-weight:700;margin-top:1rem;color:var(--danger)">Configura Supabase primero</p>
        <p style="color:var(--text-light);margin-top:.5rem">Edita el archivo <code>config.js</code> con tus credenciales.</p>
      </div>`;
    return;
  }

  if (mesaActual) {
    document.getElementById('mesaBanner').textContent = `Mesa ${mesaActual}`;
    document.getElementById('pedidoOrigenTexto').textContent = `Pedido para tu Mesa ${mesaActual}. Selecciona los platillos que quieras.`;
  } else {
    document.getElementById('mesaBanner').textContent = 'Pedido para llevar / mostrador';
  }

  loadMenuPublico();
  renderCarrito();
  loadResenasCarrusel();
}

document.addEventListener('DOMContentLoaded', init);
