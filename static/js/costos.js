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
    return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US',
        { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    cont.innerHTML = '<div class="co-cargando">Buscando variaciones...</div>';

    const fecha = document.getElementById('co-fecha')?.value || '';
    const umbral = document.getElementById('co-umbral')?.value || '8';

    try {
        const r = await fetch(`/api/costos/alertas?fecha=${fecha}&umbral=${umbral}`);
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || 'Error al cargar alertas');

        let html = '';

        // Aviso de calidad: consumo sin costo o sin catalogo = puntos ciegos
        if (d.calidad) {
            const avisos = [];
            // Un dia a medias se leeria como una caida de consumo que no ocurrio
            if (d.calidad.completitud !== null && d.calidad.completitud < 80) {
                avisos.push(`<b>Este dia todavia se esta cargando (${d.calidad.completitud}% de lo
                    habitual para un dia asi).</b> Las alertas de consumo de abajo pueden marcar
                    caidas que no son reales. Los movimientos siguen llegando hasta unos
                    ${d.dias_madurez} dias despues.`);
            }
            if (d.calidad.filas_sin_costo > 0) {
                const pct = d.calidad.filas
                    ? (100 * d.calidad.filas_sin_costo / d.calidad.filas).toFixed(0) : 0;
                avisos.push(`<b>${pct}% de los movimientos del dia no tienen costo registrado.</b>
                    Ese consumo no se puede valorizar, asi que las cifras de abajo son un piso, no el total.`);
            }
            if (d.calidad.sin_catalogo > 0) {
                avisos.push(`${d.calidad.sin_catalogo} movimiento(s) son de productos que no estan
                    en el catalogo de Contifico. No generan alerta porque no hay sobre que actuar,
                    pero conviene darlos de alta.`);
            }
            if (avisos.length) {
                html += `<div class="co-aviso"><i class="fas fa-exclamation-triangle"></i>
                    <div>${avisos.join('<br><br>')}</div></div>`;
            }
        }

        if (!d.precios.length && !d.consumos.length) {
            html += `<div class="co-vacio">
                <i class="fas fa-check-circle"></i>
                <div><b>Sin variaciones sobre el umbral</b>
                <span>Ningun precio se movio mas de ${umbral}% ni hay consumos fuera de patron el ${d.fecha}.</span></div>
            </div>`;
            cont.innerHTML = html;
            return;
        }

        if (d.precios.length) {
            html += `<h3 class="co-h3"><span class="co-chip co-chip-precio">PRECIO</span>
                ${d.precios.length} producto${d.precios.length > 1 ? 's' : ''} cambiaron de costo</h3>`;
            html += d.precios.map(p => co_filaPrecio(p)).join('');
        }

        if (d.consumos.length) {
            html += `<h3 class="co-h3"><span class="co-chip co-chip-consumo">CONSUMO</span>
                ${d.consumos.length} categoria${d.consumos.length > 1 ? 's' : ''} fuera de su patron</h3>`;
            html += d.consumos.map(c => co_filaConsumo(c)).join('');
        }

        cont.innerHTML = html;
    } catch (e) {
        cont.innerHTML = `<div class="co-error">No se pudieron cargar las alertas: ${e.message}</div>`;
    }
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
                <span class="co-antes">tipico ${co_money(c.promedio)}</span>
                <i class="fas fa-arrow-right"></i>
                <span class="co-ahora">${co_money(c.valor_dia)}</span>
                <span class="co-var ${sube ? 'sube' : 'baja'}">${co_pct(c.desvio)}</span>
            </div>
        </div>
        <div class="co-alerta-lado">
            <div class="co-impacto ${sube ? 'sube' : 'baja'}">${co_money(c.diferencia)}</div>
            <div class="co-impacto-lbl">vs ${c.muestras} semanas</div>
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
