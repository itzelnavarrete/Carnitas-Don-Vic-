-- ═══════════════════════════════════════════════════════════
--  CARNITAS DON VIC — Esquema de base de datos (Supabase/Postgres)
--  Corre TODO este archivo en: Supabase → SQL Editor → New query
--  Este esquema es exactamente el que espera app.js (nombres de
--  tabla y columnas). No los renombres sin actualizar app.js.
-- ═══════════════════════════════════════════════════════════

-- ── Categorías del menú (Tacos, Bebidas, Extras, etc.) ──
create table categorias (
  id     serial primary key,
  nombre text not null
);

-- ── Platillos (tacos, órdenes, bebidas...) ──
create table platillo (
  id            serial primary key,
  nombre        text not null,
  precio        numeric(10,2) not null,
  id_categorias integer references categorias(id) on delete set null,
  activo        boolean not null default true,   -- false = "agotado hoy", se oculta a clientes
  imagen_url    text   -- foto real del platillo (ej. "img/taco-maciza.jpg"); si es null, se usa el ícono
);

-- ── Ingredientes (insumos: carne, tortillas, cebolla, etc.) ──
create table ingredientes (
  id      serial primary key,
  nombre  text not null,
  unidad  text not null,       -- 'KG' | 'PZ' | 'LTS'
  minimo  numeric(10,2) not null default 0
);

-- ── Existencias actuales por ingrediente ──
create table inventario (
  id             serial primary key,
  id_ingrediente integer references ingredientes(id) on delete cascade,
  cantidad       numeric(10,2) not null default 0,
  dia            text   -- 'Sábado' | 'Domingo' | null (para insumos que no se planean por día, ej. refrescos)
);

-- ── Roles del personal (Cocinero, Cajero, Repartidor...) ──
create table roles (
  id         serial primary key,
  nombre_rol text not null
);

-- ── Empleados ──
create table empleado (
  id            serial primary key,
  nombre        text not null,
  paterno       text not null,
  telefono      text,
  fecha_ingreso date default current_date,
  fecha_egreso  date,
  turno         text,          -- 'Mañana' | 'Tarde' | 'Noche'
  rol           integer references roles(id) on delete set null
);

-- ── Mesas del local (identificadas por nombre, ej. "Banqueta", "Poste") ──
create table mesa (
  id_mesa         serial primary key,
  numero          text not null unique,   -- nombre/identificador de la mesa, no un número
  estado          boolean not null default false,   -- false = libre, true = ocupada
  id_orden_activa integer,
  hora_ocupada    timestamptz
);

-- ── Órdenes ──
create table orden (
  id             serial primary key,
  fecha          timestamptz not null default now(),
  empleado       integer references empleado(id) on delete set null,
  numero_mesa    text,                    -- nombre de la mesa (ej. "Poste"), si el pedido fue hecho desde su QR
  nombre_cliente text,                    -- nombre opcional que da el cliente al pedir
  estado         text not null default 'pendiente'
                 check (estado in ('pendiente','preparando','listo','entregado'))
);

-- ── Detalle de cada orden (qué platillos, cuántos) ──
create table detalle_orden (
  id          serial primary key,
  id_orden    integer references orden(id) on delete cascade,
  id_platillo integer references platillo(id) on delete set null,
  cantidad    integer not null default 1,
  nota        text,   -- instrucciones especiales, ej. "combinado: maciza + buche", "sin cebolla"
  ronda       integer not null default 1,      -- 1 = primera tanda, 2 = "quiero más" después, etc.
  entregado   boolean not null default false   -- true = ya se le dio al cliente (no repetir)
);

-- ── Cobros / caja ──
create table ingreso (
  id         serial primary key,
  id_orden   integer references orden(id) on delete cascade,
  monto      numeric(10,2) not null,
  fecha      timestamptz not null default now(),
  metodo     text,             -- 'Efectivo' | 'Tarjeta' | 'Transferencia'
  comensales integer default 1
);

-- ── Reseñas públicas (QR por mesa) ──
create table resena (
  id_resena    serial primary key,
  numero_mesa  text not null,
  calificacion integer not null check (calificacion between 1 and 5),
  comentario   text,
  fecha        timestamptz not null default now()
);

-- ── Solicitudes de cotización de eventos ──
create table cotizaciones_evento (
  id               serial primary key,
  nombre           text,
  telefono         text not null,
  numero_personas  integer not null,
  direccion        text not null,
  fecha_evento     date,
  comentarios      text,
  fecha_solicitud  timestamptz not null default now(),
  atendido         boolean not null default false
);

-- ── Perfil de administrador (login del panel) ──
-- Vinculado a Supabase Auth. Cuando crees un usuario en
-- Authentication → Users, copia su UUID y agrégalo aquí:
--   insert into perfiles (id, email, rol)
--   values ('UUID-DEL-USUARIO', 'donviccarnitas01@gmail.com', 'admin');
create table perfiles (
  id    uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  rol   text not null default 'admin'
);

