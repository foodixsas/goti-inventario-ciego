/* =====================================================================
   TABLERO DE COSTOS
   =====================================================================
   Una sola llamada -/api/costos/panel- trae todo, y los cuatro filtros
   -desde, hasta, bodega, categoria- mueven el tablero entero de una vez.
   Antes cada bloque consultaba por su lado y podian acabar mostrando
   periodos distintos sin que se notara.

   Lo primero que se ve son los fallos y su costo en plata. Las tablas
   van despues: sirven para confirmar, no para descubrir.

   Al hacer clic en cualquier producto se abre un popup con sus dias, sus
   documentos y los tramos de costo. El numero de documento es el que se
   busca en Contifico.

   Todo lleva prefijo co_ / co- para no chocar con el resto del sistema.
   ===================================================================== */

let co_datos = null;
let co_iniciado = false;
const co_f = {desde: '', hasta: '', bodega: '', categoria: '', producto: '',
              centro: ''};

/* El buscador de producto escribe texto libre, pero el backend espera un
   codigo. Aqui se guarda la traduccion "VER009 · PIMIENTO VERDE" -> VER009. */
let co_mapaProd = {};

const CO_MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
                'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function co_money(v) {
    v = Number(v) || 0;
    const s = Math.abs(v);
    if (s >= 1000000) return '$' + (v / 1000000).toFixed(1).replace('.', ',') + 'M';
    if (s >= 1000) return '$' + Math.round(v).toLocaleString('es-EC');
    if (s >= 1) return '$' + v.toFixed(2).replace('.', ',');
    return '$' + v.toFixed(6).replace('.', ',');
}

function co_m0(v) { return '$' + Math.round(Number(v) || 0).toLocaleString('es-EC'); }
function co_num(v) { return Math.round(Number(v) || 0).toLocaleString('es-EC'); }

function co_fecha(s) {
    if (!s) return '';
    const p = s.split('-');
    return parseInt(p[2], 10) + ' ' + CO_MES[parseInt(p[1], 10) - 1];
}

function co_pct(v) {
    if (v === null || v === undefined) return '';
    return (v > 0 ? '+' : '') + Math.round(v) + '%';
}

function co_esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g,
        c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
}

/* --- arranque ----------------------------------------------------- */

function co_init() {
    if (co_iniciado) return;
    co_iniciado = true;
    const hoy = new Date();
    hoy.setDate(hoy.getDate() - 3);          // el ultimo dia ya maduro
    const antes = new Date(hoy);
    antes.setDate(antes.getDate() - 90);
    co_f.hasta = hoy.toISOString().slice(0, 10);
    co_f.desde = antes.toISOString().slice(0, 10);
    co_cargar();
}

async function co_cargar() {
    const c = document.getElementById('co-tablero');
    if (!c) return;
    const barra = document.getElementById('co-filtros');
    if (barra) barra.classList.add('co-ocupado');
    if (!co_datos) c.innerHTML = '<div class="co-cargando">Valorizando los movimientos…</div>';
    try {
        const q = new URLSearchParams(co_f).toString();
        const d = await (await fetch('/api/costos/panel?' + q)).json();
        if (!d.ok) throw new Error(d.error || 'error');
        co_datos = d;
        co_pintar();
    } catch (e) {
        c.innerHTML = '<div class="co-error">No se pudo cargar: ' + co_esc(e.message) + '</div>';
    } finally {
        if (barra) barra.classList.remove('co-ocupado');
    }
}

function co_aplicar() {
    co_f.desde = document.getElementById('co-desde').value;
    co_f.hasta = document.getElementById('co-hasta').value;
    co_f.bodega = document.getElementById('co-bodega').value;
    co_f.categoria = document.getElementById('co-categoria').value;
    co_f.producto = co_leerProducto();
    co_f.centro = document.getElementById('co-centro').value;
    co_cargar();
}

/* Acepta lo que eligio del desplegable, un codigo escrito a mano, o un
   nombre completo. Si no reconoce nada, no filtra en vez de no mostrar nada. */
function co_leerProducto() {
    const e = document.getElementById('co-producto');
    const t = (e ? e.value : '').trim();
    if (!t) return '';
    if (co_mapaProd[t]) return co_mapaProd[t];
    const suelto = t.toUpperCase();
    if (co_mapaProd['#' + suelto]) return suelto;          // escribio el codigo
    const porNombre = co_mapaProd['@' + suelto];
    if (porNombre) return porNombre;                        // escribio el nombre
    return '';
}

