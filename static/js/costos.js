/**
 * MODULO CONTROL DE COSTOS - FOODIX
 * Detecta variaciones de precio y consumo el mismo dia que ocurren.
 * Dos niveles: la categoria muestra el problema, el producto lo explica.
 * Prefijo: co_
 */

let co_iniciado = false;
let co_filtros = { bodegas: [], categorias: [] };
let co_categoriaAbierta = null;

function co_init() {
    co_cargarAnefi();   // el fondo se refresca cada vez que se entra a la vista
    if (co_iniciado) { co_cargarAlertas(); return; }
    co_iniciado = true;

    const hoy = new Date();
    // Un dia sigue recibiendo movimientos durante unos dias: se arranca en el
    // ultimo dia ya maduro para no leer caidas de consumo que no existen.
    const maduro = new Date(hoy); maduro.setDate(maduro.getDate() - 3);
    const fechaInput = document.getElementById('co-fecha');
    if (fechaInput && !fechaInput.value) fechaInput.value = co_fechaISO(maduro);

    const hasta = document.getElementById('co-hasta');
    const desde = document.getElementById('co-desde');
    if (hasta && !hasta.value) hasta.value = co_fechaISO(hoy);
    if (desde && !desde.value) {
        const d = new Date(hoy); d.setDate(d.getDate() - 30);
        desde.value = co_fechaISO(d);
    }

    co_cargarFiltros().then(() => {
        co_cargarAlertas();
        co_cargarResumen();
    });
}

function co_fechaISO(d) {
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString().split('T')[0];
}

