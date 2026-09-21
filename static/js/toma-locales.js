/*
 * Toma de locales -- modulo completo.
 *
 * Replica la app de inventario-chiosburger.netlify.app dentro de Control
 * Contable. Alla los 11 usuarios y sus PIN viajaban escritos en el JavaScript
 * publico y el backend no validaba nada.
 *
 * Aqui el acceso sale de la sesion de Control Contable, como en el resto de
 * los modulos: no se vuelve a pedir la contrasena. El servidor resuelve rol,
 * permisos de modulo y bodegas desde goti.usuarios, asi que el navegador no
 * puede atribuirse nada que la base no le reconozca. La contrasena solo se
 * exige para borrar una toma, que es lo unico irreversible.
 *
 * El alcance salio de leer el bundle original, no de suponer. Las columnas del
 * export del original son literalmente:
 *
 *   Codigo | Producto | Categoria | Tipo | Conteo 1 | Conteo 2 | Conteo 3 |
 *   Total | Cantidad a Pedir | Unidad | Unidad Bodega | Equivalencias
 *
 * De ahi salen las TRES ranuras de conteo, el pedido con su unidad propia y
 * las equivalencias.
 *
 * Tres pantallas:
 *   1. Bodegas    -- solo las que el usuario tiene asignadas
 *   2. Conteo     -- captura, filtros, orden, metricas de sesion
 *   3. Historico  -- consulta, detalle, correccion y export a Excel
 *
 * El borrador del conteo si va a localStorage: son cantidades, no credenciales.
 * Ninguna contrasena se guarda en el navegador.
 */

/* global CONFIG, state, showToast */

const TL_RANURAS = 3;              // Conteo 1, 2 y 3, como el original
const TL_TIPOS = ['A', 'B', 'C'];

let tlBodegas = [];
let tlBodega = null;
let tlProductos = [];
let tlCapturas = {};               // codigo -> { c: ['','',''], pedir: '' }
let tlClave = null;                // solo para borrar; nunca se persiste
let tlPantalla = 'bodegas';
let tlInicioSesion = null;         // para la duracion de la toma

// Filtros y vista
let tlFiltro = '';
let tlCategoria = '';
let tlTipo = '';
let tlSoloCero = false;
let tlAgrupar = false;
let tlOrden = 'nombre';            // nombre | tipo | categoria
let tlVista = 'normal';            // normal | compacto -- "Tipo de Vista" del original

// Historico
let tlTomas = [];
let tlDetalle = null;


// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
/* El usuario EFECTIVO, respetando "Ver como...".
   La app permite a un admin simular a otro usuario (state._impersonando) y el
   resto de los modulos ya lo respetan. Este leia state.user a secas, asi que
   al simular a un gerente de Floreana seguia mandando el admin y el servidor
   devolvia las 8 bodegas: la simulacion no servia para comprobar nada.
   Ahora manda el simulado, y el servidor resuelve SUS bodegas y SU rol -- con
   lo que el atajo de admin tampoco se activa. */
function tlUsuarioEfectivo() {
    if (typeof state === 'undefined') return null;
    return state._impersonando || state.user || null;
}

function tlUsuario() {
    const u = tlUsuarioEfectivo();
    return u ? u.username : '';
}

function tlEsc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function tlAviso(msg, tipo) {
    if (typeof showToast === 'function') showToast(msg, tipo || 'info');
    else console.log('[toma-locales] ' + msg);
}

/* Saneado de numeros para mostrar y exportar.
   La base arrastra ruido de coma flotante de la app vieja, que sumaba en
   JavaScript: hay '4.404999999999999' donde el contador escribio 1.5 y 2.905.
   Se redondea a 4 decimales -- la precision que ya usan las tablas toma_* --
   y se quitan los ceros de relleno. El dato guardado no se toca. */
function tlNum(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(',', '.'));
    if (isNaN(n)) return null;
    return Math.round(n * 10000) / 10000;
}

/* El mismo numero como texto. Para un CSV que se abre en Excel es-EC el
   separador decimal es la COMA: con punto, la celda se lee como miles. */
function tlNumTxt(v, dec) {
    const n = tlNum(v);
    if (n === null) return (v === null || v === undefined) ? '' : String(v);
    return String(n).replace('.', dec === undefined ? ',' : dec);
}

function tlHoy() {
    return new Date().toISOString().split('T')[0];
}

/* La identidad va AL FINAL del Object.assign, no al principio. Puesta primero,
   cualquier parametro llamado `usuario` la pisaba: fue exactamente lo que paso
   con el filtro "Todos los usuarios" del historico, que mandaba usuario='' y
   hacia que el servidor respondiera 401.

   `clave` solo se incluye cuando se pide de verdad (borrar una toma); en el
   resto de las llamadas basta el usuario de la sesion. */
function tlCred(extra) {
    const c = Object.assign({}, extra || {}, { usuario: tlUsuario() });
    if (tlClave) c.clave = tlClave;
    return c;
}

function tlClaveBorrador() {
    return 'toma_borrador_' + tlBodega + '_' + tlHoy();
}

/* Suma de una fila. null si hay texto (INACTIVO), igual que el backend: ahi el
   total queda NULL y no en cero, porque cero significa "conte y no habia". */
function tlTotal(ranuras) {
    let total = 0;
    for (const r of ranuras) {
        const s = String(r == null ? '' : r).trim();
        if (s === '') continue;
        const n = Number(s.replace(',', '.'));
        if (isNaN(n)) return null;
        total += n;
    }
    // Redondeo a 4 decimales: sumar 1.5 + 2.905 en coma flotante da
    // 4.404999999999999, y eso es justo lo que la app vieja grababa.
    return Math.round(total * 10000) / 10000;
}

function tlFila(cod) {
    if (!tlCapturas[cod]) {
        tlCapturas[cod] = { c: new Array(TL_RANURAS).fill(''), pedir: '' };
    }
    return tlCapturas[cod];
}

function tlTocado(cod) {
    const f = tlCapturas[cod];
    return !!f && f.c.some(x => String(x).trim() !== '');
}

function tlDuracion() {
    if (!tlInicioSesion) return '—';
    const seg = Math.floor((Date.now() - tlInicioSesion) / 1000);
    const m = Math.floor(seg / 60);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : (m >= 1 ? `${m}m` : `${seg}s`);
}


// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
/* Tres puntos de entrada, uno por pantalla del menu. El modulo es propio y no
   una pantalla de Inventario, asi que la navegacion la lleva el menu de la app
   -- no hay pestanas internas que dupliquen lo que el menu ya hace. */
async function tlInit() {
    if (!tlListo('tl-contenido')) return;
    await tlCargarBodegas();
    tlCargarResumen('tl-contenido');
}

async function tlInitHistorico() {
    if (!tlListo('tl-contenido-historico')) return;
    if (!tlBodegas.length) await tlCargarBodegasSilencioso();
    if (!tlBodegas.length) {
        tlMensaje('ban', tlComoQuien('no tiene acceso a esta pantalla')
            + tlPistaSimulacion());
        return;
    }
    tlVerHistorico();
    tlCargarResumen('tl-contenido-historico');
}

async function tlInitPedidos() {
    if (!tlListo('tl-contenido-pedidos')) return;
    if (!tlBodegas.length) await tlCargarBodegasSilencioso();
    if (!tlBodegas.length) {
        tlMensaje('ban', tlComoQuien('no tiene acceso a esta pantalla')
            + tlPistaSimulacion());
        return;
    }
    tlVerPedidos();
    tlCargarResumen('tl-contenido-pedidos');
}

/* Prepara el contenedor de la pantalla que se esta abriendo y comprueba que
   haya sesion. Sin prompt de contrasena: la sesion de Control Contable ya
   identifica al usuario, igual que en el resto de los modulos. El servidor
   resuelve rol, permisos y bodegas desde goti.usuarios; el navegador no puede
   atribuirse nada que la base no le reconozca. */