function co_quitarProducto() {
    co_f.producto = '';
    co_cargar();
}

function co_rango(dias) {
    const h = new Date();
    h.setDate(h.getDate() - 3);
    const d = new Date(h);
    d.setDate(d.getDate() - dias);
    co_f.hasta = h.toISOString().slice(0, 10);
    co_f.desde = d.toISOString().slice(0, 10);
    co_cargar();
}

function co_limpiar() {
    co_f.bodega = '';
    co_f.categoria = '';
    co_f.producto = '';
    co_f.centro = '';
    co_cargar();
}

/* --- el tablero --------------------------------------------------- */

function co_pintar() {
    const d = co_datos, k = d.kpi;
    const suben = d.cambios.filter(c => c.impacto > 0);
    const bajan = d.cambios.filter(c => c.impacto < 0);
    const caro = suben.reduce((a, b) => a + b.impacto, 0);
    const dudoso = d.cambios.filter(c => Math.abs(c.pct || 0) > 200).length;

    document.getElementById('co-tablero').innerHTML =
        co_barraFiltros(d) + `

    <div class="co-kpis">
        ${co_kpi('rojo', co_num(k.prod_desfase), 'Productos con el costo desfasado',
            `en ${co_num(k.desfases)} tramos distintos. Su costo unitario se aparto
             mas de un ${Math.round(d.desvio * 100)}% de lo que ese producto vale
             normalmente.`)}
        ${co_kpi('rojo', co_m0(k.dano), 'Plata movida a un costo que no era',
            `es lo que salio y se traslado mientras el costo estuvo desfasado.
             Contifico no reprocesa hacia atras: eso ya no se corrige solo.`)}
        ${co_kpi('naranja', co_num(d.cambios.length), 'Cambios de costo',
            `en el periodo. ${bajan.length} a la baja, ${suben.length} al alza.
             Un cambio no es un error, pero cada uno hay que poder explicarlo.`)}
        ${co_kpi(k.sin_costo_prod > 20 ? 'rojo' : 'naranja', co_num(k.sin_costo_prod),
            'Se consumen sin costo',
            `productos que se movieron y valen $0. No aparecen en ningun informe,
             asi que su desfase no se puede ni medir.`)}
    </div>

    <div class="co-blk co-destacado">
        <h3>Desfases de costo</h3>
        <p class="co-sub">Tramos en los que el producto costo algo distinto de lo que
           suele costar. Lo normal no es un promedio -que el propio desfase ensucia-
           sino la mediana de los dias: el costo que rigio la mitad del tiempo.
           Clic en cualquiera para aislar ese producto.</p>
        ${co_tablaDesfases(d.desfases.slice(0, 15))}
    </div>

    ${d.producto ? co_bloqueProducto(d) : ''}

    ${dudoso ? `<div class="co-aviso">${dudoso} de los cambios superan el 200%.
        Un costo que se multiplica o se divide de golpe casi nunca es el precio:
        suele ser la unidad mal puesta al ingresar.</div>` : ''}

    <div class="co-blk">
        <h3>Donde se fue la plata, dia a dia</h3>
        <p class="co-sub">Consumo valorado de cada dia. Las marcas de abajo son los
           dias en que cambio el costo de algun producto.</p>
        ${co_serie(d.serie, d.cambios)}
    </div>

    <div class="co-blk co-destacado">
        <h3>Los cambios de costo que mas plata movieron</h3>
        <p class="co-sub">No importa cuanto cambio el costo, sino cuanto salio despues
           a ese costo nuevo. Clic en cualquiera para ver el movimiento exacto.</p>
        ${co_tablaCambios(d.cambios.slice(0, 15))}
    </div>

    <div class="co-dos">
        <div class="co-blk">
            <h3>Consumo por centro de costo</h3>
            <p class="co-sub">No es la bodega con otro nombre: un centro puede agrupar
               varias -Principal y Pulmon son uno solo-. Clic para filtrar.</p>
            ${co_barras((d.centros || []).map(c => ({
                nom: c.nombre, sub: c.prods + ' productos', val: c.valor,
                txt: co_m0(c.valor), cls: 'ce', cen: c.nombre})))}
        </div>
        <div class="co-blk">
            <h3>Consumo por bodega</h3>
            <p class="co-sub">Clic para filtrar el tablero por esa bodega.</p>
            ${co_barras(d.bodegas.map(b => ({
                nom: b.nombre, sub: b.prods + ' productos', val: b.valor,
                txt: co_m0(b.valor), bod: b.nombre})))}
        </div>
    </div>

    <div class="co-blk">
        <h3>Consumo por categoria</h3>
        <p class="co-sub">Clic para filtrar el tablero por esa categoria.</p>
        ${co_barras(d.categorias.map(c => ({
            nom: c.nombre, sub: c.prods + ' productos', val: c.valor,
            txt: co_m0(c.valor), cls: 'na', cat: c.nombre})))}
    </div>

    <div class="co-blk">
        <h3>En que se va la plata</h3>
        <p class="co-sub">Los productos que mas pesan en el consumo del periodo.
           Clic para ver su detalle.</p>
        ${co_tablaTop(d.top)}
    </div>

    ${d.sin_costo.length ? `<div class="co-blk">
        <h3>Se mueven sin costo</h3>
        <p class="co-sub">Contifico no les asigna costo, asi que su consumo vale cero
           y son invisibles en cualquier informe. Casi todos son procesados en planta.</p>
        ${co_tablaSinCosto(d.sin_costo)}
    </div>` : ''}

    <div class="co-pie">Datos del ${co_fecha(d.filtros.min)} al ${co_fecha(d.filtros.max)}.
        Movimientos valorizados contra el costo unitario real, no contra
        costo_promedio.</div>

    <div id="co-modal-cont"></div>`;

    co_enlazar();
}