function co_money(v) {
    const n = Number(v) || 0;
    // Los insumos a granel cuestan centavos por unidad: con 2 decimales
    // "0.02 -> 0.01" parece ruido de redondeo cuando es una caida del 60%.
    const dec = Math.abs(n) > 0 && Math.abs(n) < 1 ? 4 : 2;
    return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US',
        { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function co_pct(v) {
    if (v === null || v === undefined) return '—';
    const n = Number(v);
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
}

async function co_cargarFiltros() {
    try {
        const r = await fetch('/api/costos/filtros');
        const d = await r.json();
        if (!d.ok) return;
        co_filtros = d;

        const selB = document.getElementById('co-bodega');
        if (selB) {
            selB.innerHTML = '<option value="">Todas las bodegas</option>' +
                d.bodegas.map(b => `<option value="${b}">${b}</option>`).join('');
        }
        const info = document.getElementById('co-info-datos');
        if (info) {
            info.textContent = d.filas
                ? `Datos disponibles: ${d.desde} a ${d.hasta}`
                : 'Sin datos de resumen todavia';
        }
    } catch (e) { console.error('co_cargarFiltros', e); }
}

// ============ ALERTAS DEL DIA ============
async function co_cargarAlertas() {
    const cont = document.getElementById('co-alertas');
    if (!cont) return;
    cont.innerHTML = '<div class="co-cargando">Revisando el dia...</div>';

    const fecha = document.getElementById('co-fecha')?.value || '';
    const umbral = document.getElementById('co-umbral')?.value || '8';

    try {
        const r = await fetch(`/api/costos/alertas?fecha=${fecha}&umbral=${umbral}`);
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || 'Error al cargar alertas');

        // El orden importa: primero lo que invalida el resto.
        let html = co_bloqueRotos(d) + co_bloqueDia(d) + co_bloqueCalidad(d);

        if (!d.precios.length && !d.consumos.length) {
            html += `<div class="co-vacio">
                <i class="fas fa-check-circle"></i>
                <div><b>Nada que revisar</b>
                <span>Ningun precio se movio mas de ${umbral}% y ninguna categoria
                se salio de su patron.</span></div>
            </div>`;
        } else {
            if (d.precios.length) {
                html += `<h3 class="co-h3"><span class="co-chip co-chip-precio">PRECIO</span>
                    ${d.precios.length} producto${d.precios.length > 1 ? 's cambiaron' : ' cambio'} de costo</h3>`;
                html += d.precios.map(co_filaPrecio).join('');
            }
            if (d.consumos.length) {
                html += `<h3 class="co-h3"><span class="co-chip co-chip-consumo">CONSUMO</span>
                    ${d.consumos.length} categoria${d.consumos.length > 1 ? 's' : ''} fuera de lo habitual</h3>`;
                html += d.consumos.map(co_filaConsumo).join('');
            }
        }

        cont.innerHTML = html;
    } catch (e) {
        cont.innerHTML = `<div class="co-error">No se pudieron cargar las alertas: ${e.message}</div>`;
    }
}

// ============ 1. LO QUE ESTA ROTO ============
// Un costo imposible no es un gasto: es un dato malo. Y mientras este ahi,
// arrastra el total del dia, el de la categoria y la referencia de las
// semanas siguientes. Por eso va primero y en rojo.
function co_bloqueRotos(d) {
    const rotos = d.rotos || [];
    if (!rotos.length) return '';
    const total = rotos.reduce((a, x) => a + x.valor, 0);
    return `<div class="co-roto-panel">
        <div class="co-roto-head">
            <i class="fas fa-triangle-exclamation"></i>
            <div>
                <b>${rotos.length} ${rotos.length > 1 ? 'productos tienen' : 'producto tiene'} un costo imposible este dia</b>
                <span>Suman ${co_money(total)} que no son consumo real. Estan fuera de
                todas las cifras de abajo, pero hay que corregirlos en Contifico:
                mientras el costo siga asi, este producto ensucia cualquier informe.</span>
            </div>
        </div>
        ${rotos.map(x => `
            <div class="co-roto-fila">
                <div class="co-roto-prod">
                    <b>${x.nombre_prod || x.codigo_prod}</b>
                    <span class="co-meta">${x.codigo_prod} · ${x.categoria} · ${x.bodega}</span>
                </div>
                <div class="co-roto-cifras">
                    <div><span class="co-roto-lbl">costo del dia</span>
                         <b class="co-roto-malo">${co_money(x.costo_dia)}</b></div>
                    <div><span class="co-roto-lbl">lo habitual</span>
                         <b>${co_money(x.costo_tipico)}</b></div>
                    <div><span class="co-roto-lbl">se registro</span>
                         <b class="co-roto-malo">${co_money(x.valor)}</b></div>
                </div>
                <div class="co-roto-veces">${co_veces(x.veces)}<span>su costo normal</span></div>
            </div>`).join('')}
        <div class="co-roto-pie">
            Un costo se dispara asi cuando el stock del producto esta en negativo:
            el promedio ponderado de Contifico deja de tener sentido. Revisar el
            stock de ese producto antes que el costo.
        </div>
    </div>`;
}

function co_veces(v) {
    if (!v) return '';
    if (v >= 1000) return Math.round(v / 1000) + '.000x';
    return Math.round(v) + 'x';
}

// ============ 2. COMO FUE EL DIA ============
// Una sola cifra para saber si hay que preocuparse. La referencia es la
// MEDIANA de los mismos dias de semana, no el promedio: con el promedio, un
// solo dia raro deja la referencia inservible durante semanas.
function co_bloqueDia(d) {
    const r = d.resumen;
    if (!r || !r.muestras) return '';
    const hay = r.desvio !== null && r.desvio !== undefined;
    const sube = hay && r.desvio > 0;
    const fuerte = hay && Math.abs(r.desvio) >= 25;
    let frase;
    if (!hay) {
        frase = 'Todavia no hay suficientes dias para comparar.';
    } else if (!fuerte) {
        frase = `Un ${r.dia_semana} normal. La diferencia con lo habitual es de
                 ${co_money(Math.abs(r.diferencia))}.`;
    } else {
        frase = `Se consumio ${co_money(Math.abs(r.diferencia))}
                 ${sube ? 'mas' : 'menos'} que un ${r.dia_semana} habitual.
                 ${sube ? 'Vale la pena ver en que se fue.'
                        : 'Puede ser que el dia todavia se este cargando.'}`;
    }
    return `<div class="co-dia ${fuerte ? (sube ? 'sube' : 'baja') : 'normal'}">
        <div class="co-dia-cifra">
            <span class="co-dia-lbl">Consumo del dia</span>
            <b>${co_money(r.valor_dia)}</b>
        </div>
        <div class="co-dia-vs">
            <span class="co-dia-lbl">Un ${r.dia_semana} habitual</span>
            <b>${co_money(r.valor_tipico)}</b>
            <span class="co-dia-muestras">mediana de ${r.muestras} ${r.dia_semana}s</span>
        </div>
        ${hay ? `<div class="co-dia-var ${sube ? 'sube' : 'baja'}">${co_pct(r.desvio)}</div>` : ''}
        <div class="co-dia-frase">${frase}</div>
    </div>`;
}

// ============ 3. AVISOS DE CALIDAD DEL DATO ============
function co_bloqueCalidad(d) {
    const c = d.calidad;
    if (!c) return '';
    const avisos = [];
    if (c.completitud !== null && c.completitud < 80) {
        avisos.push(`<b>Este dia todavia se esta cargando: llego el ${c.completitud}% de
            los movimientos que suele tener un dia asi.</b> Lo de abajo puede marcar
            caidas que no son reales. Los movimientos siguen llegando hasta unos
            ${d.dias_madurez} dias despues.`);
    }
    if (c.filas_sin_costo > 0) {
        const pct = c.filas ? (100 * c.filas_sin_costo / c.filas).toFixed(0) : 0;
        avisos.push(`<b>${pct}% de los movimientos del dia no tienen costo.</b>
            Ese consumo no se puede valorizar, asi que las cifras son un piso, no el total.`);
    }
    if (c.sin_catalogo > 0) {
        avisos.push(`${c.sin_catalogo} movimiento(s) son de productos que no estan en el
            catalogo de Contifico. Conviene darlos de alta para poder seguirlos.`);
    }
    if (!avisos.length) return '';
    return `<div class="co-aviso"><i class="fas fa-circle-info"></i>
        <div>${avisos.join('<br><br>')}</div></div>`;
}

function co_filaPrecio(p) {
    const sube = p.variacion > 0;
    return `<div class="co-alerta ${sube ? 'sube' : 'baja'}">
        <div class="co-alerta-main">
            <div class="co-alerta-titulo">
                <b>${p.nombre_prod || p.codigo_prod}</b>
                <span class="co-meta">${p.categoria} · ${p.bodega}</span>
            </div>
            <div class="co-alerta-cifras">
                <span class="co-antes">${co_money(p.costo_base)}</span>
                <i class="fas fa-arrow-right"></i>
                <span class="co-ahora">${co_money(p.costo_hoy)}</span>
                <span class="co-var ${sube ? 'sube' : 'baja'}">${co_pct(p.variacion)}</span>
            </div>
        </div>
        <div class="co-alerta-lado">
            <div class="co-impacto ${sube ? 'sube' : 'baja'}">${co_money(p.impacto_mes)}</div>
            <div class="co-impacto-lbl">impacto al mes</div>
            <button class="co-btn-mini" onclick="co_verProducto('${p.codigo_prod}')">Ver historia</button>
        </div>
    </div>`;
}

function co_filaConsumo(c) {
    const sube = c.desvio > 0;
    return `<div class="co-alerta consumo ${sube ? 'sube' : 'baja'}">
        <div class="co-alerta-main">
            <div class="co-alerta-titulo">
                <b>${c.categoria}</b>
                <span class="co-meta">${c.bodega}</span>
            </div>
            <div class="co-alerta-cifras">
                <span class="co-antes">habitual ${co_money(c.promedio)}</span>
                <i class="fas fa-arrow-right"></i>
                <span class="co-ahora">${co_money(c.valor_dia)}</span>
                <span class="co-var ${sube ? 'sube' : 'baja'}">${co_pct(c.desvio)}</span>
            </div>
        </div>
        <div class="co-alerta-lado">
            <div class="co-impacto ${sube ? 'sube' : 'baja'}">${co_money(c.diferencia)}</div>
            <div class="co-impacto-lbl">vs ${c.muestras} dias iguales</div>
            <button class="co-btn-mini" onclick="co_verCategoria('${c.categoria.replace(/'/g, "\\'")}')">Ver productos</button>
        </div>
    </div>`;
}

// ============ RESUMEN POR CATEGORIA / PRODUCTO ============
async function co_cargarResumen() {
    const cont = document.getElementById('co-tabla');
    if (!cont) return;
    cont.innerHTML = '<div class="co-cargando">Calculando consumo...</div>';

    const desde = document.getElementById('co-desde')?.value || '';
    const hasta = document.getElementById('co-hasta')?.value || '';
    const bodega = document.getElementById('co-bodega')?.value || '';

    try {
        const url = `/api/costos/resumen?nivel=categoria&desde=${desde}&hasta=${hasta}`
            + `&bodega=${encodeURIComponent(bodega)}`;
        const r = await fetch(url);
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || 'Error');

        if (!d.filas.length) {
            cont.innerHTML = '<div class="co-vacio"><div>Sin consumo registrado en el periodo</div></div>';
            return;
        }

        let html = `<table class="co-tabla">
            <thead><tr>
                <th>Categoria</th>
                <th class="num">Consumo</th>
                <th class="num">Periodo anterior</th>
                <th class="num">Variacion</th>
                <th class="peso">Peso</th>
            </tr></thead><tbody>`;

        d.filas.forEach(f => {
            const peso = d.total ? (100 * f.valor / d.total) : 0;
            const cls = f.variacion === null ? '' : (f.variacion > 10 ? 'sube' : (f.variacion < -10 ? 'baja' : ''));
            html += `<tr class="co-fila-cat" onclick="co_verCategoria('${f.categoria.replace(/'/g, "\\'")}')">
                <td><i class="fas fa-chevron-right co-flecha"></i> ${f.categoria}
                    ${f.sin_costo ? '<span class="co-sincosto" title="Movimientos sin costo registrado">sin costo</span>' : ''}</td>
                <td class="num">${co_money(f.valor)}</td>
                <td class="num co-prev">${co_money(f.valor_prev)}</td>
                <td class="num co-var-cell ${cls}">${co_pct(f.variacion)}</td>
                <td class="peso"><div class="co-barra"><span style="width:${peso.toFixed(1)}%"></span></div></td>
            </tr>`;
        });
        html += `</tbody><tfoot><tr>
            <td><b>Total</b></td>
            <td class="num"><b>${co_money(d.total)}</b></td>
            <td colspan="3"></td>
        </tr></tfoot></table>`;
        cont.innerHTML = html;
    } catch (e) {
        cont.innerHTML = `<div class="co-error">No se pudo cargar el resumen: ${e.message}</div>`;
    }
}