function tlListo(idContenedor) {
    tlCont = idContenedor;
    tlComprobarUsuario();
    const c = document.getElementById(idContenedor);
    if (!c) return false;
    if (!tlUsuarioEfectivo()) {
        c.innerHTML = '<div class="empty-state"><i class="fas fa-lock"></i>'
            + '<p>Sesion no iniciada. Vuelve a entrar a la aplicacion.</p></div>';
        return false;
    }
    c.innerHTML = '<div class="tl-cifras" id="tl-cifras-' + idContenedor + '"></div>'
                + '<div id="tl-panel-' + idContenedor + '"></div>';
    return true;
}

async function tlCargarBodegasSilencioso() {
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/toma/bodegas?`
            + new URLSearchParams(tlCred()));
        if (r.ok) tlBodegas = (await r.json()).bodegas || [];
    } catch (e) { /* cada pantalla avisa por su cuenta si falla */ }
}

async function tlCargarResumen(idContenedor) {
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/toma/resumen?`
            + new URLSearchParams(tlCred()));
        if (!r.ok) return;
        const d = await r.json();
        const el = document.getElementById('tl-cifras-' + idContenedor);
        if (el) el.innerHTML = `
            <div class="tl-cifra"><small>Sesiones Hoy</small>
                <span class="ok">${d.sesiones_hoy}</span></div>
            <div class="tl-cifra"><small>Productos en 0</small>
                <span class="warn">${d.productos_cero}</span></div>`;
    } catch (e) { /* las cifras son adorno: no rompen la pantalla */ }
}

let tlCont = 'tl-contenido';

/* De quien son los datos que hay cargados en memoria. Si el usuario efectivo
   cambia -- que es lo que pasa al usar "Ver como..." -- hay que tirar la cache
   y volver a preguntar. Sin esto, el admin cargaba sus 8 bodegas, simulaba a
   un gerente de Real Audiencia y seguia viendo las 8: tlBodegas no se volvia a
   pedir porque ya tenia contenido. */
let tlUsuarioCargado = null;

function tlComprobarUsuario() {
    const actual = tlUsuario();
    if (tlUsuarioCargado !== null && tlUsuarioCargado !== actual) {
        tlBodegas = [];
        tlProductos = [];
        tlCapturas = {};
        tlBodega = null;
        tlTomas = [];
        tlDetalle = null;
        tlPedidos = [];
        tlPLocales = [];
        tlPCategorias = [];
        tlInicioSesion = null;
        tlPFiltros = { bodega: '', categoria: '', q: '', fecha: '', orden: 'local' };
        tlHFiltros = { q: '', bodega: '', usuario: '', tipo: '',
                       desde: '', hasta: '', solo_cero: false, orden: 'fecha' };
    }
    tlUsuarioCargado = actual;
}

function tlPanel() {
    return document.getElementById('tl-panel-' + tlCont)
        || document.getElementById(tlCont);
}

async function tlCargarResumen() {
    try {
        const p = new URLSearchParams(tlCred());
        const r = await fetch(`${CONFIG.API_URL}/api/toma/resumen?` + p);
        if (!r.ok) return;
        const d = await r.json();
        const el = document.getElementById('tl-cifras');
        if (el) el.innerHTML = `
            <div class="tl-cifra"><small>Sesiones Hoy</small>
                <span class="ok">${d.sesiones_hoy}</span></div>
            <div class="tl-cifra"><small>Productos en 0</small>
                <span class="warn">${d.productos_cero}</span></div>`;
    } catch (e) { /* las cifras son adorno: no rompen la pantalla */ }
}

/* Los mensajes nombran a QUIEN se esta aplicando la regla. Sin esto, un admin
   simulando a un gerente lee "no tienes bodegas" y cree que perdio sus
   propios permisos, cuando lo que ve es el resultado de la simulacion. */
function tlComoQuien(que) {
    const u = tlUsuarioEfectivo();
    if (typeof state !== 'undefined' && state._impersonando) {
        return `${u.nombre || u.username} (${u.rol}) ${que}.`;
    }
    return 'Tu usuario ' + que + '.';
}

function tlPistaSimulacion() {
    if (typeof state === 'undefined' || !state._impersonando) return '';
    return ' Estas viendo como otra persona: sal de "Ver como..." en la barra'
         + ' superior para volver a tu propio acceso.';
}

function tlMensaje(icono, txt) {
    const cont = tlPanel();
    if (cont) cont.innerHTML = `<div class="empty-state"><i class="fas fa-${icono}"></i>`
        + `<p>${tlEsc(txt)}</p></div>`;
}

function tlCargando(txt) {
    tlMensaje('spinner fa-spin', txt || 'Cargando...');
}

async function tlCargarBodegas() {
    tlCargando('Cargando bodegas...');
    try {
        const p = new URLSearchParams(tlCred());
        const r = await fetch(`${CONFIG.API_URL}/api/toma/bodegas?` + p);
        if (r.status === 401) {
            tlMensaje('lock', tlComoQuien('no esta activo en el sistema'));
            return;
        }
        if (r.status === 403) {
            // Pasa siempre al simular a un no-admin: el modulo se siembra
            // SOLO para admin, y al simular la app deja de aplicar el atajo de
            // administrador (mismo criterio que el resto de las pantallas).
            tlMensaje('ban', tlComoQuien('no tiene permiso para Toma de Locales')
                + tlPistaSimulacion());
            return;
        }
        const d = await r.json();
        tlBodegas = d.bodegas || [];
        if (!tlBodegas.length) {
            tlMensaje('warehouse', tlComoQuien('no tiene ninguna bodega asignada')
                + tlPistaSimulacion());
            return;
        }
        tlVerBodegas();
    } catch (e) {
        console.error(e);
        tlMensaje('plug', 'No se pudo contactar al servidor.');
    }
}


// ---------------------------------------------------------------------------
// PANTALLA 1: bodegas
// ---------------------------------------------------------------------------
function tlVerBodegas() {
    tlPantalla = 'bodegas';
    tlBodega = null;
    const cont = tlPanel();
    cont.innerHTML = `
        <p class="tl-ayuda">Elige la bodega que vas a contar</p>
        <div class="tl-bodegas">
            ${tlBodegas.map(b => `
                <button class="tl-bodega-btn" data-bodega="${tlEsc(b.clave)}">
                    <i class="fas fa-warehouse"></i>
                    <span>${tlEsc(b.nombre)}</span>
                </button>`).join('')}
        </div>
        <div class="tl-acciones-pie">
            <button class="btn btn-secondary" id="tl-ir-historico">
                <i class="fas fa-clock-rotate-left"></i> Historial de inventarios
            </button>
        </div>`;

    // data-* + addEventListener, nunca onclick inline (leccion 15 del proyecto)
    cont.querySelectorAll('.tl-bodega-btn').forEach(b => {
        b.addEventListener('click', () => tlAbrirBodega(b.dataset.bodega));
    });
    cont.querySelector('#tl-ir-historico').addEventListener('click', () => {
        // Navegar por el menu de la app, no por una pestana interna
        cambiarVista('toma-historico');
    });
}