function co_barraFiltros(d) {
    const bod = d.filtros.bodegas.map(b =>
        `<option value="${co_esc(b)}"${b === d.bodega ? ' selected' : ''}>${co_esc(b)}</option>`).join('');
    const cat = d.filtros.categorias.map(c =>
        `<option value="${co_esc(c)}"${c === d.categoria ? ' selected' : ''}>${co_esc(c)}</option>`).join('');

    // Se rehace el mapa en cada pintada: la lista de productos viene con la
    // respuesta y puede cambiar de un periodo a otro.
    co_mapaProd = {};
    let elegido = '';
    const prod = (d.filtros.productos || []).map(p => {
        const txt = p.codigo + ' · ' + p.nombre;
        co_mapaProd[txt] = p.codigo;
        co_mapaProd['#' + p.codigo] = p.nombre;
        co_mapaProd['@' + String(p.nombre).toUpperCase()] = p.codigo;
        if (p.codigo === d.producto) elegido = txt;
        return `<option value="${co_esc(txt)}"></option>`;
    }).join('');

    const cen = (d.filtros.centros || []).map(c =>
        `<option value="${co_esc(c)}"${c === d.centro ? ' selected' : ''}>${co_esc(c)}</option>`).join('');
    const activo = d.bodega || d.categoria || d.producto || d.centro;
    return `
    <div class="co-filtros" id="co-filtros">
        <div class="co-fg">
            <label>Desde</label>
            <input type="date" id="co-desde" value="${d.desde}"
                   min="${d.filtros.min || ''}" max="${d.filtros.max || ''}">
        </div>
        <div class="co-fg">
            <label>Hasta</label>
            <input type="date" id="co-hasta" value="${d.hasta}"
                   min="${d.filtros.min || ''}" max="${d.filtros.max || ''}">
        </div>
        <div class="co-fg co-ancho">
            <label>Centro de costo</label>
            <select id="co-centro"><option value="">Todos</option>${cen}</select>
        </div>
        <div class="co-fg co-ancho">
            <label>Bodega</label>
            <select id="co-bodega"><option value="">Todas</option>${bod}</select>
        </div>
        <div class="co-fg co-ancho">
            <label>Categoria</label>
            <select id="co-categoria"><option value="">Todas</option>${cat}</select>
        </div>
        <div class="co-fg co-ancho">
            <label>Producto</label>
            <input type="text" id="co-producto" list="co-lista-prod" placeholder="Codigo o nombre"
                   value="${co_esc(elegido)}" autocomplete="off">
            <datalist id="co-lista-prod">${prod}</datalist>
        </div>
        <button class="co-btn co-btn-p" id="co-aplicar">Aplicar</button>
        <div class="co-atajos">
            <button class="co-chip" data-dias="30">30 dias</button>
            <button class="co-chip" data-dias="90">90 dias</button>
            <button class="co-chip" data-dias="180">6 meses</button>
            ${activo ? '<button class="co-chip co-chip-x" id="co-limpiar">Quitar filtros</button>' : ''}
        </div>
    </div>`;
}