async function co_verCategoria(categoria) {
    co_categoriaAbierta = categoria;
    const cont = document.getElementById('co-tabla');
    cont.innerHTML = '<div class="co-cargando">Abriendo productos...</div>';

    const desde = document.getElementById('co-desde')?.value || '';
    const hasta = document.getElementById('co-hasta')?.value || '';
    const bodega = document.getElementById('co-bodega')?.value || '';

    try {
        const url = `/api/costos/resumen?nivel=producto&desde=${desde}&hasta=${hasta}`
            + `&bodega=${encodeURIComponent(bodega)}&categoria=${encodeURIComponent(categoria)}`;
        const r = await fetch(url);
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || 'Error');

        let html = `<div class="co-volver" onclick="co_cargarResumen()">
            <i class="fas fa-arrow-left"></i> Volver a categorias</div>
            <h3 class="co-h3-cat">${categoria}</h3>`;

        if (!d.filas.length) {
            html += '<div class="co-vacio"><div>Sin productos en el periodo</div></div>';
            cont.innerHTML = html;
            return;
        }

        html += `<table class="co-tabla">
            <thead><tr>
                <th>Producto</th>
                <th class="num">Cantidad</th>
                <th class="num">Consumo</th>
                <th class="num">Periodo anterior</th>
                <th class="num">Variacion</th>
                <th></th>
            </tr></thead><tbody>`;
        d.filas.forEach(f => {
            const cls = f.variacion === null ? '' : (f.variacion > 10 ? 'sube' : (f.variacion < -10 ? 'baja' : ''));
            html += `<tr>
                <td>${f.nombre_prod || f.codigo_prod}
                    ${f.sin_costo ? '<span class="co-sincosto">sin costo</span>' : ''}</td>
                <td class="num">${(f.cantidad || 0).toLocaleString('en-US', { maximumFractionDigits: 1 })}</td>
                <td class="num">${co_money(f.valor)}</td>
                <td class="num co-prev">${co_money(f.valor_prev)}</td>
                <td class="num co-var-cell ${cls}">${co_pct(f.variacion)}</td>
                <td><button class="co-btn-mini" onclick="co_verProducto('${f.codigo_prod}')">Historia</button></td>
            </tr>`;
        });
        html += `</tbody><tfoot><tr>
            <td><b>Total ${categoria}</b></td><td></td>
            <td class="num"><b>${co_money(d.total)}</b></td>
            <td colspan="3"></td>
        </tr></tfoot></table>`;
        cont.innerHTML = html;
    } catch (e) {
        cont.innerHTML = `<div class="co-error">${e.message}</div>`;
    }
}