// ---------------------------------------------------------------------------
// PANTALLA 2: conteo
//
// El layout replica el del sistema original pantalla por pantalla:
//
//   [ Volver al inicio ]
//   +--------------------------------------------------+
//   | [icono]  Bodega Principal        Total de productos|
//   |          Gestion de inventario              214   |
//   +--------------------------------------------------+
//   [ Agrupar por Categorias ] [ Ordenar por Tipo (A-B-C) ]
//   [       Categoria  ⇅      ] [        Codigo  ⇅       ]
//   0/214 A [====] 0%  B [====] 0%  C [====] 0%   0% ●  (10s)
//   [ Buscar... ] [ Limpiar ] [ V.2 ]
//
//   +--------------------------------------[NO CONTADO]-+
//   | ALIÑO ENCEBOLLADO                                 |
//   | # ALIÑOS · Codigo: ALI006 · Tipo: B               |
//   |   Conteo 1   Conteo 2   Conteo 3      Total       |
//   |   [   0  ]   [   0  ]   [   0  ]   [ 0 Kilogramos]|
//   |---------------------------------------------------|
//   | Cantidad a pedir                                  |
//   | [        0        ]        [ Kilogramos ]         |
//   +---------------------------------------------------+
//
// Tamanos y alineacion son los del original. Lo unico que cambia son los
// colores y las formas, anclados al toolkit FOODIX: el morado y el gradiente
// del original se sustituyen por el navy de marca y las superficies del
// sistema, y los rectangulos por los radios y pills del toolkit.
// ---------------------------------------------------------------------------
async function tlAbrirBodega(clave) {
    tlBodega = clave;
    tlPantalla = 'conteo';
    tlFiltro = ''; tlCategoria = ''; tlTipo = ''; tlSoloCero = false;
    tlCargando('Cargando productos...');
    try {
        const p = new URLSearchParams(tlCred({ bodega: clave, fuente: 'matriz' }));
        const r = await fetch(`${CONFIG.API_URL}/api/toma/catalogo?` + p);
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            tlMensaje('triangle-exclamation', err.error || 'No se pudo cargar el catalogo.');
            return;
        }
        const d = await r.json();
        tlProductos = d.productos || [];
        tlRestaurarBorrador();
        tlInicioSesion = tlInicioSesion || Date.now();
        tlVerConteo();
        tlArrancarReloj();
    } catch (e) {
        console.error(e);
        tlMensaje('plug', 'No se pudo cargar el catalogo.');
    }
}

/* El chip de tiempo del original va contando la sesion en vivo. */
let tlReloj = null;
function tlArrancarReloj() {
    if (tlReloj) clearInterval(tlReloj);
    tlReloj = setInterval(() => {
        const el = document.getElementById('tl-reloj');
        if (!el) { clearInterval(tlReloj); tlReloj = null; return; }
        el.textContent = tlDuracion();
    }, 1000);
}

function tlRestaurarBorrador() {
    tlCapturas = {};
    try {
        const raw = localStorage.getItem(tlClaveBorrador());
        if (raw) {
            const g = JSON.parse(raw) || {};
            tlCapturas = g.capturas || {};
            if (g.inicio) tlInicioSesion = g.inicio;
            const n = Object.keys(tlCapturas).filter(k => tlTocado(k)).length;
            if (n) tlAviso(`Se recupero un borrador con ${n} producto(s)`, 'info');
        }
    } catch (e) { tlCapturas = {}; }
}

function tlGuardarBorrador() {
    try {
        localStorage.setItem(tlClaveBorrador(),
            JSON.stringify({ capturas: tlCapturas, inicio: tlInicioSesion }));
    } catch (e) { /* cuota llena: no vale romper el conteo por esto */ }
}

function tlCategorias() {
    const s = new Set();
    tlProductos.forEach(p => { if (p.categoria) s.add(p.categoria); });
    return Array.from(s).sort();
}

function tlVisibles() {
    const f = tlFiltro.trim().toLowerCase();
    let lista = tlProductos.filter(p => {
        if (tlCategoria && p.categoria !== tlCategoria) return false;
        if (tlTipo && String(p.tipo_abc || '').toUpperCase() !== tlTipo) return false;
        if (tlSoloCero && tlTotal(tlFila(p.codigo).c) !== 0) return false;
        if (!f) return true;
        return String(p.producto || '').toLowerCase().includes(f)
            || String(p.codigo || '').toLowerCase().includes(f)
            || String(p.categoria || '').toLowerCase().includes(f);
    });
    if (tlOrden === 'tipo') {
        lista = lista.slice().sort((a, b) => {
            const ta = TL_TIPOS.indexOf(String(a.tipo_abc || '').toUpperCase());
            const tb = TL_TIPOS.indexOf(String(b.tipo_abc || '').toUpperCase());
            return (ta < 0 ? 9 : ta) - (tb < 0 ? 9 : tb)
                || String(a.producto || '').localeCompare(String(b.producto || ''));
        });
    } else if (tlOrden === 'categoria') {
        lista = lista.slice().sort((a, b) =>
            String(a.categoria || '').localeCompare(String(b.categoria || ''))
            || String(a.producto || '').localeCompare(String(b.producto || '')));
    } else if (tlOrden === 'codigo') {
        lista = lista.slice().sort((a, b) =>
            String(a.codigo || '').localeCompare(String(b.codigo || '')));
    }
    return lista;
}

/* Avance por tipo A/B/C: es la barra segmentada de la cabecera del original. */
function tlAvancePorTipo() {
    const r = {};
    TL_TIPOS.forEach(t => { r[t] = { total: 0, hechos: 0 }; });
    tlProductos.forEach(p => {
        const t = String(p.tipo_abc || '').toUpperCase();
        if (!r[t]) return;
        r[t].total++;
        if (tlTocado(p.codigo)) r[t].hechos++;
    });
    return r;
}

function tlMetricas() {
    let contados = 0, enCero = 0;
    tlProductos.forEach(p => {
        if (!tlTocado(p.codigo)) return;
        contados++;
        if (tlTotal(tlCapturas[p.codigo].c) === 0) enCero++;
    });
    const min = tlInicioSesion ? (Date.now() - tlInicioSesion) / 60000 : 0;
    return {
        contados, enCero,
        total: tlProductos.length,
        pendientes: tlProductos.length - contados,
        pct: tlProductos.length ? Math.round(contados * 100 / tlProductos.length) : 0,
        ritmo: min > 0.2 ? (contados / min).toFixed(1) : '—'
    };
}

function tlVerConteo() {
    const bod = tlBodegas.find(b => b.clave === tlBodega) || { nombre: tlBodega };
    const cont = tlPanel();
    cont.innerHTML = `
        <button class="tl-volver" id="tl-volver">
            <i class="fas fa-house"></i> Volver al inicio
        </button>

        <div class="tl-hero">
            <div class="tl-hero-icono"><i class="fas fa-box-open"></i></div>
            <div class="tl-hero-txt">
                <h2>${tlEsc(bod.nombre)}</h2>
                <p>Gestion de inventario</p>
            </div>
            <div class="tl-hero-cifra">
                <small>Total de productos</small>
                <span id="tl-hero-total">${tlProductos.length}</span>
            </div>
        </div>

        <div class="tl-modos">
            <button class="tl-modo" id="tl-m-agrupar">Agrupar por Categorias</button>
            <button class="tl-modo" id="tl-m-tipo">Ordenar por Tipo (A-B-C)</button>
        </div>

        <div class="tl-ordenes">
            <button class="tl-orden" id="tl-o-categoria">
                <i class="fas fa-tag"></i> Categoria
                <i class="fas fa-arrow-down-up-across-line"></i>
            </button>
            <button class="tl-orden" id="tl-o-codigo">
                <i class="fas fa-hashtag"></i> Codigo
                <i class="fas fa-arrow-down-up-across-line"></i>
            </button>
        </div>

        <div class="tl-progreso" id="tl-progreso"></div>

        <div class="tl-buscador">
            <input type="search" id="tl-buscar" placeholder="Buscar..." autocomplete="off">
            <button class="tl-aux" id="tl-limpiar">Limpiar</button>
            <button class="tl-aux" id="tl-vista">${tlVista === 'compacto' ? 'V.1' : 'V.2'}</button>
        </div>

        <div id="tl-lista" class="tl-lista${tlVista === 'compacto' ? ' tl-lista-compacta' : ''}"></div>

        <div class="tl-pie">
            <button class="btn btn-primary btn-block" id="tl-guardar">
                <i class="fas fa-save"></i> Guardar toma
            </button>
        </div>`;

    cont.querySelector('#tl-volver').addEventListener('click', tlVerBodegas);
    cont.querySelector('#tl-guardar').addEventListener('click', tlGuardar);

    cont.querySelector('#tl-m-agrupar').addEventListener('click', e => {
        tlAgrupar = !tlAgrupar;
        e.currentTarget.classList.toggle('activo', tlAgrupar);
        tlPintarLista();
    });
    cont.querySelector('#tl-m-tipo').addEventListener('click', e => {
        tlOrden = tlOrden === 'tipo' ? 'nombre' : 'tipo';
        e.currentTarget.classList.toggle('activo', tlOrden === 'tipo');
        tlSincronizarOrden();
        tlPintarLista();
    });
    cont.querySelector('#tl-o-categoria').addEventListener('click', e => {
        tlOrden = tlOrden === 'categoria' ? 'nombre' : 'categoria';
        tlSincronizarOrden();
        tlPintarLista();
    });
    cont.querySelector('#tl-o-codigo').addEventListener('click', e => {
        tlOrden = tlOrden === 'codigo' ? 'nombre' : 'codigo';
        tlSincronizarOrden();
        tlPintarLista();
    });

    cont.querySelector('#tl-buscar').addEventListener('input', e => {
        tlFiltro = e.target.value; tlPintarLista();
    });
    cont.querySelector('#tl-limpiar').addEventListener('click', () => {
        tlFiltro = ''; tlCategoria = ''; tlTipo = ''; tlSoloCero = false;
        document.getElementById('tl-buscar').value = '';
        tlPintarLista();
    });
    cont.querySelector('#tl-vista').addEventListener('click', e => {
        tlVista = tlVista === 'compacto' ? 'normal' : 'compacto';
        e.currentTarget.textContent = tlVista === 'compacto' ? 'V.1' : 'V.2';
        document.getElementById('tl-lista')
            .classList.toggle('tl-lista-compacta', tlVista === 'compacto');
        tlPintarLista();
    });

    tlPintarLista();
}