/* La historia de costo del producto elegido: cada escalon, desde cuando, y de
   donde salio el dato. Es lo primero que se quiere ver al aislar un producto. */
function co_bloqueProducto(d) {
    const nom = (co_mapaProd['#' + d.producto] || d.producto);
    const t = d.tramos || [];
    const cons = d.top.find(x => x.codigo === d.producto);
    // Su desfase, si lo tiene: de ahi sale el costo "normal" que marca el grafico
    const mio = (d.desfases || []).find(x => x.codigo === d.producto);
    return `
    <div class="co-blk co-destacado">
        <h3>${co_esc(nom)} <span class="co-cod">${co_esc(d.producto)}</span></h3>
        <p class="co-sub">Consumo del periodo: <b>${cons ? co_m0(cons.valor) : '$0'}</b>${
            cons ? ' · ' + co_num(cons.cantidad) + ' ' + co_esc((cons.unidad || '').toLowerCase()) : ''}${
            d.bodega ? ' · en ' + co_esc(d.bodega) : ''}.
            ${t.length > 1 ? 'Su costo cambio ' + (t.length - 1) + ' vez(ces) desde enero.'
                           : 'Su costo no ha cambiado desde enero.'}</p>

        <div class="co-modal-s">Como vario el costo unitario</div>
        ${co_lineaCosto(t, d.desde, d.hasta, mio ? mio.normal : null)}

        <div class="co-modal-s">Cada tramo, y de donde salio el dato</div>
        ${t.length ? '<div class="co-tramos">' + t.slice(-10).map(x => `
            <div class="co-tr ${x.confianza}">
                <div class="co-tr-c">${co_money(x.costo)}</div>
                <div class="co-tr-f">desde ${co_fecha(x.desde)}</div>
                <div class="co-tr-o">${x.fuente === 'doc1' ? 'de un movimiento exacto'
                    : x.fuente === 'factura' ? 'de la factura de compra'
                    : 'del costo promedio (2 decimales)'}</div>
            </div>`).join('') + '</div>'
          : '<div class="co-vacio">Este producto no tiene costo asignado.</div>'}
    </div>`;
}

function co_kpi(cls, big, lbl, pie) {
    return `<div class="co-kpi ${cls}">
        <div class="co-kpi-n">${big}</div>
        <div class="co-kpi-l">${lbl}</div>
        <div class="co-kpi-p">${pie}</div>
    </div>`;
}

/* Barras verticales del consumo diario. Debajo, una marca por cada dia con
   cambio de costo: asi se ve si los cambios caen en dias concretos. */
function co_serie(dias, cambios) {
    if (!dias.length) return '<div class="co-vacio">Sin movimientos en el periodo.</div>';
    const max = Math.max(...dias.map(d => d.valor), 1);
    const porFecha = {};
    cambios.forEach(c => { porFecha[c.fecha] = (porFecha[c.fecha] || 0) + 1; });
    return '<div class="co-serie">' + dias.map(d => {
        const h = Math.max(2, Math.round(100 * d.valor / max));
        const n = porFecha[d.fecha] || 0;
        return `<div class="co-s" title="${co_fecha(d.fecha)}: ${co_m0(d.valor)}${
            n ? ' · ' + n + ' cambio(s) de costo' : ''}">
            <div class="co-s-b" style="height:${h}%"></div>
            <div class="co-s-m ${n ? 'si' : ''}"></div>
        </div>`;
    }).join('') + '</div>' +
    `<div class="co-serie-pie"><span>${co_fecha(dias[0].fecha)}</span>
        <span>maximo ${co_m0(max)} en un dia</span>
        <span>${co_fecha(dias[dias.length - 1].fecha)}</span></div>`;
}