// ============ HISTORIA DE UN PRODUCTO ============
async function co_verProducto(codigo) {
    let modal = document.getElementById('co-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'co-modal';
        modal.className = 'co-modal';
        modal.innerHTML = `<div class="co-modal-fondo" onclick="co_cerrarModal()"></div>
            <div class="co-modal-caja">
                <div class="co-modal-head">
                    <div><h3 id="co-modal-titulo">Producto</h3>
                         <p id="co-modal-sub"></p></div>
                    <button onclick="co_cerrarModal()">&times;</button>
                </div>
                <div class="co-modal-body" id="co-modal-body"></div>
            </div>`;
        document.body.appendChild(modal);
    }
    modal.classList.add('activo');
    document.getElementById('co-modal-body').innerHTML =
        '<div class="co-cargando">Cargando historia...</div>';

    try {
        const r = await fetch(`/api/costos/producto?codigo=${encodeURIComponent(codigo)}&dias=90`);
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || 'Error');

        document.getElementById('co-modal-titulo').textContent = d.nombre || codigo;
        document.getElementById('co-modal-sub').textContent =
            `${d.categoria || ''} · codigo ${codigo}`;

        if (!d.serie.length) {
            document.getElementById('co-modal-body').innerHTML =
                '<div class="co-vacio"><div>Sin movimientos en 90 dias</div></div>';
            return;
        }

        const costos = d.serie.filter(s => s.costo).map(s => s.costo);
        const min = Math.min(...costos), max = Math.max(...costos);
        const rango = (max - min) || 1;

        let html = `<div class="co-modal-kpis">
            <div><span>Costo actual</span><b>${co_money(costos[costos.length - 1])}</b></div>
            <div><span>Minimo 90d</span><b>${co_money(min)}</b></div>
            <div><span>Maximo 90d</span><b>${co_money(max)}</b></div>
            <div><span>Consumo 90d</span><b>${co_money(d.serie.reduce((a, s) => a + s.valor, 0))}</b></div>
        </div>`;

        // Grafico simple de costo por dia (barras proporcionales)
        html += '<div class="co-spark">';
        d.serie.forEach(s => {
            if (!s.costo) { html += '<span class="co-spark-b vacio" title="' + s.fecha + ': sin costo"></span>'; return; }
            const alto = 12 + 88 * (s.costo - min) / rango;
            html += `<span class="co-spark-b" style="height:${alto.toFixed(0)}%"
                title="${s.fecha}: ${co_money(s.costo)} · ${s.cantidad} unid"></span>`;
        });
        html += '</div><div class="co-spark-lbl"><span>' + d.serie[0].fecha +
            '</span><span>' + d.serie[d.serie.length - 1].fecha + '</span></div>';

        html += `<table class="co-tabla co-tabla-mini">
            <thead><tr><th>Fecha</th><th class="num">Costo unitario</th>
            <th class="num">Cantidad</th><th class="num">Consumo</th></tr></thead><tbody>`;
        d.serie.slice().reverse().slice(0, 30).forEach(s => {
            html += `<tr><td>${s.fecha}</td>
                <td class="num">${s.costo ? co_money(s.costo) : '<span class="co-prev">sin costo</span>'}</td>
                <td class="num">${(s.cantidad || 0).toLocaleString('en-US', { maximumFractionDigits: 1 })}</td>
                <td class="num">${co_money(s.valor)}</td></tr>`;
        });
        html += '</tbody></table>';
        document.getElementById('co-modal-body').innerHTML = html;
    } catch (e) {
        document.getElementById('co-modal-body').innerHTML =
            `<div class="co-error">${e.message}</div>`;
    }
}