function tlSincronizarOrden() {
    const m = document.getElementById('tl-m-tipo');
    if (m) m.classList.toggle('activo', tlOrden === 'tipo');
    const c = document.getElementById('tl-o-categoria');
    if (c) c.classList.toggle('activo', tlOrden === 'categoria');
    const k = document.getElementById('tl-o-codigo');
    if (k) k.classList.toggle('activo', tlOrden === 'codigo');
}

/* Barra de avance segmentada por tipo, con el chip de tiempo. */
function tlPintarProgreso() {
    const el = document.getElementById('tl-progreso');
    if (!el) return;
    const m = tlMetricas();
    const av = tlAvancePorTipo();
    el.innerHTML = `
        <span class="tl-pg-conteo">${m.contados}/${m.total}</span>
        ${TL_TIPOS.map(t => {
            const a = av[t];
            const pct = a.total ? Math.round(a.hechos * 100 / a.total) : 0;
            return `<span class="tl-pg-tipo tl-pg-${t.toLowerCase()}">${t}</span>
                    <span class="tl-pg-barra tl-pg-${t.toLowerCase()}">
                        <i style="width:${pct}%"></i>
                    </span>
                    <span class="tl-pg-pct">${pct}%</span>`;
        }).join('')}
        <span class="tl-pg-total">${m.pct}%</span>
        <span class="tl-pg-punto ${m.pct === 100 ? 'ok' : ''}"></span>
        <span class="tl-pg-reloj"><i class="fas fa-clock"></i>
            <b id="tl-reloj">${tlDuracion()}</b></span>`;
}

function tlItemHtml(p) {
    const cod = p.codigo;
    const f = tlFila(cod);
    const total = tlTotal(f.c);
    const hecho = tlTocado(cod);
    const cero = hecho && total === 0;
    const uni = p.unidad || '';
    return `
    <div class="tl-item ${hecho ? 'tl-item-hecho' : 'tl-item-pendiente'} ${cero ? 'tl-item-cero' : ''}"
         data-codigo="${tlEsc(cod)}">
        <span class="tl-badge">${hecho ? (cero ? 'EN 0' : 'CONTADO') : 'NO CONTADO'}</span>

        <h4 class="tl-item-nombre">${tlEsc(p.producto)}</h4>
        <p class="tl-item-meta">
            <span class="tl-meta-cat"># ${tlEsc(p.categoria || 'Sin categoria')}</span>
            <span class="tl-meta-sep">·</span>
            <span class="tl-meta-cod">Codigo: ${tlEsc(cod)}</span>
            ${p.tipo_abc ? `<span class="tl-meta-sep">·</span>
                <span class="tl-meta-tipo">Tipo: ${tlEsc(p.tipo_abc)}</span>` : ''}
        </p>
        ${p.equivalencia ? `<p class="tl-item-equiv">
            <b>Equivalencia:</b> ${tlEsc(p.equivalencia)}</p>` : ''}

        <div class="tl-rejilla">
            ${f.c.map((v, j) => `
                <div class="tl-celda">
                    <label for="tl-c-${tlEsc(cod)}-${j}">Conteo ${j + 1}</label>
                    <input type="text" inputmode="decimal" class="tl-cap"
                           id="tl-c-${tlEsc(cod)}-${j}" data-ranura="${j}"
                           value="${tlEsc(v)}" placeholder="0">
                </div>`).join('')}
            <div class="tl-celda">
                <label>Total</label>
                <div class="tl-total-caja">
                    <b class="tl-total-val">${total === null ? 'INACTIVO' : total}</b>
                    ${uni ? `<span>${tlEsc(uni)}</span>` : ''}
                </div>
            </div>
        </div>

        <div class="tl-pedido">
            <label for="tl-p-${tlEsc(cod)}">Cantidad a pedir</label>
            <div class="tl-pedido-fila">
                <input type="text" inputmode="decimal" class="tl-pedir"
                       id="tl-p-${tlEsc(cod)}" value="${tlEsc(f.pedir)}" placeholder="0">
                <span class="tl-pedido-uni">${tlEsc(p.uni_bod || uni || '—')}</span>
            </div>
        </div>
    </div>`;
}

function tlPintarLista() {
    const lista = document.getElementById('tl-lista');
    if (!lista) return;
    const visibles = tlVisibles();

    if (!visibles.length) {
        lista.innerHTML = '<div class="empty-state"><i class="fas fa-search"></i>'
            + '<p>No se encontraron productos.</p></div>';
        tlPintarProgreso();
        return;
    }

    if (tlAgrupar) {
        const grupos = {};
        visibles.forEach(p => {
            const g = p.categoria || 'Sin categoria';
            (grupos[g] = grupos[g] || []).push(p);
        });
        lista.innerHTML = Object.keys(grupos).sort().map(g => `
            <div class="tl-grupo">
                <h4 class="tl-grupo-titulo">${tlEsc(g)}<span>${grupos[g].length}</span></h4>
                ${grupos[g].map(tlItemHtml).join('')}
            </div>`).join('');
    } else {
        lista.innerHTML = visibles.map(tlItemHtml).join('');
    }

    // data-* + addEventListener, nunca onclick inline (leccion 15 del proyecto)
    lista.querySelectorAll('.tl-item').forEach(item => {
        const cod = item.dataset.codigo;
        item.querySelectorAll('.tl-cap').forEach(inp => {
            inp.addEventListener('input', () => {
                tlFila(cod).c[Number(inp.dataset.ranura)] = inp.value;
                tlRefrescarItem(item, cod);
            });
        });
        const pedir = item.querySelector('.tl-pedir');
        if (pedir) {
            pedir.addEventListener('input', () => {
                tlFila(cod).pedir = pedir.value;
                tlGuardarBorrador();
            });
        }
    });
    tlPintarProgreso();
}

/* Repinta solo la fila tocada: con 227 productos, redibujar la lista entera
   en cada tecla se nota en el telefono. */
function tlRefrescarItem(item, cod) {
    const t = tlTotal(tlFila(cod).c);
    const hecho = tlTocado(cod);
    const cero = hecho && t === 0;
    item.querySelector('.tl-total-val').textContent = t === null ? 'INACTIVO' : t;
    item.classList.toggle('tl-item-hecho', hecho);
    item.classList.toggle('tl-item-pendiente', !hecho);
    item.classList.toggle('tl-item-cero', cero);
    const b = item.querySelector('.tl-badge');
    if (b) b.textContent = hecho ? (cero ? 'EN 0' : 'CONTADO') : 'NO CONTADO';
    tlGuardarBorrador();
    tlPintarProgreso();
}