/* Barras horizontales, proporcionales al mayor. */
function co_barras(items) {
    if (!items.length) return '<div class="co-vacio">Sin datos.</div>';
    const max = Math.max(...items.map(i => Math.abs(i.val)), 1);
    return '<div class="co-barras">' + items.map(i => `
        <div class="co-b ${i.cls || ''}" ${i.bod ? `data-bodega="${co_esc(i.bod)}"` : ''}
             ${i.cat ? `data-categoria="${co_esc(i.cat)}"` : ''}
             ${i.cen ? `data-centro="${co_esc(i.cen)}"` : ''}>
            <div class="co-b-t"><span class="co-b-n">${co_esc(i.nom)}</span>
                <span class="co-b-v">${i.txt}</span></div>
            <div class="co-b-r"><div class="co-b-f"
                 style="width:${Math.max(1, 100 * Math.abs(i.val) / max)}%"></div></div>
            <div class="co-b-s">${co_esc(i.sub || '')}</div>
        </div>`).join('') + '</div>';
}

function co_tablaDesfases(filas) {
    if (!filas.length) return `<div class="co-vacio">Ningun costo se aparto de lo suyo
        en este periodo.</div>`;
    return `<div class="co-scroll"><table class="co-t"><thead><tr>
        <th>Producto</th><th>Desde</th><th class="n">Dias</th>
        <th class="n">Costo normal</th><th class="n">Costo del tramo</th>
        <th class="n">Desfase</th><th class="n">Se movio</th>
        <th class="n">Plata afectada</th></tr></thead><tbody>
        ${filas.map(x => `<tr data-cod="${co_esc(x.codigo)}">
            <td><b>${co_esc(x.nombre || x.codigo)}</b>
                <br><span class="co-cod">${co_esc(x.codigo)} · ${co_esc(x.categoria || '')}</span></td>
            <td>${co_fecha(x.desde)}</td>
            <td class="n co-m">${x.dias}</td>
            <td class="n co-m">${co_money(x.normal)}</td>
            <td class="n co-m ${x.desvio > 0 ? 'co-sube' : 'co-baja'}">${co_money(x.costo)}</td>
            <td class="n co-m ${x.desvio > 0 ? 'co-sube' : 'co-baja'}">${co_pct(x.desvio)}</td>
            <td class="n co-m">${co_num(x.cantidad)} ${co_esc((x.unidad || '').toLowerCase())}</td>
            <td class="n co-m"><b>${co_m0(Math.abs(x.dano))}</b></td>
        </tr>`).join('')}
    </tbody></table></div>`;
}

/* La linea del costo unitario a lo largo del periodo. Es un escalon, no una
   curva: el costo se queda quieto entre entrada y entrada, y dibujarlo
   interpolado daria a entender una deriva suave que no existe.
   La franja gris es lo que ese producto vale normalmente. */
function co_lineaCosto(tramos, desde, hasta, normal) {
    const t = (tramos || []).filter(x => x.hasta >= desde && x.desde <= hasta);
    if (!t.length) return '<div class="co-vacio">Sin costo asignado en el periodo.</div>';
    const d0 = new Date(desde + 'T12:00:00').getTime();
    const d1 = new Date(hasta + 'T12:00:00').getTime();
    const ancho = Math.max(1, d1 - d0);
    const costos = t.map(x => x.costo);
    const lo = Math.min(...costos, normal || Infinity);
    const hi = Math.max(...costos, normal || 0);
    const rango = (hi - lo) || (hi || 1);
    const x = ms => 100 * Math.min(1, Math.max(0, (ms - d0) / ancho));
    const y = c => 92 - 84 * ((c - lo) / rango);

    let pts = [];
    t.forEach(s => {
        const a = Math.max(new Date(s.desde + 'T12:00:00').getTime(), d0);
        const b = Math.min(new Date(s.hasta + 'T12:00:00').getTime(), d1);
        pts.push([x(a), y(s.costo)], [x(b), y(s.costo)]);
    });
    const linea = pts.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ');
    const yn = normal ? y(normal) : null;

    return `<div class="co-gr">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="co-gr-svg">
            ${yn !== null ? `<line x1="0" y1="${yn.toFixed(2)}" x2="100" y2="${yn.toFixed(2)}"
                 class="co-gr-ref"/>` : ''}
            <polyline points="${linea}" class="co-gr-l"/>
        </svg>
        <div class="co-gr-ejes">
            <span>${co_money(hi)}</span>
            ${normal ? `<span class="co-gr-n">normal ${co_money(normal)}</span>` : ''}
            <span>${co_money(lo)}</span>
        </div>
        <div class="co-serie-pie"><span>${co_fecha(desde)}</span>
            <span>${t.length} tramo(s) de costo</span>
            <span>${co_fecha(hasta)}</span></div>
    </div>`;
}