function co_cerrarModal() {
    const m = document.getElementById('co-modal');
    if (m) m.classList.remove('activo');
}

async function co_refrescarDatos() {
    const btn = document.getElementById('co-btn-refrescar');
    if (btn) { btn.disabled = true; btn.textContent = 'Actualizando...'; }
    try {
        const r = await fetch('/api/costos/refrescar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dias: 3 })
        });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || 'Error');
        await co_cargarFiltros();
        await co_cargarAlertas();
        await co_cargarResumen();
    } catch (e) {
        alert('No se pudo actualizar: ' + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync"></i> Actualizar datos'; }
    }
}

// ============ FONDO DE INVERSION ANEFI ============
// El fondo vive aqui y NO en el flujo de caja: su acumulado no es caja con la que
// se pueda pagar, es plata apartada que genera intereses. El aporte si sale del
// banco, por eso sigue siendo un egreso dentro del flujo; lo que se muestra aqui
// es en que va el fondo.
// El movimiento se toma de la BD (no de la grilla del flujo, que puede ni existir
// en esta pantalla).
async function co_cargarAnefi() {
    const cont = document.getElementById('co-anefi');
    if (!cont) return;
    try {
        const res = await fetch('/api/flujo-caja/anefi-resumen');
        const d = await res.json();
        if (!d.ok) throw new Error(d.error || 'error');

        const money = v => (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
        const fechaCorta = f => {
            if (!f) return '';
            const [a, m, dd] = f.split('-');
            return `${dd}/${m}/${a}`;
        };
        const partes = [];
        if (Math.abs(d.aportes) > 0.005) {
            partes.push(`${d.aportes > 0 ? 'Aportes' : 'Rescates'} ${money(Math.abs(d.aportes))}`);
        }
        if (Math.abs(d.intereses) > 0.005) partes.push(`Intereses ${money(d.intereses)}`);

        const base = d.fecha_corte
            ? `Saldo al ${fechaCorta(d.fecha_corte)} ${money(d.saldo)}`
            : `Acumulado ${money(d.saldo)}`;

        const aviso = d.fecha_corte ? '' :
            `<div style="font-size:10px;color:#b45309;margin-top:6px;">
                <i class="fas fa-exclamation-triangle"></i>
                Sin fecha de corte: todo lo registrado se suma al saldo. Si la cartola ya
                traia esos intereses, quedarian contados dos veces.
             </div>`;

        cont.innerHTML = `
            <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:14px 16px;margin-bottom:16px;">
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                    <span style="font-size:11px;color:#6d28d9;font-weight:700;letter-spacing:.4px;">
                        <i class="fas fa-piggy-bank"></i> FONDO DE INVERSION ANEFI
                    </span>
                    <span style="font-size:10px;color:#64748b;">fuera del flujo de caja</span>
                    <button onclick="fc_anefiAbrir()" title="Registrar intereses, ajustes y el saldo de la cartola"
                            style="margin-left:auto;background:#6d28d9;color:#fff;border:none;border-radius:6px;
                                   font-size:11px;font-weight:600;padding:5px 12px;cursor:pointer;">
                        <i class="fas fa-plus"></i> Intereses y ajustes
                    </button>
                </div>
                <div style="font-size:24px;font-weight:700;color:#4c1d95;margin-top:6px;font-family:'JetBrains Mono',monospace;">
                    ${money(d.total)}
                </div>
                <div style="font-size:11px;color:#64748b;margin-top:2px;">
                    ${base}${partes.length ? ' &middot; ' + partes.join(' &middot; ') : ' &middot; sin movimiento posterior'}
                </div>
                ${aviso}
            </div>`;
    } catch (e) {
        cont.innerHTML = `<div style="font-size:11px;color:#dc2626;margin-bottom:12px;">
            No se pudo cargar el fondo ANEFI: ${e.message}</div>`;
    }
}