async function tlGuardar() {
    const m = tlMetricas();
    if (!m.contados) { tlAviso('No has contado ningun producto todavia', 'warning'); return; }

    let msg = `Vas a guardar la toma de ${m.contados} producto(s).`;
    if (m.pendientes > 0) msg += `\n\nQuedan ${m.pendientes} sin contar y NO se envian.`;
    msg += '\n\nUna vez guardada, rehacerla exige eliminarla primero. Continuar?';
    if (!confirm(msg)) return;

    const productos = [];
    tlProductos.forEach(p => {
        if (!tlTocado(p.codigo)) return;
        const f = tlCapturas[p.codigo];
        productos.push({
            codigo: p.codigo,
            producto: p.producto,
            capturas: f.c,
            unidad: p.unidad || null,
            categoria: p.categoria || null,
            tipo_abc: p.tipo_abc || null,
            anotaciones: null,
            cantidad_solicitada: String(f.pedir || '').trim() || null,
            uni_bod: p.uni_bod || null
        });
    });

    const btn = document.getElementById('tl-guardar');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/toma/guardar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tlCred({
                bodega: tlBodega, fecha: tlHoy(), productos
            }))
        });
        const d = await r.json();
        if (!r.ok) {
            // 409 = ya hay toma de hoy. Es lo mas probable en la transicion,
            // cuando alguien conto tambien en la app vieja.
            tlAviso(d.error + (d.detalle ? ' — ' + d.detalle : ''), 'error');
            return;
        }
        localStorage.removeItem(tlClaveBorrador());
        tlCapturas = {};
        tlInicioSesion = null;
        tlAviso(`Toma guardada: ${d.productos} productos`, 'success');
        tlVerBodegas();
    } catch (e) {
        console.error(e);
        tlAviso('No se pudo guardar. El borrador sigue aqui, intenta de nuevo.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Guardar toma';
    }
}

// ---------------------------------------------------------------------------
// PANTALLA 3: historico global
//
// El original NO filtra por una bodega a la vez: su bloque "Filtros Avanzados"
// ofrece "Todas las bodegas / Todos los usuarios / Todos los tipos", busqueda
// por nombre-codigo-categoria, rango de fechas, "Solo productos en cero" y un
// "Ordenar por". Aqui se replica igual, y el backend lo resuelve uniendo las
// tres formas de tabla (ver _union_bodegas en toma_locales.py).
// ---------------------------------------------------------------------------
let tlHFiltros = { q: '', bodega: '', usuario: '', tipo: '',
                   desde: '', hasta: '', solo_cero: false, orden: 'fecha' };

function tlVerHistorico() {
    tlPantalla = 'historico';
    const hace30 = new Date(); hace30.setDate(hace30.getDate() - 30);
    if (!tlHFiltros.desde) tlHFiltros.desde = hace30.toISOString().split('T')[0];
    if (!tlHFiltros.hasta) tlHFiltros.hasta = tlHoy();

    const cont = tlPanel();
    cont.innerHTML = `
        <div class="tl-encabezado">
            <h3>Historial de inventarios</h3>
            <p class="tl-ayuda">Consulta y exporta registros anteriores</p>
        </div>

        <div class="tl-card-filtros">
            <h4>Filtros Avanzados</h4>
            <div class="tl-filtros">
                <input type="search" id="tlh-q" class="obs-filtro-input"
                       placeholder="Buscar por nombre, codigo o categoria"
                       value="${tlEsc(tlHFiltros.q)}">
                <select id="tlh-bodega" class="obs-filtro-input">
                    <option value="">Todas las bodegas</option>
                    ${tlBodegas.map(b => `<option value="${tlEsc(b.clave)}"
                        ${tlHFiltros.bodega === b.clave ? 'selected' : ''}
                        >${tlEsc(b.nombre)}</option>`).join('')}
                </select>
                <select id="tlh-usuario" class="obs-filtro-input">
                    <option value="">Todos los usuarios</option>
                </select>
                <select id="tlh-tipo" class="obs-filtro-input">
                    <option value="">Todos los tipos</option>
                    ${TL_TIPOS.map(t => `<option value="${t}"
                        ${tlHFiltros.tipo === t ? 'selected' : ''}>Tipo ${t}</option>`).join('')}
                </select>
            </div>
            <div class="tl-filtros tl-filtros-fechas">
                <input type="date" id="tlh-desde" class="obs-filtro-input"
                       value="${tlHFiltros.desde}">
                <input type="date" id="tlh-hasta" class="obs-filtro-input"
                       value="${tlHFiltros.hasta}">
                <select id="tlh-orden" class="obs-filtro-input">
                    <option value="fecha">Ordenar por: Fecha</option>
                    <option value="producto">Ordenar por: Producto</option>
                    <option value="total">Ordenar por: Total</option>
                </select>
                <button class="btn btn-primary" id="tlh-buscar">
                    <i class="fas fa-search"></i> Buscar
                </button>
            </div>
            <div class="tl-switches">
                <label><input type="checkbox" id="tlh-cero"
                    ${tlHFiltros.solo_cero ? 'checked' : ''}> Solo productos en cero</label>
                <button class="btn btn-link" id="tlh-limpiar">
                    <i class="fas fa-eraser"></i> Limpiar
                </button>
                <button class="btn btn-secondary" id="tlh-todo">
                    <i class="fas fa-file-excel"></i> Exportar todo
                </button>
            </div>
        </div>

        <div id="tlh-resultado"></div>`;

    cont.querySelector('#tlh-buscar').addEventListener('click', tlBuscarHistorico);
    cont.querySelector('#tlh-q').addEventListener('keydown', e => {
        if (e.key === 'Enter') tlBuscarHistorico();
    });
    cont.querySelector('#tlh-todo').addEventListener('click', tlExportarTodo);
    cont.querySelector('#tlh-limpiar').addEventListener('click', () => {
        tlHFiltros = { q: '', bodega: '', usuario: '', tipo: '',
                       desde: '', hasta: '', solo_cero: false, orden: 'fecha' };
        tlVerHistorico();
    });
    tlBuscarHistorico();
}

function tlLeerFiltros() {
    const g = id => { const e = document.getElementById(id); return e ? e.value : ''; };
    tlHFiltros.q = g('tlh-q');
    tlHFiltros.bodega = g('tlh-bodega');
    tlHFiltros.usuario = g('tlh-usuario');
    tlHFiltros.tipo = g('tlh-tipo');
    tlHFiltros.desde = g('tlh-desde');
    tlHFiltros.hasta = g('tlh-hasta');
    tlHFiltros.orden = g('tlh-orden') || 'fecha';
    const c = document.getElementById('tlh-cero');
    tlHFiltros.solo_cero = !!(c && c.checked);
}

async function tlBuscarHistorico() {
    tlLeerFiltros();
    const cont = document.getElementById('tlh-resultado');
    cont.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i>'
        + '<p>Cargando historicos desde la base de datos...</p></div>';
    try {
        // `filtro_usuario`, NO `usuario`: ese nombre ya lo ocupa la credencial
        // y el filtro la pisaba, con lo que el servidor respondia 401.
        const args = tlCred({
            q: tlHFiltros.q, bodega: tlHFiltros.bodega,
            filtro_usuario: tlHFiltros.usuario,
            tipo: tlHFiltros.tipo, desde: tlHFiltros.desde, hasta: tlHFiltros.hasta,
            orden: tlHFiltros.orden, limite: 1000
        });
        if (tlHFiltros.solo_cero) args.solo_cero = '1';
        const r = await fetch(`${CONFIG.API_URL}/api/toma/buscar?`
            + new URLSearchParams(args));
        const d = await r.json();
        if (!r.ok) {
            cont.innerHTML = `<div class="empty-state"><i class="fas fa-ban"></i>`
                + `<p>${tlEsc(d.error || 'No se pudo consultar')}</p></div>`;
            return;
        }
        tlTomas = d.tomas || [];
        tlPintarResultado(d);
    } catch (e) {
        console.error(e);
        cont.innerHTML = '<div class="empty-state"><i class="fas fa-plug"></i>'
            + '<p>No se pudo contactar al servidor.</p></div>';
    }
}