function co_tablaCambios(filas) {
    if (!filas.length) return '<div class="co-vacio">Ningun costo cambio en el periodo.</div>';
    return `<div class="co-scroll"><table class="co-t"><thead><tr>
        <th>Producto</th><th>Cuando</th><th class="n">Costo antes</th>
        <th class="n">Costo despues</th><th class="n">Cambio</th>
        <th class="n">Salio despues</th><th class="n">Costo del cambio</th></tr></thead><tbody>
        ${filas.map(c => `<tr data-cod="${co_esc(c.codigo)}">
            <td><b>${co_esc(c.nombre || c.codigo)}</b>
                <br><span class="co-cod">${co_esc(c.codigo)} · ${co_esc(c.categoria || '')}</span></td>
            <td>${co_fecha(c.fecha)}</td>
            <td class="n co-m">${co_money(c.antes)}</td>
            <td class="n co-m">${co_money(c.ahora)}</td>
            <td class="n co-m ${c.pct > 0 ? 'co-sube' : 'co-baja'}">${co_pct(c.pct)}</td>
            <td class="n co-m">${co_num(c.cantidad)} ${co_esc((c.unidad || '').toLowerCase())}</td>
            <td class="n co-m ${c.impacto > 0 ? 'co-sube' : 'co-baja'}"><b>${
                (c.impacto > 0 ? '+' : '') + co_m0(c.impacto)}</b></td>
        </tr>`).join('')}
    </tbody></table></div>`;
}

function co_tablaTop(filas) {
    if (!filas.length) return '<div class="co-vacio">Sin consumo en el periodo.</div>';
    const max = Math.max(...filas.map(f => f.valor), 1);
    return `<div class="co-scroll"><table class="co-t"><thead><tr>
        <th>Producto</th><th>Categoria</th><th class="n">Cantidad</th>
        <th class="n">Consumo</th><th>Peso</th></tr></thead><tbody>
        ${filas.map(f => `<tr data-cod="${co_esc(f.codigo)}">
            <td><b>${co_esc(f.nombre || f.codigo)}</b>
                <br><span class="co-cod">${co_esc(f.codigo)}${
                    f.confianza === 'media' ? ' · costo aproximado' : ''}</span></td>
            <td class="co-cat">${co_esc(f.categoria || '')}</td>
            <td class="n co-m">${co_num(f.cantidad)} ${co_esc((f.unidad || '').toLowerCase())}</td>
            <td class="n co-m"><b>${co_m0(f.valor)}</b></td>
            <td><div class="co-mini"><div style="width:${100 * f.valor / max}%"></div></div></td>
        </tr>`).join('')}
    </tbody></table></div>`;
}

function co_tablaSinCosto(filas) {
    return `<div class="co-scroll"><table class="co-t"><thead><tr>
        <th>Producto</th><th>Categoria</th><th class="n">Dias con salida</th>
        <th class="n">Cantidad sin valorizar</th></tr></thead><tbody>
        ${filas.map(f => `<tr data-cod="${co_esc(f.codigo)}">
            <td><b>${co_esc(f.nombre || f.codigo)}</b>
                <br><span class="co-cod">${co_esc(f.codigo)}</span></td>
            <td class="co-cat">${co_esc(f.categoria || '')}</td>
            <td class="n co-m">${f.dias}</td>
            <td class="n co-m">${co_num(f.cantidad)} ${co_esc((f.unidad || '').toLowerCase())}</td>
        </tr>`).join('')}
    </tbody></table></div>`;
}

/* --- eventos ------------------------------------------------------ */