-- ═══════════════════════════════════════════════════════════
--  DATOS INICIALES — puedes editar/agregar más después desde la página
-- ═══════════════════════════════════════════════════════════
insert into categorias (nombre) values
  ('Tacos'), ('Antojitos'), ('Órdenes por kilo'), ('Extras y salsas'), ('Bebidas');

insert into roles (nombre_rol) values
  ('Cocinero'), ('Cajero'), ('Mesero'), ('Repartidor');

-- ═══════════════════════════════════════════════════════════
--  SEGURIDAD (RLS) — modo desarrollo: acceso abierto con la anon key.
--  Esto es válido para un proyecto escolar/demo. Si más adelante lo
--  pones en producción con dinero real, hay que restringir estas
--  políticas (por ejemplo: solo lectura pública, escritura solo
--  autenticada).
-- ═══════════════════════════════════════════════════════════
alter table categorias      enable row level security;
alter table platillo        enable row level security;
alter table ingredientes    enable row level security;
alter table inventario      enable row level security;
alter table roles           enable row level security;
alter table empleado        enable row level security;
alter table mesa            enable row level security;
alter table orden           enable row level security;
alter table detalle_orden   enable row level security;
alter table ingreso         enable row level security;
alter table resena          enable row level security;
alter table cotizaciones_evento enable row level security;
alter table perfiles        enable row level security;

create policy "acceso_total_dev" on categorias    for all using (true) with check (true);
create policy "acceso_total_dev" on platillo      for all using (true) with check (true);
create policy "acceso_total_dev" on ingredientes  for all using (true) with check (true);
create policy "acceso_total_dev" on inventario    for all using (true) with check (true);
create policy "acceso_total_dev" on roles         for all using (true) with check (true);
create policy "acceso_total_dev" on empleado      for all using (true) with check (true);
create policy "acceso_total_dev" on mesa          for all using (true) with check (true);
create policy "acceso_total_dev" on orden         for all using (true) with check (true);
create policy "acceso_total_dev" on detalle_orden for all using (true) with check (true);
create policy "acceso_total_dev" on ingreso       for all using (true) with check (true);
create policy "acceso_total_dev" on resena        for all using (true) with check (true);
create policy "acceso_total_dev" on cotizaciones_evento for all using (true) with check (true);

-- perfiles: cada quien solo puede leer su propio perfil (para el login)
create policy "leer_propio_perfil" on perfiles for select using (auth.uid() = id);

-- ═══════════════════════════════════════════════════════════
--  MIGRACIÓN — solo necesaria si YA habías corrido una versión
--  anterior de este archivo (con la tabla "orden" sin estas
--  columnas). Si es tu primera vez corriendo schema.sql, ignora
--  este bloque, ya está incluido arriba.
-- ═══════════════════════════════════════════════════════════
-- alter table orden add column if not exists numero_mesa integer;
-- alter table orden add column if not exists nombre_cliente text;
-- alter table orden add column if not exists estado text not null default 'pendiente'
--   check (estado in ('pendiente','preparando','listo','entregado'));
--
-- create table if not exists cotizaciones_evento (
--   id               serial primary key,
--   nombre           text,
--   telefono         text not null,
--   numero_personas  integer not null,
--   direccion        text not null,
--   fecha_evento     date,
--   comentarios      text,
--   fecha_solicitud  timestamptz not null default now(),
--   atendido         boolean not null default false
-- );
-- alter table cotizaciones_evento enable row level security;
-- create policy "acceso_total_dev" on cotizaciones_evento for all using (true) with check (true);
--
-- alter table detalle_orden add column if not exists nota text;
--
-- alter table platillo add column if not exists activo boolean not null default true;
--
-- ── Cambiar mesas de número a nombre (Banqueta, Camión, Poste, etc.) ──
-- ⚠️ Solo corre esto UNA VEZ. Borra las mesas viejas numeradas y las
-- vuelve a crear con nombre. Si ya tienes órdenes o reseñas ligadas a
-- números de mesa viejos, esos quedarán con su número anterior como texto.
-- alter table orden  alter column numero_mesa type text using numero_mesa::text;
-- alter table resena alter column numero_mesa type text using numero_mesa::text;
-- delete from mesa;
-- alter table mesa alter column numero type text using numero::text;
-- insert into mesa (numero, estado) values
--   ('Banqueta', false), ('Camión Izquierdo', false), ('Camión Derecho', false),
--   ('Poste', false), ('Carmen', false), ('Ara', false), ('Palo', false);
--
-- alter table inventario add column if not exists dia text;
--
-- alter table detalle_orden add column if not exists ronda integer not null default 1;
-- alter table detalle_orden add column if not exists entregado boolean not null default false;
--
-- alter table platillo add column if not exists imagen_url text;