function tlPintarResultado(d) {
    const cont = document.getElementById('tlh-resultado');
    if (!tlTomas.length) {
        cont.innerHTML = '<div class="empty-state"><i class="fas fa-chart-simple"></i>'
            + '<p>No se encontraron registros.</p></div>';
        return;
    }
    // Rellenar el desplegable de usuarios con los que de verdad aparecen.
    const sel = document.getElementById('tlh-usuario');
    if (sel && sel.options.length <= 1) {
        const us = Array.from(new Set(tlTomas.map(t => t.usuario).filter(Boolean))).sort();
        us.forEach(u => {
            const o = document.createElement('option');
            o.value = u;
            o.textContent = u.length > 40 ? u.slice(0, 40) + '...' : u;
            sel.appendChild(o);
        });
        sel.value = tlHFiltros.usuario || '';
    }

    cont.innerHTML = `
        <p class="tl-ayuda">${tlTomas.length} toma(s) ·
            ${(d.productos || []).length} producto(s) en el rango</p>
        <table class="data-table tl-tabla">
            <thead><tr>
                <th>Fecha</th><th>Bodega</th><th>Productos</th><th>Total</th>
                <th>En 0</th><th>Inactivos</th><th>Acciones</th>
            </tr></thead>
            <tbody>
            ${tlTomas.map((t, i) => `
                <tr>
                    <td><strong>${tlEsc(t.fecha)}</strong></td>
                    <td>${tlEsc(t.bodega_nombre)}</td>
                    <td>${tlEsc(t.productos)}</td>
                    <td>${t.suma_total === null ? '—'
                        : tlEsc(Number(t.suma_total).toFixed(2))}</td>
                    <td>${tlEsc(t.en_cero)}</td>
                    <td>${tlEsc(t.inactivos)}</td>
                    <td class="tl-acciones">
                        <button class="btn btn-sm btn-secondary tlh-ver" data-idx="${i}">
                            <i class="fas fa-eye"></i> Ver
                        </button>
                        <button class="btn btn-sm btn-secondary tlh-xls" data-idx="${i}"
                                title="Excel">
                            <i class="fas fa-file-excel"></i>
                        </button>
                        <button class="btn btn-sm btn-secondary tlh-csv" data-idx="${i}"
                                title="CSV">
                            <i class="fas fa-file-csv"></i>
                        </button>
                    </td>
                </tr>`).join('')}
            </tbody>
        </table>`;

    cont.querySelectorAll('.tlh-ver').forEach(b => {
        const t = tlTomas[b.dataset.idx];
        b.addEventListener('click', () => tlVerDetalle(t.bodega, t.fecha));
    });
    cont.querySelectorAll('.tlh-xls').forEach(b => {
        const t = tlTomas[b.dataset.idx];
        b.addEventListener('click', () => tlExportar(t.bodega, t.fecha, 'xlsx'));
    });
    cont.querySelectorAll('.tlh-csv').forEach(b => {
        const t = tlTomas[b.dataset.idx];
        b.addEventListener('click', () => tlExportar(t.bodega, t.fecha, 'csv'));
    });
}

/* El archivo lo arma el servidor (openpyxl / csv). El telefono no tiene que
   cargar una libreria de 900 KB solo para exportar, y de paso el export pasa
   por el mismo portero que todo lo demas. */
function tlExportar(bodega, fecha, formato) {
    window.open(`${CONFIG.API_URL}/api/toma/exportar?`
        + new URLSearchParams(tlCred({ bodega, fecha, formato: formato || 'xlsx' })),
        '_blank');
}

/* "Exportar Todo" del original: un Excel con lo que devuelvan los filtros,
   de todas las bodegas a la vez. */
function tlExportarTodo() {
    tlLeerFiltros();
    const a = tlCred({
        q: tlHFiltros.q, bodega: tlHFiltros.bodega,
        filtro_usuario: tlHFiltros.usuario, tipo: tlHFiltros.tipo,
        desde: tlHFiltros.desde, hasta: tlHFiltros.hasta
    });
    if (tlHFiltros.solo_cero) a.solo_cero = '1';
    window.open(`${CONFIG.API_URL}/api/toma/exportar-todo?`
        + new URLSearchParams(a), '_blank');
}

async function tlVerDetalle(bodega, fecha) {
    tlCargando('Cargando detalle...');
    try {
        const p = new URLSearchParams(tlCred({ bodega, fecha }));
        const r = await fetch(`${CONFIG.API_URL}/api/toma/detalle?` + p);
        const d = await r.json();
        if (!r.ok) { tlMensaje('ban', d.error || 'No se pudo cargar'); return; }
        tlDetalle = { bodega, fecha, productos: d.productos || [] };
        tlPintarDetalle();
    } catch (e) {
        console.error(e);
        tlMensaje('plug', 'No se pudo cargar el detalle.');
    }
}

function tlPintarDetalle() {
    const { bodega, fecha, productos } = tlDetalle;
    const bod = tlBodegas.find(b => b.clave === bodega) || { nombre: bodega };
    const cont = tlPanel();
    cont.innerHTML = `
        <div class="tl-barra">
            <button class="btn btn-secondary" id="tl-d-volver">
                <i class="fas fa-arrow-left"></i> Historial
            </button>
            <div class="tl-titulo">
                <strong>${tlEsc(bod.nombre)}</strong>
                <span class="tl-fecha">${tlEsc(fecha)} · ${productos.length} productos</span>
            </div>
            <button class="btn btn-secondary" id="tl-d-excel">
                <i class="fas fa-file-excel"></i> Excel
            </button>
            <button class="btn btn-danger" id="tl-d-borrar">
                <i class="fas fa-trash"></i> Eliminar toma
            </button>
        </div>
        <table class="data-table tl-tabla">
            <thead><tr>
                <th>Codigo</th><th>Producto</th><th>Categoria</th><th>Tipo</th>
                <th>Conteos</th><th>Total</th><th>Pedir</th><th>Unidad</th><th></th>
            </tr></thead>
            <tbody>
            ${productos.map((p, i) => `
                <tr>
                    <td>${tlEsc(p.codigo)}</td>
                    <td>${tlEsc(p.producto)}</td>
                    <td>${tlEsc(p.categoria)}</td>
                    <td>${tlEsc(p.tipo_abc)}</td>
                    <td><code>${tlEsc(p.cantidades)}</code></td>
                    <td><strong>${p.total === null ? 'INACTIVO'
                        : tlEsc(tlNumTxt(p.total, '.'))}</strong></td>
                    <td>${tlEsc(p.cant_pedir != null
                        ? tlNumTxt(p.cant_pedir, '.') : '—')}</td>
                    <td>${tlEsc(p.unidad)}${p.uni_bod ? ' / ' + tlEsc(p.uni_bod) : ''}</td>
                    <td><button class="btn btn-sm btn-secondary tl-editar" data-idx="${i}">
                        <i class="fas fa-pen"></i></button></td>
                </tr>`).join('')}
            </tbody>
        </table>`;

    cont.querySelector('#tl-d-volver').addEventListener('click', () => {
        if (tlCont === 'tl-contenido-historico') tlVerHistorico();
        else cambiarVista('toma-historico');
    });
    cont.querySelector('#tl-d-excel').addEventListener('click', () => tlExportar(bodega, fecha, 'xlsx'));
    const bor = cont.querySelector('#tl-d-borrar');
    if (bor) bor.addEventListener('click', () => tlEliminarToma(bodega, fecha));
    cont.querySelectorAll('.tl-editar').forEach(b => {
        b.addEventListener('click', () => tlEditarProducto(productos[b.dataset.idx]));
    });
}