function co_enlazar() {
    const t = document.getElementById('co-tablero');
    const ap = document.getElementById('co-aplicar');
    if (ap) ap.addEventListener('click', co_aplicar);
    const li = document.getElementById('co-limpiar');
    if (li) li.addEventListener('click', co_limpiar);
    t.querySelectorAll('.co-chip[data-dias]').forEach(b =>
        b.addEventListener('click', () => co_rango(parseInt(b.dataset.dias, 10))));
    // Un clic en un producto abre su popup y nada mas. Filtrar el tablero
    // entero es otra cosa, y se pide desde el propio popup: obligar a bajar
    // hasta el bloque del producto para ver el detalle no tenia sentido.
    t.querySelectorAll('[data-cod]').forEach(el =>
        el.addEventListener('click', () => co_detalle(el.dataset.cod)));
    t.querySelectorAll('[data-bodega]').forEach(el =>
        el.addEventListener('click', () => {
            co_f.bodega = co_f.bodega === el.dataset.bodega ? '' : el.dataset.bodega;
            co_cargar();
        }));
    t.querySelectorAll('[data-centro]').forEach(el =>
        el.addEventListener('click', () => {
            co_f.centro = co_f.centro === el.dataset.centro ? '' : el.dataset.centro;
            co_cargar();
        }));
    t.querySelectorAll('[data-categoria]').forEach(el =>
        el.addEventListener('click', () => {
            co_f.categoria = co_f.categoria === el.dataset.categoria ? '' : el.dataset.categoria;
            co_cargar();
        }));
    ['co-desde', 'co-hasta'].forEach(id => {
        const e = document.getElementById(id);
        if (e) e.addEventListener('change', co_aplicar);
    });
    ['co-bodega', 'co-categoria', 'co-producto', 'co-centro'].forEach(id => {
        const e = document.getElementById(id);
        if (e) e.addEventListener('change', co_aplicar);
    });
    // Borrar el texto del buscador quita el filtro sin tener que pulsar nada.
    const pr = document.getElementById('co-producto');
    if (pr) pr.addEventListener('input', () => {
        if (!pr.value.trim() && co_f.producto) co_quitarProducto();
    });
}

/* --- el popup ----------------------------------------------------- */

function co_abrirModal(html) {
    const c = document.getElementById('co-modal-cont');
    if (!c) return;
    c.innerHTML = `<div class="co-modal-fondo" id="co-modal-fondo">
        <div class="co-modal"><button class="co-modal-x" id="co-modal-x">&times;</button>
        ${html}</div></div>`;
    document.getElementById('co-modal-x').addEventListener('click', co_cerrarModal);
    document.getElementById('co-modal-fondo').addEventListener('click', ev => {
        if (ev.target.id === 'co-modal-fondo') co_cerrarModal();
    });
    document.addEventListener('keydown', co_escape);
}

function co_cerrarModal() {
    const c = document.getElementById('co-modal-cont');
    if (c) c.innerHTML = '';
    document.removeEventListener('keydown', co_escape);
}

function co_escape(e) { if (e.key === 'Escape') co_cerrarModal(); }

async function co_detalle(codigo) {
    co_abrirModal('<div class="co-cargando">Buscando los movimientos de ' +
                  co_esc(codigo) + '…</div>');
    try {
        const q = new URLSearchParams({codigo: codigo, desde: co_f.desde,
                                       hasta: co_f.hasta, bodega: co_f.bodega});
        const d = await (await fetch('/api/costos/panel/movimientos?' + q)).json();
        if (!d.ok) throw new Error(d.error || 'error');
        co_abrirModal(co_pintarDetalle(d));
        const b = document.getElementById('co-filtrar-por');
        if (b) b.addEventListener('click', () => {
            co_cerrarModal();
            co_f.producto = d.codigo;
            co_cargar();
        });
    } catch (e) {
        co_abrirModal('<div class="co-error">No se pudo cargar: ' +
                      co_esc(e.message) + '</div>');
    }
}

/* El costo que rige la mitad de los dias: la misma referencia que usa el
   backend para los desfases, calculada aqui para no pedirla en otro viaje. */
function co_normal(tramos, desde, hasta) {
    const d0 = new Date(desde + 'T12:00:00').getTime();
    const d1 = new Date(hasta + 'T12:00:00').getTime();
    const dia = 86400000;
    const t = (tramos || []).filter(x => x.hasta >= desde && x.desde <= hasta)
        .map(x => ({
            costo: x.costo,
            dias: Math.max(1, Math.round((Math.min(new Date(x.hasta + 'T12:00:00').getTime(), d1)
                    - Math.max(new Date(x.desde + 'T12:00:00').getTime(), d0)) / dia) + 1),
        }))
        .sort((a, b) => a.costo - b.costo);
    if (!t.length) return null;
    const total = t.reduce((a, b) => a + b.dias, 0);
    let acum = 0;
    for (const x of t) { acum += x.dias; if (acum >= total / 2) return x.costo; }
    return t[t.length - 1].costo;
}