/* ---------------------------------------------------------------------------
   Modal de edicion.

   El original abria un panel "Editar Producto" con Total actual, Nuevo total,
   Cantidad a pedir actual, Nueva cantidad a pedir y Motivo (opcional). Aqui va
   igual, con la anatomia del toolkit: card de 12px, inputs pill de 44px, y el
   valor grande en 26px weight 300.

   Sustituye a los prompt() encadenados, que en un movil son tres dialogos
   seguidos del sistema y no dejan ver lo que se esta corrigiendo.
   --------------------------------------------------------------------------- */
function tlCerrarModal() {
    const m = document.getElementById('tl-modal');
    if (m) m.remove();
}

function tlEditarProducto(p) {
    tlCerrarModal();
    const tienePedir = p.cant_pedir !== null && p.cant_pedir !== undefined;
    const div = document.createElement('div');
    div.id = 'tl-modal';
    div.className = 'tl-modal-fondo';
    div.innerHTML = `
        <div class="tl-modal" role="dialog" aria-modal="true"
             aria-labelledby="tl-modal-titulo">
            <div class="tl-modal-cab">
                <h3 id="tl-modal-titulo">Editar producto</h3>
                <button class="tl-modal-x" id="tl-m-cerrar" aria-label="Cerrar">
                    <i class="fas fa-xmark"></i>
                </button>
            </div>

            <div class="tl-modal-cuerpo">
                <p class="tl-modal-prod">${tlEsc(p.producto)}</p>
                <p class="tl-modal-meta">${tlEsc(p.codigo)}
                    ${p.categoria ? ' · ' + tlEsc(p.categoria) : ''}
                    ${p.tipo_abc ? ' · Tipo ' + tlEsc(p.tipo_abc) : ''}</p>

                <div class="tl-modal-actual">
                    <div>
                        <small>Conteos registrados</small>
                        <code>${tlEsc(p.cantidades)}</code>
                    </div>
                    <div>
                        <small>Total actual</small>
                        <strong>${p.total === null ? 'INACTIVO' : tlEsc(p.total)}</strong>
                    </div>
                    ${tienePedir ? `<div>
                        <small>Cantidad a pedir actual</small>
                        <strong>${tlEsc(p.cant_pedir)}</strong>
                    </div>` : ''}
                </div>

                <label class="tl-modal-campo">
                    <span>Nuevo total</span>
                    <input type="text" inputmode="decimal" id="tl-m-total"
                           value="${p.total === null ? '' : tlEsc(p.total)}">
                </label>

                ${tienePedir ? `
                <label class="tl-modal-campo">
                    <span>Nueva cantidad a pedir</span>
                    <input type="text" inputmode="decimal" id="tl-m-pedir"
                           value="${tlEsc(p.cant_pedir)}">
                </label>` : ''}

                <label class="tl-modal-campo">
                    <span>Motivo (opcional)</span>
                    <input type="text" id="tl-m-motivo"
                           placeholder="Por que se corrige">
                </label>
            </div>

            <div class="tl-modal-pie">
                <button class="btn btn-secondary" id="tl-m-cancelar">Cancelar</button>
                <button class="btn btn-primary" id="tl-m-guardar">
                    <i class="fas fa-check"></i> Guardar
                </button>
            </div>
        </div>`;
    document.body.appendChild(div);

    div.querySelector('#tl-m-cerrar').addEventListener('click', tlCerrarModal);
    div.querySelector('#tl-m-cancelar').addEventListener('click', tlCerrarModal);
    // Cerrar al pinchar fuera, pero no al pinchar dentro de la tarjeta
    div.addEventListener('click', e => { if (e.target === div) tlCerrarModal(); });
    document.addEventListener('keydown', function esc(e) {
        if (e.key === 'Escape') { tlCerrarModal(); document.removeEventListener('keydown', esc); }
    });
    div.querySelector('#tl-m-guardar')
       .addEventListener('click', () => tlGuardarEdicion(p, tienePedir));
    setTimeout(() => { const i = document.getElementById('tl-m-total'); if (i) i.focus(); }, 50);
}

async function tlGuardarEdicion(p, tienePedir) {
    const v = id => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
    const total = v('tl-m-total');
    const pedir = tienePedir ? v('tl-m-pedir') : null;
    const motivo = v('tl-m-motivo');

    if (total !== '' && isNaN(Number(total.replace(',', '.')))) {
        tlAviso('El nuevo total no es un numero', 'error');
        return;
    }
    const btn = document.getElementById('tl-m-guardar');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/toma/editar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tlCred({
                bodega: tlDetalle.bodega, fecha: tlDetalle.fecha, codigo: p.codigo,
                total: total === '' ? null : Number(total.replace(',', '.')),
                cant_pedir: (pedir === null || pedir === '') ? null : pedir,
                motivo
            }))
        });
        const d = await r.json();
        if (!r.ok) { tlAviso(d.error || 'No se pudo editar', 'error'); return; }
        tlCerrarModal();
        tlAviso('Corregido', 'success');
        tlVerDetalle(tlDetalle.bodega, tlDetalle.fecha);
    } catch (e) {
        console.error(e);
        tlAviso('No se pudo editar', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Guardar'; }
    }
}

// ---------------------------------------------------------------------------
// PANTALLA 4: Pedidos del Dia
//
// Que hay que pedir, segun la ultima toma de cada local. Con los mismos filtros
// que el historico, para que las dos pantallas se manejen igual:
// local ("Todos los locales"), categoria, texto libre, fecha y orden.
//
// Solo salen las bodegas cuya tabla guarda la cantidad a pedir: las centrales
// (principal, materia prima, planta) no tienen esa columna. No es un olvido,
// es que su tabla no lo registra.
// ---------------------------------------------------------------------------
let tlPFiltros = { bodega: '', categoria: '', q: '', fecha: '', orden: 'local' };
let tlPLocales = [];
let tlPCategorias = [];
let tlPedidos = [];

function tlVerPedidos() {
    tlPantalla = 'pedidos';
    const cont = tlPanel();
    cont.innerHTML = `
        <div class="tl-encabezado">
            <h3>Pedidos del Dia</h3>
            <p class="tl-ayuda">Lo que hay que pedir segun la ultima toma de cada local</p>
        </div>

        <div class="tl-card-filtros">
            <h4>Filtros</h4>
            <div class="tl-filtros">
                <select id="tlp-bodega" class="obs-filtro-input">
                    <option value="">Todos los locales</option>
                </select>
                <select id="tlp-categoria" class="obs-filtro-input">
                    <option value="">Todas las categorias</option>
                </select>
                <input type="search" id="tlp-q" class="obs-filtro-input"
                       placeholder="Buscar producto o codigo"
                       value="${tlEsc(tlPFiltros.q)}">
                <select id="tlp-orden" class="obs-filtro-input">
                    <option value="local">Ordenar por: Local</option>
                    <option value="producto">Ordenar por: Producto</option>
                    <option value="categoria">Ordenar por: Categoria</option>
                    <option value="cantidad">Ordenar por: Cantidad a pedir</option>
                </select>
            </div>
            <div class="tl-filtros tl-filtros-fechas">
                <input type="date" id="tlp-fecha" class="obs-filtro-input"
                       value="${tlEsc(tlPFiltros.fecha)}">
                <button class="btn btn-primary" id="tlp-buscar">
                    <i class="fas fa-search"></i> Consultar
                </button>
                <button class="btn btn-secondary" id="tlp-limpiar">
                    <i class="fas fa-eraser"></i> Limpiar
                </button>
                <button class="btn btn-secondary" id="tlp-excel">
                    <i class="fas fa-file-csv"></i> Descargar CSV
                </button>
            </div>
            <p class="tl-ayuda" style="margin:10px 0 0">
                Sin fecha se toma la ultima toma de cada local.
            </p>
        </div>

        <div id="tlp-lista"></div>`;

    cont.querySelector('#tlp-buscar').addEventListener('click', tlCargarPedidos);
    cont.querySelector('#tlp-excel').addEventListener('click', tlDescargarPedidos);
    cont.querySelector('#tlp-q').addEventListener('keydown', e => {
        if (e.key === 'Enter') tlCargarPedidos();
    });
    ['tlp-bodega', 'tlp-categoria', 'tlp-orden'].forEach(id => {
        cont.querySelector('#' + id).addEventListener('change', tlCargarPedidos);
    });
    cont.querySelector('#tlp-limpiar').addEventListener('click', () => {
        tlPFiltros = { bodega: '', categoria: '', q: '', fecha: '', orden: 'local' };
        tlVerPedidos();
    });

    tlCargarPedidos();
}