function co_pintarDetalle(d) {
    const uni = (d.filas[0] && d.filas[0].unidad) || '';
    const desde = co_f.desde, hasta = co_f.hasta;
    const normal = co_normal(d.tramos, desde, hasta);
    const enRango = (d.tramos || []).filter(t => t.hasta >= desde && t.desde <= hasta);
    const consumo = d.filas.filter(f => f.tipo === 'EGR')
                           .reduce((a, b) => a + b.valor, 0);
    const cant = d.filas.filter(f => f.tipo === 'EGR')
                        .reduce((a, b) => a + b.cantidad, 0);
    // El tramo que mas se aparta de lo normal, que es lo que se vino a ver
    let peor = null;
    if (normal) enRango.forEach(t => {
        const dv = t.costo / normal - 1;
        if (!peor || Math.abs(dv) > Math.abs(peor.dv)) peor = {t: t, dv: dv};
    });

    return `
    <h3 class="co-modal-t">${co_esc(d.nombre)} <span class="co-cod">${co_esc(d.codigo)}</span></h3>

    <div class="co-modal-cifras">
        <div><b>${co_m0(consumo)}</b><span>consumo del periodo</span></div>
        <div><b>${co_num(cant)} ${co_esc(uni.toLowerCase())}</b><span>cantidad que salio</span></div>
        <div><b>${normal ? co_money(normal) : '—'}</b><span>costo normal</span></div>
        <div class="${peor && Math.abs(peor.dv) > 0.15 ? 'mal' : ''}">
            <b>${peor && Math.abs(peor.dv) > 0.15 ? co_pct(peor.dv * 100) : 'sin desfase'}</b>
            <span>${peor && Math.abs(peor.dv) > 0.15
                ? 'mayor desfase, desde ' + co_fecha(peor.t.desde) : 'en este periodo'}</span></div>
    </div>

    <div class="co-modal-s">Como vario el costo unitario</div>
    ${co_lineaCosto(d.tramos, desde, hasta, normal)}

    <div class="co-modal-s">Cada tramo, y de donde salio el dato</div>
    <div class="co-tramos">${(enRango.length ? enRango : d.tramos).slice(-8).map(t => `
        <div class="co-tr ${t.confianza}">
            <div class="co-tr-c">${co_money(t.costo)}</div>
            <div class="co-tr-f">desde ${co_fecha(t.desde)}</div>
            <div class="co-tr-o">${t.fuente === 'doc1' ? 'de un movimiento exacto'
                : t.fuente === 'factura' ? 'de la factura de compra'
                : 'del costo promedio (2 decimales)'}</div>
        </div>`).join('')}</div>

    <div class="co-modal-s">Movimientos del periodo</div>
    <p class="co-sub">El numero de documento es el que se busca en Contifico.</p>
    <div class="co-scroll co-modal-tabla">
    <table class="co-t"><thead><tr><th>Fecha</th><th>Bodega</th><th>Tipo</th>
        <th class="n">Cantidad</th><th class="n">Costo unit.</th>
        <th class="n">Valor</th><th>Documento</th></tr></thead><tbody>
        ${d.filas.map(f => `<tr class="${f.sin_costo ? 'co-fila-sin' : ''}">
            <td>${co_fecha(f.fecha)}</td>
            <td>${co_esc(f.bodega)}</td>
            <td><span class="co-tag ${f.tipo}">${co_esc(f.tipo)}</span></td>
            <td class="n co-m">${co_num(f.cantidad)} ${co_esc(uni.toLowerCase())}</td>
            <td class="n co-m">${f.costo === null ? '—' : co_money(f.costo)}</td>
            <td class="n co-m">${co_money(f.valor)}</td>
            <td class="co-doc">${co_esc(f.docs || '')}</td>
        </tr>`).join('')}
    </tbody></table></div>
    ${d.filas.length >= 300 ? '<p class="co-sub">Se muestran los 300 mas recientes.</p>' : ''}
    <div class="co-modal-pie">
        <button class="co-btn co-btn-p" id="co-filtrar-por">Filtrar todo el tablero
            por este producto</button>
    </div>`;
}

window.co_init = co_init;