function tlLeerFiltrosPedidos() {
    const g = id => { const e = document.getElementById(id); return e ? e.value : ''; };
    tlPFiltros.bodega = g('tlp-bodega');
    tlPFiltros.categoria = g('tlp-categoria');
    tlPFiltros.q = g('tlp-q');
    tlPFiltros.fecha = g('tlp-fecha');
    tlPFiltros.orden = g('tlp-orden') || 'local';
}

function tlArgsPedidos() {
    const a = tlCred({ orden: tlPFiltros.orden });
    if (tlPFiltros.bodega) a.bodega = tlPFiltros.bodega;
    if (tlPFiltros.categoria) a.categoria = tlPFiltros.categoria;
    if (tlPFiltros.q) a.q = tlPFiltros.q;
    if (tlPFiltros.fecha) a.fecha = tlPFiltros.fecha;
    return a;
}

async function tlCargarPedidos() {
    tlLeerFiltrosPedidos();
    const lista = document.getElementById('tlp-lista');
    lista.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i>'
        + '<p>Cargando pedidos...</p></div>';
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/toma/pedidos?`
            + new URLSearchParams(tlArgsPedidos()));
        const d = await r.json();
        if (!r.ok) {
            lista.innerHTML = `<div class="empty-state"><i class="fas fa-ban"></i>`
                + `<p>${tlEsc(d.error || 'No se pudo consultar')}</p></div>`;
            return;
        }
        tlPedidos = d.pedidos || [];
        // Los desplegables se llenan con lo que devuelve el servidor. Los
        // locales llegan siempre; las categorias dependen del resultado, asi
        // que solo se reemplazan cuando hay algo que poner (si no, al filtrar
        // por una categoria el desplegable se quedaria con esa sola opcion).
        if (d.locales) { tlPLocales = d.locales; tlLlenarLocales(); }
        if ((d.categorias || []).length) { tlPCategorias = d.categorias; }
        tlLlenarCategorias();
        tlPintarPedidos(d);
    } catch (e) {
        console.error(e);
        lista.innerHTML = '<div class="empty-state"><i class="fas fa-plug"></i>'
            + '<p>No se pudo contactar al servidor.</p></div>';
    }
}

function tlLlenarLocales() {
    const sel = document.getElementById('tlp-bodega');
    if (!sel) return;
    sel.innerHTML = '<option value="">Todos los locales</option>'
        + tlPLocales.map(l => `<option value="${tlEsc(l.clave)}">${tlEsc(l.nombre)}</option>`).join('');
    sel.value = tlPFiltros.bodega || '';
}

function tlLlenarCategorias() {
    const sel = document.getElementById('tlp-categoria');
    if (!sel) return;
    sel.innerHTML = '<option value="">Todas las categorias</option>'
        + tlPCategorias.map(c => `<option value="${tlEsc(c)}">${tlEsc(c)}</option>`).join('');
    sel.value = tlPFiltros.categoria || '';
}

function tlPintarPedidos(d) {
    const lista = document.getElementById('tlp-lista');
    if (!tlPedidos.length) {
        lista.innerHTML = '<div class="empty-state"><i class="fas fa-cart-shopping"></i>'
            + `<p>${tlEsc(d.nota || 'No hay productos por pedir con esos filtros.')}</p></div>`;
        return;
    }

    // Resumen por local: cuantos productos pide cada uno y de que fecha sale.
    const porLocal = {};
    tlPedidos.forEach(p => {
        const k = p.bodega_nombre;
        if (!porLocal[k]) porLocal[k] = { n: 0, fecha: p.fecha };
        porLocal[k].n++;
    });

    lista.innerHTML = `
        <div class="tl-metricas">
            ${Object.keys(porLocal).sort().map(k => `
                <div class="tl-metrica">
                    <span>${porLocal[k].n}</span>
                    <small>${tlEsc(k)}</small>
                    <small class="tl-metrica-fecha">${tlEsc(porLocal[k].fecha)}</small>
                </div>`).join('')}
            <div class="tl-metrica">
                <span>${tlPedidos.length}</span><small>Total</small>
            </div>
        </div>

        <table class="data-table tl-tabla">
            <thead><tr>
                <th>Local</th><th>Fecha</th><th>Codigo</th><th>Producto</th>
                <th>Categoria</th><th>Pedir</th><th>Unidad</th><th>Contado</th>
            </tr></thead>
            <tbody>
            ${tlPedidos.map(p => `
                <tr>
                    <td>${tlEsc(p.bodega_nombre)}</td>
                    <td>${tlEsc(p.fecha)}</td>
                    <td>${tlEsc(p.codigo)}</td>
                    <td>${tlEsc(p.producto)}</td>
                    <td>${tlEsc(p.categoria)}</td>
                    <td><strong>${tlEsc(tlNumTxt(p.cant_pedir, '.'))}</strong></td>
                    <td>${tlEsc(p.uni_bod)}</td>
                    <td>${tlEsc(tlNumTxt(p.total, '.'))}</td>
                </tr>`).join('')}
            </tbody>
        </table>`;
}

/* CSV armado en el navegador: son los datos que ya estan en pantalla, no hace
   falta volver a pedirlos al servidor. */
function tlDescargarPedidos() {
    if (!tlPedidos.length) { tlAviso('No hay pedidos que descargar', 'warning'); return; }
    const cab = ['Local', 'Fecha', 'Codigo', 'Producto', 'Categoria',
                 'Cantidad a pedir', 'Unidad', 'Contado'];
    const esc = v => {
        const s = (v === null || v === undefined) ? '' : String(v);
        return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const filas = tlPedidos.map(p => [p.bodega_nombre, p.fecha, p.codigo, p.producto,
                                      p.categoria, tlNumTxt(p.cant_pedir),
                                      p.uni_bod, tlNumTxt(p.total)]
                                      .map(esc).join(';'));
    // BOM para que Excel en Windows respete las tildes
    const csv = '﻿' + [cab.join(';')].concat(filas).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'pedidos_' + (tlPFiltros.fecha || tlHoy()) + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}


/* Borrar una toma completa. Es lo UNICO que vuelve a pedir la contrasena: si
   el cruce operativo ya la consumio, borrarla descuadra el inventario. La
   clave se usa y se olvida, no se guarda. */
async function tlEliminarToma(bodega, fecha) {
    const bod = tlBodegas.find(b => b.clave === bodega) || { nombre: bodega };
    if (!confirm(`Vas a ELIMINAR la toma completa de ${bod.nombre} del ${fecha}.

`
        + `Si el cruce operativo ya la uso, el inventario quedara descuadrado.

`
        + `Continuar?`)) return;
    const clave = prompt('Tu contrasena de Control Contable para confirmar:');
    if (!clave) return;
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/toma/eliminar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign(tlCred({ bodega, fecha }), { clave }))
        });
        const d = await r.json();
        if (!r.ok) { tlAviso(d.error || 'No se pudo eliminar', 'error'); return; }
        tlAviso(`Toma eliminada: ${d.filas} filas`, 'success');
        tlVerHistorico();
    } catch (e) {
        console.error(e);
        tlAviso('No se pudo eliminar', 'error');
    }
}
