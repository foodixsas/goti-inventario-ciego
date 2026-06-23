// ==================== DASHBOARD & CHARTS ====================

// Rastrear instancias de graficos para destruirlos antes de recrear
let chartInstances = {};

// Paleta FOODIX — derivada del primary #123450
const CHART_COLORS = [
    '#123450',  // Primary
    '#1a4a6e',  // Primary light
    '#1e6091',  // Azul medio
    '#2980b9',  // Azul cielo
    '#3498db',  // Azul claro
    '#1abc9c',  // Verde azulado
    '#16a085',  // Verde oscuro
    '#2c3e50',  // Gris azulado
    '#34495e',  // Gris medio
];

const CHART_COLORS_ALPHA = [
    'rgba(18, 52, 80, 0.75)',
    'rgba(26, 74, 110, 0.75)',
    'rgba(30, 96, 145, 0.75)',
    'rgba(41, 128, 185, 0.75)',
    'rgba(52, 152, 219, 0.75)',
    'rgba(26, 188, 156, 0.75)',
    'rgba(22, 160, 133, 0.75)',
    'rgba(44, 62, 80, 0.75)',
    'rgba(52, 73, 94, 0.75)',
];

// Colores semanticos para faltantes/sobrantes (dentro de la paleta)
const COLOR_FALTANTE = '#123450';
const COLOR_FALTANTE_ALPHA = 'rgba(18, 52, 80, 0.8)';
const COLOR_SOBRANTE = '#1abc9c';
const COLOR_SOBRANTE_ALPHA = 'rgba(26, 188, 156, 0.8)';

function configureChartDefaults() {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.font.family = "'Inter', 'Poppins', sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = '#64748B';
    Chart.defaults.plugins.tooltip.backgroundColor = '#123450';
    Chart.defaults.plugins.tooltip.titleFont = { weight: '600' };
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.padding = 16;
    Chart.defaults.elements.bar.borderRadius = 4;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function destroyChart(id) {
    if (chartInstances[id]) {
        chartInstances[id].destroy();
        delete chartInstances[id];
    }
}

const MARCAS_BODEGAS = {
    'chios': ['real_audiencia', 'floreana', 'portugal'],
    'santo_cachon': ['santo_cachon_real', 'santo_cachon_portugal'],
    'simon_bolon': ['simon_bolon'],
    'operaciones': ['bodega_principal', 'materia_prima', 'planta']
};

const _TODAS_BODEGAS = [
    { value: 'real_audiencia',       label: 'Real Audiencia',        marca: 'chios' },
    { value: 'floreana',             label: 'Floreana',              marca: 'chios' },
    { value: 'portugal',             label: 'Portugal',              marca: 'chios' },
    { value: 'santo_cachon_real',    label: 'Santo Cachon Real',     marca: 'santo_cachon' },
    { value: 'santo_cachon_portugal',label: 'Santo Cachon Portugal', marca: 'santo_cachon' },
    { value: 'simon_bolon',          label: 'Simon Bolon',           marca: 'simon_bolon' },
    { value: 'bodega_principal',     label: 'Bodega Principal',      marca: 'operaciones' },
    { value: 'materia_prima',        label: 'Materia Prima',         marca: 'operaciones' },
    { value: 'planta',               label: 'Planta de Produccion',  marca: 'operaciones' },
];

function filtrarBodegasPorMarca() {
    const marca = document.getElementById('dash-marca').value;
    const selectBodega = document.getElementById('dash-bodega');
    const filtradas = marca ? _TODAS_BODEGAS.filter(b => b.marca === marca) : _TODAS_BODEGAS;
    const labelTodas = marca ? `Todos los locales de ${document.getElementById('dash-marca').options[document.getElementById('dash-marca').selectedIndex].text}` : 'Todos';
    selectBodega.innerHTML = `<option value="">${labelTodas}</option>` +
        filtradas.map(b => `<option value="${b.value}">${b.label}</option>`).join('');
}

async function _cargarContadoresDash() {
    const sel = document.getElementById('dash-contador');
    if (!sel || sel.options.length > 1) return;
    try {
        const res = await fetch(`${CONFIG.API_URL}/api/personas`);
        if (!res.ok) return;
        const personas = await res.json();
        const sorted = personas.filter(p => p.nombre).sort((a,b) => a.nombre.localeCompare(b.nombre));
        sorted.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.username || p.nombre;
            opt.textContent = p.nombre;
            sel.appendChild(opt);
        });
    } catch(e) {}
}

// ==================== DASHBOARD GENERAL TABS ====================

function cambiarDashTab(tab) {
    try { sessionStorage.setItem('dash_tab', tab); } catch(e) {}
    // Activar botón de tab
    document.querySelectorAll('.dash-module-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.dashtab === tab);
    });
    // Mostrar panel correspondiente
    document.querySelectorAll('.dash-tab-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById(`dash-tab-${tab}`);
    if (panel) panel.classList.add('active');
    // Auto-cargar el dashboard del tab
    _autoCargaDashTab(tab);
}

function _autoCargaDashTab(tab) {
    const hoy = new Date().toISOString().split('T')[0];
    const hace30 = new Date(); hace30.setDate(hace30.getDate() - 30);
    const desde30 = hace30.toISOString().split('T')[0];
    switch(tab) {
        case 'inventario': {
            const d = document.getElementById('dash-fecha-desde');
            const h = document.getElementById('dash-fecha-hasta');
            if (!d.value) d.value = desde30;
            if (!h.value) h.value = hoy;
            cargarDashboard();
            break;
        }
        case 'depositos': {
            const d = document.getElementById('dep-dash-desde');
            const h = document.getElementById('dep-dash-hasta');
            if (d && !d.value) d.value = desde30;
            if (h && !h.value) h.value = hoy;
            if (typeof depCargarDashboard === 'function') depCargarDashboard();
            break;
        }
        case 'cuadres': {
            const d = document.getElementById('cuadre-dash-desde');
            const h = document.getElementById('cuadre-dash-hasta');
            if (d && !d.value) d.value = desde30;
            if (h && !h.value) h.value = hoy;
            if (typeof cuadreCargarDashboard === 'function') cuadreCargarDashboard();
            break;
        }
        case 'delivery': {
            const d = document.getElementById('del-dash-desde');
            const h = document.getElementById('del-dash-hasta');
            if (d && !d.value) d.value = desde30;
            if (h && !h.value) h.value = hoy;
            if (typeof delCargarDashboard === 'function') delCargarDashboard();
            break;
        }
        case 'facturas': {
            const d = document.getElementById('fac-dash-desde');
            const h = document.getElementById('fac-dash-hasta');
            if (d && !d.value) d.value = desde30;
            if (h && !h.value) h.value = hoy;
            if (typeof facCargarDashboard === 'function') facCargarDashboard();
            break;
        }
    }
}

let _dashCargando = false;
async function cargarDashboard() {
    if (_dashCargando) return;

    const fechaDesde = document.getElementById('dash-fecha-desde').value;
    const fechaHasta = document.getElementById('dash-fecha-hasta').value;
    const bodega = document.getElementById('dash-bodega') ? document.getElementById('dash-bodega').value : '';
    const marca = document.getElementById('dash-marca') ? document.getElementById('dash-marca').value : '';

    if (!fechaDesde || !fechaHasta) {
        showToast('Selecciona las fechas desde y hasta', 'error');
        return;
    }

    const productoSel = document.getElementById('dash-producto');
    const producto = productoSel ? productoSel.value : '';
    const contador = document.getElementById('dash-contador')?.value || '';
    const contadorParam = contador ? `&contador=${encodeURIComponent(contador)}` : '';
    // Mostrar estado de carga
    _dashCargando = true;
    const btn = document.getElementById('btn-cargar-dashboard');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cargando...';
    }

    // Construir parámetro de bodega: si hay bodega específica usar esa, si hay marca usar las bodegas de la marca
    let bodegaParam = '';
    if (bodega) {
        bodegaParam = `&bodega=${bodega}`;
    } else if (marca && MARCAS_BODEGAS[marca]) {
        bodegaParam = MARCAS_BODEGAS[marca].map(b => `&bodega=${b}`).join('');
    }

    // Cargar lista de productos disponibles
    _dashCargarProductos(fechaDesde, fechaHasta, bodega || (marca ? MARCAS_BODEGAS[marca]?.[0] : ''));

    try {
        const prodParam = producto ? `&producto=${encodeURIComponent(producto)}` : '';
        const [resDash, resTend] = await Promise.all([
            fetch(`${CONFIG.API_URL}/api/reportes/dashboard?fecha_desde=${fechaDesde}&fecha_hasta=${fechaHasta}${bodegaParam}${prodParam}${contadorParam}`),
            fetch(`${CONFIG.API_URL}/api/reportes/tendencias-temporal?fecha_desde=${fechaDesde}&fecha_hasta=${fechaHasta}${bodegaParam}${prodParam}${contadorParam}`)
        ]);

        if (resDash.ok && resTend.ok) {
            const datosDash = await resDash.json();
            const datosTend = await resTend.json();

            renderDashboardStats(datosDash.bodegas, datosDash.promedios);
            renderDashboardValorResumen(datosDash.bodegas);
            renderChartExactitud(datosDash.bodegas);
            renderChartProductosFallan(datosDash.top_descuadre);
            renderChartDiferenciasBodega(datosDash.bodegas);
            renderChartTendenciaTemporal(datosTend);
            _cargarMotivosDropdown();
            renderTopDescuadre(datosDash.top_descuadre);
            renderContadoresResumen(datosDash.contadores);

            // Cargar motivos por separado para no bloquear el resto
            try {
                const resMotivos = await fetch(`${CONFIG.API_URL}/api/reportes/motivos?fecha_desde=${fechaDesde}&fecha_hasta=${fechaHasta}${bodegaParam}${prodParam}${contadorParam}`);
                const datosMotivos = resMotivos.ok ? await resMotivos.json() : [];
                renderChartMotivos(datosMotivos);
            } catch(e) { console.log('Error cargando motivos:', e); }

            // Cargar % error por persona
            try {
                const resPersonas = await fetch(`${CONFIG.API_URL}/api/reportes/personas-errores?fecha_desde=${fechaDesde}&fecha_hasta=${fechaHasta}${bodegaParam}`);
                const datosPersonas = resPersonas.ok ? await resPersonas.json() : [];
                renderChartPersonasErrores(datosPersonas);
            } catch(e) { console.log('Error cargando personas-errores:', e); }

            showToast('Dashboard actualizado', 'success');
        } else {
            showToast('Error al cargar datos del dashboard', 'error');
        }
    } catch (error) {
        console.error('Error cargando dashboard:', error);
        showToast('Error de conexion al cargar dashboard', 'error');
    } finally {
        _dashCargando = false;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-sync-alt"></i> Actualizar';
        }
    }
}

function _fmtMoney(v) { return '$' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

function renderDashboardStats(datos, promedios) {
    const container = document.getElementById('dashboard-stats');
    if (!datos || datos.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-chart-bar"></i><p>No hay datos para el rango seleccionado</p></div>';
        return;
    }

    const totales = datos.reduce((acc, d) => {
        acc.productos += d.total_productos;
        acc.contados += d.total_contados;
        acc.diferencias += d.total_con_diferencia;
        acc.faltantes += d.valor_faltantes || 0;
        acc.sobrantes += d.valor_sobrantes || 0;
        return acc;
    }, { productos: 0, contados: 0, diferencias: 0, faltantes: 0, sobrantes: 0 });

    const prom = promedios || {};
    const pctConteo = prom.cumplimiento_promedio || 0;
    const pctExacto = prom.exactitud_promedio || 0;
    const totalDias = prom.total_dias || 0;

    container.innerHTML = `
        <div class="dashboard-stat-card">
            <div class="stat-icon icon-productos"><i class="fas fa-clipboard-check"></i></div>
            <div class="stat-info">
                <div class="stat-valor">${pctConteo}%</div>
                <div class="stat-label">Cumplimiento Conteo</div>
                <div style="font-size:11px;color:#64748B;">Promedio diario de ${totalDias} dia(s)</div>
            </div>
        </div>
        <div class="dashboard-stat-card">
            <div class="stat-icon icon-contados"><i class="fas fa-check-circle"></i></div>
            <div class="stat-info">
                <div class="stat-valor">${pctExacto}%</div>
                <div class="stat-label">Exactitud Inventario</div>
                <div style="font-size:11px;color:#64748B;">Promedio diario de ${totalDias} dia(s)</div>
            </div>
        </div>
        <div class="dashboard-stat-card">
            <div class="stat-icon icon-diferencias"><i class="fas fa-arrow-down"></i></div>
            <div class="stat-info">
                <div class="stat-valor" style="color:#123450;">${_fmtMoney(totales.faltantes)}</div>
                <div class="stat-label">Valor Faltantes</div>
            </div>
        </div>
        <div class="dashboard-stat-card">
            <div class="stat-icon icon-desviacion"><i class="fas fa-arrow-up"></i></div>
            <div class="stat-info">
                <div class="stat-valor" style="color:#1abc9c;">${_fmtMoney(totales.sobrantes)}</div>
                <div class="stat-label">Valor Sobrantes</div>
            </div>
        </div>
    `;
}

function renderDashboardValorResumen(datos) {
    const container = document.getElementById('dashboard-valor-resumen');
    if (!container || !datos || datos.length === 0) { if (container) container.innerHTML = ''; return; }
    const totalFalt = datos.reduce((s, d) => s + (d.valor_faltantes || 0), 0);
    const totalSob = datos.reduce((s, d) => s + (d.valor_sobrantes || 0), 0);
    const neto = totalSob - totalFalt;
    const esPerdida = neto < 0;
    container.innerHTML = `
        <div style="background:linear-gradient(135deg, #123450 0%, #1a4a6e 100%);border-radius:12px;padding:20px 24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;color:#fff;">
            <div>
                <div style="font-size:12px;opacity:0.7;text-transform:uppercase;letter-spacing:1px;">Descuadre Neto</div>
                <div style="font-size:28px;font-weight:700;margin-top:4px;">${_fmtMoney(Math.abs(neto))}</div>
                <div style="font-size:12px;opacity:0.8;margin-top:2px;">${esPerdida ? 'Perdida neta' : 'Sobrante neto'} en ${datos.length} bodega(s)</div>
            </div>
            <div style="display:flex;gap:24px;">
                <div style="text-align:center;">
                    <div style="font-size:11px;opacity:0.6;text-transform:uppercase;">Faltantes</div>
                    <div style="font-size:18px;font-weight:600;margin-top:2px;">${_fmtMoney(totalFalt)}</div>
                </div>
                <div style="width:1px;background:rgba(255,255,255,0.2);"></div>
                <div style="text-align:center;">
                    <div style="font-size:11px;opacity:0.6;text-transform:uppercase;">Sobrantes</div>
                    <div style="font-size:18px;font-weight:600;margin-top:2px;">${_fmtMoney(totalSob)}</div>
                </div>
            </div>
        </div>
    `;
}

function renderChartExactitud(datos) {
    if (typeof Chart === 'undefined') return;
    destroyChart('exactitud');
    const ctx = document.getElementById('chart-exactitud');
    if (!ctx || !datos || datos.length === 0) return;

    const totalExactos = datos.reduce((s, d) => s + d.total_contados - d.total_con_diferencia, 0);
    const totalConDif = datos.reduce((s, d) => s + d.total_con_diferencia, 0);
    const pct = (totalExactos + totalConDif) > 0 ? Math.round(totalExactos / (totalExactos + totalConDif) * 100) : 0;

    chartInstances['exactitud'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Exactos', 'Con diferencia'],
            datasets: [{
                data: [totalExactos, totalConDif],
                backgroundColor: [COLOR_SOBRANTE, COLOR_FALTANTE],
                borderWidth: 0,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, color: '#123450' } },
                tooltip: { callbacks: { label: c => `${c.label}: ${c.parsed} productos` } }
            }
        },
        plugins: [{
            id: 'centerText',
            afterDraw(chart) {
                const { ctx: c, chartArea: { width, height, top, left } } = chart;
                c.save();
                c.font = '700 28px Inter, sans-serif';
                c.fillStyle = '#123450';
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillText(`${pct}%`, left + width / 2, top + height / 2 - 8);
                c.font = '400 11px Inter, sans-serif';
                c.fillStyle = '#64748B';
                c.fillText('Exactitud', left + width / 2, top + height / 2 + 14);
                c.restore();
            }
        }]
    });
}

function renderChartProductosFallan(topItems) {
    if (typeof Chart === 'undefined') return;
    destroyChart('productos-fallan');
    const ctx = document.getElementById('chart-productos-fallan');
    if (!ctx || !topItems || topItems.length === 0) return;

    const top8 = topItems.slice(0, 8);
    const labels = top8.map(p => p.nombre.length > 20 ? p.nombre.substring(0, 18) + '...' : p.nombre);
    const valores = top8.map(p => p.valor_descuadre);

    chartInstances['productos-fallan'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: valores,
                backgroundColor: CHART_COLORS.slice(0, top8.length),
                borderWidth: 2,
                borderColor: '#fff',
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '50%',
            plugins: {
                legend: { position: 'right', labels: { font: { size: 10 }, padding: 8, usePointStyle: true, pointStyle: 'circle', color: '#123450' } },
                tooltip: { callbacks: { label: c => `${c.label}: $${c.parsed.toFixed(2)}` } }
            }
        }
    });
}

function renderChartDiferenciasBodega(datos) {
    if (typeof Chart === 'undefined') return;
    destroyChart('diferencias-bodega');
    const ctx = document.getElementById('chart-diferencias-bodega');
    if (!ctx || !datos || datos.length === 0) return;

    const totalFalt = datos.reduce((s, d) => s + (d.valor_faltantes || 0), 0);
    const totalSob = datos.reduce((s, d) => s + (d.valor_sobrantes || 0), 0);

    // Si es 1 bodega, mostrar doughnut faltantes vs sobrantes
    if (datos.length === 1) {
        chartInstances['diferencias-bodega'] = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Faltantes', 'Sobrantes'],
                datasets: [{
                    data: [totalFalt, totalSob],
                    backgroundColor: [COLOR_FALTANTE, COLOR_SOBRANTE],
                    borderWidth: 0,
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, color: '#123450' } },
                    tooltip: { callbacks: { label: c => `${c.label}: $${c.parsed.toFixed(2)}` } }
                }
            },
            plugins: [{
                id: 'centerMoney',
                afterDraw(chart) {
                    const { ctx: c, chartArea: { width, height, top, left } } = chart;
                    c.save();
                    c.font = '700 20px Inter, sans-serif';
                    c.fillStyle = '#123450';
                    c.textAlign = 'center';
                    c.textBaseline = 'middle';
                    c.fillText(`$${(totalFalt + totalSob).toFixed(0)}`, left + width / 2, top + height / 2 - 6);
                    c.font = '400 10px Inter, sans-serif';
                    c.fillStyle = '#64748B';
                    c.fillText('Descuadre total', left + width / 2, top + height / 2 + 12);
                    c.restore();
                }
            }]
        });
    } else {
        chartInstances['diferencias-bodega'] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: datos.map(d => d.local_nombre),
                datasets: [
                    { label: 'Faltantes ($)', data: datos.map(d => d.valor_faltantes || 0), backgroundColor: COLOR_FALTANTE_ALPHA, borderColor: COLOR_FALTANTE, borderWidth: 1, borderRadius: 4 },
                    { label: 'Sobrantes ($)', data: datos.map(d => d.valor_sobrantes || 0), backgroundColor: COLOR_SOBRANTE_ALPHA, borderColor: COLOR_SOBRANTE, borderWidth: 1, borderRadius: 4 }
                ]
            },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'rectRounded', padding: 16 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: $${c.parsed.x.toFixed(2)}` } } },
                scales: { x: { beginAtZero: true, grid: { color: '#F1F5F9', drawBorder: false }, ticks: { callback: v => '$' + v, color: '#94A3B8' } }, y: { grid: { display: false }, ticks: { color: '#123450', font: { weight: '500' } } } }
            }
        });
    }
}

function renderChartFaltantesSobrantes(datos) {
    if (typeof Chart === 'undefined') return;
    destroyChart('faltantes-sobrantes');
    const ctx = document.getElementById('chart-faltantes-sobrantes');
    if (!ctx || !datos || datos.length === 0) return;

    const totalFalt = datos.reduce((s, d) => s + d.total_faltantes, 0);
    const totalSob = datos.reduce((s, d) => s + d.total_sobrantes, 0);
    const totalExactos = datos.reduce((s, d) => s + d.total_contados - d.total_con_diferencia, 0);

    chartInstances['faltantes-sobrantes'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Faltantes', 'Sobrantes', 'Exactos'],
            datasets: [{
                data: [totalFalt, totalSob, totalExactos],
                backgroundColor: [COLOR_FALTANTE, COLOR_SOBRANTE, '#E2E8F0'],
                borderWidth: 2,
                borderColor: '#fff',
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            plugins: {
                legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, color: '#123450' } },
                tooltip: { callbacks: { label: c => `${c.label}: ${c.parsed} productos` } }
            }
        },
        plugins: [{
            id: 'centerCount',
            afterDraw(chart) {
                const { ctx: c, chartArea: { width, height, top, left } } = chart;
                c.save();
                c.font = '700 24px Inter, sans-serif';
                c.fillStyle = '#123450';
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillText(`${totalFalt + totalSob}`, left + width / 2, top + height / 2 - 6);
                c.font = '400 10px Inter, sans-serif';
                c.fillStyle = '#64748B';
                c.fillText('Con diferencia', left + width / 2, top + height / 2 + 12);
                c.restore();
            }
        }]
    });
}

function renderTopDescuadre(items) {
    const tbody = document.getElementById('dash-top-tbody');
    if (!tbody) return;
    if (!items || items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#64748B;padding:20px;">Sin datos</td></tr>';
        return;
    }
    tbody.innerHTML = items.map(p => {
        const difColor = p.diferencia < 0 ? 'color:#123450;font-weight:600;' : 'color:#1abc9c;font-weight:600;';
        return `<tr>
            <td>${escapeHtml(p.codigo)}</td>
            <td>${escapeHtml(p.nombre)}</td>
            <td style="${difColor}">${p.diferencia > 0 ? '+' : ''}${p.diferencia.toFixed(2)}</td>
            <td>$${p.costo_unitario.toFixed(2)}</td>
            <td style="font-weight:700;color:#123450;">$${p.valor_descuadre.toFixed(2)}</td>
        </tr>`;
    }).join('');
}

async function actualizarTendenciaMotivo() {
    const sel = document.getElementById('tendencia-motivo-filter');
    if (!sel) return;
    const motivo = sel.value || '';
    const fechaDesde = document.getElementById('dash-fecha-desde')?.value || '';
    const fechaHasta = document.getElementById('dash-fecha-hasta')?.value || '';
    const marca = document.getElementById('dash-marca')?.value || '';
    const bodega = document.getElementById('dash-bodega')?.value || '';
    const contador = document.getElementById('dash-contador')?.value || '';

    if (!fechaDesde || !fechaHasta) return;

    let bodegaParam = '';
    if (bodega) {
        bodegaParam = '&bodega=' + bodega;
    } else if (marca && MARCAS_BODEGAS && MARCAS_BODEGAS[marca]) {
        bodegaParam = MARCAS_BODEGAS[marca].map(function(b) { return '&bodega=' + b; }).join('');
    }

    var motivoParam = motivo ? '&motivo=' + encodeURIComponent(motivo) : '';
    var contadorParam = contador ? '&contador=' + encodeURIComponent(contador) : '';
    var url = CONFIG.API_URL + '/api/reportes/tendencias-temporal?fecha_desde=' + fechaDesde + '&fecha_hasta=' + fechaHasta + bodegaParam + motivoParam + contadorParam;

    try {
        var r = await fetch(url);
        if (r.ok) {
            var datos = await r.json();
            renderChartTendenciaTemporal(datos);
        }
    } catch(e) { console.error('Error actualizando tendencia por motivo:', e); }
}

function _cargarMotivosDropdown(datos) {
    const sel = document.getElementById('tendencia-motivo-filter');
    if (!sel) return;
    // Extraer motivos unicos de los datos del dashboard (motivos ya cargados)
    const valorActual = sel.value;
    // No resetear si ya tiene opciones cargadas por otro medio
    if (sel.options.length <= 1) {
        // Cargar motivos desde endpoint
        fetch(`${CONFIG.API_URL}/api/reportes/motivos-lista`)
            .then(r => r.json())
            .then(motivos => {
                sel.innerHTML = '<option value="">Todos los motivos</option>';
                if (Array.isArray(motivos)) {
                    motivos.forEach(m => {
                        if (m) sel.innerHTML += `<option value="${m}">${m}</option>`;
                    });
                }
                if (valorActual) sel.value = valorActual;
            })
            .catch(() => {});
    }
}

function renderChartTendenciaTemporal(datos) {
    if (typeof Chart === 'undefined') return;
    destroyChart('tendencia-temporal');
    const ctx = document.getElementById('chart-tendencia-temporal');
    if (!ctx || !datos || !datos.fechas || datos.fechas.length === 0) return;

    const fechasCortas = datos.fechas.map(f => {
        const parts = f.split('-');
        return `${parts[2]}/${parts[1]}`;
    });

    const datasets = [];
    let colorIdx = 0;
    for (const [local, info] of Object.entries(datos.series)) {
        datasets.push({
            label: info.nombre,
            data: info.datos,
            borderColor: CHART_COLORS[colorIdx % CHART_COLORS.length],
            backgroundColor: CHART_COLORS_ALPHA[colorIdx % CHART_COLORS_ALPHA.length],
            fill: false,
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 6,
            borderWidth: 2
        });
        colorIdx++;
    }

    const _tendenciaFechas = datos.fechas;
    const _tendenciaSeries = datos.series;

    chartInstances['tendencia-temporal'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: fechasCortas,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: (evt, elements) => {
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    const datasetIdx = elements[0].datasetIndex;
                    const fecha = _tendenciaFechas[idx];
                    const serieKeys = Object.keys(_tendenciaSeries);
                    const bodegaId = serieKeys[datasetIdx] || '';
                    const bodegaNombre = _tendenciaSeries[bodegaId]?.nombre || bodegaId;
                    abrirDetalleTendencia(fecha, bodegaId, bodegaNombre);
                }
            },
            plugins: {
                legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 16 } },
                tooltip: {
                    callbacks: {
                        afterLabel: () => 'Click para ver productos'
                    }
                }
            },
            scales: {
                x: { grid: { color: '#F1F5F9', drawBorder: false }, ticks: { color: '#94A3B8', maxRotation: 45 } },
                y: { beginAtZero: true, grid: { color: '#F1F5F9', drawBorder: false }, ticks: { color: '#94A3B8' }, title: { display: true, text: 'Productos con diferencia', color: '#64748B', font: { size: 11 } } }
            }
        }
    });
    ctx.style.cursor = 'pointer';
}

async function abrirDetalleTendencia(fecha, bodegaId, bodegaNombre) {
    const modal = document.getElementById('modal-motivo');
    const titulo = document.getElementById('modal-motivo-titulo');
    const body = document.getElementById('modal-motivo-body');

    const fechaCorta = fecha.split('-').reverse().join('/');
    titulo.textContent = `Diferencias ${fechaCorta} — ${bodegaNombre}`;
    body.innerHTML = '<div style="text-align:center;padding:20px;"><i class="fas fa-spinner fa-spin" style="font-size:24px;color:var(--primary);"></i><p style="margin-top:10px;color:#94A3B8;">Cargando...</p></div>';
    modal.classList.remove('hidden');

    try {
        const res = await fetch(`${CONFIG.API_URL}/api/reportes/diferencias-fecha?fecha=${fecha}&bodega=${bodegaId}`);
        if (!res.ok) throw new Error('Error');
        const productos = await res.json();

        if (productos.length === 0) {
            body.innerHTML = '<p style="text-align:center;color:#94A3B8;padding:20px;">No hay productos con diferencia</p>';
            return;
        }

        const tablaFilas = (lista) => lista.map(p => {
            const difColor = p.diferencia < 0 ? 'color:var(--accent);' : 'color:var(--success);';
            return `<tr>
                <td style="font-weight:500;">${escapeHtml(p.nombre)}</td>
                <td style="text-align:center;">${p.sistema}</td>
                <td style="text-align:center;">${p.conteo}</td>
                <td style="text-align:center;font-weight:700;${difColor}">${p.diferencia > 0 ? '+' : ''}${p.diferencia.toFixed(3)}</td>
                <td style="font-size:11px;color:#64748B;">${p.motivo || '-'}</td>
                <td style="font-size:11px;color:#475569;">${p.responsable ? `👤 ${escapeHtml(p.responsable)}` : '<span style="color:#CBD5E1;">—</span>'}</td>
            </tr>`;
        }).join('');

        body.innerHTML = `
            <div style="margin-bottom:10px;display:flex;align-items:center;gap:10px;">
                <span style="font-size:13px;color:var(--text-medium);"><strong>${productos.length}</strong> producto${productos.length !== 1 ? 's' : ''} con diferencia</span>
                <input id="filtro-popup-tend" type="text" placeholder="Buscar producto..." oninput="_filtrarPopupTend(this.value, ${JSON.stringify(productos).replace(/</g,'\\u003c')})"
                    style="margin-left:auto;padding:5px 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:12px;width:180px;">
            </div>
            <table class="usuarios-tabla" style="margin:0;width:100%;">
                <thead>
                    <tr>
                        <th style="text-align:left;">Producto</th>
                        <th style="text-align:center;">Sistema</th>
                        <th style="text-align:center;">Conteo</th>
                        <th style="text-align:center;">Dif</th>
                        <th style="text-align:left;">Motivo</th>
                        <th style="text-align:left;">Responsable</th>
                    </tr>
                </thead>
                <tbody id="popup-tend-tbody">${tablaFilas(productos)}</tbody>
            </table>
        `;
        window._popupTendData = productos;
    } catch(e) {
        body.innerHTML = '<p style="text-align:center;color:var(--accent);padding:20px;">Error al cargar detalle</p>';
    }
}

// ---- Gestión de motivos excluidos (localStorage) ----
function _getMotivosExcluidos() {
    try { return JSON.parse(localStorage.getItem('motivos_excluidos') || '[]'); } catch { return []; }
}
function _setMotivosExcluidos(arr) {
    localStorage.setItem('motivos_excluidos', JSON.stringify(arr));
}
function _toggleMotivo(motivo) {
    const excluidos = _getMotivosExcluidos();
    const idx = excluidos.indexOf(motivo);
    if (idx === -1) excluidos.push(motivo); else excluidos.splice(idx, 1);
    _setMotivosExcluidos(excluidos);
    renderChartMotivos(null);
}
function _restaurarTodosMotivos() {
    _setMotivosExcluidos([]);
    renderChartMotivos(null);
}

function _renderMotivosLeyenda(todosLosDatos, excluidos) {
    const wrapper = document.getElementById('motivos-leyenda');
    const btnRestaurar = document.getElementById('btn-restaurar-motivos');
    if (!wrapper) return;
    if (!todosLosDatos || todosLosDatos.length === 0) { wrapper.innerHTML = ''; return; }

    const hayExcluidos = excluidos.length > 0;
    if (btnRestaurar) btnRestaurar.style.display = hayExcluidos ? 'inline-block' : 'none';

    wrapper.innerHTML = todosLosDatos.map((d, i) => {
        const excluido = excluidos.includes(d.motivo);
        const color = CHART_COLORS[i % CHART_COLORS.length];
        const label = d.motivo.length > 40 ? d.motivo.substring(0, 38) + '...' : d.motivo;
        return `<span onclick="_toggleMotivo('${d.motivo.replace(/'/g, "\\'")}')"
                      title="${excluido ? 'Click para mostrar' : 'Click para ocultar'}: ${escapeHtml(d.motivo)}"
                      style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;font-size:11px;color:${excluido ? '#94A3B8' : '#334155'};user-select:none;">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${excluido ? '#CBD5E1' : color};flex-shrink:0;"></span>
            <span style="${excluido ? 'text-decoration:line-through;' : ''}">${escapeHtml(label)}</span>
        </span>`;
    }).join('');
}

function renderChartMotivos(datos) {
    if (typeof Chart === 'undefined') return;
    // Guardar datos completos para poder re-renderizar al cambiar exclusiones
    if (datos && datos.length > 0) window._motivosDatosCompletos = datos;
    const todosLosDatos = window._motivosDatosCompletos || [];

    destroyChart('motivos');
    const ctx = document.getElementById('chart-motivos');

    const excluidos = _getMotivosExcluidos();
    _renderMotivosLeyenda(todosLosDatos, excluidos);

    const datosFiltrados = todosLosDatos.filter(d => !excluidos.includes(d.motivo));

    if (!ctx || datosFiltrados.length === 0) {
        if (ctx) {
            const parent = ctx.parentElement;
            if (parent) parent.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#94A3B8;font-size:13px;">No hay motivos para mostrar</div>';
        }
        return;
    }

    const labels = datosFiltrados.map(d => d.motivo.length > 35 ? d.motivo.substring(0, 33) + '...' : d.motivo);
    const valores = datosFiltrados.map(d => d.cantidad);

    chartInstances['motivos'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Frecuencia',
                data: valores,
                backgroundColor: datosFiltrados.map((_, i) => CHART_COLORS_ALPHA[i % CHART_COLORS_ALPHA.length]),
                borderColor: datosFiltrados.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
                borderWidth: 1.5,
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            onClick: (evt, elements) => {
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    const motivo = datosFiltrados[idx].motivo;
                    abrirDetalleMotivo(motivo);
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: c => `${c.parsed.x} ocurrencia${c.parsed.x !== 1 ? 's' : ''} — click izquierdo: ver detalle | click derecho: excluir`
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: '#F1F5F9', drawBorder: false },
                    ticks: { color: '#94A3B8', stepSize: 1, precision: 0 },
                    title: { display: true, text: 'Cantidad', color: '#64748B', font: { size: 11 } }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: '#123450', font: { size: 11, weight: '500' }, cursor: 'pointer' }
                }
            }
        }
    });

    ctx.style.cursor = 'pointer';
    ctx.oncontextmenu = null;
}

function renderChartPersonasErrores(datos) {
    if (typeof Chart === 'undefined') return;
    destroyChart('personas-errores');
    const ctx = document.getElementById('chart-personas-errores');
    if (!ctx) return;

    if (!datos || datos.length === 0) {
        ctx.parentElement.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#94A3B8;font-size:13px;">Sin datos suficientes (min. 5 conteos por persona)</div>';
        return;
    }

    // Orden ascendente para que el mayor quede arriba en barra horizontal
    const sorted = [...datos].reverse();
    const labels = sorted.map(d => d.persona.length > 25 ? d.persona.substring(0, 23) + '...' : d.persona);
    const valores = sorted.map(d => d.porcentaje_error);

    // Color según % de error: verde < 5%, amarillo 5-15%, rojo > 15%
    const colores = valores.map(v => v > 15 ? 'rgba(239,68,68,0.7)' : v > 5 ? 'rgba(251,191,36,0.7)' : 'rgba(34,197,94,0.7)');
    const bordes  = valores.map(v => v > 15 ? 'rgb(239,68,68)' : v > 5 ? 'rgb(251,191,36)' : 'rgb(34,197,94)');

    chartInstances['personas-errores'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '% Error',
                data: valores,
                backgroundColor: colores,
                borderColor: bordes,
                borderWidth: 1.5,
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (c) => {
                            const d = sorted[c.dataIndex];
                            return `${c.parsed.x}% error — ${d.total_errores} errores de ${d.total_conteos} conteos`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: '#F1F5F9', drawBorder: false },
                    ticks: { color: '#94A3B8', callback: v => v + '%' },
                    title: { display: true, text: '% de Error', color: '#64748B', font: { size: 11 } }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: '#123450', font: { size: 11, weight: '500' } }
                }
            }
        }
    });
}

async function abrirDetalleMotivo(motivo) {
    const modal = document.getElementById('modal-motivo');
    const titulo = document.getElementById('modal-motivo-titulo');
    const body = document.getElementById('modal-motivo-body');

    titulo.textContent = motivo;
    body.innerHTML = '<div style="text-align:center;padding:20px;"><i class="fas fa-spinner fa-spin" style="font-size:24px;color:var(--primary);"></i><p style="margin-top:10px;color:#94A3B8;">Cargando detalle...</p></div>';
    modal.classList.remove('hidden');

    const fechaDesde = document.getElementById('dash-fecha-desde').value;
    const fechaHasta = document.getElementById('dash-fecha-hasta').value;
    const bodega = document.getElementById('dash-bodega')?.value || '';
    const marca = document.getElementById('dash-marca')?.value || '';
    const contador = document.getElementById('dash-contador')?.value || '';
    let bodegaParam = '';
    if (bodega) {
        bodegaParam = `&bodega=${bodega}`;
    } else if (marca && MARCAS_BODEGAS[marca]) {
        bodegaParam = MARCAS_BODEGAS[marca].map(b => `&bodega=${b}`).join('');
    }
    const contadorParam = contador ? `&contador=${encodeURIComponent(contador)}` : '';

    try {
        const res = await fetch(`${CONFIG.API_URL}/api/reportes/motivos/detalle?fecha_desde=${fechaDesde}&fecha_hasta=${fechaHasta}&motivo=${encodeURIComponent(motivo)}${bodegaParam}${contadorParam}`);
        if (!res.ok) throw new Error('Error');
        const productos = await res.json();

        if (productos.length === 0) {
            body.innerHTML = '<p style="text-align:center;color:#94A3B8;padding:20px;">No se encontraron productos con este motivo</p>';
            return;
        }

        const filasMotivo = (lista) => lista.map(p => {
            const difColor = p.diferencia < 0 ? 'color:var(--accent);' : p.diferencia > 0 ? 'color:var(--success);' : 'color:#94A3B8;';
            return `<tr>
                <td style="font-size:11px;color:#475569;white-space:nowrap;">${escapeHtml(p.fecha)}</td>
                <td style="font-weight:500;">${escapeHtml(p.nombre)}</td>
                <td style="font-size:11px;color:#64748B;">${escapeHtml(p.local)}</td>
                <td style="text-align:center;font-weight:700;${difColor}">${p.diferencia > 0 ? '+' : ''}${p.diferencia.toFixed(3)}</td>
                <td style="font-size:11px;color:#475569;">${p.responsable ? `👤 ${escapeHtml(p.responsable)}` : '<span style="color:#CBD5E1;">—</span>'}</td>
                <td style="font-size:11px;color:#64748B;font-style:italic;">${p.observacion ? escapeHtml(p.observacion) : '<span style="color:#CBD5E1;">—</span>'}</td>
            </tr>`;
        }).join('');

        // Locales únicos para el dropdown
        const localesUnicos = [...new Set(productos.map(p => p.local))].sort();
        const opcionesLocales = localesUnicos.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');

        body.innerHTML = `
            <div style="margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span style="font-size:13px;color:var(--text-medium);"><strong id="popup-motivo-count">${productos.length}</strong> ocurrencia${productos.length !== 1 ? 's' : ''}</span>
                <select id="filtro-popup-motivo-local" onchange="_filtrarPopupMotivo()"
                    style="padding:5px 8px;border:1px solid #E2E8F0;border-radius:6px;font-size:12px;color:#475569;">
                    <option value="">Todos los locales</option>
                    ${opcionesLocales}
                </select>
                <input id="filtro-popup-motivo" type="text" placeholder="Buscar producto o responsable..." oninput="_filtrarPopupMotivo()"
                    style="padding:5px 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:12px;flex:1;min-width:160px;">
            </div>
            <table class="usuarios-tabla" style="margin:0;width:100%;">
                <thead>
                    <tr>
                        <th style="text-align:left;">Fecha</th>
                        <th style="text-align:left;">Producto</th>
                        <th style="text-align:left;">Local</th>
                        <th style="text-align:center;">Diferencia</th>
                        <th style="text-align:left;">Responsable</th>
                        <th style="text-align:left;">Observación</th>
                    </tr>
                </thead>
                <tbody id="popup-motivo-tbody">${filasMotivo(productos)}</tbody>
            </table>
        `;
        window._popupMotivoData = productos;
        window._filasMotivo = filasMotivo;
    } catch(e) {
        body.innerHTML = '<p style="text-align:center;color:var(--accent);padding:20px;">Error al cargar detalle</p>';
    }
}

function cerrarModalMotivo() {
    document.getElementById('modal-motivo').classList.add('hidden');
}

function _filtrarPopupTend(texto, allData) {
    const data = allData || window._popupTendData || [];
    const q = texto.toLowerCase().trim();
    const filtrado = q ? data.filter(p => p.nombre.toLowerCase().includes(q) || (p.motivo||'').toLowerCase().includes(q) || (p.responsable||'').toLowerCase().includes(q)) : data;
    const tbody = document.getElementById('popup-tend-tbody');
    if (!tbody) return;
    tbody.innerHTML = filtrado.map(p => {
        const difColor = p.diferencia < 0 ? 'color:var(--accent);' : 'color:var(--success);';
        return `<tr>
            <td style="font-weight:500;">${escapeHtml(p.nombre)}</td>
            <td style="text-align:center;">${p.sistema}</td>
            <td style="text-align:center;">${p.conteo}</td>
            <td style="text-align:center;font-weight:700;${difColor}">${p.diferencia > 0 ? '+' : ''}${p.diferencia.toFixed(3)}</td>
            <td style="font-size:11px;color:#64748B;">${p.motivo || '-'}</td>
            <td style="font-size:11px;color:#475569;">${p.responsable ? `👤 ${escapeHtml(p.responsable)}` : '<span style="color:#CBD5E1;">—</span>'}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="6" style="text-align:center;color:#94A3B8;padding:12px;">Sin resultados</td></tr>';
}

function _filtrarPopupMotivo() {
    const data = window._popupMotivoData || [];
    const q = (document.getElementById('filtro-popup-motivo')?.value || '').toLowerCase().trim();
    const localSel = (document.getElementById('filtro-popup-motivo-local')?.value || '').toLowerCase();
    const filtrado = data.filter(p => {
        const passLocal = !localSel || p.local.toLowerCase() === localSel;
        const passTexto = !q || p.nombre.toLowerCase().includes(q) || (p.responsable||'').toLowerCase().includes(q) || p.fecha.includes(q) || (p.observacion||'').toLowerCase().includes(q);
        return passLocal && passTexto;
    });
    const tbody = document.getElementById('popup-motivo-tbody');
    if (!tbody || !window._filasMotivo) return;
    tbody.innerHTML = window._filasMotivo(filtrado) || '<tr><td colspan="6" style="text-align:center;color:#94A3B8;padding:12px;">Sin resultados</td></tr>';
    const cnt = document.getElementById('popup-motivo-count');
    if (cnt) cnt.textContent = filtrado.length;
}

function renderContadoresResumen(contadores) {
    const wrapper = document.getElementById('dash-contadores-wrapper');
    if (!wrapper) return;

    if (!contadores || contadores.length === 0) {
        wrapper.innerHTML = '<div style="padding:20px;text-align:center;color:#94A3B8;font-size:13px;">Sin actividad de contadores en este periodo</div>';
        return;
    }

    const filas = contadores.map(c => `
        <tr>
            <td style="font-weight:600;color:#123450;">
                <span style="display:inline-block;width:28px;height:28px;border-radius:50%;background:#EEF2FF;color:#123450;text-align:center;line-height:28px;font-size:12px;margin-right:8px;font-weight:700;">
                    ${escapeHtml((c.nombre || '?')[0].toUpperCase())}
                </span>
                ${escapeHtml(c.nombre)}
            </td>
            <td style="text-align:center;font-weight:700;color:#123450;">${c.dias_contados}</td>
            <td style="text-align:center;font-weight:700;">${c.total_items}</td>
            <td style="text-align:center;">${c.bodegas_cubiertas}</td>
            <td style="text-align:center;color:#64748B;font-size:12px;">${c.ultima_actividad || '—'}</td>
        </tr>
    `).join('');

    wrapper.innerHTML = `
        <table class="usuarios-tabla" style="margin:0;width:100%;">
            <thead>
                <tr>
                    <th style="text-align:left;">Contador</th>
                    <th style="text-align:center;">Días</th>
                    <th style="text-align:center;">Items Contados</th>
                    <th style="text-align:center;">Bodegas</th>
                    <th style="text-align:center;">Última Actividad</th>
                </tr>
            </thead>
            <tbody>${filas}</tbody>
        </table>
    `;
}

// ==================== FIN DASHBOARD ====================

// Estado de la aplicacion
let state = {
    user: null,
    productos: [],
    conteos: {},
    categorias: [],
    productoSeleccionado: null,
    etapaConteo: 1,  // 1 = Primer conteo, 2 = Segundo conteo, 3 = Finalizado
    productosFallidos: [],  // Productos con diferencia después del primer conteo
    personas: [],           // Lista de personas asignables
    asignaciones: {},       // Asignaciones por conteo_id
    cruceEjecuciones: [],   // Ejecuciones de cruce operativo
    cruceDetalleId: null,   // ID de ejecucion activa en detalle
    cruceSoloDif: false     // Filtro solo diferencias
};

// Detectar unidades que solo permiten enteros (sin decimales)
function esUnidadEntera(unidad) {
    if (!unidad) return false;
    const u = unidad.toLowerCase().trim();
    return u === 'gramos' || u === 'gramo' || u === 'gr' || u === 'g';
}

// Bloquear punto y coma en inputs de unidades enteras
function bloquearDecimales(event) {
    if (event.key === '.' || event.key === ',') {
        event.preventDefault();
    }
}

// Inicializacion
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function _cargarPersonasDelHTML() {
    // Metodo 1: Variable global inyectada por script
    if (window._PERSONAS_PRECARGADAS && Array.isArray(window._PERSONAS_PRECARGADAS) && window._PERSONAS_PRECARGADAS.length > 0) {
        return window._PERSONAS_PRECARGADAS;
    }
    // Metodo 2: JSON island (script type=application/json)
    try {
        const jsonEl = document.getElementById('personas-data');
        if (jsonEl && jsonEl.textContent) {
            const parsed = JSON.parse(jsonEl.textContent);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
    } catch(e) {}
    // Metodo 3: Base64 en meta tag
    try {
        const metaEl = document.querySelector('meta[name="personas-b64"]');
        if (metaEl && metaEl.content) {
            const decoded = JSON.parse(atob(metaEl.content));
            if (Array.isArray(decoded) && decoded.length > 0) return decoded;
        }
    } catch(e) {}
    return [];
}

function initApp() {
    // Cargar personas precargadas del servidor (inyectadas en el HTML)
    var personasHTML = _cargarPersonasDelHTML();
    if (personasHTML.length > 0) {
        state.personas = personasHTML;
        try { localStorage.setItem('personas_cache', JSON.stringify(state.personas)); } catch(e) {}
    }

    // Verificar sesion guardada — refrescar permisos del servidor
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
        state.user = JSON.parse(savedUser);
        showMainScreen();
        // Refrescar permisos desde el servidor en background
        _refrescarPermisos();
    }

    // Event listeners
    setupEventListeners();

    // Cargar fecha actual (formato YYYY-MM-DD para input date)
    const hoy = new Date();
    document.getElementById('fecha-conteo').valueAsDate = hoy;

    // Cargar bodegas
    cargarBodegas();

    // Chart.js defaults
    configureChartDefaults();
}


function setupEventListeners() {
    // Login
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('btn-logout').addEventListener('click', handleLogout);

    // Navegacion
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            cambiarVista(view);
        });
    });

    // Conteo
    document.getElementById('btn-consultar').addEventListener('click', consultarInventario);
    const btnCargarProd = document.getElementById('btn-cargar-productos');
    if (btnCargarProd) btnCargarProd.addEventListener('click', cargarProductos);
    document.getElementById('btn-guardar-conteo').addEventListener('click', guardarConteoEtapa);
    document.getElementById('buscar-producto').addEventListener('input', filtrarProductos);

    // Historico
    document.getElementById('btn-buscar-historico').addEventListener('click', buscarHistorico);

    // Dashboard
    document.getElementById('btn-cargar-dashboard').addEventListener('click', cargarDashboard);

    // Cruce Operativo
    const btnCruce = document.getElementById('btn-buscar-cruce');
    if (btnCruce) btnCruce.addEventListener('click', cargarCruceOperativo);
}

// ==================== AUTENTICACION ====================

async function handleLogin(e) {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorDiv = document.getElementById('login-error');

    errorDiv.classList.add('hidden');

    try {
        // Intentar login con el servidor
        const response = await fetch(`${CONFIG.API_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ username, password })
        });

        if (response.ok) {
            const data = await response.json();
            state.user = data.user;
            localStorage.setItem('user', JSON.stringify(data.user));
            // Limpiar cache de personas para forzar recarga fresca
            localStorage.removeItem('personas_cache');
            state.personas = [];
            showMainScreen();
            showToast(`Bienvenido, ${data.user.nombre}`, 'success');
            return;
        }
    } catch (error) {
        console.log('Servidor no disponible:', error);
        errorDiv.textContent = 'Servidor no disponible. Intenta de nuevo.';
        errorDiv.classList.remove('hidden');
        return;
    }

    // Si el servidor respondio pero credenciales invalidas
    errorDiv.textContent = 'Usuario o contrasena incorrectos';
    errorDiv.classList.remove('hidden');
}

function handleLogout() {
    state.user = null;
    localStorage.removeItem('user');
    showLoginScreen();
    showToast('Sesion cerrada', 'success');
}

function showLoginScreen() {
    document.getElementById('login-screen').classList.add('active');
    document.getElementById('main-screen').classList.remove('active');
}

function showMainScreen() {
    document.getElementById('login-screen').classList.remove('active');
    document.getElementById('main-screen').classList.add('active');
    document.getElementById('user-name').textContent = state.user.nombre;

    // Mostrar/ocultar nav segun modulos asignados al usuario
    const userModulos = (state.user && state.user.modulos) || [];
    const isAdmin = _esAdmin();

    document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
        const mod = btn.dataset.view;
        if (isAdmin) {
            btn.style.display = '';  // Admin ve todo
        } else if (mod === 'usuarios' || mod === 'config-productos' || mod === 'flujo-caja') {
            btn.style.display = 'none';  // admin-only views
        } else {
            btn.style.display = userModulos.includes(mod) ? '' : 'none';
        }
    });

    // Ocultar modulos admin-only completos para no-admins
    const moduloFlujoCaja = document.querySelector('.nav-module[data-module="flujocaja"]');
    if (moduloFlujoCaja) moduloFlujoCaja.style.display = isAdmin ? '' : 'none';

    // Recargar bodegas filtradas segun usuario
    cargarBodegas();

    // Cargar selector de impersonacion si es admin
    cargarSelectorImpersonar();

    // Inicializar filtros del dashboard
    filtrarBodegasPorMarca();
    _cargarContadoresDash();

    // Restaurar la vista donde estaba (por pestaña, independiente de otras tabs)
    const vistaGuardada = sessionStorage.getItem('vista_activa');
    if (vistaGuardada && document.getElementById(`view-${vistaGuardada}`)) {
        cambiarVista(vistaGuardada);
    } else {
        cambiarVista('dash-general');
    }
}

// ==================== NAVEGACION ====================

function toggleModule(moduleName) {
    const mod = document.querySelector(`.nav-module[data-module="${moduleName}"]`);
    if (!mod) return;
    mod.classList.toggle('collapsed');
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('open');
}

function cambiarVista(viewName) {
    // Cerrar sidebar en móvil
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('open');

    // Guardar vista activa por pestaña (sessionStorage es independiente por tab)
    try { sessionStorage.setItem('vista_activa', viewName); } catch(e) {}

    // Actualizar botones
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    // Mostrar vista
    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
    });
    document.getElementById(`view-${viewName}`).classList.add('active');

    // Auto-cargar cruce al entrar
    if (viewName === 'cruce') {
        const cDesde = document.getElementById('cruce-fecha-desde');
        const cHasta = document.getElementById('cruce-fecha-hasta');
        if (!cDesde.value || !cHasta.value) {
            const hoy = new Date();
            const hace30 = new Date();
            hace30.setDate(hoy.getDate() - 30);
            cDesde.value = hace30.toISOString().split('T')[0];
            cHasta.value = hoy.toISOString().split('T')[0];
        }
        cargarCruceOperativo();
        cuadrarCargarFechas();
        cargaCargarFechas();
    }

    // Auto-inicializar observaciones al entrar
    if (viewName === 'observaciones') {
        initObservaciones();
    }

    // Auto-inicializar corrección al entrar
    if (viewName === 'correccion') {
        const corrFecha = document.getElementById('corr-fecha');
        if (!corrFecha.value) {
            corrFecha.value = new Date().toISOString().split('T')[0];
        }
    }

    // Auto-cargar bajas al entrar
    if (viewName === 'bajas') {
        cargarBajas();
        poblarPersonasBaja();
        cargarProductosBaja(); // precarga catálogo Airtable
    }

    // Auto-inicializar panel al entrar
    if (viewName === 'panel') {
        panelInit();
    }

    // Auto-inicializar semanal al entrar
    if (viewName === 'semanal') {
        semanalInit();
    }

    // Auto-inicializar voucher scanner al entrar
    if (viewName === 'vouchers') {
        vs_initVouchers();
    }

    // Auto-inicializar flujo de caja al entrar
    if (viewName === 'flujo-caja') {
        if (typeof fc_init === 'function') fc_init();
    }

    // Auto-inicializar depositos al entrar
    if (viewName === 'dep-pendientes') { depCargarPendientes(); }
    if (viewName === 'dep-historial' || viewName === 'dep-descuadres' || viewName === 'dep-dashboard') {
        const hoy = new Date().toISOString().split('T')[0];
        const hace30 = new Date(); hace30.setDate(hace30.getDate() - 30);
        const desde30 = hace30.toISOString().split('T')[0];
        const prefijos = {'dep-historial':'dep-fecha','dep-descuadres':'dep-desc','dep-dashboard':'dep-dash'};
        const pref = prefijos[viewName];
        if (pref) {
            const dEl = document.getElementById(`${pref}-desde`);
            const hEl = document.getElementById(`${pref}-hasta`);
            if (dEl && !dEl.value) dEl.value = desde30;
            if (hEl && !hEl.value) hEl.value = hoy;
        }
    }

    // Auto-inicializar evaluacion al entrar
    if (viewName === 'evaluacion') {
        const evalFecha = document.getElementById('eval-semana');
        if (!evalFecha.value) {
            const hoy = new Date();
            const d = new Date(hoy);
            const dia = d.getDay();
            const diff = dia === 0 ? -6 : 1 - dia;
            d.setDate(d.getDate() + diff);
            evalFecha.value = d.toISOString().split('T')[0];
        }
    }

    // Auto-inicializar descuentos nomina
    if (viewName === 'descuentos-nomina') {
        const dd = document.getElementById('desc-fecha-desde');
        const dh = document.getElementById('desc-fecha-hasta');
        if (dd && !dd.value) {
            const d = new Date(); d.setDate(d.getDate() - 30);
            dd.value = d.toISOString().split('T')[0];
        }
        if (dh && !dh.value) dh.value = new Date().toISOString().split('T')[0];
    }

    // Auto-inicializar cuadres de caja
    if (viewName === 'cuadre-registro') { cuadreInit(); }
    if (viewName === 'cuadre-historial' || viewName === 'cuadre-dashboard') {
        const hoy = new Date().toISOString().split('T')[0];
        const hace30 = new Date(); hace30.setDate(hace30.getDate() - 30);
        const cpref = viewName === 'cuadre-historial' ? 'cuadre-hist' : 'cuadre-dash';
        const cd = document.getElementById(`${cpref}-desde`);
        const ch = document.getElementById(`${cpref}-hasta`);
        if (cd && !cd.value) cd.value = hace30.toISOString().split('T')[0];
        if (ch && !ch.value) ch.value = hoy;
    }

    // Auto-inicializar delivery
    if (viewName === 'del-registro') { delInit(); }
    if (viewName === 'del-historial' || viewName === 'del-dashboard') {
        const hoy = new Date().toISOString().split('T')[0];
        const hace30 = new Date(); hace30.setDate(hace30.getDate() - 30);
        const dpref = viewName === 'del-historial' ? 'del-hist' : 'del-dash';
        const dd = document.getElementById(`${dpref}-desde`);
        const dh = document.getElementById(`${dpref}-hasta`);
        if (dd && !dd.value) dd.value = hace30.toISOString().split('T')[0];
        if (dh && !dh.value) dh.value = hoy;
    }

    // Auto-inicializar facturas
    if (viewName === 'fac-registro') { facInit(); }
    if (viewName === 'fac-historial' || viewName === 'fac-dashboard') {
        const hoy = new Date().toISOString().split('T')[0];
        const hace30 = new Date(); hace30.setDate(hace30.getDate() - 30);
        const fpref = viewName === 'fac-historial' ? 'fac-hist' : 'fac-dash';
        const fd = document.getElementById(`${fpref}-desde`);
        const fh = document.getElementById(`${fpref}-hasta`);
        if (fd && !fd.value) fd.value = hace30.toISOString().split('T')[0];
        if (fh && !fh.value) fh.value = hoy;
    }

    // Auto-cargar usuarios y roles al entrar
    if (viewName === 'usuarios') {
        usuariosCargar();
        rolesCargar();
    }

    // Auto-cargar config productos
    if (viewName === 'config-productos') {
        cprodCargar();
    }

    // Redireccionar vistas de dashboard vacías al módulo unificado
    if (viewName === 'dashboard') { cambiarVista('dash-general'); return; }
    if (viewName === 'dep-dashboard') { cambiarVista('dash-general'); cambiarDashTab('depositos'); return; }
    if (viewName === 'cuadre-dashboard') { cambiarVista('dash-general'); cambiarDashTab('cuadres'); return; }
    if (viewName === 'del-dashboard') { cambiarVista('dash-general'); cambiarDashTab('delivery'); return; }
    if (viewName === 'fac-dashboard') { cambiarVista('dash-general'); cambiarDashTab('facturas'); return; }

    // Inicializar dashboard general al entrar
    if (viewName === 'dash-general') {
        const tabGuardado = sessionStorage.getItem('dash_tab') || 'inventario';
        cambiarDashTab(tabGuardado);
        // Filtrar bodegas del dashboard según permisos del usuario
        const esAdminDash = _esAdminOSupervisor();
        if (!esAdminDash) {
            const userBodegas = state.user?.bodegas || [];
            const dashBodega = document.getElementById('dash-bodega');
            if (dashBodega) {
                const opciones = dashBodega.querySelectorAll('option[value]');
                opciones.forEach(opt => {
                    if (opt.value && !userBodegas.includes(opt.value)) {
                        opt.style.display = 'none';
                    }
                });
                // Auto-seleccionar si tiene una sola bodega
                if (userBodegas.length === 1) {
                    dashBodega.value = userBodegas[0];
                }
                // Ocultar selector de marca si no es admin
                const dashMarca = document.getElementById('dash-marca');
                if (dashMarca) dashMarca.closest('.form-group').style.display = 'none';
            }
        }
    }
}

// ==================== BODEGAS ====================

function cargarBodegas() {
    const selectBodega = document.getElementById('bodega-select');
    const filtroBodega = document.getElementById('filtro-bodega');
    const reporteBodega = document.getElementById('reporte-bodega');
    const dashBodega = document.getElementById('dash-bodega');

    // Bodega asignada al usuario (null = ve todas) — respetar impersonacion
    const imp = state._impersonando;
    const bodegaUsuario = imp ? imp.bodega : (state.user ? state.user.bodega : null);

    // Bodegas permitidas (filtrar por las asignadas si tiene varias)
    const userBodegas = imp ? (imp.bodegas || []) : ((state.user && state.user.bodegas) ? state.user.bodegas : []);
    const bodegas = bodegaUsuario
        ? CONFIG.BODEGAS.filter(b => b.id === bodegaUsuario)
        : userBodegas.length > 0
            ? CONFIG.BODEGAS.filter(b => userBodegas.includes(b.id))
            : CONFIG.BODEGAS;

    // Limpiar selects
    selectBodega.innerHTML = bodegaUsuario ? '' : '<option value="">Seleccionar bodega...</option>';
    filtroBodega.innerHTML = '<option value="">-- Selecciona --</option>';
    if (reporteBodega) reporteBodega.innerHTML = bodegaUsuario ? '' : '<option value="">Seleccionar bodega...</option>';
    if (dashBodega) dashBodega.innerHTML = '<option value="">Todas las bodegas</option>';

    bodegas.forEach(bodega => {
        const opt = `<option value="${bodega.id}">${bodega.nombre}</option>`;
        selectBodega.innerHTML += opt;
        filtroBodega.innerHTML += opt;
        if (reporteBodega) reporteBodega.innerHTML += opt;
        if (dashBodega) dashBodega.innerHTML += opt;
    });

    // Si tiene bodega asignada, seleccionarla automaticamente
    if (bodegaUsuario) {
        selectBodega.value = bodegaUsuario;
        filtroBodega.value = bodegaUsuario;
        if (reporteBodega) reporteBodega.value = bodegaUsuario;
        if (dashBodega) dashBodega.value = bodegaUsuario;
    }
}

// ==================== CATEGORIAS (DESHABILITADO) ====================
// Funcionalidad de categorías deshabilitada temporalmente

// ==================== CONSULTA INVENTARIO ====================

async function consultarInventario() {
    const fecha = document.getElementById('fecha-conteo').value;
    const local = document.getElementById('bodega-select').value;

    if (!fecha) {
        showToast('Selecciona una fecha', 'error');
        return;
    }

    if (!local) {
        showToast('Selecciona una bodega', 'error');
        return;
    }

    // Mostrar indicador de carga
    const btn = document.getElementById('btn-consultar');
    const btnTextoOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Consultando...';

    const container = document.getElementById('productos-list');
    container.innerHTML = `
        <div class="loading-overlay">
            <div class="loading-spinner"></div>
            <p>Cargando inventario...</p>
        </div>
    `;

    try {
        const response = await fetch(`${CONFIG.API_URL}/api/inventario/consultar?fecha=${fecha}&local=${local}`);

        if (response.ok) {
            const data = await response.json();

            // Guardar personas si vienen en la respuesta (del cache del servidor)
            if (data.personas && data.personas.length > 0) {
                state.personas = data.personas;
                try { localStorage.setItem('personas_cache', JSON.stringify(data.personas)); } catch(e) {}
            }

            if (data.productos.length === 0) {
                const bodegasOperativas = ['bodega_principal', 'materia_prima'];
                if (bodegasOperativas.includes(local)) {
                    renderProductosVacioOperativo(local, fecha);
                } else {
                    showToast('No hay datos para esta fecha y bodega', 'warning');
                    renderProductosVacio();
                }
                return;
            }

            // Convertir datos a formato de productos
            state.productos = data.productos.map(p => ({
                id: p.id,
                codigo: p.codigo,
                nombre: p.nombre,
                unidad: p.unidad,
                cantidad_sistema: parseFloat(p.cantidad),
                cantidad_contada: p.cantidad_contada,
                cantidad_contada_2: p.cantidad_contada_2,
                observaciones: p.observaciones || '',
                motivo: p.motivo || '',
                corregido: p.corregido || false,
                justificado: p.justificado || false,
                cantidad_justificada: parseFloat(p.cantidad_justificada) || 0,
                costo_unitario: parseFloat(p.costo_unitario) || 0,
                contado_por_nombre: p.contado_por_nombre || '',
                contado2_por_nombre: p.contado2_por_nombre || ''
            }));

            // Verificar si ya tiene conteo 1 guardado
            const todosConConteo1 = state.productos.every(p => p.cantidad_contada !== null);
            const algunosConConteo1 = state.productos.some(p => p.cantidad_contada !== null);

            if (todosConConteo1) {
                // Calcular productos con diferencias
                state.productosFallidos = state.productos
                    .filter(p => p.cantidad_contada !== null && p.cantidad_contada !== p.cantidad_sistema)
                    .map(p => p.codigo);

                if (state.productosFallidos.length === 0) {
                    // Todo coincidió en el primer conteo, está finalizado
                    state.etapaConteo = 3;
                    await Promise.all([cargarAsignaciones(fecha, local), cargarPersonas(), cargarSecciones(fecha, local)]);
                    renderProductosInventario();
                    showToast('Conteo ya completado - todos los productos coinciden.', 'success');
                    return;
                }

                // Verificar si TODOS los productos ya tienen conteo 2 (finalizado)
                const todosConConteo2 = state.productos.every(p => p.cantidad_contada_2 !== null);
                if (todosConConteo2) {
                    state.etapaConteo = 3;
                    await Promise.all([cargarAsignaciones(fecha, local), cargarPersonas(), cargarSecciones(fecha, local)]);
                    renderProductosInventario();
                    showToast('Este conteo ya fue finalizado. Solo lectura.', 'warning');
                    return;
                }

                // Auto-llenar conteo 2 para productos sin diferencia
                try {
                    const resp = await fetch(`${CONFIG.API_URL}/api/inventario/autofill-conteo2`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ fecha, local })
                    });
                    const result = await resp.json();
                    if (result.success && result.actualizados > 0) {
                        state.productos.forEach(p => {
                            if (p.cantidad_contada !== null && p.cantidad_contada === p.cantidad_sistema && p.cantidad_contada_2 === null) {
                                p.cantidad_contada_2 = p.cantidad_contada;
                            }
                        });
                        console.log(`Auto-fill conteo 2: ${result.actualizados} productos`);
                    }
                } catch (e) {
                    console.error('Error en autofill conteo2:', e);
                }

                // Verificar de nuevo si ahora todos tienen conteo 2
                const fallidosSinConteo2 = state.productos.filter(p =>
                    state.productosFallidos.includes(p.codigo) &&
                    (p.cantidad_contada_2 === null || p.cantidad_contada_2 === undefined)
                );

                if (fallidosSinConteo2.length === 0) {
                    // Todos los que tenían diferencia ya tienen conteo 2
                    state.etapaConteo = 3;
                    await Promise.all([cargarAsignaciones(fecha, local), cargarPersonas(), cargarSecciones(fecha, local)]);
                    renderProductosInventario();
                    showToast('Este conteo ya fue finalizado. Solo lectura.', 'warning');
                    return;
                }

                state.etapaConteo = 2;
                renderProductosInventario();
                showToast(`Conteo 1 ya realizado. Completa el segundo conteo (${state.productosFallidos.length} con diferencias).`, 'warning');
                return;
            }

            // Primer conteo - continuar desde donde se quedó
            state.etapaConteo = 1;
            state.productosFallidos = [];
            state.conteos = {};

            renderProductosInventario();

            if (algunosConConteo1) {
                const contados = state.productos.filter(p => p.cantidad_contada !== null).length;
                showToast(`Continuando conteo - ${contados}/${data.productos.length} productos registrados`, 'info');
            } else {
                showToast(`${data.productos.length} productos cargados - Primer Conteo`, 'success');
            }
        } else {
            showToast('Error al consultar', 'error');
            container.innerHTML = '';
        }
    } catch (error) {
        console.error('Error consultando inventario:', error);
        showToast('Error de conexion', 'error');
        container.innerHTML = '';
    } finally {
        btn.disabled = false;
        btn.innerHTML = btnTextoOriginal;
    }
}

function renderProductosInventario() {
    const container = document.getElementById('productos-list');
    const totalSpan = document.getElementById('productos-total');
    const btnGuardar = document.getElementById('btn-guardar-conteo');
    const puedeContar = _puede('conteo', 'editar');
    if (btnGuardar) btnGuardar.style.display = puedeContar ? '' : 'none';

    if (state.productos.length === 0) {
        renderProductosVacio();
        return;
    }

    // Ordenar por código
    state.productos.sort((a, b) => a.codigo.localeCompare(b.codigo));

    // Filtrar productos según etapa
    let productosAMostrar = state.productos;
    if (state.etapaConteo === 2) {
        // Solo mostrar los que fallaron en etapa 2
        productosAMostrar = state.productos.filter(p => state.productosFallidos.includes(p.codigo));
    }

    // Texto del botón según etapa
    if (state.etapaConteo === 1) {
        btnGuardar.innerHTML = '<i class="fas fa-save"></i> Guardar Conteo 1';
        btnGuardar.disabled = false;
    } else if (state.etapaConteo === 2) {
        btnGuardar.innerHTML = '<i class="fas fa-check-double"></i> Finalizar Conteo';
        btnGuardar.disabled = false;
    } else {
        btnGuardar.innerHTML = '<i class="fas fa-lock"></i> Conteo Finalizado';
        btnGuardar.disabled = true;
    }

    // Construir tabla
    let etapaTexto = state.etapaConteo === 1 ? 'PRIMER CONTEO' :
                     state.etapaConteo === 2 ? `SEGUNDO CONTEO (${productosAMostrar.length} con diferencia)` :
                     'CONTEO FINALIZADO';

    // Calcular quiénes contaron (nombres únicos de conteo1 y conteo2)
    const _contadores1 = [...new Set(state.productos.map(p => p.contado_por_nombre).filter(Boolean))];
    const _contadores2 = [...new Set(state.productos.map(p => p.contado2_por_nombre).filter(Boolean))];
    let contadorBadgeHtml = '';
    if (_contadores1.length > 0) {
        contadorBadgeHtml += `<span class="sem-cerrada-info" style="margin-left:12px;font-size:12px;"><i class="fas fa-user"></i> Conteo 1: ${escapeHtml(_contadores1.join(', '))}</span>`;
    }
    if (_contadores2.length > 0) {
        contadorBadgeHtml += `<span class="sem-cerrada-info" style="margin-left:8px;font-size:12px;"><i class="fas fa-user-check"></i> Conteo 2: ${escapeHtml(_contadores2.join(', '))}</span>`;
    }

    // Construir tabla principal
    let tablaHtml = `
        <div class="etapa-indicator etapa-${state.etapaConteo}" style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;">
            <span><i class="fas fa-${state.etapaConteo === 1 ? 'edit' : state.etapaConteo === 2 ? 'exclamation-triangle' : 'check-circle'}"></i>
            ${etapaTexto}</span>
            ${contadorBadgeHtml}
        </div>
        <table class="tabla-inventario">
            <thead>
                <tr>
                    <th>Código</th>
                    <th>Producto</th>
                    <th>Unidad</th>
                    ${state.etapaConteo === 3 ? '<th>Sistema</th>' : ''}
                    <th>${state.etapaConteo === 2 ? 'Conteo 1' : 'Conteo'}</th>
                    ${state.etapaConteo >= 2 ? '<th>Conteo 2</th>' : ''}
                    ${state.etapaConteo === 3 ? '<th>Dif</th>' : ''}
                </tr>
            </thead>
            <tbody>
                ${productosAMostrar.map(prod => {
                    const conteo1 = prod.cantidad_contada !== null && prod.cantidad_contada !== undefined;
                    const conteo2 = prod.cantidad_contada_2 !== null && prod.cantidad_contada_2 !== undefined;

                    // Diferencia solo en etapa 3
                    let difHtml = '';
                    if (state.etapaConteo === 3) {
                        const cantidadFinal = conteo2 ? prod.cantidad_contada_2 : prod.cantidad_contada;
                        const diferencia = cantidadFinal - prod.cantidad_sistema;
                        const difClass = diferencia < 0 ? 'negativa' : diferencia > 0 ? 'positiva' : 'cero';
                        const difFormateada = diferencia.toFixed(3);
                        difHtml = `<td class="col-diferencia ${difClass}">${diferencia > 0 ? '+' : ''}${difFormateada}</td>`;
                    }

                    return `
                        <tr data-id="${prod.id}">
                            <td class="col-codigo">${escapeHtml(prod.codigo)}</td>
                            <td class="col-nombre">${escapeHtml(prod.nombre)}</td>
                            <td class="col-unidad">${prod.unidad || 'Unidad'}</td>
                            ${state.etapaConteo === 3 ? `<td class="col-sistema">${prod.cantidad_sistema}</td>` : ''}
                            <td class="col-contado">
                                ${state.etapaConteo === 1 ? `
                                    <input type="number"
                                           class="input-contado"
                                           step="${esUnidadEntera(prod.unidad) ? '1' : '0.001'}"
                                           ${esUnidadEntera(prod.unidad) ? 'pattern="[0-9]*" inputmode="numeric"' : 'inputmode="decimal"'}
                                           value="${conteo1 ? prod.cantidad_contada : ''}"
                                           placeholder="-"
                                           data-id="${prod.id}"
                                           data-codigo="${prod.codigo}"
                                           data-conteo="1"
                                           data-unidad="${prod.unidad || ''}"
                                           ${!puedeContar ? 'disabled' : ''}
                                           onchange="guardarConteoDirecto(this)"
                                           onblur="guardarConteoDirecto(this)"
                                           onkeypress="${esUnidadEntera(prod.unidad) ? 'bloquearDecimales(event);' : ''} if(event.key==='Enter') this.blur()">
                                ` : `
                                    <span class="valor-contado">${conteo1 ? prod.cantidad_contada : '-'}</span>
                                `}
                            </td>
                            ${state.etapaConteo >= 2 ? `
                                <td class="col-contado">
                                    ${state.etapaConteo === 2 ? `
                                        <input type="number"
                                               class="input-contado input-conteo2"
                                               step="${esUnidadEntera(prod.unidad) ? '1' : '0.001'}"
                                               ${esUnidadEntera(prod.unidad) ? 'pattern="[0-9]*" inputmode="numeric"' : 'inputmode="decimal"'}
                                               value="${conteo2 ? prod.cantidad_contada_2 : ''}"
                                               placeholder="-"
                                               data-id="${prod.id}"
                                               data-codigo="${prod.codigo}"
                                               data-conteo="2"
                                               data-unidad="${prod.unidad || ''}"
                                               ${!puedeContar ? 'disabled' : ''}
                                               onchange="guardarConteoDirecto(this)"
                                               onblur="guardarConteoDirecto(this)"
                                               onkeypress="${esUnidadEntera(prod.unidad) ? 'bloquearDecimales(event);' : ''} if(event.key==='Enter') this.blur()">
                                    ` : `
                                        <span class="valor-contado">${conteo2 ? prod.cantidad_contada_2 : '-'}</span>
                                    `}
                                </td>
                            ` : ''}
                            ${difHtml}
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;

    container.innerHTML = tablaHtml;

    // Observaciones ahora se cargan independientemente con fecha/bodega

    // Las asignaciones y secciones se manejan en el módulo Semanal (deshabilitado aquí)
    const asigContainer = document.getElementById('asignaciones-container');
    const seccionesContainer = document.getElementById('secciones-asig-container');
    if (asigContainer) asigContainer.innerHTML = '';
    if (seccionesContainer) seccionesContainer.innerHTML = '';

    totalSpan.textContent = productosAMostrar.length;
    actualizarContador();
}

async function guardarConteoDirecto(input) {
    if (!_puede('conteo', 'editar')) { showToast('No tienes permiso para contar', 'error'); return; }
    const id = parseInt(input.dataset.id);
    const codigo = input.dataset.codigo;
    const conteoNum = parseInt(input.dataset.conteo) || 1;
    let cantidad = input.value !== '' ? parseFloat(input.value) : null;

    // Si la unidad es gramos, forzar entero (sin decimales)
    if (cantidad !== null && esUnidadEntera(input.dataset.unidad)) {
        cantidad = Math.round(cantidad);
        input.value = cantidad;
    }

    // Evitar guardado duplicado si el valor no cambio
    const prod = state.productos.find(p => p.id === id);
    if (prod) {
        const valorActual = conteoNum === 2 ? prod.cantidad_contada_2 : prod.cantidad_contada;
        if (valorActual === cantidad) return;
    }

    try {
        const response = await fetch(`${CONFIG.API_URL}/api/inventario/guardar-conteo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, cantidad_contada: cantidad, conteo: conteoNum, usuario: state.user ? state.user.username : '' })
        });

        if (response.ok) {
            // Actualizar estado local
            const prod = state.productos.find(p => p.id === id);
            if (prod) {
                if (conteoNum === 2) {
                    prod.cantidad_contada_2 = cantidad;
                    if (state.user && !prod.contado2_por_nombre) {
                        prod.contado2_por_nombre = state.user.nombre || state.user.username || '';
                    }
                } else {
                    prod.cantidad_contada = cantidad;
                    if (state.user && !prod.contado_por_nombre) {
                        prod.contado_por_nombre = state.user.nombre || state.user.username || '';
                    }
                }
            }

            actualizarContador();
            input.classList.add('guardado');
            setTimeout(() => input.classList.remove('guardado'), 500);
        } else {
            showToast('Error al guardar', 'error');
            input.classList.add('error');
            setTimeout(() => input.classList.remove('error'), 500);
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('Error de conexion', 'error');
    }
}

// ==================== GUARDAR OBSERVACION ====================

// ==================== CACHE LOCAL (2 horas) ====================

function _obsCacheKey() {
    const fecha = document.getElementById('obs-fecha')?.value || '';
    const bodega = document.getElementById('obs-bodega')?.value || '';
    return `obs_cache_${fecha}_${bodega}`;
}

function cachearCambioObs(el) {
    // Guardar todos los cambios actuales en localStorage con expiración 2h
    const cache = {};
    document.querySelectorAll('.select-motivo[data-id]').forEach(sel => {
        const id = sel.dataset.id;
        const fila = sel.closest('tr');
        const input = fila?.querySelector('.input-observacion');
        cache['conteo_' + id] = { motivo: sel.value, observaciones: input ? input.value : '' };
    });
    document.querySelectorAll('.select-motivo[data-manual-id]').forEach(sel => {
        const id = sel.dataset.manualId;
        const fila = sel.closest('tr');
        const input = fila?.querySelector('.input-observacion');
        cache['manual_' + id] = { motivo: sel.value, observaciones: input ? input.value : '' };
    });
    try {
        localStorage.setItem(_obsCacheKey(), JSON.stringify({ data: cache, expira: Date.now() + 2 * 60 * 60 * 1000 }));
    } catch(e) {}
}

function restaurarCacheObs() {
    try {
        const raw = localStorage.getItem(_obsCacheKey());
        if (!raw) return;
        const { data, expira } = JSON.parse(raw);
        if (Date.now() > expira) { localStorage.removeItem(_obsCacheKey()); return; }

        // Restaurar valores en conteo
        document.querySelectorAll('.select-motivo[data-id]').forEach(sel => {
            const cached = data['conteo_' + sel.dataset.id];
            if (cached) {
                if (cached.motivo && !sel.value) sel.value = cached.motivo;
                const fila = sel.closest('tr');
                const input = fila?.querySelector('.input-observacion');
                if (input && cached.observaciones && !input.value) input.value = cached.observaciones;
            }
        });
        // Restaurar valores en manuales
        document.querySelectorAll('.select-motivo[data-manual-id]').forEach(sel => {
            const cached = data['manual_' + sel.dataset.manualId];
            if (cached) {
                if (cached.motivo && !sel.value) sel.value = cached.motivo;
                const fila = sel.closest('tr');
                const input = fila?.querySelector('.input-observacion');
                if (input && cached.observaciones && !input.value) input.value = cached.observaciones;
            }
        });
    } catch(e) {}
}

// ==================== GUARDAR TODO ====================

async function guardarTodasObservaciones() {
    if (!_puede('observaciones', 'editar')) { showToast('No tienes permiso para editar observaciones', 'error'); return; }

    // Validar que todos los motivos editables estén seleccionados
    const todosSelects = document.querySelectorAll('.select-motivo[data-id], .select-motivo[data-manual-id]');
    let sinMotivo = 0;
    todosSelects.forEach(sel => {
        if (!sel.value) {
            sinMotivo++;
            sel.style.border = '2px solid var(--accent)';
            setTimeout(() => sel.style.border = '', 3000);
        }
    });
    if (sinMotivo > 0) {
        showToast(`Faltan ${sinMotivo} motivos por seleccionar`, 'error');
        return;
    }

    const btn = document.querySelector('.btn-guardar-obs');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
    }

    let errores = 0;
    let guardados = 0;

    // 1) Guardar filas del conteo
    const filasConteo = document.querySelectorAll('.select-motivo[data-id]');
    for (const selectMotivo of filasConteo) {
        const id = parseInt(selectMotivo.dataset.id);
        const fila = selectMotivo.closest('tr');
        const inputObs = fila?.querySelector('.input-observacion');
        const motivo = selectMotivo.value;
        const observaciones = inputObs ? inputObs.value.trim() : '';

        try {
            const response = await fetch(`${CONFIG.API_URL}/api/inventario/guardar-observacion`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, motivo, observaciones })
            });
            if (response.ok) {
                const prod = _obsProductos.find(p => p.id === id);
                if (prod) { prod.motivo = motivo; prod.observaciones = observaciones; }
                selectMotivo.classList.add('guardado');
                if (inputObs) inputObs.classList.add('guardado');
                setTimeout(() => { selectMotivo.classList.remove('guardado'); if (inputObs) inputObs.classList.remove('guardado'); }, 1500);
                guardados++;
            } else { errores++; }
        } catch(e) { errores++; }
    }

    // 2) Guardar filas manuales
    const filasManuales = document.querySelectorAll('.select-motivo[data-manual-id]');
    for (const selectMotivo of filasManuales) {
        const id = parseInt(selectMotivo.dataset.manualId);
        const fila = selectMotivo.closest('tr');
        const inputObs = fila?.querySelector('.input-observacion');
        const motivo = selectMotivo.value;
        const observaciones = inputObs ? inputObs.value.trim() : '';

        try {
            const response = await fetch(`${CONFIG.API_URL}/api/observaciones-manuales/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ motivo, observaciones })
            });
            if (response.ok) {
                const m = _obsManuales.find(x => x.id === id);
                if (m) { m.motivo = motivo; m.observaciones = observaciones; }
                selectMotivo.classList.add('guardado');
                if (inputObs) inputObs.classList.add('guardado');
                setTimeout(() => { selectMotivo.classList.remove('guardado'); if (inputObs) inputObs.classList.remove('guardado'); }, 1500);
                guardados++;
            } else { errores++; }
        } catch(e) { errores++; }
    }

    if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Guardar Observaciones';
    }

    // Limpiar cache después de guardar exitosamente
    if (errores === 0) {
        try { localStorage.removeItem(_obsCacheKey()); } catch(e) {}
        showToast(`${guardados} observaciones guardadas correctamente`, 'success');
    } else {
        showToast(`${errores} observaciones no se pudieron guardar`, 'error');
    }
}

async function guardarObservacion(input) {
    if (!_puede('observaciones', 'editar')) { showToast('No tienes permiso', 'error'); return; }
    const id = parseInt(input.dataset.id);
    const observaciones = input.value.trim();

    try {
        const response = await fetch(`${CONFIG.API_URL}/api/inventario/guardar-observacion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, observaciones })
        });

        if (response.ok) {
            const prod = _obsProductos.find(p => p.id === id);
            if (prod) {
                prod.observaciones = observaciones;
            }
            input.classList.add('guardado');
            setTimeout(() => input.classList.remove('guardado'), 500);
        } else {
            showToast('Error al guardar observacion', 'error');
            input.classList.add('error');
            setTimeout(() => input.classList.remove('error'), 500);
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('Error de conexion', 'error');
    }
}

// ==================== MODULO: OBSERVACIONES (pestaña separada) ====================

const OBSERVACIONES_PREESTABLECIDAS = [
    'Baja cargada fuera de tiempo',
    'Bajas mal ejecutadas',
    'Compra Extraordinaria',
    'Cruce de productos',
    'Descuento a trabajador',
    'Error de sistema',
    'Factura mal cargada',
    'Facturación cargada fuera de tiempo',
    'Mal conteo',
    'Mal tipeo',
    'Producción mal ejecutada',
    'Producto sin justificación',
    'Traslado entre tiendas Erróneo',
    'Traslados mal ejecutado de bodega Principal'
];

// Estado local del módulo observaciones
let _obsProductos = [];
let _obsProductosAgregados = []; // IDs de productos agregados manualmente
let _obsManuales = []; // Observaciones manuales (tabla separada)

function initObservaciones() {
    const selectBodega = document.getElementById('obs-bodega');
    const inputFecha = document.getElementById('obs-fecha');
    if (!selectBodega || !inputFecha) return;

    // Llenar bodegas si está vacío
    if (selectBodega.options.length <= 1) {
        const esAdminObs = _esAdminOSupervisor();
        const userBodegas = state.user?.bodegas || [];
        CONFIG.BODEGAS.forEach(b => {
            if (esAdminObs || userBodegas.includes(b.id)) {
                const opt = document.createElement('option');
                opt.value = b.id;
                opt.textContent = b.nombre;
                selectBodega.appendChild(opt);
            }
        });
        // Auto-seleccionar si tiene una sola bodega
        if (!esAdminObs && userBodegas.length === 1) {
            selectBodega.value = userBodegas[0];
        }
    }

    // Default: fecha de hoy
    if (!inputFecha.value) {
        inputFecha.value = new Date().toISOString().split('T')[0];
    }

    // Si ya hay fecha y bodega seleccionados, cargar automáticamente
    if (inputFecha.value && selectBodega.value) {
        cargarObservaciones();
    }
}

async function cargarObservaciones() {
    const fecha = document.getElementById('obs-fecha').value;
    const bodega = document.getElementById('obs-bodega').value;
    const obsContainer = document.getElementById('observaciones-container');

    if (!fecha || !bodega) {
        showToast('Selecciona fecha y bodega', 'error');
        return;
    }

    obsContainer.innerHTML = `<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Cargando...</p></div>`;

    try {
        const response = await fetch(`${CONFIG.API_URL}/api/inventario/consultar?fecha=${fecha}&local=${bodega}`);
        if (!response.ok) throw new Error('Error al consultar');
        const data = await response.json();

        _obsProductosAgregados = [];
        _obsProductos = (data.productos || []).map(p => ({
            id: p.id,
            codigo: p.codigo,
            nombre: p.nombre,
            unidad: p.unidad,
            cantidad_sistema: parseFloat(p.cantidad),
            cantidad_contada: p.cantidad_contada,
            cantidad_contada_2: p.cantidad_contada_2,
            observaciones: p.observaciones || '',
            motivo: p.motivo || '',
            corregido: p.corregido || false,
            justificado: p.justificado || false,
            cantidad_justificada: parseFloat(p.cantidad_justificada) || 0,
            contado_por_nombre: p.contado_por_nombre || '',
            contado2_por_nombre: p.contado2_por_nombre || ''
        }));

        // Cargar observaciones manuales
        try {
            const resManuales = await fetch(`${CONFIG.API_URL}/api/observaciones-manuales?fecha=${fecha}&local=${bodega}`);
            if (resManuales.ok) {
                _obsManuales = await resManuales.json();
            } else {
                _obsManuales = [];
            }
        } catch(e) { _obsManuales = []; }

        renderObservaciones();
    } catch (error) {
        obsContainer.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error al cargar datos</p></div>`;
        showToast('Error al cargar observaciones', 'error');
    }
}

function renderObservaciones() {
    const obsContainer = document.getElementById('observaciones-container');
    if (!obsContainer) return;

    if (!_obsProductos || _obsProductos.length === 0) {
        obsContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-box-open"></i>
                <p>No hay datos para esta fecha y bodega</p>
            </div>`;
        return;
    }

    // Productos del conteo con diferencia actual
    const productosConDif = _obsProductos.filter(prod => {
        const conteo2 = prod.cantidad_contada_2 !== null && prod.cantidad_contada_2 !== undefined;
        const cantidadFinal = conteo2 ? prod.cantidad_contada_2 : prod.cantidad_contada;
        if (cantidadFinal === null || cantidadFinal === undefined) return false;
        return cantidadFinal - prod.cantidad_sistema !== 0;
    });

    // Productos sin diferencia pero que ya tienen motivo/obs/corregido en el conteo
    const productosGestionados = _obsProductos.filter(prod => {
        const conteo2 = prod.cantidad_contada_2 !== null && prod.cantidad_contada_2 !== undefined;
        const cantidadFinal = conteo2 ? prod.cantidad_contada_2 : prod.cantidad_contada;
        if (cantidadFinal === null || cantidadFinal === undefined) return false;
        const tieneDif = cantidadFinal - prod.cantidad_sistema !== 0;
        if (tieneDif) return false;
        return prod.motivo || prod.observaciones || prod.corregido;
    });

    const todosConteo = [...productosConDif, ...productosGestionados];
    // Admin y Supervisor pueden justificar (marcar corregido)
    const esAdmin = _esAdminOSupervisor();

    let html = '';

    // Calcular contadores únicos para observaciones
    const _obsContadores1 = [...new Set(_obsProductos.map(p => p.contado_por_nombre).filter(Boolean))];
    const _obsContadores2 = [...new Set(_obsProductos.map(p => p.contado2_por_nombre).filter(Boolean))];
    let obsContadorHtml = '';
    if (_obsContadores1.length > 0) {
        obsContadorHtml += `<span class="sem-cerrada-info" style="margin-left:10px;font-size:12px;"><i class="fas fa-user"></i> Conteo 1: ${escapeHtml(_obsContadores1.join(', '))}</span>`;
    }
    if (_obsContadores2.length > 0) {
        obsContadorHtml += `<span class="sem-cerrada-info" style="margin-left:8px;font-size:12px;"><i class="fas fa-user-check"></i> Conteo 2: ${escapeHtml(_obsContadores2.join(', '))}</span>`;
    }
    if (obsContadorHtml) {
        html += `<div style="margin-bottom:10px;padding:10px 14px;background:#EFF6FF;border-radius:8px;border-left:3px solid #123450;display:flex;align-items:center;flex-wrap:wrap;gap:4px;">
            <i class="fas fa-users" style="color:#123450;"></i>
            <span style="font-size:12px;font-weight:600;color:#123450;">Contado por:</span>
            ${obsContadorHtml}
        </div>`;
    }

    // === TABLA 1: Productos del conteo con diferencia ===
    if (todosConteo.length > 0) {
        html += `
        <div class="tabla-obs-container">
            <div class="obs-header">
                <i class="fas fa-clipboard-list"></i>
                Diferencias del conteo (${productosConDif.length} con diferencia${productosGestionados.length > 0 ? ` + ${productosGestionados.length} gestionados` : ''})
            </div>
            <table class="tabla-observaciones">
                <thead>
                    <tr>
                        <th class="obs-col-producto">Producto</th>
                        <th class="obs-col-dif">Dif</th>
                        <th class="obs-col-motivo">Motivo</th>
                        <th class="obs-col-obs">Observación</th>
                        <th class="obs-col-corregido" title="Se modificó el conteo">Corregido</th>
                        <th class="obs-col-corregido" title="Cantidad justificada (no entra al descuento)">Justif.</th>
                    </tr>
                </thead>
                <tbody>
                    ${todosConteo.map(prod => {
                        const conteo2 = prod.cantidad_contada_2 !== null && prod.cantidad_contada_2 !== undefined;
                        const cantidadFinal = conteo2 ? prod.cantidad_contada_2 : prod.cantidad_contada;
                        const diferencia = (cantidadFinal !== null && cantidadFinal !== undefined) ? cantidadFinal - prod.cantidad_sistema : 0;
                        const difClass = diferencia < 0 ? 'negativa' : diferencia > 0 ? 'positiva' : '';
                        const esDifCero = diferencia === 0;
                        const obsActual = (prod.observaciones || '').replace(/"/g, '&quot;');
                        const motivoActual = prod.motivo || '';
                        const corregido = prod.corregido || false;
                        const justificado = prod.justificado || false;
                        const cantJustif = parseFloat(prod.cantidad_justificada) || 0;
                        const difAbs = Math.abs(diferencia);
                        const yaGuardado = motivoActual || obsActual;
                        const bloqueado = yaGuardado && !esAdmin;

                        return `
                            <tr class="${esDifCero ? 'fila-corregida' : ''}">
                                <td class="obs-nombre">${prod.nombre}</td>
                                <td class="obs-dif ${difClass}">${diferencia !== 0 ? (diferencia > 0 ? '+' : '') + diferencia.toFixed(3) : '<span style="color:#94A3B8">0.000</span>'}</td>
                                <td class="obs-motivo-cell">
                                    ${bloqueado
                                        ? `<span class="obs-texto-fijo">${motivoActual || '-'}</span>`
                                        : `<select class="select-motivo" data-id="${prod.id}" onchange="cachearCambioObs(this)">
                                            <option value="">-- Seleccionar --</option>
                                            ${OBSERVACIONES_PREESTABLECIDAS.map(op =>
                                                `<option value="${op}" ${motivoActual === op ? 'selected' : ''}>${op}</option>`
                                            ).join('')}
                                        </select>`
                                    }
                                </td>
                                <td class="obs-input-cell">
                                    ${bloqueado
                                        ? `<span class="obs-texto-fijo">${obsActual || '-'}</span>`
                                        : `<input type="text"
                                               class="input-observacion"
                                               value="${obsActual}"
                                               placeholder="Escribir observación..."
                                               data-id="${prod.id}"
                                               onchange="cachearCambioObs(this)"
                                               onkeypress="if(event.key==='Enter') this.blur()">`
                                    }
                                </td>
                                <td class="obs-corregido-cell" title="${corregido ? 'El conteo fue modificado manualmente' : 'Conteo original'}">
                                    <span class="badge-corregido ${corregido ? 'corregido-si' : 'corregido-no'}">${corregido ? 'Sí' : 'No'}</span>
                                </td>
                                <td class="obs-corregido-cell">
                                    ${esAdmin && diferencia !== 0
                                        ? `<input type="number" step="0.01" min="0" max="${difAbs.toFixed(2)}"
                                                  value="${cantJustif > 0 ? cantJustif.toFixed(2) : ''}"
                                                  placeholder="0"
                                                  data-id="${prod.id}" data-max="${difAbs.toFixed(4)}"
                                                  onchange="guardarCantJustificada(this)"
                                                  style="width:70px;padding:4px 6px;border:1.5px solid ${cantJustif > 0 ? '#059669' : '#e2e8f0'};border-radius:6px;font-size:12px;text-align:center;font-weight:${cantJustif > 0 ? '700' : '400'};color:${cantJustif > 0 ? '#059669' : '#475569'};">`
                                        : `<span style="font-size:12px;color:${cantJustif > 0 ? '#059669' : '#94a3b8'};font-weight:${cantJustif > 0 ? '600' : '400'};">${cantJustif > 0 ? cantJustif.toFixed(2) : '-'}</span>`
                                    }
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>`;
    } else {
        html += `<div class="empty-state"><i class="fas fa-check-circle"></i><p>No hay productos con diferencia en el conteo</p></div>`;
    }

    // === TABLA 2: Observaciones manuales (productos agregados) ===
    const productosOrdenados = [..._obsProductos].sort((a, b) => a.nombre.localeCompare(b.nombre));

    html += `
        <div class="tabla-obs-container" style="margin-top:16px;">
            <div class="obs-header">
                <i class="fas fa-plus-circle"></i>
                Productos agregados manualmente (${_obsManuales.length})
            </div>
            <table class="tabla-observaciones">
                <thead>
                    <tr>
                        <th class="obs-col-producto">Producto</th>
                        <th class="obs-col-dif">Dif</th>
                        <th class="obs-col-motivo">Motivo</th>
                        <th class="obs-col-obs">Observación</th>
                        <th class="obs-col-corregido" title="Se modificó el conteo">Corregido</th>
                        <th class="obs-col-corregido" title="Cantidad justificada (no entra al descuento)">Justif.</th>
                    </tr>
                </thead>
                <tbody>
                    ${_obsManuales.map(m => {
                        const dif = parseFloat(m.diferencia) || 0;
                        const difClass = dif < 0 ? 'negativa' : dif > 0 ? 'positiva' : '';
                        const obsActual = (m.observaciones || '').replace(/"/g, '&quot;');
                        const motivoActual = m.motivo || '';
                        const corregido = m.corregido || false;
                        const justificado = m.justificado || false;
                        const yaGuardadoM = motivoActual || obsActual;
                        const bloqueadoM = yaGuardadoM && !esAdmin;
                        return `
                            <tr class="fila-manual">
                                <td class="obs-nombre">
                                    ${m.nombre}
                                    ${esAdmin ? `<button class="btn-eliminar-obs" onclick="eliminarObsManual(${m.id})" title="Eliminar">
                                        <i class="fas fa-trash-alt"></i>
                                    </button>` : ''}
                                </td>
                                <td class="obs-dif ${difClass}">${dif !== 0 ? (dif > 0 ? '+' : '') + dif.toFixed(3) : '0.000'}</td>
                                <td class="obs-motivo-cell">
                                    ${bloqueadoM
                                        ? `<span class="obs-texto-fijo">${motivoActual || '-'}</span>`
                                        : `<select class="select-motivo" data-manual-id="${m.id}" onchange="cachearCambioObs(this)">
                                            <option value="">-- Seleccionar --</option>
                                            ${OBSERVACIONES_PREESTABLECIDAS.map(op =>
                                                `<option value="${op}" ${motivoActual === op ? 'selected' : ''}>${op}</option>`
                                            ).join('')}
                                        </select>`
                                    }
                                </td>
                                <td class="obs-input-cell">
                                    ${bloqueadoM
                                        ? `<span class="obs-texto-fijo">${obsActual || '-'}</span>`
                                        : `<input type="text"
                                               class="input-observacion"
                                               value="${obsActual}"
                                               placeholder="Escribir observación..."
                                               data-manual-id="${m.id}"
                                               onchange="cachearCambioObs(this)"
                                               onkeypress="if(event.key==='Enter') this.blur()">`
                                    }
                                </td>
                                <td class="obs-corregido-cell" title="${corregido ? 'El registro fue modificado' : 'Original'}">
                                    <span class="badge-corregido ${corregido ? 'corregido-si' : 'corregido-no'}">${corregido ? 'Sí' : 'No'}</span>
                                </td>
                                <td class="obs-corregido-cell">
                                    ${esAdmin
                                        ? `<label class="toggle-corregido">
                                               <input type="checkbox" class="check-corregido" data-manual-id="${m.id}"
                                                      ${justificado ? 'checked' : ''}
                                                      onchange="toggleJustificadoManual(this)">
                                               <span class="toggle-slider"></span>
                                               <span class="toggle-label">${justificado ? 'Sí' : 'No'}</span>
                                           </label>`
                                        : `<span class="badge-corregido ${justificado ? 'corregido-si' : 'corregido-no'}">${justificado ? 'Sí' : 'No'}</span>`
                                    }
                                </td>
                            </tr>
                        `;
                    }).join('')}
                    <tr class="fila-agregar">
                        <td>
                            <select id="obs-agregar-producto" class="select-motivo" style="background:white;">
                                <option value="">-- Seleccionar producto --</option>
                                ${productosOrdenados.map(p =>
                                    `<option value="${p.codigo}||${p.nombre.replace(/"/g, '&quot;')}">${p.nombre}</option>`
                                ).join('')}
                            </select>
                        </td>
                        <td>
                            <input type="number" id="obs-agregar-dif" class="input-observacion" placeholder="Dif"
                                   step="0.001" style="width:70px;text-align:center;">
                        </td>
                        <td colspan="2" style="text-align:center;">
                            <button class="btn-obs-cargar" onclick="agregarProductoManual()" style="width:100%;">
                                <i class="fas fa-plus"></i> Agregar producto
                            </button>
                        </td>
                        <td></td>
                    </tr>
                </tbody>
            </table>
        </div>
        <div class="obs-footer" style="margin-top:16px;">
            <button class="btn-guardar-obs" onclick="guardarTodasObservaciones()">
                <i class="fas fa-save"></i> Guardar Observaciones
            </button>
        </div>`;

    obsContainer.innerHTML = html;
    restaurarCacheObs();
}

let _agregandoManual = false;
async function agregarProductoManual() {
    if (_agregandoManual) return;
    const selectProd = document.getElementById('obs-agregar-producto');
    const difInput = document.getElementById('obs-agregar-dif');
    const fecha = document.getElementById('obs-fecha').value;
    const bodega = document.getElementById('obs-bodega').value;

    if (!selectProd || !selectProd.value) { showToast('Selecciona un producto', 'error'); return; }
    if (!fecha || !bodega) { showToast('Selecciona fecha y bodega', 'error'); return; }

    const [codigo, nombre] = selectProd.value.split('||');
    const diferencia = difInput ? parseFloat(difInput.value) || 0 : 0;

    _agregandoManual = true;
    try {
        const response = await fetch(`${CONFIG.API_URL}/api/observaciones-manuales`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fecha, local: bodega, codigo, nombre, diferencia,
                creado_por: state.user ? state.user.username : ''
            })
        });
        if (response.ok) {
            const data = await response.json();
            _obsManuales.push({ id: data.id, codigo, nombre, diferencia, motivo: '', observaciones: '', corregido: false });
            renderObservaciones();
            showToast('Producto agregado', 'success');
        } else {
            showToast('Error al agregar', 'error');
        }
    } catch (error) {
        showToast('Error de conexión', 'error');
    } finally {
        _agregandoManual = false;
    }
}

async function eliminarObsManual(id) {
    if (!confirm('¿Eliminar este producto de la lista?')) return;
    try {
        const res = await fetch(`${CONFIG.API_URL}/api/observaciones-manuales/${id}`, { method: 'DELETE' });
        if (res.ok) {
            _obsManuales = _obsManuales.filter(m => m.id !== id);
            renderObservaciones();
            showToast('Producto eliminado', 'success');
        } else {
            showToast('Error al eliminar', 'error');
        }
    } catch(e) { showToast('Error de conexión', 'error'); }
}

async function guardarMotivoManual(select) {
    if (!_puede('observaciones', 'editar')) { showToast('No tienes permiso', 'error'); return; }
    const id = parseInt(select.dataset.manualId);
    const motivo = select.value;
    try {
        const res = await fetch(`${CONFIG.API_URL}/api/observaciones-manuales/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motivo })
        });
        if (res.ok) {
            const m = _obsManuales.find(x => x.id === id);
            if (m) m.motivo = motivo;
            select.classList.add('guardado');
            setTimeout(() => select.classList.remove('guardado'), 1000);
            showToast('Motivo guardado', 'success');
        }
    } catch(e) { showToast('Error de conexión', 'error'); }
}

async function guardarObsManual(input) {
    if (!_puede('observaciones', 'editar')) { showToast('No tienes permiso', 'error'); return; }
    const id = parseInt(input.dataset.manualId);
    const observaciones = input.value.trim();
    try {
        const res = await fetch(`${CONFIG.API_URL}/api/observaciones-manuales/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ observaciones })
        });
        if (res.ok) {
            const m = _obsManuales.find(x => x.id === id);
            if (m) m.observaciones = observaciones;
            input.classList.add('guardado');
            setTimeout(() => input.classList.remove('guardado'), 500);
        }
    } catch(e) { showToast('Error de conexión', 'error'); }
}

async function toggleCorregidoManual(checkbox) {
    const id = parseInt(checkbox.dataset.manualId);
    const corregido = checkbox.checked;
    const label = checkbox.closest('.toggle-corregido').querySelector('.toggle-label');
    try {
        const res = await fetch(`${CONFIG.API_URL}/api/observaciones-manuales/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ corregido })
        });
        if (res.ok) {
            const m = _obsManuales.find(x => x.id === id);
            if (m) m.corregido = corregido;
            label.textContent = corregido ? 'Sí' : 'No';
            showToast(corregido ? 'Marcado como corregido' : 'Desmarcado', 'success');
        } else {
            checkbox.checked = !corregido;
        }
    } catch(e) { checkbox.checked = !corregido; showToast('Error', 'error'); }
}

async function toggleJustificadoManual(checkbox) {
    const id = parseInt(checkbox.dataset.manualId);
    const justificado = checkbox.checked;
    const label = checkbox.closest('.toggle-corregido').querySelector('.toggle-label');
    try {
        const res = await fetch(`${CONFIG.API_URL}/api/observaciones-manuales/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ justificado })
        });
        if (res.ok) {
            const m = _obsManuales.find(x => x.id === id);
            if (m) m.justificado = justificado;
            label.textContent = justificado ? 'Sí' : 'No';
            showToast(justificado ? 'Justificado (no entra al descuento)' : 'Justificación removida', 'success');
        } else {
            checkbox.checked = !justificado;
        }
    } catch(e) { checkbox.checked = !justificado; showToast('Error', 'error'); }
}

async function guardarMotivo(select) {
    if (!_puede('observaciones', 'editar')) { showToast('No tienes permiso', 'error'); return; }
    const id = parseInt(select.dataset.id);
    const motivo = select.value;

    try {
        const response = await fetch(`${CONFIG.API_URL}/api/inventario/guardar-observacion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, motivo })
        });
        if (response.ok) {
            const prod = _obsProductos.find(p => p.id === id);
            if (prod) prod.motivo = motivo;
            select.classList.add('guardado');
            setTimeout(() => select.classList.remove('guardado'), 1000);
            showToast('Motivo guardado', 'success');
        } else {
            showToast('Error al guardar motivo', 'error');
        }
    } catch (error) {
        showToast('Error de conexión', 'error');
    }
}

async function toggleCorregido(checkbox) {
    const id = parseInt(checkbox.dataset.id);
    const corregido = checkbox.checked;
    const label = checkbox.closest('.toggle-corregido').querySelector('.toggle-label');

    try {
        const response = await fetch(`${CONFIG.API_URL}/api/inventario/guardar-observacion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, corregido })
        });
        if (response.ok) {
            const prod = _obsProductos.find(p => p.id === id);
            if (prod) prod.corregido = corregido;
            label.textContent = corregido ? 'Sí' : 'No';
            showToast(corregido ? 'Marcado como corregido' : 'Marcado como no corregido', 'success');
        } else {
            checkbox.checked = !corregido;
            showToast('Error al actualizar', 'error');
        }
    } catch (error) {
        checkbox.checked = !corregido;
        showToast('Error de conexión', 'error');
    }
}

async function guardarCantJustificada(input) {
    const id = parseInt(input.dataset.id);
    const max = parseFloat(input.dataset.max) || 0;
    let cantidad = parseFloat(input.value) || 0;
    if (cantidad < 0) cantidad = 0;
    if (cantidad > max) cantidad = max;
    input.value = cantidad > 0 ? cantidad.toFixed(2) : '';

    try {
        const response = await fetch(`${CONFIG.API_URL}/api/inventario/guardar-observacion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, cantidad_justificada: cantidad })
        });
        if (response.ok) {
            const prod = _obsProductos.find(p => p.id === id);
            if (prod) {
                prod.cantidad_justificada = cantidad;
                prod.justificado = cantidad > 0;
            }
            input.style.borderColor = cantidad > 0 ? '#059669' : '#e2e8f0';
            input.style.fontWeight = cantidad > 0 ? '700' : '400';
            input.style.color = cantidad > 0 ? '#059669' : '#475569';
            showToast(cantidad > 0 ? `Justificado: ${cantidad.toFixed(2)} unidades` : 'Justificacion removida', 'success');
        } else {
            showToast('Error al guardar', 'error');
        }
    } catch (error) {
        showToast('Error de conexion', 'error');
    }
}

// ==================== MODULO: ASIGNACION DE DIFERENCIAS ====================

async function cargarPersonas() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(`${CONFIG.API_URL}/api/personas?refresh=1`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (response.ok) {
            const datos = await response.json();
            if (Array.isArray(datos) && datos.length > 0) {
                state.personas = datos;
                try { localStorage.setItem('personas_cache', JSON.stringify(datos)); } catch(e) {}
            }
        }
    } catch (error) {
        console.error('Error cargando personas:', error);
    }
    // Si fallo, intentar cargar desde cache local
    if (!state.personas || state.personas.length === 0) {
        try {
            const cache = localStorage.getItem('personas_cache');
            if (cache) { state.personas = JSON.parse(cache); }
        } catch(e) {}
    }
}

async function cargarAsignaciones(fecha, local) {
    try {
        const response = await fetch(`${CONFIG.API_URL}/api/inventario/asignaciones?fecha=${fecha}&local=${local}`);
        if (response.ok) {
            const data = await response.json();
            state.asignaciones = data.asignaciones || {};
        }
    } catch (error) {
        console.error('Error cargando asignaciones:', error);
        state.asignaciones = {};
    }
}

function renderAsignacionesDiferencias(container, productosConDif) {
    const totalProductos = productosConDif.length;
    let completosCount = 0;

    let valorTotalGeneral = 0;

    const productosHtml = productosConDif.map(prod => {
        const conteo2 = prod.cantidad_contada_2 !== null && prod.cantidad_contada_2 !== undefined;
        const cantidadFinal = conteo2 ? prod.cantidad_contada_2 : prod.cantidad_contada;
        const diferencia = cantidadFinal - prod.cantidad_sistema;
        const difAbs = Math.abs(diferencia);
        const difClass = diferencia < 0 ? 'negativa' : 'positiva';
        const difTexto = diferencia < 0 ? 'Faltante' : 'Sobrante';

        // Costo del producto (viene de la BD directamente)
        const costoUnit = prod.costo_unitario || 0;
        const valorDif = difAbs * costoUnit;
        valorTotalGeneral += valorDif;

        // Obtener asignaciones guardadas para este producto
        const asignacionesGuardadas = state.asignaciones[String(prod.id)] || [];
        const totalAsignado = asignacionesGuardadas.reduce((sum, a) => sum + a.cantidad, 0);
        const esCompleto = Math.abs(totalAsignado - difAbs) < 0.001;
        if (esCompleto && asignacionesGuardadas.length > 0) completosCount++;

        const statusClass = asignacionesGuardadas.length === 0 ? 'pendiente' : (esCompleto ? 'completo' : 'parcial');
        const statusTexto = asignacionesGuardadas.length === 0 ? 'Sin asignar' : (esCompleto ? 'Completo' : `${totalAsignado.toFixed(1)}/${difAbs.toFixed(1)}`);

        // Generar filas de asignacion
        let filasHtml = '';
        if (asignacionesGuardadas.length > 0) {
            filasHtml = asignacionesGuardadas.map((a, idx) => generarFilaAsignacion(prod.id, idx, a.persona, a.cantidad, prod.unidad)).join('');
        } else {
            filasHtml = generarFilaAsignacion(prod.id, 0, '', '', prod.unidad);
        }

        const costoHtml = costoUnit > 0
            ? `<span class="asig-prod-costo">C/U: $${costoUnit.toFixed(2)} | Total: $${valorDif.toFixed(2)}</span>`
            : `<span class="asig-prod-costo sin-costo">Sin costo registrado</span>`;

        return `
            <div class="asig-producto" data-id="${prod.id}" data-diferencia="${difAbs}" data-unidad="${prod.unidad || 'Und'}" data-costo="${costoUnit}">
                <div class="asig-producto-header" onclick="toggleAsignacion(${prod.id})">
                    <div class="asig-prod-info">
                        <span class="asig-prod-nombre">${escapeHtml(prod.nombre)}</span>
                        <span class="asig-prod-dif ${difClass}">${difTexto}: ${diferencia > 0 ? '+' : ''}${diferencia.toFixed(3)}</span>
                        ${costoHtml}
                    </div>
                    <span class="asig-status ${statusClass}">${statusTexto}</span>
                    <i class="fas fa-chevron-down asig-chevron"></i>
                </div>
                <div class="asig-producto-body" id="asig-body-${prod.id}" style="display:none;">
                    <div class="asig-filas" id="asig-filas-${prod.id}">
                        ${filasHtml}
                    </div>
                    <button class="btn-add-persona" onclick="agregarFilaAsignacion(${prod.id})">
                        <i class="fas fa-plus"></i> Agregar persona
                    </button>
                    <div class="asig-resumen" id="asig-resumen-${prod.id}">
                        <span>Total asignado: <strong id="asig-total-${prod.id}">${totalAsignado.toFixed(3)}</strong> / ${difAbs.toFixed(3)}</span>
                        ${costoUnit > 0 ? `<span class="asig-valor-total" id="asig-valor-${prod.id}">Valor: $${(totalAsignado * costoUnit).toFixed(2)}</span>` : ''}
                    </div>
                    <button class="btn-guardar-asig" onclick="guardarAsignacionProducto(${prod.id})">
                        <i class="fas fa-save"></i> Guardar
                    </button>
                </div>
            </div>
        `;
    }).join('');

    // ---- Resumen por persona ----
    const _resumenPersonas = {};
    productosConDif.forEach(prod => {
        const costoUnit = parseFloat(prod.costo_unitario) || 0;
        const asigs = state.asignaciones[String(prod.id)] || [];
        asigs.forEach(a => {
            if (!_resumenPersonas[a.persona]) _resumenPersonas[a.persona] = 0;
            _resumenPersonas[a.persona] += a.cantidad * costoUnit;
        });
    });
    const _personasOrdenadas = Object.entries(_resumenPersonas).sort((a, b) => b[1] - a[1]);
    const resumenPersonasHtml = _personasOrdenadas.length === 0 ? '' : `
        <div class="asig-resumen-personas">
            <div class="asig-resumen-title"><i class="fas fa-receipt"></i> Resumen por persona</div>
            ${_personasOrdenadas.map(([nombre, total]) => `
                <div class="asig-resumen-row">
                    <span class="asig-resumen-nombre"><i class="fas fa-user"></i> ${escapeHtml(nombre)}</span>
                    <span class="asig-resumen-monto">$${total.toFixed(2)}</span>
                </div>`).join('')}
        </div>`;

    container.innerHTML = `
        <div class="asig-container">
            <div class="asig-header">
                <i class="fas fa-users"></i>
                Asignacion de Diferencias (${totalProductos} productos)
                <span class="asig-header-status">${completosCount}/${totalProductos} completos</span>
            </div>
            ${valorTotalGeneral > 0 ? `<div class="asig-valor-general"><i class="fas fa-dollar-sign"></i> Valor total diferencias: <strong>$${valorTotalGeneral.toFixed(2)}</strong></div>` : ''}
            ${productosHtml}
            ${resumenPersonasHtml}
            <div class="asig-footer">
                <button class="btn-guardar-todas-asig" onclick="guardarTodasAsignaciones()">
                    <i class="fas fa-save"></i> Guardar Todas las Asignaciones
                </button>
            </div>
        </div>
    `;
}

function generarFilaAsignacion(productoId, idx, personaSeleccionada, cantidad, unidad) {
    const unidadLabel = unidad || 'Und';
    const productoDiv = document.querySelector(`.asig-producto[data-id="${productoId}"]`);
    const costoUnit = productoDiv ? parseFloat(productoDiv.dataset.costo) || 0 : 0;
    const cantNum = parseFloat(cantidad) || 0;
    const valorFila = (cantNum * costoUnit).toFixed(2);
    return `
        <div class="asig-fila" data-producto="${productoId}" data-idx="${idx}">
            <div class="persona-dropdown" onclick="abrirSelectorPersona(this.querySelector('.input-persona'), ${productoId})">
                <input type="text" class="input-persona" readonly
                       value="${personaSeleccionada}" placeholder="Seleccionar persona...">
                <i class="fas fa-chevron-down persona-dd-arrow"></i>
            </div>
            <div class="asig-fila-bottom">
                <div class="input-asignacion-wrap">
                    <input type="number" class="input-asignacion" value="${cantidad}"
                           step="0.001" min="0" placeholder="Cant."
                           onchange="actualizarTotalAsignado(${productoId}, this)"
                           onblur="actualizarTotalAsignado(${productoId}, this)">
                    <span class="unidad-label">${unidadLabel}</span>
                </div>
                <span class="fila-descuento">$${valorFila}</span>
                <button class="btn-remove-fila" onclick="removerFilaAsignacion(this, ${productoId})">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>
    `;
}

let _selectorAbierto = false;
async function abrirSelectorPersona(inputEl, productoId) {
    // Evitar doble invocacion (double-tap en movil)
    if (_selectorAbierto) return;
    _selectorAbierto = true;

    try {
        // Fuente 1: state.personas (ya cargadas de consultar o cargarPersonas)
        // Fuente 2: HTML inyectado (JSON island o base64)
        if (!state.personas || state.personas.length === 0) {
            var fromHTML = _cargarPersonasDelHTML();
            if (fromHTML.length > 0) state.personas = fromHTML;
        }
        // Fuente 3: localStorage
        if (!state.personas || state.personas.length === 0) {
            try {
                const cache = localStorage.getItem('personas_cache');
                if (cache) {
                    const parsed = JSON.parse(cache);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        state.personas = parsed;
                    }
                }
            } catch(e) {}
        }

        // Crear modal de seleccion de persona
        let modal = document.getElementById('modal-persona-selector');
        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = 'modal-persona-selector';
        modal.className = 'modal-persona-overlay';
        modal._targetInput = inputEl;
        modal._productoId = productoId;

        modal.innerHTML = `
            <div class="modal-persona-content">
                <div class="modal-persona-header">
                    <input type="text" id="persona-buscar" class="persona-buscar-input"
                           placeholder="Buscar persona...">
                    <button class="btn-close-persona" onclick="cerrarSelectorPersona()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-persona-list" id="persona-lista"></div>
            </div>
        `;
        document.body.appendChild(modal);

        // Cerrar al hacer clic fuera
        modal.addEventListener('click', function(e) {
            if (e.target === modal) cerrarSelectorPersona();
        });

        // Fuente 3: Si aun no hay personas, fetch directo con spinner
        if (!state.personas || state.personas.length === 0) {
            const lista = document.getElementById('persona-lista');
            if (lista) {
                lista.innerHTML = `
                    <div style="padding:30px;text-align:center;color:#64748b;">
                        <i class="fas fa-spinner fa-spin" style="font-size:24px;margin-bottom:10px;display:block;"></i>
                        Cargando personas...
                    </div>
                `;
            }
            await cargarPersonas();
        }

        // Fuente 4: Si TODAVIA no hay personas, intentar fetch como ultimo recurso
        if (!state.personas || state.personas.length === 0) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);
                const resp = await fetch(`${CONFIG.API_URL}/api/personas`, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (resp.ok) {
                    const datos = await resp.json();
                    if (Array.isArray(datos) && datos.length > 0) {
                        state.personas = datos;
                        try { localStorage.setItem('personas_cache', JSON.stringify(datos)); } catch(e) {}
                    }
                }
            } catch(e) {
                console.error('Fetch fallback tambien fallo:', e);
            }
        }

        // Renderizar lista de personas
        renderListaPersonas();

        // Configurar busqueda
        const buscarInput = document.getElementById('persona-buscar');
        if (buscarInput) {
            buscarInput.addEventListener('input', function() {
                const filtro = this.value.toLowerCase();
                const opciones = document.querySelectorAll('.persona-opcion');
                opciones.forEach(op => {
                    op.style.display = op.textContent.toLowerCase().includes(filtro) ? '' : 'none';
                });
            });
        }
    } finally {
        _selectorAbierto = false;
    }
}

function renderListaPersonas() {
    const lista = document.getElementById('persona-lista');
    if (!lista) return;

    if (state.personas && state.personas.length > 0) {
        // Onclick directo en cada opcion (mas confiable en movil que event delegation)
        lista.innerHTML = state.personas.map((p, i) => {
            return `<div class="persona-opcion" onclick="seleccionarPersona(state.personas[${i}])">
                <i class="fas fa-user"></i> ${escapeHtml(p)}
            </div>`;
        }).join('');
    } else {
        // Diagnostico: mostrar info util para debug
        let lsCount = 0;
        try {
            const c = localStorage.getItem('personas_cache');
            if (c) lsCount = JSON.parse(c).length;
        } catch(e) {}

        lista.innerHTML = `
            <div style="padding:30px;text-align:center;color:#64748b;">
                <i class="fas fa-exclamation-circle" style="font-size:24px;margin-bottom:10px;display:block;color:#D97706;"></i>
                No se pudieron cargar las personas
                <div style="font-size:11px;color:#94a3b8;margin-top:8px;">
                    state: ${state.personas ? state.personas.length : 'null'} | cache: ${lsCount}
                </div>
                <button onclick="reintentarCargarPersonas()" style="display:block;margin:12px auto 0;padding:10px 24px;background:#1E3A5F;color:white;border:none;border-radius:8px;font-size:14px;font-family:inherit;cursor:pointer;">
                    <i class="fas fa-sync-alt"></i> Reintentar
                </button>
                <button onclick="cargarPersonasDiagnostico()" style="display:block;margin:8px auto 0;padding:8px 20px;background:#059669;color:white;border:none;border-radius:8px;font-size:12px;font-family:inherit;cursor:pointer;">
                    <i class="fas fa-stethoscope"></i> Diagnostico
                </button>
            </div>
        `;
    }
}

async function reintentarCargarPersonas() {
    const lista = document.getElementById('persona-lista');
    if (lista) {
        lista.innerHTML = `
            <div style="padding:30px;text-align:center;color:#64748b;">
                <i class="fas fa-spinner fa-spin" style="font-size:24px;margin-bottom:10px;display:block;"></i>
                Cargando personas...
            </div>
        `;
    }
    state.personas = [];
    // Intentar fetch async primero
    await cargarPersonas();
    // Si fallo, intentar fetch como ultimo recurso
    if (!state.personas || state.personas.length === 0) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            const resp = await fetch(`${CONFIG.API_URL}/api/personas`, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (resp.ok) {
                const datos = await resp.json();
                if (Array.isArray(datos) && datos.length > 0) {
                    state.personas = datos;
                    try { localStorage.setItem('personas_cache', JSON.stringify(datos)); } catch(e) {}
                }
            }
        } catch(e) {}
    }
    renderListaPersonas();
}

async function cargarPersonasDiagnostico() {
    const lista = document.getElementById('persona-lista');
    if (!lista) return;
    lista.innerHTML = '<div style="padding:20px;font-size:12px;font-family:monospace;text-align:left;"></div>';
    const log = lista.firstChild;
    const addLog = (msg) => { log.innerHTML += msg + '<br>'; };

    addLog('== DIAGNOSTICO PERSONAS ==');
    addLog(`state.personas: ${state.personas ? state.personas.length : 'null'}`);

    // Test localStorage
    try {
        const c = localStorage.getItem('personas_cache');
        addLog(`localStorage: ${c ? JSON.parse(c).length + ' personas' : 'vacio'}`);
    } catch(e) {
        addLog(`localStorage ERROR: ${e.message}`);
    }

    // Test fetch /api/personas
    addLog('Probando fetch /api/personas...');
    try {
        const t1 = Date.now();
        const resp = await fetch(`${CONFIG.API_URL}/api/personas`);
        const t2 = Date.now();
        addLog(`Status: ${resp.status} (${t2-t1}ms)`);
        if (resp.ok) {
            const data = await resp.json();
            addLog(`Datos: ${Array.isArray(data) ? data.length + ' personas' : typeof data}`);
            if (Array.isArray(data) && data.length > 0) {
                state.personas = data;
                try { localStorage.setItem('personas_cache', JSON.stringify(data)); } catch(e) {}
                addLog('GUARDADO en state y localStorage');
                addLog('<br><b style="color:#059669">Datos cargados OK. Toca Reintentar.</b>');
            }
        } else {
            const txt = await resp.text();
            addLog(`Error body: ${txt.substring(0, 200)}`);
        }
    } catch(e) {
        addLog(`Fetch ERROR: ${e.name}: ${e.message}`);
    }

    // Test debug endpoint
    addLog('<br>Probando /api/debug-personas...');
    try {
        const resp2 = await fetch(`${CONFIG.API_URL}/api/debug-personas`);
        if (resp2.ok) {
            const dbg = await resp2.json();
            addLog(`Cache servidor: ${dbg.cache_count} personas`);
            addLog(`Cache edad: ${dbg.cache_age_seconds}s`);
            addLog(`Token configurado: ${dbg.airtable_token_configured}`);
        }
    } catch(e) {
        addLog(`Debug ERROR: ${e.message}`);
    }
}

function seleccionarPersona(nombre) {
    const modal = document.getElementById('modal-persona-selector');
    if (modal && modal._targetInput) {
        modal._targetInput.value = nombre;
        actualizarTotalAsignado(modal._productoId);
    }
    cerrarSelectorPersona();
}

function cerrarSelectorPersona() {
    const modal = document.getElementById('modal-persona-selector');
    if (modal) modal.remove();
}

function toggleAsignacion(productoId) {
    const body = document.getElementById(`asig-body-${productoId}`);
    const header = body.previousElementSibling;
    const chevron = header.querySelector('.asig-chevron');

    if (body.style.display === 'none') {
        body.style.display = 'block';
        chevron.classList.add('rotated');
    } else {
        body.style.display = 'none';
        chevron.classList.remove('rotated');
    }
}

function agregarFilaAsignacion(productoId) {
    const filasContainer = document.getElementById(`asig-filas-${productoId}`);
    const productoDiv = document.querySelector(`.asig-producto[data-id="${productoId}"]`);
    const unidad = productoDiv ? productoDiv.dataset.unidad : 'Und';
    const idx = filasContainer.children.length;
    filasContainer.insertAdjacentHTML('beforeend', generarFilaAsignacion(productoId, idx, '', '', unidad));
}

function removerFilaAsignacion(btn, productoId) {
    const fila = btn.closest('.asig-fila');
    fila.remove();
    actualizarTotalAsignado(productoId);
}

function actualizarTotalAsignado(productoId, inputActual) {
    const productoDiv = document.querySelector(`.asig-producto[data-id="${productoId}"]`);
    const difAbs = parseFloat(productoDiv.dataset.diferencia);
    const filasContainer = document.getElementById(`asig-filas-${productoId}`);
    const inputs = filasContainer.querySelectorAll('.input-asignacion');

    // Si se modifico un input, limitar su valor al maximo permitido
    if (inputActual) {
        let sumaOtros = 0;
        inputs.forEach(inp => {
            if (inp !== inputActual) {
                const val = parseFloat(inp.value);
                if (!isNaN(val) && val > 0) sumaOtros += val;
            }
        });
        const maxPermitido = Math.max(0, difAbs - sumaOtros);
        const valActual = parseFloat(inputActual.value);
        if (!isNaN(valActual) && valActual > maxPermitido) {
            inputActual.value = parseFloat(maxPermitido.toFixed(3));
            showToast(`Maximo permitido: ${maxPermitido.toFixed(3)}`, 'warning');
        }
    }

    let total = 0;
    inputs.forEach(inp => {
        const val = parseFloat(inp.value);
        if (!isNaN(val)) total += val;
    });

    const totalSpan = document.getElementById(`asig-total-${productoId}`);
    if (totalSpan) totalSpan.textContent = total.toFixed(3);

    // Actualizar status en el header
    const statusSpan = productoDiv.querySelector('.asig-status');
    const esCompleto = Math.abs(total - difAbs) < 0.001;

    if (total === 0) {
        statusSpan.className = 'asig-status pendiente';
        statusSpan.textContent = 'Sin asignar';
    } else if (esCompleto) {
        statusSpan.className = 'asig-status completo';
        statusSpan.textContent = 'Completo';
    } else {
        statusSpan.className = 'asig-status parcial';
        statusSpan.textContent = `${total.toFixed(1)}/${difAbs.toFixed(1)}`;
    }

    // Actualizar valor monetario y descuento por fila
    const costoUnit = parseFloat(productoDiv.dataset.costo) || 0;
    const valorSpan = document.getElementById(`asig-valor-${productoId}`);
    if (valorSpan && costoUnit > 0) {
        valorSpan.textContent = `Valor: $${(total * costoUnit).toFixed(2)}`;
    }

    // Recalcular descuento en cada fila
    if (costoUnit > 0) {
        const filas = filasContainer.querySelectorAll('.asig-fila');
        filas.forEach(fila => {
            const cantInput = fila.querySelector('.input-asignacion');
            const descSpan = fila.querySelector('.fila-descuento');
            if (cantInput && descSpan) {
                const cant = parseFloat(cantInput.value) || 0;
                descSpan.textContent = `$${(cant * costoUnit).toFixed(2)}`;
            }
        });
    }

    // Actualizar max en todos los inputs
    inputs.forEach(inp => {
        let sumaOtros = 0;
        inputs.forEach(other => {
            if (other !== inp) {
                const v = parseFloat(other.value);
                if (!isNaN(v) && v > 0) sumaOtros += v;
            }
        });
        inp.max = Math.max(0, difAbs - sumaOtros).toFixed(3);
    });
}

async function guardarAsignacionProducto(productoId) {
    const productoDiv = document.querySelector(`.asig-producto[data-id="${productoId}"]`);
    const difAbs = parseFloat(productoDiv.dataset.diferencia);
    const filasContainer = document.getElementById(`asig-filas-${productoId}`);
    const filas = filasContainer.querySelectorAll('.asig-fila');
    const asignaciones = [];

    for (const fila of filas) {
        const persona = fila.querySelector('.input-persona').value.trim();
        const cantidad = parseFloat(fila.querySelector('.input-asignacion').value);
        if (persona && !isNaN(cantidad) && cantidad > 0) {
            // Validar que la persona exista en la lista
            if (!state.personas.includes(persona)) {
                showToast(`"${persona}" no esta en la lista de personal`, 'error');
                return;
            }
            asignaciones.push({ persona, cantidad });
        }
    }

    // Verificar que este completo
    const totalAsignado = asignaciones.reduce((sum, a) => sum + a.cantidad, 0);
    if (Math.abs(totalAsignado - difAbs) > 0.001) {
        showToast(`Debe asignar exactamente ${difAbs.toFixed(3)}. Asignado: ${totalAsignado.toFixed(3)}`, 'error');
        return;
    }

    // Verificar duplicados de persona
    const personas = asignaciones.map(a => a.persona);
    const duplicados = personas.filter((p, i) => personas.indexOf(p) !== i);
    if (duplicados.length > 0) {
        showToast(`Persona duplicada: ${duplicados[0]}`, 'error');
        return;
    }

    try {
        const btn = filasContainer.parentElement.querySelector('.btn-guardar-asig');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
        }

        const response = await fetch(`${CONFIG.API_URL}/api/inventario/guardar-asignaciones`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conteo_id: productoId, asignaciones })
        });

        if (response.ok) {
            // Actualizar estado local
            state.asignaciones[String(productoId)] = asignaciones;
            showToast('Asignacion guardada', 'success');

            if (btn) {
                btn.innerHTML = '<i class="fas fa-check"></i> Guardado';
                setTimeout(() => {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-save"></i> Guardar';
                }, 1500);
            }
        } else {
            showToast('Error al guardar asignacion', 'error');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-save"></i> Guardar';
            }
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('Error de conexion', 'error');
    }
}

async function guardarTodasAsignaciones() {
    const productoDivs = document.querySelectorAll('.asig-producto');
    if (productoDivs.length === 0) return;

    const btn = document.querySelector('.btn-guardar-todas-asig');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando todo...';
    }

    let guardados = 0;
    let errores = 0;

    for (const div of productoDivs) {
        const productoId = parseInt(div.dataset.id);
        const difAbs = parseFloat(div.dataset.diferencia);
        const filasContainer = document.getElementById(`asig-filas-${productoId}`);
        if (!filasContainer) continue;

        const filas = filasContainer.querySelectorAll('.asig-fila');
        const asignaciones = [];
        for (const fila of filas) {
            const persona = fila.querySelector('.input-persona').value.trim();
            const cantidad = parseFloat(fila.querySelector('.input-asignacion').value);
            if (persona && !isNaN(cantidad) && cantidad > 0) {
                asignaciones.push({ persona, cantidad });
            }
        }

        if (asignaciones.length === 0) continue;

        // Verificar que este completo
        const totalAsignado = asignaciones.reduce((sum, a) => sum + a.cantidad, 0);
        if (Math.abs(totalAsignado - difAbs) > 0.001) {
            errores++;
            continue;
        }

        try {
            const response = await fetch(`${CONFIG.API_URL}/api/inventario/guardar-asignaciones`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conteo_id: productoId, asignaciones })
            });
            if (response.ok) {
                state.asignaciones[String(productoId)] = asignaciones;
                guardados++;
            } else {
                errores++;
            }
        } catch (error) {
            errores++;
        }
    }

    if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Guardar Todas las Asignaciones';
    }

    if (errores === 0 && guardados > 0) {
        showToast(`${guardados} asignaciones guardadas correctamente`, 'success');
    } else if (errores > 0) {
        showToast(`${errores} errores al guardar`, 'error');
    } else {
        showToast('No hay asignaciones para guardar', 'info');
    }
}

// ==================== GUARDAR CONTEO POR ETAPA ====================

// Guardar todos los inputs visibles (para celulares donde onchange no dispara bien)
async function guardarTodosLosConteos() {
    const inputs = document.querySelectorAll('.input-contado');
    const promesas = [];

    for (const input of inputs) {
        const id = parseInt(input.dataset.id);
        const conteoNum = parseInt(input.dataset.conteo) || 1;
        const cantidad = input.value !== '' ? parseFloat(input.value) : null;

        // Verificar si el valor cambio
        const prod = state.productos.find(p => p.id === id);
        if (prod) {
            const valorActual = conteoNum === 2 ? prod.cantidad_contada_2 : prod.cantidad_contada;
            if (valorActual !== cantidad) {
                promesas.push(
                    fetch(`${CONFIG.API_URL}/api/inventario/guardar-conteo`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id, cantidad_contada: cantidad, conteo: conteoNum, usuario: state.user ? state.user.username : '' })
                    }).then(response => {
                        if (response.ok && prod) {
                            if (conteoNum === 2) {
                                prod.cantidad_contada_2 = cantidad;
                            } else {
                                prod.cantidad_contada = cantidad;
                            }
                        }
                    }).catch(err => console.error('Error guardando:', err))
                );
            }
        }
    }

    if (promesas.length > 0) {
        await Promise.all(promesas).catch(err => {
            console.error('Error guardando conteos:', err);
            showToast('Error al guardar algunos conteos', 'error');
        });
    }
}

async function guardarConteoEtapa() {
    if (!_puede('conteo', 'editar')) { showToast('No tienes permiso para contar', 'error'); return; }
    // Primero guardar todos los inputs pendientes (importante para celulares)
    await guardarTodosLosConteos();

    if (state.etapaConteo === 1) {
        // Verificar que TODOS los productos tengan conteo
        const productosSinConteo = state.productos.filter(p =>
            p.cantidad_contada === null || p.cantidad_contada === undefined || p.cantidad_contada === ''
        );

        if (productosSinConteo.length > 0) {
            showToast(`Faltan ${productosSinConteo.length} productos por contar. Ingresa un valor (puede ser 0)`, 'error');
            // Resaltar el primer producto sin conteo
            const primerSinConteo = document.querySelector(`input[data-codigo="${productosSinConteo[0].codigo}"]`);
            if (primerSinConteo) {
                primerSinConteo.focus();
                primerSinConteo.classList.add('error');
                setTimeout(() => primerSinConteo.classList.remove('error'), 2000);
            }
            return;
        }

        const productosConConteo = state.productos.filter(p => p.cantidad_contada !== null);

        // Calcular diferencias
        state.productosFallidos = [];
        productosConConteo.forEach(p => {
            if (p.cantidad_contada !== p.cantidad_sistema) {
                state.productosFallidos.push(p.codigo);
            }
        });

        if (state.productosFallidos.length === 0) {
            // Todo bien! Pasar a etapa 3 directamente
            state.etapaConteo = 3;
            showToast('¡Excelente! Todos los productos coinciden con el sistema', 'success');
        } else {
            // Hay diferencias, pasar a etapa 2
            // Auto-llenar conteo 2 para productos que coinciden con el sistema
            const fecha = document.getElementById('fecha-conteo').value;
            const local = document.getElementById('bodega-select').value;
            try {
                const resp = await fetch(`${CONFIG.API_URL}/api/inventario/autofill-conteo2`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fecha, local })
                });
                const result = await resp.json();
                if (result.success && result.actualizados > 0) {
                    // Actualizar estado local: copiar conteo1 a conteo2 donde coinciden
                    state.productos.forEach(p => {
                        if (p.cantidad_contada !== null && p.cantidad_contada === p.cantidad_sistema && p.cantidad_contada_2 === null) {
                            p.cantidad_contada_2 = p.cantidad_contada;
                        }
                    });
                    console.log(`Auto-fill conteo 2: ${result.actualizados} productos`);
                }
            } catch (e) {
                console.error('Error en autofill conteo2:', e);
            }
            state.etapaConteo = 2;
            showToast(`⚠️ ${state.productosFallidos.length} productos tienen diferencias. Realiza el segundo conteo.`, 'warning');
        }

        renderProductosInventario();

    } else if (state.etapaConteo === 2) {
        // Verificar que todos los fallidos tengan conteo 2
        const faltantes = state.productos.filter(p =>
            state.productosFallidos.includes(p.codigo) &&
            (p.cantidad_contada_2 === null || p.cantidad_contada_2 === undefined)
        );

        if (faltantes.length > 0) {
            showToast(`Faltan ${faltantes.length} productos por contar`, 'error');
            return;
        }

        // Finalizar conteo
        state.etapaConteo = 3;
        const fecha3 = document.getElementById('fecha-conteo').value;
        const local3 = document.getElementById('bodega-select').value;
        await Promise.all([cargarAsignaciones(fecha3, local3), cargarPersonas()]);
        showToast('Conteo finalizado. Mostrando diferencias.', 'success');
        renderProductosInventario();
    }
}

function renderProductosVacio() {
    const container = document.getElementById('productos-list');
    container.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-inbox"></i>
            <p>No hay productos para mostrar</p>
        </div>
    `;
    document.getElementById('productos-total').textContent = '0';
    document.getElementById('productos-contados').textContent = '0';
    const obsContainer = document.getElementById('observaciones-container');
    if (obsContainer) obsContainer.innerHTML = '';
    const asigContainer = document.getElementById('asignaciones-container');
    if (asigContainer) asigContainer.innerHTML = '';
}

function renderProductosVacioOperativo(bodega, fecha) {
    const NOMBRES = {bodega_principal:'Bodega Principal', materia_prima:'Materia Prima', planta:'Planta de Produccion'};
    const container = document.getElementById('productos-list');
    container.innerHTML = `
        <div class="empty-state" style="padding:40px;">
            <i class="fas fa-dice" style="font-size:40px; color:var(--primary); margin-bottom:12px;"></i>
            <p style="margin-bottom:16px;">No hay productos cargados para <b>${NOMBRES[bodega] || bodega}</b> en esta fecha.</p>
            <button class="btn-obs-cargar" style="background:var(--primary);" onclick="generarConteoOperativo('${bodega}', '${fecha}')">
                <i class="fas fa-random"></i> Generar 10 productos aleatorios
            </button>
            <p style="margin-top:8px; font-size:12px; color:var(--text-light);">Se seleccionaran 10 productos al azar del catalogo de Contifico</p>
        </div>
    `;
    document.getElementById('productos-total').textContent = '0';
    document.getElementById('productos-contados').textContent = '0';
}

let _conteoOpPollHandle = null;

async function generarConteoOperativo(bodega, fecha) {
    const container = document.getElementById('productos-list');
    container.innerHTML = `
        <div style="text-align:center; padding:30px;">
            <i class="fas fa-spinner fa-spin" style="font-size:28px; color:var(--primary);"></i>
            <p style="margin-top:12px; font-weight:600;" id="conteo-op-msg">Solicitando descarga de Contifico...</p>
            <p style="font-size:12px; color:var(--text-light);">El worker en PC FINANZAS descargara el stock actual</p>
        </div>`;

    try {
        const r = await fetch(`${CONFIG.API_URL}/api/inventario/generar-conteo-operativo`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ bodega, fecha })
        });
        const data = await r.json();

        if (r.status === 409) {
            showToast(data.error || 'Ya existen productos para esta fecha', 'warning');
            document.getElementById('btn-consultar').click();
            return;
        }
        if (!r.ok) throw new Error(data.error || 'Error generando');

        // Polling para esperar al worker
        const msgEl = document.getElementById('conteo-op-msg');
        if (msgEl) msgEl.textContent = `Tarea creada (id ${data.id}). Esperando worker...`;
        conteoOpPollEstado(data.id);
    } catch(e) {
        showToast('Error: ' + e.message, 'error');
        renderProductosVacioOperativo(bodega, fecha);
    }
}

function conteoOpPollEstado(ejecId) {
    let intentos = 0;
    if (_conteoOpPollHandle) clearInterval(_conteoOpPollHandle);

    _conteoOpPollHandle = setInterval(async () => {
        intentos++;
        const msgEl = document.getElementById('conteo-op-msg');
        try {
            const r = await fetch(`${CONFIG.API_URL}/api/conteo-op/estado/${ejecId}`);
            const d = await r.json();

            if (d.estado === 'pendiente') {
                if (msgEl) msgEl.textContent = `Esperando worker... (${intentos * 5}s)`;
            } else if (d.estado === 'en_proceso') {
                if (msgEl) msgEl.textContent = `Worker descargando stock de Contifico...`;
            } else if (d.estado === 'completado') {
                clearInterval(_conteoOpPollHandle);
                showToast(`Conteo generado: ${d.fijos || 0} fijos + ${d.aleatorios || 0} aleatorios`, 'success');
                document.getElementById('btn-consultar').click();
            } else if (d.estado === 'error') {
                clearInterval(_conteoOpPollHandle);
                showToast('Error: ' + (d.error_msg || 'desconocido'), 'error');
                const bodega = document.getElementById('bodega-select').value;
                const fecha = document.getElementById('fecha-conteo').value;
                renderProductosVacioOperativo(bodega, fecha);
            }

            if (intentos > 120) {
                clearInterval(_conteoOpPollHandle);
                if (msgEl) msgEl.textContent = 'Tiempo excedido. Verifica que el worker este corriendo.';
            }
        } catch(e) { console.error('poll conteo-op error:', e); }
    }, 5000);
}

// ==================== PRODUCTOS ====================

async function cargarProductos() {
    const bodega = document.getElementById('bodega-select').value;

    if (!bodega) {
        showToast('Selecciona una bodega', 'error');
        return;
    }

    try {
        const response = await fetch(`${CONFIG.API_URL}/api/productos`);
        if (response.ok) {
            state.productos = await response.json();
            renderProductos();
            showToast(`${state.productos.length} productos cargados`, 'success');
        }
    } catch (error) {
        console.error('Error cargando productos:', error);
        showToast('Error al cargar productos', 'error');
    }
}

function renderProductos() {
    const container = document.getElementById('productos-list');
    const totalSpan = document.getElementById('productos-total');

    if (state.productos.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-box-open"></i>
                <p>No hay productos disponibles</p>
            </div>
        `;
        totalSpan.textContent = '0';
        return;
    }

    container.innerHTML = state.productos.map(prod => {
        const conteo = state.conteos[prod.codigo] || null;
        const contado = conteo !== null;

        return `
            <div class="producto-card ${contado ? 'contado' : ''}"
                 onclick="abrirModalCantidad('${escapeHtml(prod.codigo)}', '${escapeHtml(prod.nombre)}')">
                <div class="producto-nombre">${escapeHtml(prod.nombre)}</div>
                <div class="producto-codigo">${escapeHtml(prod.codigo)}</div>
                <div class="producto-cantidad">
                    <div>
                        <div class="cantidad-valor">${contado ? conteo : '-'}</div>
                        <div class="cantidad-label">${contado ? 'Contado' : 'Sin contar'}</div>
                    </div>
                    <i class="fas fa-${contado ? 'check-circle' : 'edit'}"></i>
                </div>
            </div>
        `;
    }).join('');

    totalSpan.textContent = state.productos.length;
    actualizarContador();
}

function filtrarProductos() {
    const busqueda = document.getElementById('buscar-producto').value.toLowerCase();
    const rows = document.querySelectorAll('.tabla-inventario tbody tr');

    rows.forEach(row => {
        const codigo = row.querySelector('.col-codigo')?.textContent.toLowerCase() || '';
        const nombre = row.querySelector('.col-nombre')?.textContent.toLowerCase() || '';
        const visible = codigo.includes(busqueda) || nombre.includes(busqueda);
        row.style.display = visible ? '' : 'none';
    });
}

function actualizarContador() {
    const contados = state.productos.filter(p => p.cantidad_contada !== null).length;
    document.getElementById('productos-contados').textContent = contados;
}

// ==================== MODAL CANTIDAD ====================

function abrirModalCantidad(codigo, nombre) {
    state.productoSeleccionado = { codigo, nombre };

    document.getElementById('modal-producto-nombre').textContent = nombre;
    document.getElementById('modal-producto-codigo').textContent = `Codigo: ${codigo}`;

    const cantidadActual = state.conteos[codigo] || 0;
    document.getElementById('modal-cantidad-input').value = cantidadActual;

    document.getElementById('modal-cantidad').classList.remove('hidden');
    document.getElementById('modal-cantidad-input').focus();
    document.getElementById('modal-cantidad-input').select();
}

function cerrarModal() {
    document.getElementById('modal-cantidad').classList.add('hidden');
    state.productoSeleccionado = null;
}

function ajustarCantidad(delta) {
    const input = document.getElementById('modal-cantidad-input');
    let valor = parseFloat(input.value) || 0;
    valor = Math.max(0, valor + delta);
    input.value = valor;
}

async function guardarCantidad() {
    const cantidad = parseFloat(document.getElementById('modal-cantidad-input').value) || 0;
    const { id, codigo } = state.productoSeleccionado;

    if (id) {
        try {
            const response = await fetch(`${CONFIG.API_URL}/api/inventario/guardar-conteo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, cantidad_contada: cantidad, usuario: state.user ? state.user.username : '' })
            });

            if (response.ok) {
                const prod = state.productos.find(p => p.id === id);
                if (prod) {
                    prod.cantidad_contada = cantidad;
                }
                state.conteos[codigo] = cantidad;
                renderProductosInventario();
                cerrarModal();
                showToast('Conteo guardado', 'success');
            } else {
                showToast('Error al guardar', 'error');
            }
        } catch (error) {
            console.error('Error guardando conteo:', error);
            showToast('Error de conexion', 'error');
        }
    } else {
        state.conteos[codigo] = cantidad;
        renderProductos();
        cerrarModal();
        showToast('Cantidad registrada', 'success');
    }
}

// Cerrar modal con Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        cerrarModal();
    }
    if (e.key === 'Enter' && state.productoSeleccionado) {
        guardarCantidad();
    }
});

// ==================== HISTORICO ====================

let _histPivotModo = 'cantidad'; // 'cantidad' | 'valor'
let _histPivotCache = null;
let _histFiltroProducto = '';
let _histFiltroProductoRaw = '';
let _histFiltroPersona = '';
let _histModoDescuento = ''; // '' | 'neto' | 'ajustado'
let _histFiltroTimer = null;

function _setHistModo(modo) {
    _histPivotModo = modo;
    if (_histPivotCache) _renderHistPivot(_histPivotCache);
}

function _setHistFiltro(q) {
    _histFiltroProductoRaw = q;
    _histFiltroProducto = q.toLowerCase().trim();
    clearTimeout(_histFiltroTimer);
    _histFiltroTimer = setTimeout(() => {
        if (_histPivotCache) _renderHistPivot(_histPivotCache);
    }, 350);
}

function _setHistFiltroPersona(p) {
    _histFiltroPersona = p;
    if (_histPivotCache) _renderHistPivot(_histPivotCache);
}

function _setHistModoDescuento(m) {
    _histModoDescuento = m;
    if (_histPivotCache) _renderHistPivot(_histPivotCache);
}

async function buscarHistorico() {
    const fechaDesde = document.getElementById('fecha-desde').value;
    const fechaHasta = document.getElementById('fecha-hasta').value;
    const bodega = document.getElementById('filtro-bodega').value;
    const container = document.getElementById('historico-list');

    if (!fechaDesde || !fechaHasta) {
        showToast('Selecciona las fechas desde y hasta', 'error');
        return;
    }
    if (!bodega) {
        showToast('Selecciona una bodega', 'error');
        return;
    }

    container.innerHTML = `<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Cargando...</p></div>`;

    try {
        _histFiltroProducto = '';
        _histFiltroProductoRaw = '';
        _histFiltroPersona = '';
        // ---- Vista PIVOTE por bodega ----
        const url = `${CONFIG.API_URL}/api/historico/pivot?fecha_desde=${fechaDesde}&fecha_hasta=${fechaHasta}&bodega=${bodega}`;
        const resp = await fetch(url);
        const data = await resp.json();
        if (data.error) { showToast(data.error, 'error'); return; }
        _histPivotCache = data;
        _renderHistPivot(data);
    } catch (error) {
        console.error('Error buscando historico:', error);
        showToast('Error al buscar historico', 'error');
    }
}

function exportarHistoricoExcel() {
    const fechaDesde = document.getElementById('fecha-desde').value;
    const fechaHasta = document.getElementById('fecha-hasta').value;
    const bodega = document.getElementById('filtro-bodega').value;
    if (!fechaDesde || !fechaHasta) { showToast('Selecciona las fechas', 'error'); return; }
    if (!bodega) { showToast('Selecciona una bodega', 'error'); return; }
    const url = `${CONFIG.API_URL}/api/reportes/exportar-excel?fecha_desde=${fechaDesde}&fecha_hasta=${fechaHasta}&bodega=${bodega}`;
    window.open(url, '_blank');
}

function _fmtContadores(contadores) {
    if (!contadores || !contadores.length) return '<span style="color:#94A3B8;font-size:10px;">Sin registrar</span>';
    return contadores.map(c => {
        const tipo = contadores.length > 1 ? ` <span style="opacity:0.7;font-size:9px;">(${c.tipo})</span>` : '';
        const hora = c.hora_inicio ? `<br><span style="font-size:9px;color:#94A3B8;">${c.hora_inicio}${c.hora_fin && c.hora_fin !== c.hora_inicio ? ' - ' + c.hora_fin : ''}</span>` : '';
        return `<span style="font-size:10px;">👤 ${escapeHtml(c.nombre || 'Sin nombre')}${tipo}${hora}</span>`;
    }).join('<br>');
}

function _renderHistPivot(data) {
    const container = document.getElementById('historico-list');
    const { fechas, productos } = data;

    if (!productos.length) {
        container.innerHTML = `<div class="empty-state"><i class="fas fa-search"></i><p>No se encontraron registros</p></div>`;
        return;
    }

    const esValor = _histPivotModo === 'valor';
    const fmtF = f => { const p = f.split('-'); return `${p[2]}/${p[1]}`; };
    const fmtDif = (d, cu) => {
        if (d === null || d === undefined) return null;
        if (esValor) return d * (cu || 0);
        return d;
    };

    // Filtrar por producto y/o persona
    let productosFiltrados = productos;
    if (_histFiltroProducto) {
        productosFiltrados = productosFiltrados.filter(p =>
            p.codigo.toLowerCase().includes(_histFiltroProducto) ||
            p.nombre.toLowerCase().includes(_histFiltroProducto));
    }
    if (_histFiltroPersona) {
        productosFiltrados = productosFiltrados.filter(p =>
            p.personas && p.personas.includes(_histFiltroPersona));
    }

    // Ordenar: primero productos con al menos una diferencia
    const prods = [...productosFiltrados].sort((a, b) => {
        const aDif = Object.values(a.porFecha).some(v => v.diferencia !== null && v.diferencia !== 0);
        const bDif = Object.values(b.porFecha).some(v => v.diferencia !== null && v.diferencia !== 0);
        if (aDif && !bDif) return -1;
        if (!aDif && bDif) return 1;
        return a.codigo.localeCompare(b.codigo);
    });

    // Totales por fecha
    const totPorFecha = {};
    fechas.forEach(f => { totPorFecha[f] = 0; });
    let totGeneral = 0;

    let rows = '';
    let totGeneralAbsSum = 0;
    for (const prod of prods) {
        let totProd = 0;
        let totProdAbsSum = 0;
        let tieneDif = false;
        let celdas = '';
        for (const f of fechas) {
            const v = prod.porFecha[f];
            if (!v || v.contado === null) {
                celdas += `<td class="hpiv-empty">—</td>`;
            } else {
                const val = fmtDif(v.diferencia, v.costo_unitario);
                totPorFecha[f] += val;
                totProd += val;
                totProdAbsSum += Math.abs(val);
                totGeneral += val;
                if (val !== 0) tieneDif = true;
                const cls = val < 0 ? 'hpiv-neg' : val > 0 ? 'hpiv-pos' : 'hpiv-cero';
                const txt = esValor
                    ? (val === 0 ? '✓' : `$${val.toFixed(2)}`)
                    : (val === 0 ? '✓' : val.toFixed(2));
                celdas += `<td class="hpiv-val ${cls}">${txt}</td>`;
            }
        }

        // Total Dif. según modo descuento (aplica a cantidad Y valor)
        let totProdShow;
        if (_histModoDescuento === 'ajustado') {
            totProdShow = Math.abs(totProd);        // ABS(SUM) — se compensan (+1-1 = 0)
        } else {
            // Normal y Neto: suma de absolutos (todo descuadre cuenta)
            totProdShow = totProdAbsSum;
        }
        totGeneralAbsSum += totProdAbsSum;

        const rowCls = tieneDif ? 'hpiv-row-dif' : '';
        const totTxt = esValor
            ? (totProdShow === 0 ? '✓' : `$${totProdShow.toFixed(2)}`)
            : (totProdShow === 0 ? '✓' : totProdShow.toFixed(2));
        const totCls = totProdShow < 0 ? 'hpiv-neg' : totProdShow > 0 ? 'hpiv-pos' : 'hpiv-cero';

        rows += `<tr class="${rowCls}">
            <td><code class="hpiv-codigo">${escapeHtml(prod.codigo)}</code></td>
            <td class="hpiv-nombre">${escapeHtml(prod.nombre)}</td>
            <td class="hpiv-unid">${escapeHtml(prod.unidad)}</td>
            ${celdas}
            <td class="hpiv-rowtot ${totCls}">${totTxt}</td>
        </tr>`;
    }

    // Fila total
    const totFechasCells = fechas.map(f => {
        const v = totPorFecha[f];
        const cls = v < 0 ? 'hpiv-neg' : v > 0 ? 'hpiv-pos' : '';
        const txt = esValor ? (v === 0 ? '' : `$${v.toFixed(2)}`) : (v === 0 ? '' : v.toFixed(2));
        return `<td class="${cls}" style="font-weight:700;">${txt}</td>`;
    }).join('');
    let totGeneralShow;
    if (_histModoDescuento === 'ajustado') {
        totGeneralShow = Math.abs(totGeneral);       // ABS(SUM)
    } else {
        // Normal y Neto: suma de absolutos
        totGeneralShow = totGeneralAbsSum;
    }
    const totGenTxt = esValor
        ? `$${totGeneralShow.toFixed(2)}`
        : totGeneralShow.toFixed(2);

    const conDif = prods.filter(p => Object.values(p.porFecha).some(v => v.diferencia !== null && v.diferencia !== 0)).length;

    const personasDisponibles = data.personas || [];
    const hayFiltro = _histFiltroProducto || _histFiltroPersona;
    const personaOpts = personasDisponibles.map(p =>
        `<option value="${escapeHtml(p)}" ${_histFiltroPersona === p ? 'selected' : ''}>${escapeHtml(p)}</option>`
    ).join('');

    container.innerHTML = `
    <div style="grid-column:1/-1;">
    <div class="baja-pivot-toolbar" style="flex-wrap:wrap;gap:10px;">
        <span class="baja-pivot-info">${prods.length}${hayFiltro ? ' (filtrado)' : ''} de ${productos.length} productos · ${fechas.length} fecha(s) · <span style="color:#D97706;font-weight:600;">${conDif} con diferencia</span></span>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <div style="position:relative;display:flex;align-items:center;">
                <i class="fas fa-search" style="position:absolute;left:10px;color:#94A3B8;font-size:12px;pointer-events:none;"></i>
                <input type="text" id="hist-buscar-producto"
                    placeholder="Buscar producto..."
                    value="${escapeHtml(_histFiltroProductoRaw)}"
                    oninput="_setHistFiltro(this.value)"
                    style="height:32px;padding:0 10px 0 30px;border:1px solid rgba(203,213,225,0.7);border-radius:8px;font-size:13px;font-family:inherit;background:#F8FAFC;color:#123450;outline:none;width:170px;">
            </div>
            ${personasDisponibles.length ? `
            <div style="position:relative;display:flex;align-items:center;">
                <i class="fas fa-user" style="position:absolute;left:10px;color:#94A3B8;font-size:12px;pointer-events:none;"></i>
                <select onchange="_setHistFiltroPersona(this.value)"
                    style="height:32px;padding:0 10px 0 30px;border:1px solid rgba(203,213,225,0.7);border-radius:8px;font-size:13px;font-family:inherit;background:#F8FAFC;color:#123450;outline:none;cursor:pointer;min-width:160px;appearance:none;">
                    <option value="">Todas las personas</option>
                    ${personaOpts}
                </select>
            </div>` : ''}
            <div class="baja-pivot-toggle">
                <button class="baja-toggle-btn ${!esValor ? 'active' : ''}" onclick="_setHistModo('cantidad')">
                    <i class="fas fa-cubes"></i> Cantidad
                </button>
                <button class="baja-toggle-btn ${esValor ? 'active' : ''}" onclick="_setHistModo('valor')">
                    <i class="fas fa-dollar-sign"></i> Valor
                </button>
            </div>
            <div class="baja-pivot-toggle">
                <button class="baja-toggle-btn ${_histModoDescuento==='' ? 'active' : ''}" onclick="_setHistModoDescuento('')" title="Muestra diferencias reales con signo (+/-)">
                    <i class="fas fa-arrows-alt-h"></i> Normal
                </button>
                <button class="baja-toggle-btn ${_histModoDescuento==='neto' ? 'active' : ''}" onclick="_setHistModoDescuento('neto')" title="ABS(SUM): neta primero, luego descuenta">
                    Valor Neto
                </button>
                <button class="baja-toggle-btn ${_histModoDescuento==='ajustado' ? 'active' : ''}" onclick="_setHistModoDescuento('ajustado')" title="SUM(ABS): cada diferencia siempre suma al descuento">
                    Valor Ajustado
                </button>
            </div>
        </div>
    </div>
    <div style="overflow-x:auto;">
    <table class="tabla-bajas-pivot tabla-hist-pivot">
        <thead>
            <tr>
                <th class="bpiv-cod">Código</th>
                <th class="bpiv-nom">Producto</th>
                <th class="bpiv-uni">Unid.</th>
                ${fechas.map(f => {
                    const cInfo = (data.contadores || {})[f];
                    const contHtml = _fmtContadores(cInfo);
                    return `<th class="bpiv-fecha">${fmtF(f)}<br>${contHtml}</th>`;
                }).join('')}
                <th class="bpiv-tot">Total Dif.</th>
            </tr>
        </thead>
        <tbody>${rows}
            <tr class="bpiv-row-total">
                <td colspan="3">TOTAL DIFERENCIA</td>
                ${totFechasCells}
                <td>${totGenTxt}</td>
            </tr>
        </tbody>
    </table>
    </div>
    <div style="margin-top:10px;font-size:11px;display:flex;gap:16px;color:#64748b;flex-wrap:wrap;">
        <span><span style="background:#FEE2E2;padding:1px 8px;border-radius:3px;">rojo</span> = falta producto (negativo)</span>
        <span><span style="background:#FEF3C7;padding:1px 8px;border-radius:3px;">naranja</span> = sobra producto (positivo)</span>
        <span><span style="color:#059669;">✓</span> = sin diferencia</span>
    </div>
    </div>`;
}

function formatearFecha(fechaStr) {
    if (!fechaStr) return '';
    const [y, m, d] = fechaStr.split('-');
    return `${d}/${m}/${y}`;
}

// ==================== REPORTES ====================

async function verDiferencias() {
    const fecha = document.getElementById('reporte-fecha-desde').value;
    const bodega = document.getElementById('reporte-bodega').value;

    if (!fecha) {
        showToast('Selecciona una fecha (Desde) para ver diferencias', 'error');
        return;
    }

    const getNombreBodega = (id) => {
        const b = CONFIG.BODEGAS.find(b => b.id === id);
        return b ? b.nombre : id;
    };

    const mostrarTodas = !bodega;

    try {
        let url = `${CONFIG.API_URL}/api/reportes/diferencias?fecha=${fecha}`;
        if (bodega) url += `&bodega=${bodega}`;

        const response = await fetch(url);
        if (response.ok) {
            const datos = await response.json();
            const panel = document.getElementById('reporte-resultado');
            const titulo = document.getElementById('reporte-titulo');
            const contenido = document.getElementById('reporte-contenido');

            titulo.textContent = mostrarTodas
                ? `Diferencias - Todas las Bodegas - ${formatearFecha(fecha)}`
                : `Diferencias - ${getNombreBodega(bodega)} - ${formatearFecha(fecha)}`;

            if (datos.length === 0) {
                contenido.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-check-circle"></i>
                        <p>No hay productos con diferencias para esta fecha${mostrarTodas ? '' : ' y bodega'}</p>
                    </div>
                `;
            } else {
                contenido.innerHTML = `
                    <div class="tabla-reporte-wrapper">
                        <table class="tabla-reporte">
                            <thead>
                                <tr>
                                    ${mostrarTodas ? '<th>Bodega</th>' : ''}
                                    <th>Codigo</th>
                                    <th>Producto</th>
                                    <th>Unidad</th>
                                    <th>Sistema</th>
                                    <th>Conteo 1</th>
                                    <th>Conteo 2</th>
                                    <th>Diferencia</th>
                                    <th>Motivo</th>
                                    <th>Observacion</th>
                                    <th>Corregido</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${datos.map(p => {
                                    const difClass = p.diferencia < 0 ? 'negativa' : 'positiva';
                                    const corregidoClass = p.corregido ? 'corregido-si' : 'corregido-no';
                                    return `
                                        <tr>
                                            ${mostrarTodas ? `<td><strong>${p.local_nombre || p.local}</strong></td>` : ''}
                                            <td class="col-codigo">${p.codigo}</td>
                                            <td>${p.nombre}</td>
                                            <td>${p.unidad || '-'}</td>
                                            <td class="text-center">${p.sistema}</td>
                                            <td class="text-center">${p.conteo1 !== null ? p.conteo1 : '-'}</td>
                                            <td class="text-center">${p.conteo2 !== null ? p.conteo2 : '-'}</td>
                                            <td class="col-diferencia ${difClass}">${p.diferencia > 0 ? '+' : ''}${p.diferencia.toFixed(3)}</td>
                                            <td class="col-obs">${p.motivo || '-'}</td>
                                            <td class="col-obs">${p.observaciones || '-'}</td>
                                            <td class="text-center"><span class="badge-corregido ${corregidoClass}">${p.corregido ? 'Sí' : 'No'}</span></td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                    <div class="reporte-resumen">
                        <span><strong>${datos.length}</strong> productos con diferencias</span>
                    </div>
                `;
            }

            panel.classList.remove('hidden');
            panel.scrollIntoView({ behavior: 'smooth' });
        }
    } catch (error) {
        console.error('Error cargando diferencias:', error);
        showToast('Error al cargar reporte de diferencias', 'error');
    }
}

async function exportarExcel() {
    const fechaDesde = document.getElementById('reporte-fecha-desde').value;
    const fechaHasta = document.getElementById('reporte-fecha-hasta').value;
    const bodega = document.getElementById('reporte-bodega').value;

    if (!fechaDesde || !fechaHasta) {
        showToast('Selecciona las fechas desde y hasta para exportar', 'error');
        return;
    }

    try {
        let url = `${CONFIG.API_URL}/api/reportes/exportar-excel?fecha_desde=${fechaDesde}&fecha_hasta=${fechaHasta}`;
        if (bodega) url += `&bodega=${bodega}`;

        showToast('Generando archivo Excel...', 'info');

        const response = await fetch(url);
        if (response.ok) {
            const blob = await response.blob();
            const urlBlob = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = urlBlob;
            a.download = `inventario_${fechaDesde}_a_${fechaHasta}.xlsx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(urlBlob);
            showToast('Archivo Excel descargado', 'success');
        } else {
            const err = await response.json();
            showToast(err.error || 'Error al exportar', 'error');
        }
    } catch (error) {
        console.error('Error exportando Excel:', error);
        showToast('Error al descargar el archivo', 'error');
    }
}

async function verTendencias() {
    const bodega = document.getElementById('reporte-bodega').value;

    try {
        let url = `${CONFIG.API_URL}/api/reportes/tendencias?limite=20`;
        if (bodega) url += `&bodega=${bodega}`;

        const response = await fetch(url);
        if (response.ok) {
            const datos = await response.json();
            const panel = document.getElementById('reporte-resultado');
            const titulo = document.getElementById('reporte-titulo');
            const contenido = document.getElementById('reporte-contenido');

            const getNombreBodega = (id) => {
                const b = CONFIG.BODEGAS.find(b => b.id === id);
                return b ? b.nombre : id;
            };

            titulo.textContent = `Top 20 Productos con Mayor Descuadre${bodega ? ' - ' + getNombreBodega(bodega) : ''}`;

            if (datos.length === 0) {
                contenido.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-chart-line"></i>
                        <p>No hay datos de tendencias disponibles</p>
                    </div>
                `;
            } else {
                contenido.innerHTML = `
                    <div class="reporte-chart-container">
                        <canvas id="chart-tendencias-reporte"></canvas>
                    </div>
                    <div class="tabla-reporte-wrapper">
                        <table class="tabla-reporte">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Codigo</th>
                                    <th>Producto</th>
                                    <th>Frecuencia</th>
                                    <th>Prom. Desviacion</th>
                                    <th>Dif. Acumulada</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${datos.map(p => {
                                    const acumClass = p.diferencia_acumulada < 0 ? 'negativa' : p.diferencia_acumulada > 0 ? 'positiva' : '';
                                    return `
                                        <tr>
                                            <td class="text-center ranking">${p.ranking}</td>
                                            <td class="col-codigo">${p.codigo}</td>
                                            <td>${p.nombre}</td>
                                            <td class="text-center"><span class="badge-freq">${p.frecuencia}</span></td>
                                            <td class="text-center">${p.promedio_desviacion.toFixed(3)}</td>
                                            <td class="col-diferencia ${acumClass}">${p.diferencia_acumulada > 0 ? '+' : ''}${p.diferencia_acumulada.toFixed(3)}</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                `;

                // Renderizar grafico de barras horizontal en el reporte
                if (typeof Chart !== 'undefined') {
                    destroyChart('tendencias-reporte');
                    const ctxTend = document.getElementById('chart-tendencias-reporte');
                    if (ctxTend) {
                        const top10 = datos.slice(0, 10);
                        chartInstances['tendencias-reporte'] = new Chart(ctxTend, {
                            type: 'bar',
                            data: {
                                labels: top10.map(p => p.nombre.length > 20 ? p.nombre.substring(0, 20) + '...' : p.nombre),
                                datasets: [{
                                    label: 'Frecuencia de descuadre',
                                    data: top10.map(p => p.frecuencia),
                                    backgroundColor: top10.map((_, i) => CHART_COLORS_ALPHA[i % CHART_COLORS_ALPHA.length]),
                                    borderColor: top10.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
                                    borderWidth: 2
                                }]
                            },
                            options: {
                                indexAxis: 'y',
                                responsive: true,
                                maintainAspectRatio: false,
                                plugins: { legend: { display: false } },
                                scales: {
                                    x: { beginAtZero: true, grid: { color: '#F1F5F9' } },
                                    y: { grid: { display: false } }
                                }
                            }
                        });
                    }
                }
            }

            panel.classList.remove('hidden');
            panel.scrollIntoView({ behavior: 'smooth' });
        }
    } catch (error) {
        console.error('Error cargando tendencias:', error);
        showToast('Error al cargar reporte de tendencias', 'error');
    }
}

function cerrarReporte() {
    document.getElementById('reporte-resultado').classList.add('hidden');
}

// ==================== UTILIDADES ====================

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 4000);
}

// ==================== CRUCE OPERATIVO ====================

async function cargarCruceOperativo() {
    const fechaDesde = document.getElementById('cruce-fecha-desde').value;
    const fechaHasta = document.getElementById('cruce-fecha-hasta').value;
    const bodega = getCruceBodegaGlobal();

    if (!fechaDesde || !fechaHasta) {
        showToast('Selecciona las fechas desde y hasta', 'error');
        return;
    }

    try {
        let url = `${CONFIG.API_URL}/api/cruce/ejecuciones?fecha_desde=${fechaDesde}&fecha_hasta=${fechaHasta}`;
        if (bodega) url += `&bodega=${bodega}`;

        const [resEjec, resResumen] = await Promise.all([
            fetch(url),
            fetch(`${CONFIG.API_URL}/api/cruce/resumen`)
        ]);

        if (resEjec.ok) {
            state.cruceEjecuciones = await resEjec.json();
            renderCruceEjecuciones();
        } else {
            showToast('Error al cargar ejecuciones', 'error');
        }

        if (resResumen.ok) {
            const resumen = await resResumen.json();
            renderCruceResumen(resumen);
        }
    } catch (error) {
        console.error('Error cargando cruce:', error);
        showToast('Error de conexion', 'error');
    }
}

function renderCruceResumen(resumen) {
    const container = document.getElementById('cruce-resumen');
    if (!resumen || resumen.length === 0) {
        container.innerHTML = '';
        return;
    }

    const totalDif = resumen.reduce((s, r) => s + (r.total_con_diferencia || 0), 0);
    const totalValor = resumen.reduce((s, r) => s + (r.valor_total_diferencias || 0), 0);
    const totalFalt = resumen.reduce((s, r) => s + (r.faltantes || 0), 0);
    const totalSobr = resumen.reduce((s, r) => s + (r.sobrantes || 0), 0);

    container.innerHTML = `
        <div class="dashboard-stat-card">
            <div class="stat-icon" style="background:rgba(185,28,28,0.1);color:#B91C1C;"><i class="fas fa-exclamation-triangle"></i></div>
            <div class="stat-info">
                <div class="stat-valor">${totalDif}</div>
                <div class="stat-label">Con Diferencia</div>
            </div>
        </div>
        <div class="dashboard-stat-card">
            <div class="stat-icon" style="background:rgba(217,119,6,0.1);color:#D97706;"><i class="fas fa-dollar-sign"></i></div>
            <div class="stat-info">
                <div class="stat-valor">$${totalValor.toLocaleString('es-EC', {minimumFractionDigits: 2})}</div>
                <div class="stat-label">Valor Diferencias</div>
            </div>
        </div>
        <div class="dashboard-stat-card">
            <div class="stat-icon" style="background:rgba(185,28,28,0.1);color:#B91C1C;"><i class="fas fa-arrow-down"></i></div>
            <div class="stat-info">
                <div class="stat-valor">${totalFalt}</div>
                <div class="stat-label">Faltantes</div>
            </div>
        </div>
        <div class="dashboard-stat-card">
            <div class="stat-icon" style="background:rgba(5,150,105,0.1);color:#059669;"><i class="fas fa-arrow-up"></i></div>
            <div class="stat-info">
                <div class="stat-valor">${totalSobr}</div>
                <div class="stat-label">Sobrantes</div>
            </div>
        </div>
    `;
}

function renderCruceEjecuciones() {
    const container = document.getElementById('cruce-ejecuciones');
    const ejecs = state.cruceEjecuciones;

    if (!ejecs || ejecs.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-exchange-alt"></i><p>No hay cruces en el rango seleccionado</p></div>';
        return;
    }

    container.innerHTML = ejecs.map(e => {
        const estadoClass = e.estado === 'completado' ? 'cruce-estado-ok' :
                            e.estado === 'error' ? 'cruce-estado-error' : 'cruce-estado-pending';
        const estadoIcon = e.estado === 'completado' ? 'fa-check-circle' :
                           e.estado === 'error' ? 'fa-times-circle' : 'fa-clock';
        return `
            <div class="cruce-ejec-card" style="position:relative;">
                <div onclick="verCruceDetalle(${e.id})" style="cursor:pointer;">
                    <div class="cruce-ejec-info">
                        <div class="cruce-ejec-bodega">${e.bodega_nombre}</div>
                        <div class="cruce-ejec-fecha">${e.fecha_toma}</div>
                        <div class="cruce-ejec-estado ${estadoClass}">
                            <i class="fas ${estadoIcon}"></i> ${e.estado}
                        </div>
                    </div>
                    <div class="cruce-ejec-stats">
                        <div class="cruce-stat"><span class="cruce-stat-val">${e.total_productos_toma || 0}</span><span class="cruce-stat-lbl">Toma</span></div>
                        <div class="cruce-stat"><span class="cruce-stat-val">${e.total_cruzados || 0}</span><span class="cruce-stat-lbl">Cruzados</span></div>
                        <div class="cruce-stat cruce-stat-dif"><span class="cruce-stat-val">${e.total_con_diferencia || 0}</span><span class="cruce-stat-lbl">Diferencias</span></div>
                    </div>
                    ${e.error_msg ? `<div class="cruce-ejec-error">${e.error_msg}</div>` : ''}
                </div>
                <button class="btn-cruce-eliminar" title="Eliminar esta ejecucion" onclick="event.stopPropagation(); cruceEliminar(${e.id}, '${e.bodega_nombre}', '${e.fecha_toma}')">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
    }).join('');
}

async function verCruceDetalle(ejecId) {
    state.cruceDetalleId = ejecId;
    state.cruceSoloDif = false;

    const ejec = state.cruceEjecuciones.find(e => e.id === ejecId);
    const titulo = ejec ? `${ejec.bodega_nombre} - ${ejec.fecha_toma}` : 'Detalle';
    document.getElementById('cruce-detalle-titulo').textContent = titulo;

    const btn = document.getElementById('btn-cruce-solo-dif');
    if (btn) btn.classList.remove('active');

    await cargarCruceDetalleData(ejecId, false);

    document.getElementById('cruce-detalle-panel').classList.remove('hidden');
}

async function cargarCruceDetalleData(ejecId, soloDif) {
    const container = document.getElementById('cruce-detalle-contenido');
    container.innerHTML = '<div style="padding:20px;text-align:center;"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>';

    try {
        let url = `${CONFIG.API_URL}/api/cruce/detalle?ejecucion_id=${ejecId}`;
        if (soloDif) url += '&solo_diferencias=true';

        const resp = await fetch(url);
        if (!resp.ok) throw new Error('Error cargando detalle');

        const datos = await resp.json();
        renderCruceDetalle(datos);
    } catch (error) {
        container.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${error.message}</p></div>`;
    }
}

function renderCruceDetalle(datos) {
    const container = document.getElementById('cruce-detalle-contenido');

    if (!datos || datos.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle"></i><p>Sin diferencias</p></div>';
        return;
    }

    let html = `<div class="tabla-cruce-wrapper"><table class="tabla-cruce">
        <thead><tr>
            <th>Codigo</th><th>Producto</th><th>Cat.</th><th>Tipo</th>
            <th>Fisico</th><th>Sistema</th><th>Dif.</th><th>%</th><th>Valor $</th><th>Origen</th>
        </tr></thead><tbody>`;

    datos.forEach(d => {
        const dif = d.diferencia || 0;
        const pct = d.cantidad_sistema ? ((dif / d.cantidad_sistema) * 100).toFixed(1) : '-';
        const difClass = dif < 0 ? 'cruce-neg' : dif > 0 ? 'cruce-pos' : '';
        const origenClass = d.origen === 'solo_toma' ? 'cruce-solo-toma' :
                            d.origen === 'solo_contifico' ? 'cruce-solo-cont' : '';

        html += `<tr class="${origenClass}">
            <td>${escapeHtml(d.codigo)}</td>
            <td>${escapeHtml(d.nombre || '')}</td>
            <td>${d.categoria || ''}</td>
            <td>${d.tipo_abc || ''}</td>
            <td>${d.cantidad_toma != null ? d.cantidad_toma.toFixed(2) : '-'}</td>
            <td>${d.cantidad_sistema != null ? d.cantidad_sistema.toFixed(2) : '-'}</td>
            <td class="${difClass}">${dif.toFixed(2)}</td>
            <td class="${difClass}">${pct}%</td>
            <td>$${(d.valor_diferencia || 0).toFixed(2)}</td>
            <td><span class="cruce-origen-badge ${origenClass}">${d.origen}</span></td>
        </tr>`;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
}

async function cruceFiltrarSoloDiferencias() {
    state.cruceSoloDif = !state.cruceSoloDif;
    const btn = document.getElementById('btn-cruce-solo-dif');
    if (btn) btn.classList.toggle('active', state.cruceSoloDif);

    if (state.cruceDetalleId) {
        await cargarCruceDetalleData(state.cruceDetalleId, state.cruceSoloDif);
    }
}

function cruceExportarExcel() {
    if (!state.cruceDetalleId) {
        showToast('Selecciona un cruce primero', 'error');
        return;
    }
    window.open(`${CONFIG.API_URL}/api/cruce/exportar-excel?ejecucion_id=${state.cruceDetalleId}`, '_blank');
}

function cerrarCruceDetalle() {
    document.getElementById('cruce-detalle-panel').classList.add('hidden');
    state.cruceDetalleId = null;
}

// ==================== MERMA OPERATIVA ====================

let _mermaProductos = [];
let _mermaAutocompletResultados = [];

const BODEGAS_NOMBRES_MERMA = {
    'real_audiencia': 'Real Audiencia',
    'floreana': 'Floreana',
    'portugal': 'Portugal',
    'santo_cachon_real': 'S.Cachon Real',
    'santo_cachon_portugal': 'S.Cachon Portugal',
    'simon_bolon': 'Simon Bolon'
};

function cargarMermas() {
    const desde = document.getElementById('merma-fecha-desde')?.value || '';
    const hasta = document.getElementById('merma-fecha-hasta')?.value || '';
    const local = document.getElementById('merma-filtro-bodega')?.value || '';

    let url = `${CONFIG.API_URL}/api/merma?`;
    if (desde) url += `fecha_desde=${desde}&`;
    if (hasta) url += `fecha_hasta=${hasta}&`;
    if (local) url += `local=${local}`;

    fetch(url)
        .then(r => r.json())
        .then(data => {
            if (data.error) { showToast(data.error, 'error'); return; }
            renderTablaMermas(data);
        })
        .catch(() => showToast('Error al cargar mermas', 'error'));
}

function renderTablaMermas(mermas) {
    const container = document.getElementById('merma-tabla-container');
    if (!mermas.length) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle"></i><p>No hay mermas registradas en el periodo seleccionado</p></div>';
        return;
    }

    const totalCosto = mermas.reduce((sum, m) => sum + m.costo_total, 0);

    let html = `
        <div class="tabla-merma-wrapper">
        <table class="tabla-merma">
            <thead>
                <tr>
                    <th>Fecha</th>
                    <th>Bodega</th>
                    <th>Código</th>
                    <th>Producto</th>
                    <th>Cantidad</th>
                    <th>Unidad</th>
                    <th>Motivo</th>
                    <th>Costo Total</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
    `;

    for (const m of mermas) {
        html += `
            <tr>
                <td>${m.fecha}</td>
                <td>${BODEGAS_NOMBRES_MERMA[m.local] || m.local}</td>
                <td><code>${m.codigo}</code></td>
                <td>${m.nombre}</td>
                <td>${m.cantidad}</td>
                <td>${m.unidad}</td>
                <td>${m.motivo || '-'}</td>
                <td class="merma-costo-cell">$${m.costo_total.toFixed(2)}</td>
                <td><button class="btn-eliminar-merma" onclick="eliminarMerma(${m.id})" title="Eliminar"><i class="fas fa-trash"></i></button></td>
            </tr>
        `;
    }

    html += `
            </tbody>
            <tfoot>
                <tr class="merma-total-row">
                    <td colspan="7"><strong>TOTAL MERMA</strong></td>
                    <td><strong>$${totalCosto.toFixed(2)}</strong></td>
                    <td></td>
                </tr>
            </tfoot>
        </table>
        </div>
    `;

    container.innerHTML = html;
}

function registrarMerma() {
    const fecha = document.getElementById('merma-fecha').value;
    const local = document.getElementById('merma-bodega').value;
    const codigo = document.getElementById('merma-codigo').value.trim();
    const nombre = document.getElementById('merma-nombre').value.trim();
    const unidad = document.getElementById('merma-unidad').value.trim();
    const cantidad = parseFloat(document.getElementById('merma-cantidad').value) || 0;
    const motivo = document.getElementById('merma-motivo').value.trim();
    const costo_unitario = parseFloat(document.getElementById('merma-costo-unitario').value) || 0;

    if (!fecha || !local || !codigo || !nombre || cantidad <= 0) {
        showToast('Completa: fecha, bodega, producto y cantidad mayor a 0', 'error');
        return;
    }

    fetch(`${CONFIG.API_URL}/api/merma/registrar`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({fecha, local, codigo, nombre, unidad, cantidad, motivo, costo_unitario})
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) { showToast(data.error, 'error'); return; }
        showToast('Merma registrada correctamente', 'success');
        limpiarFormularioMerma();
        cargarMermas();
    })
    .catch(() => showToast('Error al registrar merma', 'error'));
}

function eliminarMerma(id) {
    if (!confirm('¿Eliminar esta merma? Esta acción no se puede deshacer.')) return;
    fetch(`${CONFIG.API_URL}/api/merma/${id}`, {method: 'DELETE'})
        .then(r => r.json())
        .then(data => {
            if (data.error) { showToast(data.error, 'error'); return; }
            showToast('Merma eliminada', 'success');
            cargarMermas();
        })
        .catch(() => showToast('Error al eliminar', 'error'));
}

function limpiarFormularioMerma() {
    document.getElementById('merma-codigo').value = '';
    document.getElementById('merma-nombre').value = '';
    document.getElementById('merma-unidad').value = '';
    document.getElementById('merma-cantidad').value = '';
    document.getElementById('merma-motivo').value = '';
    document.getElementById('merma-costo-unitario').value = '';
    document.getElementById('merma-costo-total').value = '$0.00';
    document.getElementById('merma-autocomplete').classList.add('hidden');
    _mermaAutocompletResultados = [];
}

function calcularCostoMerma() {
    const cantidad = parseFloat(document.getElementById('merma-cantidad').value) || 0;
    const costoUnit = parseFloat(document.getElementById('merma-costo-unitario').value) || 0;
    const total = cantidad * costoUnit;
    document.getElementById('merma-costo-total').value = `$${total.toFixed(2)}`;
}

async function cargarProductosMerma() {
    const fecha = document.getElementById('merma-fecha').value;
    const local = document.getElementById('merma-bodega').value;
    if (!fecha || !local) return;
    _mermaProductos = [];
    try {
        const resp = await fetch(`${CONFIG.API_URL}/api/inventario/consultar?fecha=${fecha}&local=${local}`);
        const data = await resp.json();
        if (data.productos) {
            _mermaProductos = data.productos;
        }
    } catch(e) {
        // No crítico - el autocomplete funcionará vacío
    }
}

function buscarProductoMerma(term) {
    const lista = document.getElementById('merma-autocomplete');
    if (!lista) return;
    if (!term || term.length < 2) {
        lista.classList.add('hidden');
        return;
    }
    const termLower = term.toLowerCase();
    _mermaAutocompletResultados = _mermaProductos
        .filter(p => p.codigo.toLowerCase().includes(termLower) || p.nombre.toLowerCase().includes(termLower))
        .slice(0, 8);

    if (!_mermaAutocompletResultados.length) {
        lista.classList.add('hidden');
        return;
    }

    lista.innerHTML = _mermaAutocompletResultados.map((p, i) => `
        <div class="merma-autocomplete-item" onclick="seleccionarProductoMerma(${i})">
            <strong>${p.codigo}</strong> &mdash; ${p.nombre}
            <span class="merma-ac-unidad">${p.unidad || ''}</span>
        </div>
    `).join('');
    lista.classList.remove('hidden');
}

function seleccionarProductoMerma(idx) {
    const p = _mermaAutocompletResultados[idx];
    if (!p) return;
    document.getElementById('merma-codigo').value = p.codigo;
    document.getElementById('merma-nombre').value = p.nombre;
    document.getElementById('merma-unidad').value = p.unidad || '';
    document.getElementById('merma-costo-unitario').value = p.costo_unitario || 0;
    document.getElementById('merma-autocomplete').classList.add('hidden');
    calcularCostoMerma();
    document.getElementById('merma-cantidad').focus();
}

// ==================== BAJAS DIRECTAS ====================

let _bajaProductos = [];

// ---- estado lista de items y asignaciones de la baja en curso ----
let _bajaItems = []; // [{codigo, nombre, unidad, cantidad, costo_unitario}]
let _bajaAsignaciones = []; // [{persona, monto}]

function poblarPersonasBaja() {
    // No hay select fijo de persona — se usan botones en el panel de asignaciones
}

let _bajaPivotModo = 'cantidad'; // 'cantidad' | 'costo'
let _bajaGruposCache = [];

function cargarBajas() {
    const desde = document.getElementById('baja-fecha-desde')?.value || '';
    const hasta = document.getElementById('baja-fecha-hasta')?.value || '';
    const local = document.getElementById('baja-filtro-bodega')?.value || '';
    let url = `${CONFIG.API_URL}/api/bajas?`;
    if (desde) url += `fecha_desde=${desde}&`;
    if (hasta) url += `fecha_hasta=${hasta}&`;
    if (local) url += `local=${local}`;
    fetch(url)
        .then(r => r.json())
        .then(data => {
            if (data.error) { showToast(data.error, 'error'); return; }
            _bajaGruposCache = data;
            renderTablaBajas(data);
        })
        .catch(() => showToast('Error al cargar bajas', 'error'));
}

function _setBajaModo(modo) {
    _bajaPivotModo = modo;
    renderTablaBajas(_bajaGruposCache);
}

function renderTablaBajas(grupos) {
    const container = document.getElementById('baja-tabla-container');
    if (!grupos || !grupos.length) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle"></i><p>No hay bajas registradas en el periodo seleccionado</p></div>';
        return;
    }

    const esCosto = _bajaPivotModo === 'costo';
    const fmtF = f => { const p = f.split('-'); return `${p[2]}/${p[1]}`; };
    const BODEGAS = {'real_audiencia':'Real Audiencia','floreana':'Floreana','portugal':'Portugal',
        'santo_cachon_real':'S.Cachon Real','santo_cachon_portugal':'S.Cachon Portugal','simon_bolon':'Simon Bolon'};

    // ---- Construir pivote ----
    const fechas = [...new Set(grupos.map(g => g.fecha))].sort();
    const prodMap = {};

    for (const g of grupos) {
        for (const item of g.items) {
            if (!prodMap[item.codigo]) {
                prodMap[item.codigo] = {codigo: item.codigo, nombre: item.nombre, unidad: item.unidad, porFecha: {}};
            }
            if (!prodMap[item.codigo].porFecha[g.fecha]) {
                prodMap[item.codigo].porFecha[g.fecha] = {qty: 0, costo: 0};
            }
            prodMap[item.codigo].porFecha[g.fecha].qty  += parseFloat(item.cantidad) || 0;
            prodMap[item.codigo].porFecha[g.fecha].costo += parseFloat(item.costo_total) || 0;
        }
    }
    const productos = Object.values(prodMap).sort((a, b) => a.codigo.localeCompare(b.codigo));

    // ---- Totales por fecha ----
    const totPorFecha = {};
    fechas.forEach(f => { totPorFecha[f] = 0; });
    let totGeneral = 0;

    const fmtVal = v => esCosto ? `$${v.toFixed(2)}` : (Number.isInteger(v) || v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));

    // ---- HTML tabla ----
    // ---- Vista por Persona ----
    if (_bajaPivotModo === 'persona') {
        const personaMap = {};
        for (const g of grupos) {
            for (const asig of g.asignaciones) {
                if (!personaMap[asig.persona]) personaMap[asig.persona] = {monto: 0, registros: 0};
                personaMap[asig.persona].monto += parseFloat(asig.monto) || 0;
                personaMap[asig.persona].registros += 1;
            }
        }
        const personas = Object.entries(personaMap).sort((a, b) => b[1].monto - a[1].monto);
        const totalMonto = personas.reduce((s, [, v]) => s + v.monto, 0);
        let html = `
        <div class="baja-pivot-toolbar">
            <span class="baja-pivot-info">${personas.length} persona(s)</span>
            <div class="baja-pivot-toggle">
                <button class="baja-toggle-btn" onclick="_setBajaModo('cantidad')"><i class="fas fa-cubes"></i> Cantidad</button>
                <button class="baja-toggle-btn" onclick="_setBajaModo('costo')"><i class="fas fa-dollar-sign"></i> Valor</button>
                <button class="baja-toggle-btn active" onclick="_setBajaModo('persona')"><i class="fas fa-users"></i> Por Persona</button>
            </div>
        </div>
        <div style="overflow-x:auto;">
        <table class="tabla-bajas-pivot">
            <thead><tr>
                <th style="text-align:left;padding:10px 12px;">Persona</th>
                <th style="text-align:center;">Registros</th>
                <th style="text-align:right;padding:10px 12px;">Monto Total</th>
            </tr></thead>
            <tbody>`;
        for (const [nombre, datos] of personas) {
            html += `<tr>
                <td style="padding:10px 12px;font-weight:600;color:#123450;"><i class="fas fa-user" style="color:#94a3b8;margin-right:6px;"></i>${escapeHtml(nombre)}</td>
                <td style="text-align:center;color:#64748B;">${datos.registros}</td>
                <td style="text-align:right;padding:10px 12px;font-weight:700;color:#F43F5E;">$${datos.monto.toFixed(2)}</td>
            </tr>`;
        }
        html += `<tr style="background:#123450;color:white;font-weight:700;">
            <td style="padding:10px 12px;" colspan="2">TOTAL</td>
            <td style="text-align:right;padding:10px 12px;">$${totalMonto.toFixed(2)}</td>
        </tr></tbody></table></div>`;
        container.innerHTML = html;
        return;
    }

    let html = `
    <div class="baja-pivot-toolbar">
        <span class="baja-pivot-info">${productos.length} producto(s) · ${fechas.length} fecha(s)</span>
        <div class="baja-pivot-toggle">
            <button class="baja-toggle-btn ${!esCosto ? 'active' : ''}" onclick="_setBajaModo('cantidad')">
                <i class="fas fa-cubes"></i> Cantidad
            </button>
            <button class="baja-toggle-btn ${esCosto ? 'active' : ''}" onclick="_setBajaModo('costo')">
                <i class="fas fa-dollar-sign"></i> Valor
            </button>
            <button class="baja-toggle-btn" onclick="_setBajaModo('persona')">
                <i class="fas fa-users"></i> Por Persona
            </button>
        </div>
    </div>
    <div style="overflow-x:auto;">
    <table class="tabla-bajas-pivot">
        <thead>
            <tr>
                <th class="bpiv-cod">Código</th>
                <th class="bpiv-nom">Producto</th>
                <th class="bpiv-uni">Unid.</th>
                ${fechas.map(f => `<th class="bpiv-fecha">${fmtF(f)}</th>`).join('')}
                <th class="bpiv-tot">Total</th>
            </tr>
        </thead>
        <tbody>`;

    for (const prod of productos) {
        let totProd = 0;
        html += `<tr>
            <td><code class="bpiv-codigo-val">${escapeHtml(prod.codigo)}</code></td>
            <td class="bpiv-nombre-val">${escapeHtml(prod.nombre)}</td>
            <td class="bpiv-uni-val">${escapeHtml(prod.unidad)}</td>`;
        for (const f of fechas) {
            const val = prod.porFecha[f];
            if (val) {
                const v = esCosto ? val.costo : val.qty;
                totPorFecha[f] += v;
                totProd += v;
                totGeneral += v;
                html += `<td class="bpiv-val">${fmtVal(v)}</td>`;
            } else {
                html += `<td class="bpiv-empty">—</td>`;
            }
        }
        html += `<td class="bpiv-rowtot">${fmtVal(totProd)}</td></tr>`;
    }

    // Fila de totales
    html += `<tr class="bpiv-row-total">
        <td colspan="3">TOTAL</td>
        ${fechas.map(f => `<td>${fmtVal(totPorFecha[f])}</td>`).join('')}
        <td>${fmtVal(totGeneral)}</td>
    </tr>`;

    html += `</tbody></table></div>`;

    // ---- Sección detalle con delete ----
    html += `
    <div style="margin-top:16px;">
        <button class="btn-secondary btn-sm" onclick="_toggleDetalleBajas(this)">
            <i class="fas fa-list"></i> Ver registros individuales
        </button>
        <div id="baja-detalle-lista" style="display:block;margin-top:10px;">`;

    for (const g of grupos) {
        const asigTexto = g.asignaciones.length
            ? g.asignaciones.map(a => `<strong>${escapeHtml(a.persona)}</strong>: $${a.monto.toFixed(2)}`).join(' · ')
            : '<em style="color:#94a3b8">Sin asignar</em>';
        html += `
        <div class="baja-detalle-row">
            <div class="baja-detalle-head">
                <div>
                    <strong>${g.fecha}</strong> · ${BODEGAS[g.local]||g.local}
                    ${g.codigo_baja ? `<span class="baja-tag green">${escapeHtml(g.codigo_baja)}</span>` : ''}
                    ${g.documento ? `<span class="baja-tag blue"><i class="fas fa-file-alt"></i> ${escapeHtml(g.documento)}</span>` : ''}
                    ${g.motivo ? `<em style="font-size:11px;color:#64748b;"> · ${escapeHtml(g.motivo)}</em>` : ''}
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                    <strong style="color:#1E3A5F;">$${g.total_costo.toFixed(2)}</strong>
                    <button class="btn-eliminar-merma" onclick="eliminarBajaGrupo(${g.baja_grupo})" title="Eliminar"><i class="fas fa-trash"></i></button>
                </div>
            </div>
            <div class="baja-detalle-items">
                ${g.items.map(i => `<span class="baja-item-chip"><code>${escapeHtml(i.codigo)}</code> ${escapeHtml(i.nombre)} · ${i.cantidad} ${escapeHtml(i.unidad)} · $${i.costo_total.toFixed(2)}</span>`).join('')}
            </div>
            <div class="baja-detalle-asig">
                <i class="fas fa-users" style="color:#94a3b8;margin-right:5px;"></i>${asigTexto}
            </div>
        </div>`;
    }

    html += `</div></div>`;
    container.innerHTML = html;
}

function _toggleDetalleBajas(btn) {
    const lista = document.getElementById('baja-detalle-lista');
    if (!lista) return;
    const oculto = lista.style.display === 'none';
    lista.style.display = oculto ? 'block' : 'none';
    btn.innerHTML = oculto
        ? '<i class="fas fa-times"></i> Ocultar registros'
        : '<i class="fas fa-list"></i> Ver registros individuales';
}

// ---- gestión de items en el formulario ----

function _renderBajaItems() {
    const container = document.getElementById('baja-items-container');
    const emptyEl = document.getElementById('baja-items-empty');
    const totalBar = document.getElementById('baja-total-bar');
    if (!container) return;

    if (_bajaItems.length === 0) {
        container.innerHTML = `<div class="baja-items-empty" id="baja-items-empty">
            <i class="fas fa-box-open"></i><p>Agrega productos a la baja</p></div>`;
        totalBar?.classList.add('hidden');
        return;
    }

    let totalGeneral = 0;
    let html = '';
    _bajaItems.forEach((item, idx) => {
        const subtotal = (item.cantidad || 0) * (item.costo_unitario || 0);
        totalGeneral += subtotal;
        html += `
        <div class="baja-item-row">
            <div class="baja-item-info">
                <span class="baja-item-codigo">${escapeHtml(item.codigo)}</span>
                <span class="baja-item-nombre">${escapeHtml(item.nombre)}</span>
                <span class="baja-item-unidad">${item.unidad || ''}</span>
            </div>
            <div class="baja-item-inputs">
                <input type="number" class="baja-item-input" value="${item.cantidad||''}"
                       placeholder="Cant." min="0" step="0.01"
                       onchange="_actualizarItemBaja(${idx},'cantidad',this.value)"
                       oninput="_actualizarItemBaja(${idx},'cantidad',this.value)">
                <input type="number" class="baja-item-input" value="${item.costo_unitario||''}"
                       placeholder="C/U $" min="0" step="0.0001"
                       onchange="_actualizarItemBaja(${idx},'costo_unitario',this.value)"
                       oninput="_actualizarItemBaja(${idx},'costo_unitario',this.value)">
                <span class="baja-item-subtotal" id="baja-sub-${idx}">$${subtotal.toFixed(2)}</span>
                <button class="baja-item-del" onclick="_eliminarItemBaja(${idx})">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>`;
    });
    container.innerHTML = html;

    if (totalBar) {
        totalBar.classList.remove('hidden');
        document.getElementById('baja-total-valor').textContent = `$${totalGeneral.toFixed(2)}`;
    }
}

function _actualizarItemBaja(idx, campo, valor) {
    if (!_bajaItems[idx]) return;
    _bajaItems[idx][campo] = parseFloat(valor) || 0;
    // Actualizar subtotal sin re-renderizar todo
    const subtotal = (_bajaItems[idx].cantidad || 0) * (_bajaItems[idx].costo_unitario || 0);
    const subEl = document.getElementById(`baja-sub-${idx}`);
    if (subEl) subEl.textContent = `$${subtotal.toFixed(2)}`;
    // Actualizar total general
    const total = _bajaItems.reduce((s, i) => s + (i.cantidad||0)*(i.costo_unitario||0), 0);
    const totalEl = document.getElementById('baja-total-valor');
    if (totalEl) totalEl.textContent = `$${total.toFixed(2)}`;
}

function _eliminarItemBaja(idx) {
    _bajaItems.splice(idx, 1);
    _renderBajaItems();
}

function registrarBaja() {
    if (!_puede('bajas', 'editar')) { showToast('No tienes permiso para registrar bajas', 'error'); return; }
    const fecha = document.getElementById('baja-fecha').value;
    const local = document.getElementById('baja-bodega').value;
    const motivo = document.getElementById('baja-motivo').value.trim();
    const documento = document.getElementById('baja-documento').value.trim();
    const codigo_baja = document.getElementById('baja-codigo-ref').value.trim();

    if (!fecha || !local) { showToast('Selecciona fecha y bodega', 'error'); return; }
    if (_bajaItems.length === 0) { showToast('Agrega al menos un producto', 'error'); return; }
    if (_bajaItems.some(i => !i.cantidad || i.cantidad <= 0)) {
        showToast('Todos los productos deben tener cantidad mayor a 0', 'error'); return;
    }

    fetch(`${CONFIG.API_URL}/api/bajas/registrar`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({fecha, local, motivo, documento, codigo_baja, items: _bajaItems, asignaciones: _bajaAsignaciones})
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) { showToast(data.error, 'error'); return; }
        showToast(`Baja registrada: ${_bajaItems.length} producto(s), ${_bajaAsignaciones.length} persona(s)`, 'success');
        limpiarFormularioBaja();
        cargarBajas();
    })
    .catch(() => showToast('Error al registrar baja', 'error'));
}

function eliminarBajaGrupo(baja_grupo) {
    if (!_puede('bajas', 'eliminar')) { showToast('No tienes permiso para eliminar bajas', 'error'); return; }
    if (!confirm('¿Eliminar esta baja completa? Se eliminarán los productos y las asignaciones.')) return;
    fetch(`${CONFIG.API_URL}/api/bajas/grupo/${baja_grupo}`, {method: 'DELETE'})
        .then(r => r.json())
        .then(data => {
            if (data.error) { showToast(data.error, 'error'); return; }
            showToast('Baja eliminada', 'success');
            cargarBajas();
        })
        .catch(() => showToast('Error al eliminar', 'error'));
}

function limpiarFormularioBaja() {
    document.getElementById('baja-motivo').value = '';
    document.getElementById('baja-documento').value = '';
    document.getElementById('baja-codigo-ref').value = '';
    _bajaItems = [];
    _bajaAsignaciones = [];
    _renderBajaItems();
    _renderAsignacionesBaja();
}

async function cargarProductosBaja() {
    if (_bajaProductos.length > 0) return;
    try {
        const resp = await fetch(`${CONFIG.API_URL}/api/catalogo-productos`);
        const data = await resp.json();
        if (Array.isArray(data)) _bajaProductos = data;
    } catch(e) {}
}

async function abrirSelectorProductoBaja() {
    if (_bajaProductos.length === 0) await cargarProductosBaja();

    let modal = document.getElementById('modal-producto-baja');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'modal-producto-baja';
    modal.className = 'modal-persona-overlay';
    modal.innerHTML = `
        <div class="modal-persona-content">
            <div class="modal-persona-header">
                <input type="text" id="baja-prod-buscar" class="persona-buscar-input"
                       placeholder="Buscar por código o nombre...">
                <button class="btn-close-persona" onclick="cerrarSelectorProductoBaja()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-persona-list" id="baja-prod-lista"></div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) cerrarSelectorProductoBaja(); });

    _renderListaProductosBaja(_bajaProductos);

    const buscarInput = document.getElementById('baja-prod-buscar');
    if (buscarInput) {
        buscarInput.focus();
        buscarInput.addEventListener('input', function() {
            const term = this.value.toLowerCase();
            const filtrados = term.length < 1 ? _bajaProductos
                : _bajaProductos.filter(p => p.codigo.toLowerCase().includes(term) || p.nombre.toLowerCase().includes(term));
            _renderListaProductosBaja(filtrados);
        });
    }
}

function _renderListaProductosBaja(lista) {
    const container = document.getElementById('baja-prod-lista');
    if (!container) return;
    if (!lista.length) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:#64748b;">Sin resultados</div>';
        return;
    }
    container.innerHTML = lista.map(p => `
        <div class="persona-opcion" onclick="_seleccionarProdBaja(${_bajaProductos.indexOf(p)})">
            <span style="font-weight:600;color:#1E3A5F;">${escapeHtml(p.codigo)}</span>
            &nbsp;—&nbsp;${escapeHtml(p.nombre)}
            <span style="font-size:11px;color:#94a3b8;margin-left:6px;">${p.unidad||''}</span>
        </div>
    `).join('');
}

function _seleccionarProdBaja(idx) {
    const p = _bajaProductos[idx];
    if (!p) return;
    // Agregar a la lista (no duplicar el mismo código)
    const yaExiste = _bajaItems.findIndex(i => i.codigo === p.codigo);
    if (yaExiste >= 0) {
        showToast(`${p.codigo} ya está en la lista`, 'info');
        cerrarSelectorProductoBaja();
        return;
    }
    _bajaItems.push({codigo: p.codigo, nombre: p.nombre, unidad: p.unidad || '', cantidad: null, costo_unitario: null});
    cerrarSelectorProductoBaja();
    _renderBajaItems();
}

function cerrarSelectorProductoBaja() {
    const modal = document.getElementById('modal-producto-baja');
    if (modal) modal.remove();
}

// ---- Panel Personas de la Baja ----

let _personasBajaLista = []; // guarda lista filtrada para referenciar por índice en onclick

function agregarPersonaAsigBaja() {
    let modal = document.getElementById('modal-persona-baja');
    if (modal) modal.remove();

    const personas = (state.personas || []);
    modal = document.createElement('div');
    modal.id = 'modal-persona-baja';
    modal.className = 'modal-persona-overlay';
    modal.innerHTML = `
        <div class="modal-persona-content">
            <div class="modal-persona-header">
                <input type="text" id="baja-pers-buscar" class="persona-buscar-input"
                       placeholder="Buscar persona..." oninput="_filtrarPersonasBaja(this.value)">
                <button class="btn-close-persona" onclick="_cerrarPersonaBaja()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-persona-list" id="baja-pers-lista"></div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) _cerrarPersonaBaja(); });

    _filtrarPersonasBaja('');
    setTimeout(() => { const b = document.getElementById('baja-pers-buscar'); if (b) b.focus(); }, 100);
}

function _filtrarPersonasBaja(q) {
    const lista = document.getElementById('baja-pers-lista');
    if (!lista) return;
    const personas = (state.personas || []);
    _personasBajaLista = q ? personas.filter(p => p.toLowerCase().includes(q.toLowerCase())) : personas.slice();
    if (!_personasBajaLista.length) {
        lista.innerHTML = '<div style="padding:20px;text-align:center;color:#64748b;">Sin resultados</div>';
        return;
    }
    lista.innerHTML = _personasBajaLista.map((p, i) => `
        <div class="persona-opcion" onclick="_seleccionarPersonaBaja(${i})">
            <i class="fas fa-user" style="margin-right:8px;color:#94a3b8;"></i>${escapeHtml(p)}
        </div>
    `).join('');
}

function _seleccionarPersonaBaja(idx) {
    // idx es el índice en _personasBajaLista (let no está en window, sí accesible desde función)
    const nombre = _personasBajaLista[idx];
    if (!nombre) return;
    // Evitar duplicados
    if (_bajaAsignaciones.find(a => a.persona === nombre)) {
        showToast(`${nombre} ya está asignado`, 'info');
        _cerrarPersonaBaja();
        return;
    }
    _bajaAsignaciones.push({persona: nombre, monto: 0});
    _cerrarPersonaBaja();
    _renderAsignacionesBaja();
}

function _cerrarPersonaBaja() {
    const modal = document.getElementById('modal-persona-baja');
    if (modal) modal.remove();
}

function _renderAsignacionesBaja() {
    const container = document.getElementById('baja-asig-container');
    const footer = document.getElementById('baja-asig-footer');
    if (!container) return;

    if (_bajaAsignaciones.length === 0) {
        container.innerHTML = `<div class="baja-items-empty">
            <i class="fas fa-users"></i><p>Agrega personas a asignar</p></div>`;
        footer?.classList.add('hidden');
        return;
    }

    const totalProductos = _bajaItems.reduce((s, i) => s + (i.cantidad||0)*(i.costo_unitario||0), 0);
    const totalAsig = _bajaAsignaciones.reduce((s, a) => s + (parseFloat(a.monto)||0), 0);

    container.innerHTML = _bajaAsignaciones.map((a, idx) => `
        <div class="baja-asig-row">
            <span class="baja-asig-nombre">${escapeHtml(a.persona)}</span>
            <input type="number" class="baja-asig-input" min="0" step="0.01"
                   value="${a.monto || ''}" placeholder="$0.00"
                   onchange="_actualizarMontoAsig(${idx}, this.value)"
                   oninput="_actualizarMontoAsig(${idx}, this.value)">
            <button class="baja-item-del" onclick="_eliminarAsigBaja(${idx})" title="Eliminar">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');

    if (footer) {
        footer.classList.remove('hidden');
        const asigTotalEl = document.getElementById('baja-asig-total');
        const diffEl = document.getElementById('baja-asig-diff');
        if (asigTotalEl) asigTotalEl.textContent = `$${totalAsig.toFixed(2)}`;
        if (diffEl) {
            const diff = totalProductos - totalAsig;
            if (Math.abs(diff) < 0.01) {
                diffEl.textContent = '✓ Cuadra';
                diffEl.className = 'baja-asig-diff ok';
            } else if (diff > 0) {
                diffEl.textContent = `Falta $${diff.toFixed(2)}`;
                diffEl.className = 'baja-asig-diff warn';
            } else {
                diffEl.textContent = `Excede $${Math.abs(diff).toFixed(2)}`;
                diffEl.className = 'baja-asig-diff warn';
            }
        }
    }
}

function _actualizarMontoAsig(idx, valor) {
    if (!_bajaAsignaciones[idx]) return;
    _bajaAsignaciones[idx].monto = parseFloat(valor) || 0;
    // Actualizar solo footer sin re-renderizar filas
    const totalProductos = _bajaItems.reduce((s, i) => s + (i.cantidad||0)*(i.costo_unitario||0), 0);
    const totalAsig = _bajaAsignaciones.reduce((s, a) => s + (parseFloat(a.monto)||0), 0);
    const asigTotalEl = document.getElementById('baja-asig-total');
    const diffEl = document.getElementById('baja-asig-diff');
    if (asigTotalEl) asigTotalEl.textContent = `$${totalAsig.toFixed(2)}`;
    if (diffEl) {
        const diff = totalProductos - totalAsig;
        if (Math.abs(diff) < 0.01) {
            diffEl.textContent = '✓ Cuadra';
            diffEl.className = 'baja-asig-diff ok';
        } else if (diff > 0) {
            diffEl.textContent = `Falta $${diff.toFixed(2)}`;
            diffEl.className = 'baja-asig-diff warn';
        } else {
            diffEl.textContent = `Excede $${Math.abs(diff).toFixed(2)}`;
            diffEl.className = 'baja-asig-diff warn';
        }
    }
}

function _eliminarAsigBaja(idx) {
    _bajaAsignaciones.splice(idx, 1);
    _renderAsignacionesBaja();
}

// ==================== ASIGNACIÓN POR SECCIÓN (PROTOTIPO) ====================

let _seccionesLocal = [];      // [{seccion_id, nombre, productos:[...], personas:[...]}]
let _prodConDifCache = [];     // cache de productos con diferencia del conteo actual
let _secPersonasLista = [];    // lista filtrada para onclick por índice

// Las secciones son estado local temporal — se guardan en asignacion_diferencias al confirmar
async function cargarSecciones(fecha, local) {
    _seccionesLocal = [];
}

function renderPanelSecciones(container, productosConDif) {
    _prodConDifCache = productosConDif;
    // Siempre hay exactamente una sección activa
    if (_seccionesLocal.length === 0) {
        _seccionesLocal.push({ seccion_id: null, nombre: 'Sección 1', productos: [], personas: [] });
    }
    const listaHtml = _seccionesLocal.map((s, i) => _htmlSeccion(s, i)).join('');

    container.innerHTML = `
    <div class="sec-panel">
        <div class="sec-panel-header">
            <div class="sec-panel-title">
                <i class="fas fa-layer-group"></i> Asignación por Sección
            </div>
        </div>
        <div id="sec-lista">${listaHtml}</div>
    </div>`;
}

function _reRenderSecciones() {
    const lista = document.getElementById('sec-lista');
    if (!lista) return;
    lista.innerHTML = _seccionesLocal.map((s, i) => _htmlSeccion(s, i)).join('');
}

function _crearSeccion() {
    _seccionesLocal.push({
        seccion_id: null,
        nombre: `Sección ${_seccionesLocal.length + 1}`,
        productos: [],
        personas: []
    });
    _reRenderSecciones();
    // Scroll al final para ver la nueva sección
    setTimeout(() => {
        const cards = document.querySelectorAll('.sec-card');
        if (cards.length) cards[cards.length - 1].scrollIntoView({behavior: 'smooth', block: 'start'});
    }, 50);
}

function _htmlSeccion(sec, sIdx) {
    const totalValor = sec.productos.reduce((s, p) => s + (parseFloat(p.valor) || 0), 0);
    const totalAsig  = sec.personas.reduce((s, p) => s + (parseFloat(p.monto) || 0), 0);
    const diff = totalValor - totalAsig;
    const cuadra = Math.abs(diff) < 0.01;

    // ---- HTML productos con checkboxes (solo productos con disponible pendiente) ----
    const _prodFiltrados = _prodConDifCache.filter(prod => {
        const _c2f = prod.cantidad_contada_2 !== null && prod.cantidad_contada_2 !== undefined;
        const _cantF = _c2f ? prod.cantidad_contada_2 : prod.cantidad_contada;
        const _difAbsF = Math.abs(_cantF - prod.cantidad_sistema);
        const _asigF = _calcAsignadoOtras(prod.id, sIdx);
        const _dispF = Math.max(0, _difAbsF - _asigF);
        return _dispF > 0.001 || sec.productos.some(p => p.conteo_id === prod.id);
    });
    const productosHtml = _prodFiltrados.length === 0
        ? (_prodConDifCache.length === 0
            ? '<div class="sec-empty-inner">No hay productos con diferencia</div>'
            : '<div class="sec-empty-inner"><i class="fas fa-check-circle" style="color:#059669;margin-right:5px;"></i> Todos los productos ya fueron asignados en otras secciones</div>')
        : _prodFiltrados.map(prod => {
            const c2 = prod.cantidad_contada_2 !== null && prod.cantidad_contada_2 !== undefined;
            const cantFinal = c2 ? prod.cantidad_contada_2 : prod.cantidad_contada;
            const diferencia = cantFinal - prod.cantidad_sistema;
            const difAbs = Math.abs(diferencia);
            const costo = parseFloat(prod.costo_unitario) || 0;
            const unidad = prod.unidad || '';
            const secProd = sec.productos.find(p => p.conteo_id === prod.id);
            const seleccionado = !!secProd;

            // Cuánto ya asignan las OTRAS secciones (no esta)
            const asignadoOtras = _calcAsignadoOtras(prod.id, sIdx);
            // Máximo disponible para esta sección
            const disponible = Math.max(0, difAbs - asignadoOtras);

            const cantAsig = seleccionado
                ? Math.min(secProd.cantidad_asignada ?? disponible, disponible)
                : disponible;
            const valorAsig = cantAsig * costo;
            const difClass = diferencia < 0 ? 'negativa' : 'positiva';
            const difLabel = diferencia < 0 ? '▼' : '▲';

            const qtyHtml = seleccionado ? `
                <div class="sec-prod-qty">
                    <input type="number" class="sec-qty-input" id="sec-qty-${sIdx}-${prod.id}"
                           value="${cantAsig.toFixed(2)}"
                           min="0" max="${disponible.toFixed(2)}" step="0.01" placeholder="Cant."
                           oninput="_actualizarCantidadSec(${sIdx}, ${prod.id}, this.value, ${disponible.toFixed(4)})">
                    <span class="sec-qty-unidad">${unidad}</span>
                </div>` : '';

            const valorStr = costo > 0
                ? `<span class="sec-prod-valor${seleccionado ? '' : ' sec-prod-valor-dim'}" id="sec-val-${sIdx}-${prod.id}">$${valorAsig.toFixed(2)}</span>`
                : `<span class="sec-prod-valor sec-prod-valor-dim">—</span>`;

            const disponibleLabel = asignadoOtras > 0
                ? `${difLabel} disp. ${disponible.toFixed(2)} ${unidad}`
                : `${difLabel} máx ${difAbs.toFixed(2)} ${unidad}`;

            return `
            <label class="sec-prod-item ${seleccionado ? 'selected' : ''}" data-sidx="${sIdx}" data-pid="${prod.id}" data-dif="${diferencia.toFixed(4)}" data-difabs="${disponible.toFixed(4)}" data-costo="${costo.toFixed(4)}" data-unidad="${unidad}" data-codigo="${escapeHtml(prod.codigo)}" data-nombre="${escapeHtml(prod.nombre).replace(/"/g,'&quot;')}">
                <input type="checkbox" ${seleccionado ? 'checked' : ''} onchange="_toggleProdSec(this)">
                <div class="sec-prod-info">
                    <span class="sec-prod-nombre">${escapeHtml(prod.nombre)}</span>
                    <span class="sec-prod-dif ${difClass}">${disponibleLabel}</span>
                </div>
                ${qtyHtml}
                ${valorStr}
            </label>`;
        }).join('');

    // ---- HTML personas (solo chips, sin monto — la división es automática al guardar) ----
    const personasHtml = sec.personas.length === 0
        ? `<div class="sec-empty-inner"><i class="fas fa-user-plus"></i> Agrega personas</div>`
        : sec.personas.map((nombre, pIdx) => `
            <div class="sec-persona-chip">
                <i class="fas fa-user"></i>
                <span>${escapeHtml(nombre)}</span>
                <button class="baja-item-del" onclick="_quitarPersonaSec(${sIdx}, ${pIdx})" title="Quitar">
                    <i class="fas fa-times"></i>
                </button>
            </div>`).join('');

    // ---- Info de división ----
    const divisionInfo = sec.personas.length > 0 && sec.productos.length > 0 ? `
        <div class="sec-division-info">
            <i class="fas fa-divide"></i>
            ${sec.productos.length} producto(s) ÷ ${sec.personas.length} persona(s)
            ${totalValor > 0 ? `· <strong>$${(totalValor / sec.personas.length).toFixed(2)}</strong> c/u` : ''}
        </div>` : '';

    return `
    <div class="sec-card" id="sec-card-${sIdx}">
        <div class="sec-card-header">
            <span class="sec-nombre-input" style="pointer-events:none;">Asignación por Sección</span>
        </div>

        <div class="sec-two-col">
            <!-- Panel Productos -->
            <div class="sec-col">
                <div class="sec-col-header">
                    <span><i class="fas fa-box-open"></i> Productos con descuadre</span>
                    ${totalValor > 0 ? `<span class="sec-total-chip">$${totalValor.toFixed(2)}</span>` : ''}
                </div>
                <div class="sec-productos-lista">${productosHtml}</div>
            </div>

            <!-- Panel Personas -->
            <div class="sec-col">
                <div class="sec-col-header">
                    <span><i class="fas fa-users"></i> Personas responsables</span>
                    <button class="btn-secondary btn-xs" onclick="_abrirPersonaSec(${sIdx})">
                        <i class="fas fa-plus"></i> Agregar
                    </button>
                </div>
                <div class="sec-personas-lista chips">${personasHtml}</div>
                ${divisionInfo}
            </div>
        </div>

        <div class="sec-card-footer">
            <button class="btn-primary btn-sm" onclick="_guardarSec(${sIdx})">
                <i class="fas fa-save"></i> Guardar sección
            </button>
        </div>
    </div>`;
}

// ---- Helpers ----

// Suma lo ya asignado: en BD (state.asignaciones) + otras secciones activas (excepto sIdx)
function _calcAsignadoOtras(conteoId, sIdx) {
    const enBD = (state.asignaciones[String(conteoId)] || []).reduce((s, a) => s + (parseFloat(a.cantidad) || 0), 0);
    const enSecciones = _seccionesLocal.reduce((total, s, i) => {
        if (i === sIdx) return total;
        const p = s.productos.find(p => p.conteo_id === conteoId);
        return total + (p ? (parseFloat(p.cantidad_asignada) || 0) : 0);
    }, 0);
    return enBD + enSecciones;
}

// ---- Acciones de productos ----

function _toggleProdSec(checkbox) {
    const label = checkbox.closest('label.sec-prod-item');
    if (!label) return;
    const sIdx      = parseInt(label.dataset.sidx);
    const prodId    = parseInt(label.dataset.pid);
    const dif       = parseFloat(label.dataset.dif);
    const disponible = parseFloat(label.dataset.difabs); // ya viene calculado como disponible
    const costo     = parseFloat(label.dataset.costo);
    const codigo    = label.dataset.codigo;
    const nombre    = label.dataset.nombre;
    const sec = _seccionesLocal[sIdx];
    if (!sec) return;
    if (checkbox.checked) {
        if (!sec.productos.some(p => p.conteo_id === prodId)) {
            // Por defecto asigna solo lo disponible (diferencia - otras secciones)
            sec.productos.push({
                conteo_id: prodId, codigo, nombre,
                diferencia: dif, costo_unitario: costo,
                cantidad_asignada: disponible,
                valor: disponible * costo
            });
        }
    } else {
        sec.productos = sec.productos.filter(p => p.conteo_id !== prodId);
    }
    _reRenderSecciones();
}

function _actualizarNombreSec(sIdx, valor) {
    if (_seccionesLocal[sIdx]) _seccionesLocal[sIdx].nombre = valor;
}

// ---- División automática ----

function _dividirSec(sIdx) {
    const sec = _seccionesLocal[sIdx];
    if (!sec || sec.personas.length === 0) return;
    const total = sec.productos.reduce((s, p) => s + (parseFloat(p.valor) || 0), 0);
    if (total === 0) { showToast('Selecciona productos con costo para dividir', 'error'); return; }
    const n = sec.personas.length;
    const base = Math.floor((total / n) * 100) / 100;
    let restante = total;
    sec.personas.forEach((p, i) => {
        if (i === n - 1) {
            p.monto = Math.round(restante * 100) / 100;
        } else {
            p.monto = base;
            restante = Math.round((restante - base) * 100) / 100;
        }
    });
    _reRenderSecciones();
}

// Actualiza cantidad asignada a un producto y recalcula valor (sin re-renderizar)
function _actualizarCantidadSec(sIdx, conteoId, cantStr, maxCant) {
    const sec = _seccionesLocal[sIdx];
    if (!sec) return;
    const prod = sec.productos.find(p => p.conteo_id === conteoId);
    if (!prod) return;
    let cantidad = parseFloat(cantStr) || 0;
    // Limitar al máximo del descuadre
    if (maxCant !== undefined && cantidad > maxCant) {
        cantidad = maxCant;
        const inputEl = document.getElementById(`sec-qty-${sIdx}-${conteoId}`);
        if (inputEl) inputEl.value = cantidad.toFixed(2);
        showToast(`Máximo: ${maxCant.toFixed(2)} (diferencia del producto)`, 'error');
    }
    if (cantidad < 0) cantidad = 0;
    prod.cantidad_asignada = cantidad;
    prod.valor = cantidad * (prod.costo_unitario || 0);
    // Actualizar solo el span del valor de ese producto
    const valEl = document.getElementById(`sec-val-${sIdx}-${conteoId}`);
    if (valEl) valEl.textContent = prod.costo_unitario > 0 ? `$${prod.valor.toFixed(2)}` : '—';
    _actualizarFooterSec(sIdx);
}

// Actualiza chip de total e info de división sin re-renderizar toda la sección
function _actualizarFooterSec(sIdx) {
    const sec = _seccionesLocal[sIdx];
    if (!sec) return;
    const totalValor = sec.productos.reduce((s, p) => s + (parseFloat(p.valor) || 0), 0);
    const card = document.getElementById(`sec-card-${sIdx}`);
    if (!card) return;
    const chip = card.querySelector('.sec-total-chip');
    if (chip) chip.textContent = `$${totalValor.toFixed(2)}`;
    const infoEl = card.querySelector('.sec-division-info');
    if (infoEl && sec.personas.length > 0) {
        const porPersona = sec.personas.length > 0 ? totalValor / sec.personas.length : 0;
        infoEl.innerHTML = `<i class="fas fa-divide"></i> ${sec.productos.length} producto(s) ÷ ${sec.personas.length} persona(s)${totalValor > 0 ? ` · <strong>$${porPersona.toFixed(2)}</strong> c/u` : ''}`;
    }
}

function _quitarPersonaSec(sIdx, pIdx) {
    if (!_seccionesLocal[sIdx]) return;
    _seccionesLocal[sIdx].personas.splice(pIdx, 1);
    _reRenderSecciones();
}

function _eliminarSec(sIdx) {
    _seccionesLocal.splice(sIdx, 1);
    _reRenderSecciones();
}

// ---- Selector de persona ----

function _abrirPersonaSec(sIdx) {
    let modal = document.getElementById('modal-persona-sec');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'modal-persona-sec';
    modal.className = 'modal-persona-overlay';
    modal.innerHTML = `
        <div class="modal-persona-content">
            <div class="modal-persona-header">
                <input type="text" id="sec-pers-buscar" class="persona-buscar-input"
                       placeholder="Buscar persona..." oninput="_filtrarPersonasSec(this.value, ${sIdx})">
                <button class="btn-close-persona" onclick="_cerrarPersonaSec()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-persona-list" id="sec-pers-lista"></div>
        </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) _cerrarPersonaSec(); });
    _filtrarPersonasSec('', sIdx);
    setTimeout(() => { const b = document.getElementById('sec-pers-buscar'); if (b) b.focus(); }, 100);
}

function _filtrarPersonasSec(q, sIdx) {
    const lista = document.getElementById('sec-pers-lista');
    if (!lista) return;
    const personas = state.personas || [];
    _secPersonasLista = q ? personas.filter(p => p.toLowerCase().includes(q.toLowerCase())) : personas.slice();
    if (!_secPersonasLista.length) {
        lista.innerHTML = '<div style="padding:20px;text-align:center;color:#64748b;">Sin resultados</div>';
        return;
    }
    lista.innerHTML = _secPersonasLista.map((p, i) => `
        <div class="persona-opcion" onclick="_selPersonaSec(${i}, ${sIdx})">
            <i class="fas fa-user" style="margin-right:8px;color:#94a3b8;"></i>${escapeHtml(p)}
        </div>`).join('');
}

function _selPersonaSec(pIdx, sIdx) {
    const nombre = _secPersonasLista[pIdx];
    if (!nombre || !_seccionesLocal[sIdx]) return;
    if (_seccionesLocal[sIdx].personas.includes(nombre)) {
        showToast(`${nombre} ya está en la sección`, 'info');
        _cerrarPersonaSec();
        return;
    }
    _seccionesLocal[sIdx].personas.push(nombre);
    _cerrarPersonaSec();
    _reRenderSecciones();
}

function _cerrarPersonaSec() {
    const modal = document.getElementById('modal-persona-sec');
    if (modal) modal.remove();
}

// ---- Guardar ----

async function _guardarSec(sIdx) {
    const sec = _seccionesLocal[sIdx];
    if (!sec) return;
    if (sec.productos.length === 0) { showToast('Selecciona al menos un producto', 'error'); return; }
    if (sec.personas.length === 0)  { showToast('Agrega al menos una persona', 'error'); return; }
    const fecha = document.getElementById('fecha-conteo')?.value;
    const local = document.getElementById('bodega-select')?.value;
    if (!fecha || !local) { showToast('No hay fecha/bodega activa', 'error'); return; }
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/conteo/secciones/guardar`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({productos: sec.productos, personas: sec.personas})
        });
        const data = await r.json();
        if (data.error) { showToast(data.error, 'error'); return; }
        // Resetear la sección para continuar asignando
        _seccionesLocal.splice(sIdx, 1);
        _seccionesLocal.push({ seccion_id: null, nombre: 'Sección 1', productos: [], personas: [] });
        showToast(`Asignado: ${data.productos} producto(s) ÷ ${data.personas} persona(s)`, 'success');
        _reRenderSecciones();
        // Recargar asignaciones para reflejar los cambios en el panel de arriba
        await cargarAsignaciones(fecha, local);
        const asigContainer = document.getElementById('asignaciones-container');
        if (asigContainer && _prodConDifCache.length > 0) {
            renderAsignacionesDiferencias(asigContainer, _prodConDifCache);
        }
    } catch(e) {
        showToast('Error al guardar', 'error');
    }
}

// ==================== CORRECCIÓN DE CONTEOS (ADMIN) ====================

let _corrProductosOriginales = [];

async function cargarCorreccion() {
    const fecha = document.getElementById('corr-fecha').value;
    const local = document.getElementById('corr-bodega').value;
    const container = document.getElementById('corr-tabla-container');

    if (!fecha || !local) {
        showToast('Selecciona fecha y bodega', 'error');
        return;
    }

    container.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>';

    try {
        const res = await fetch(`/api/inventario/consultar?fecha=${fecha}&local=${local}`);
        const data = await res.json();
        if (data.error) { showToast(data.error, 'error'); return; }
        _corrProductosOriginales = data.productos || [];
        renderTablaCorreccion(_corrProductosOriginales);
    } catch(e) {
        showToast('Error al cargar conteos', 'error');
    }
}

function corrValor(v) { return v !== null && v !== undefined ? v : ''; }

function renderTablaCorreccion(productos) {
    const container = document.getElementById('corr-tabla-container');
    if (!productos.length) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-box-open"></i><p>No hay productos para esta fecha y bodega</p></div>';
        return;
    }

    const rows = productos.map((p, i) => `
        <tr id="corr-row-${p.id}" class="corr-tr${i % 2 === 1 ? ' corr-tr-alt' : ''}">
            <td class="corr-td-codigo"><span class="producto-codigo">${p.codigo}</span></td>
            <td class="corr-td-nombre">${p.nombre}</td>
            <td class="corr-td-num">
                <input type="number" class="corr-inp" id="corr-sis-${p.id}"
                    value="${corrValor(p.cantidad)}" min="0" step="0.01"
                    oninput="corrMarcarCambio(${p.id})">
            </td>
            <td class="corr-td-num">
                <input type="number" class="corr-inp corr-inp-c1" id="corr-c1-${p.id}"
                    value="${corrValor(p.cantidad_contada)}" min="0" step="0.01"
                    oninput="corrMarcarCambio(${p.id})">
            </td>
            <td class="corr-td-num">
                <input type="number" class="corr-inp corr-inp-c2" id="corr-c2-${p.id}"
                    value="${corrValor(p.cantidad_contada_2)}" min="0" step="0.01"
                    oninput="corrMarcarCambio(${p.id})">
            </td>
            <td class="corr-td-btn">
                <button class="corr-btn-save" id="corr-savebtn-${p.id}" onclick="guardarCorreccionFila(${p.id})" title="Guardar esta fila">
                    <i class="fas fa-save"></i>
                </button>
            </td>
        </tr>
    `).join('');

    const bodegaNombre = document.getElementById('corr-bodega').selectedOptions[0]?.text || '';
    const fecha = document.getElementById('corr-fecha').value;

    container.innerHTML = `
        <div class="corr-toolbar">
            <div class="corr-info">
                <i class="fas fa-boxes"></i>
                <strong>${productos.length} productos</strong>
                <span class="corr-info-sep">·</span>
                <span>${bodegaNombre}</span>
                <span class="corr-info-sep">·</span>
                <span>${fecha}</span>
            </div>
            <button class="corr-btn-guardar-todos" onclick="guardarTodasCorrecciones()">
                <i class="fas fa-save"></i> Guardar Todos
            </button>
        </div>
        <div class="corr-table-wrap">
            <table class="corr-table">
                <thead>
                    <tr>
                        <th>Código</th>
                        <th>Nombre</th>
                        <th class="corr-th-num">Stock Sistema</th>
                        <th class="corr-th-num">Conteo 1</th>
                        <th class="corr-th-num">Conteo 2</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

function corrMarcarCambio(id) {
    const row = document.getElementById(`corr-row-${id}`);
    if (row) row.classList.add('corr-tr-modified');
    const btn = document.getElementById(`corr-savebtn-${id}`);
    if (btn) btn.classList.add('corr-btn-save-active');
}

async function guardarCorreccionFila(id) {
    if (!_puede('correccion', 'editar')) { showToast('No tienes permiso para corregir conteos', 'error'); return; }
    const sisInput = document.getElementById(`corr-sis-${id}`);
    const c1Input  = document.getElementById(`corr-c1-${id}`);
    const c2Input  = document.getElementById(`corr-c2-${id}`);
    const btn      = document.getElementById(`corr-savebtn-${id}`);
    const row      = document.getElementById(`corr-row-${id}`);

    const sis = sisInput.value !== '' ? parseFloat(sisInput.value) : null;
    const c1  = c1Input.value  !== '' ? parseFloat(c1Input.value)  : null;
    const c2  = c2Input.value  !== '' ? parseFloat(c2Input.value)  : null;

    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

    try {
        const res = await fetch('/api/admin/corregir-conteo', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, cantidad: sis, cantidad_contada: c1, cantidad_contada_2: c2, usuario: state.user ? state.user.username : '' })
        });
        const data = await res.json();
        if (data.success) {
            if (row) { row.classList.remove('corr-tr-modified'); row.classList.add('corr-tr-saved'); }
            if (btn) { btn.innerHTML = '<i class="fas fa-check"></i>'; btn.classList.remove('corr-btn-save-active'); }
            setTimeout(() => {
                if (row) row.classList.remove('corr-tr-saved');
                if (btn) { btn.innerHTML = '<i class="fas fa-save"></i>'; btn.disabled = false; }
            }, 2000);
        } else {
            showToast(data.error || 'Error al guardar', 'error');
            if (btn) { btn.innerHTML = '<i class="fas fa-save"></i>'; btn.disabled = false; }
        }
    } catch(e) {
        showToast('Error de conexión', 'error');
        if (btn) { btn.innerHTML = '<i class="fas fa-save"></i>'; btn.disabled = false; }
    }
}

async function guardarTodasCorrecciones() {
    const rows = document.querySelectorAll('#corr-tabla-container tbody tr');
    const btnTodos = document.querySelector('.corr-btn-guardar-todos');
    if (btnTodos) { btnTodos.disabled = true; btnTodos.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...'; }

    let ok = 0, errores = 0;
    for (const row of rows) {
        const id = parseInt(row.id.replace('corr-row-', ''));
        if (!id) continue;
        const sisInput = document.getElementById(`corr-sis-${id}`);
        const c1Input  = document.getElementById(`corr-c1-${id}`);
        const c2Input  = document.getElementById(`corr-c2-${id}`);
        if (!c1Input) continue;
        const sis = sisInput && sisInput.value !== '' ? parseFloat(sisInput.value) : null;
        const c1  = c1Input.value  !== '' ? parseFloat(c1Input.value)  : null;
        const c2  = c2Input && c2Input.value !== '' ? parseFloat(c2Input.value) : null;
        try {
            const res = await fetch('/api/admin/corregir-conteo', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, cantidad: sis, cantidad_contada: c1, cantidad_contada_2: c2, usuario: state.user ? state.user.username : '' })
            });
            const data = await res.json();
            if (data.success) {
                ok++;
                row.classList.remove('corr-tr-modified');
                row.classList.add('corr-tr-saved');
                setTimeout(() => row.classList.remove('corr-tr-saved'), 2000);
            } else { errores++; }
        } catch(e) { errores++; }
    }

    if (btnTodos) { btnTodos.disabled = false; btnTodos.innerHTML = '<i class="fas fa-save"></i> Guardar Todos'; }
    if (errores === 0) {
        showToast(`✓ ${ok} productos guardados correctamente`, 'success');
    } else {
        showToast(`${ok} guardados, ${errores} con error`, 'error');
    }
}


// ==================== PANEL DE CONTROL ====================

let _panelInited = false;
let _panelPolling = null;

function panelInit() {
    if (_panelInited) return;
    _panelInited = true;

    const fechaInput = document.getElementById('panel-fecha');
    if (!fechaInput.value) {
        fechaInput.value = new Date().toISOString().split('T')[0];
    }

    // Botones de fecha rapida
    document.querySelectorAll('.panel-fecha-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const delta = parseInt(btn.dataset.delta);
            const d = new Date();
            d.setDate(d.getDate() + delta);
            document.getElementById('panel-fecha').value = d.toISOString().split('T')[0];
        });
    });
}

function panelGetFecha() {
    const v = document.getElementById('panel-fecha').value;
    if (!v) {
        showToast('Selecciona una fecha', 'error');
        return null;
    }
    return v;
}

function panelFechaDD(isoDate) {
    const [y, m, d] = isoDate.split('-');
    return `${d}/${m}/${y}`;
}

function panelLog(text) {
    const el = document.getElementById('panel-consola');
    const placeholder = el.querySelector('.panel-consola-placeholder');
    if (placeholder) placeholder.remove();
    el.textContent += text + '\n';
    el.scrollTop = el.scrollHeight;
}

function panelLimpiarConsola() {
    const el = document.getElementById('panel-consola');
    el.innerHTML = '<span class="panel-consola-placeholder">La salida aparecera aqui al ejecutar una accion...</span>';
}

function panelSetStatus(text, cls) {
    const el = document.getElementById('panel-status-text');
    el.textContent = text;
    el.className = cls || '';
}

function panelSetBtnsDisabled(disabled) {
    document.querySelectorAll('#view-panel .panel-btn').forEach(b => b.disabled = disabled);
}

async function panelEjecutar(tipo, modo) {
    const fecha = panelGetFecha();
    if (!fecha) return;

    const fechaDD = panelFechaDD(fecha);
    let desc = '';
    if (tipo === 'carga') desc = `Carga BD ${modo}`;
    else if (tipo === 'toma') desc = `Toma Fisica ${modo}`;
    else desc = 'Consulta Plataformas';

    // Confirmar
    if (!confirm(`Ejecutar: ${desc}\nFecha: ${fechaDD}\n\nEste proceso se ejecutara en el servidor local (no en Render).\nContinuar?`)) {
        return;
    }

    panelSetBtnsDisabled(true);
    panelSetStatus(`Ejecutando: ${desc} | ${fechaDD}...`, 'status-running');

    const el = document.getElementById('panel-consola');
    const placeholder = el.querySelector('.panel-consola-placeholder');
    if (placeholder) placeholder.remove();
    el.textContent += `\n${'='.repeat(60)}\n  ${desc}  |  Fecha: ${fechaDD}  |  ${new Date().toLocaleTimeString()}\n${'='.repeat(60)}\n\n`;
    el.scrollTop = el.scrollHeight;

    // Nota: Los scripts (cargar_inventario_bd.py, registrar_toma_fisica.py, consulta_plataformas.py)
    // se ejecutan localmente con el BAT, no desde Render.
    // Aqui mostramos instrucciones claras.
    const cmds = {
        carga: `python cargar_inventario_bd.py ${modo} ${fechaDD}`,
        toma: `python registrar_toma_fisica.py ${fechaDD} ${modo}`,
        plataformas: `python consulta_plataformas.py ${fechaDD}`
    };
    const cmd = cmds[tipo];

    el.textContent += `  COMANDO A EJECUTAR:\n  cd INVENTARIO_CIEGO\n  ${cmd}\n\n`;
    el.textContent += `  Copiado al portapapeles. Pegalo en una terminal.\n\n`;
    el.scrollTop = el.scrollHeight;

    // Copiar al portapapeles
    try {
        await navigator.clipboard.writeText(cmd);
        showToast(`Comando copiado: ${cmd}`, 'success');
    } catch(e) {
        // Fallback
        showToast(`Comando: ${cmd}`, 'success');
    }

    panelSetStatus(`Comando listo: ${desc}`, 'status-ok');
    panelSetBtnsDisabled(false);
}

async function panelConsultar() {
    const fecha = panelGetFecha();
    if (!fecha) return;

    const bodega = document.getElementById('panel-consulta-bodega').value;
    const resumenEl = document.getElementById('panel-consulta-resumen');
    const tablaEl = document.getElementById('panel-consulta-tabla');

    resumenEl.classList.add('hidden');
    tablaEl.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Consultando...</p></div>';

    try {
        let url = `${CONFIG.API_URL}/api/panel/consultar?fecha=${fecha}`;
        if (bodega) url += `&bodega=${bodega}`;

        const res = await fetch(url);
        const json = await res.json();

        if (json.error) {
            tablaEl.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${escapeHtml(json.error)}</p></div>`;
            return;
        }

        const rows = json.data;
        if (!rows || rows.length === 0) {
            tablaEl.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>No hay datos para esta fecha</p></div>';
            resumenEl.classList.add('hidden');
            return;
        }

        // Calcular resumen
        const bodegas = new Set();
        let conConteo = 0, sinStock = 0;
        rows.forEach(r => {
            bodegas.add(r.local);
            if (r.cantidad_contada !== null || r.cantidad_contada_2 !== null) conConteo++;
            if (r.cantidad === null) sinStock++;
        });

        resumenEl.innerHTML = `
            <span><i class="fas fa-boxes-stacked"></i> ${rows.length} productos</span>
            <span><i class="fas fa-warehouse"></i> ${bodegas.size} bodegas</span>
            <span><i class="fas fa-clipboard-check"></i> ${conConteo} con conteo</span>
            <span><i class="fas fa-exclamation-circle"></i> ${sinStock} sin stock</span>
        `;
        resumenEl.classList.remove('hidden');

        // Tabla
        let html = `<table class="panel-tabla">
            <thead><tr>
                <th>Bodega</th><th>Codigo</th><th>Producto</th><th>Unidad</th>
                <th class="text-right">Stock</th><th class="text-right">Conteo 1</th>
                <th class="text-right">Conteo 2</th><th class="text-right">Costo</th>
            </tr></thead><tbody>`;

        rows.forEach(r => {
            const cant = r.cantidad !== null ? parseFloat(r.cantidad).toFixed(1) : '<span class="val-null">-</span>';
            const c1 = r.cantidad_contada !== null ? `<span class="val-success">${parseFloat(r.cantidad_contada).toFixed(1)}</span>` : '<span class="val-null">-</span>';
            const c2 = r.cantidad_contada_2 !== null ? `<span class="val-success">${parseFloat(r.cantidad_contada_2).toFixed(1)}</span>` : '<span class="val-null">-</span>';
            const costo = r.costo_unitario !== null && parseFloat(r.costo_unitario) > 0 ? parseFloat(r.costo_unitario).toFixed(2) : '<span class="val-null">-</span>';
            const cantClass = r.cantidad === null ? 'val-danger' : '';

            html += `<tr>
                <td>${escapeHtml(r.local)}</td>
                <td>${escapeHtml(r.codigo)}</td>
                <td>${escapeHtml(r.nombre)}</td>
                <td>${escapeHtml(r.unidad || '')}</td>
                <td class="text-right ${cantClass}">${cant}</td>
                <td class="text-right">${c1}</td>
                <td class="text-right">${c2}</td>
                <td class="text-right">${costo}</td>
            </tr>`;
        });

        html += '</tbody></table>';
        tablaEl.innerHTML = html;

    } catch(e) {
        tablaEl.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${escapeHtml(e.message)}</p></div>`;
    }
}

async function panelBorrarStock() {
    const fecha = panelGetFecha();
    if (!fecha) return;

    const bodega = document.getElementById('panel-borrar-bodega').value;
    const infoEl = document.getElementById('panel-borrar-info');

    // Primero contar
    try {
        let url = `${CONFIG.API_URL}/api/panel/contar-stock?fecha=${fecha}`;
        if (bodega) url += `&bodega=${bodega}`;

        const res = await fetch(url);
        const json = await res.json();

        if (json.count === 0) {
            infoEl.textContent = 'No hay registros con stock para esta fecha.';
            infoEl.className = 'panel-info-msg msg-warn';
            return;
        }

        const bodegaTxt = bodega || 'TODAS las bodegas';
        const fechaDD = panelFechaDD(fecha);

        if (!confirm(
            `Se pondra cantidad = NULL en ${json.count} registros.\n\n` +
            `Fecha: ${fechaDD}\n` +
            `Bodega: ${bodegaTxt}\n\n` +
            `SOLO se borra "cantidad" (stock sistema).\n` +
            `Los conteos (cantidad_contada, cantidad_contada_2) NO se tocan.\n\n` +
            `Continuar?`
        )) {
            return;
        }

        infoEl.textContent = 'Borrando...';
        infoEl.className = 'panel-info-msg';

        const res2 = await fetch(`${CONFIG.API_URL}/api/panel/borrar-stock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fecha, bodega })
        });
        const json2 = await res2.json();

        if (json2.error) {
            infoEl.textContent = `Error: ${json2.error}`;
            infoEl.className = 'panel-info-msg msg-err';
        } else {
            infoEl.textContent = `${json2.message} | Bodega: ${bodegaTxt} | Fecha: ${fechaDD}`;
            infoEl.className = 'panel-info-msg msg-ok';
            showToast(json2.message, 'success');
        }
    } catch(e) {
        infoEl.textContent = `Error: ${e.message}`;
        infoEl.className = 'panel-info-msg msg-err';
    }
}

// ==================== SEMANAL - ASIGNACION SEMANAL ====================

let _semanalListenersAdded = false;
let _semanalSemanaActual = null; // semana object actual cargada
let _semanalDiferencias = []; // diferencias de la semana actual

function semanalInit() {
    const sel = document.getElementById('sem-bodega');
    const esAdminOSupervisor = _esAdminOSupervisor();

    // Si no es admin ni supervisor, filtrar bodegas: solo mostrar las asignadas al usuario
    if (sel && !esAdminOSupervisor) {
        const userBodegas = state.user?.bodegas || [];
        const opciones = sel.querySelectorAll('option[value]');
        opciones.forEach(opt => {
            if (opt.value && !userBodegas.includes(opt.value)) {
                opt.style.display = 'none';
            }
        });
        // Auto-seleccionar si solo tiene una bodega
        if (userBodegas.length === 1) {
            sel.value = userBodegas[0];
        }
    }

    // Setear fecha al lunes mas reciente
    const fechaInput = document.getElementById('sem-fecha-lunes');
    if (fechaInput && !fechaInput.value) {
        fechaInput.value = _semanalGetLunes(new Date());
    }
    semanalMostrarRango();

    // Cargar pendientes
    semanalCargarPendientes();

    // Event listeners (solo una vez)
    if (!_semanalListenersAdded) {
        _semanalListenersAdded = true;

        document.getElementById('btn-sem-cargar').addEventListener('click', semanalCargar);
        document.getElementById('btn-sem-guardar-todo').addEventListener('click', semanalGuardarTodo);
        document.getElementById('btn-sem-cerrar').addEventListener('click', semanalCerrar);
        document.getElementById('btn-sem-reabrir').addEventListener('click', semanalReabrir);
    }
}

function semanalMostrarRango() {
    const fechaInput = document.getElementById('sem-fecha-lunes');
    const preview = document.getElementById('sem-rango-preview');
    if (!fechaInput || !preview || !fechaInput.value) { if (preview) preview.textContent = ''; return; }

    const lunes = _semanalGetLunes(new Date(fechaInput.value + 'T12:00:00'));
    fechaInput.value = lunes; // ajustar al lunes

    const lunesDate = new Date(lunes + 'T12:00:00');
    const domingoDate = new Date(lunesDate);
    domingoDate.setDate(lunesDate.getDate() + 6);

    const dias = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

    const fmtFecha = (d) => `${dias[d.getDay()]} ${d.getDate()} ${meses[d.getMonth()]}`;
    preview.textContent = `${fmtFecha(lunesDate)} → ${fmtFecha(domingoDate)} ${domingoDate.getFullYear()}`;
}

function _semanalGetLunes(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0=dom, 1=lun...
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d.toISOString().split('T')[0];
}

function _semanalFormatFecha(isoStr) {
    if (!isoStr) return '';
    const parts = isoStr.split('-');
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return `${d.getDate()} ${meses[d.getMonth()]}`;
}

function _semanalFormatFechaLarga(isoStr) {
    if (!isoStr) return '';
    const parts = isoStr.split('-');
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return `${d.getDate()} ${meses[d.getMonth()]} ${d.getFullYear()}`;
}

function _semanalBodegaNombre(id) {
    const b = CONFIG.BODEGAS.find(x => x.id === id);
    return b ? b.nombre : id;
}

async function semanalCargar() {
    const bodega = document.getElementById('sem-bodega').value;
    const fechaRaw = document.getElementById('sem-fecha-lunes').value;

    if (!bodega) {
        showToast('Selecciona una bodega', 'error');
        return;
    }
    if (!fechaRaw) {
        showToast('Selecciona una fecha', 'error');
        return;
    }

    // Ajustar a lunes
    const fechaLunes = _semanalGetLunes(new Date(fechaRaw + 'T12:00:00'));
    document.getElementById('sem-fecha-lunes').value = fechaLunes;

    try {
        // Crear/obtener semana
        const resCrear = await fetch(`${CONFIG.API_URL}/api/semanas/crear`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ local: bodega, fecha_inicio: fechaLunes })
        });
        const semana = await resCrear.json();
        if (semana.error) {
            showToast(semana.error, 'error');
            return;
        }

        _semanalSemanaActual = semana;

        // Cargar diferencias
        const resDif = await fetch(`${CONFIG.API_URL}/api/semanas/${semana.id}/diferencias`);
        const dataDif = await resDif.json();
        if (dataDif.error) {
            showToast(dataDif.error, 'error');
            return;
        }

        _semanalSemanaActual = dataDif.semana || semana;
        _semanalDiferencias = dataDif.diferencias || [];

        // Reconstruir grupos desde asignaciones guardadas (necesario para semanas cerradas)
        _semReconstruirGruposDesdeAsignaciones();

        // Mostrar info de semana
        semanalRenderInfo(_semanalSemanaActual);
        semanalRenderDiferencias(dataDif);

        // Cargar lista de semanas de esta bodega
        const resSemanas = await fetch(`${CONFIG.API_URL}/api/semanas?local=${bodega}`);
        const semanas = await resSemanas.json();
        if (!semanas.error) {
            semanalRenderSemanas(semanas);
        }

        // Cargar resumen por persona
        const resResumen = await fetch(`${CONFIG.API_URL}/api/semanas/resumen-persona?local=${bodega}`);
        const resumenData = await resResumen.json();
        if (!resumenData.error) {
            semanalRenderResumenPersonas(resumenData);
        }

    } catch (error) {
        console.error('Error cargando semana:', error);
        showToast('Error de conexion al cargar semana', 'error');
    }
}

function semanalRenderInfo(semana) {
    const infoEl = document.getElementById('sem-info');
    infoEl.classList.remove('hidden');

    const rangoEl = document.getElementById('sem-rango-fechas');
    rangoEl.innerHTML = `<i class="fas fa-calendar-week"></i> <strong>${_semanalFormatFechaLarga(semana.fecha_inicio)}</strong> al <strong>${_semanalFormatFechaLarga(semana.fecha_fin)}</strong> &mdash; ${_semanalBodegaNombre(semana.local)}`;

    const badgeEl = document.getElementById('sem-estado-badge');
    const esCerrada = semana.estado === 'cerrada';
    badgeEl.innerHTML = esCerrada
        ? `<span class="sem-badge sem-badge-cerrada"><i class="fas fa-lock"></i> Cerrada</span>`
        : `<span class="sem-badge sem-badge-abierta"><i class="fas fa-lock-open"></i> Abierta</span>`;

    if (esCerrada && semana.cerrada_por) {
        const cerradaAt = semana.cerrada_at ? ` el ${_semanalFormatFechaLarga(semana.cerrada_at.split('T')[0])}` : '';
        badgeEl.innerHTML += `<span class="sem-cerrada-info">por ${escapeHtml(semana.cerrada_por)}${cerradaAt}</span>`;
    }

    document.getElementById('btn-sem-cerrar').style.display = esCerrada ? 'none' : '';
    document.getElementById('btn-sem-reabrir').style.display = esCerrada ? '' : 'none';
}

function semanalRenderSemanas(semanas) {
    const container = document.getElementById('sem-lista-semanas');
    if (!semanas || semanas.length === 0) {
        container.innerHTML = '';
        return;
    }

    let html = '<h3 class="sem-seccion-titulo"><i class="fas fa-list"></i> Semanas de esta Bodega</h3><div class="sem-cards-grid">';

    const esAdminSem = _esAdmin();

    semanas.forEach(s => {
        const esCerrada = s.estado === 'cerrada';
        const esActiva = _semanalSemanaActual && _semanalSemanaActual.id === s.id;
        const rangoTxt = `${_semanalFormatFecha(s.fecha_inicio)} - ${_semanalFormatFechaLarga(s.fecha_fin)}`;
        const badgeClass = esCerrada ? 'sem-badge-cerrada' : 'sem-badge-abierta';
        const badgeIcon = esCerrada ? 'fa-lock' : 'fa-lock-open';
        const badgeText = esCerrada ? 'Cerrada' : 'Abierta';
        const totalAsig = typeof s.total_asignado === 'number' ? `$${s.total_asignado.toFixed(2)}` : '$0.00';

        html += `
            <div class="sem-semana-card ${esActiva ? 'sem-card-activa' : ''}" onclick="semanalCargarSemanaById(${s.id})">
                <div class="sem-card-rango">${rangoTxt}</div>
                <div class="sem-card-meta">
                    <span class="sem-badge ${badgeClass}"><i class="fas ${badgeIcon}"></i> ${badgeText}</span>
                    <span class="sem-card-stat"><i class="fas fa-box"></i> ${s.total_productos || 0} productos</span>
                    <span class="sem-card-stat"><i class="fas fa-dollar-sign"></i> ${totalAsig}</span>
                    ${esAdminSem ? `<button onclick="event.stopPropagation(); semanalEliminarSemana(${s.id}, ${esCerrada})" title="Eliminar semana" style="background:var(--accent);color:white;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:11px;"><i class="fas fa-trash-alt"></i> Eliminar</button>` : ''}
                </div>
                ${esCerrada && s.cerrada_por ? `<div class="sem-card-cerrada-info">Cerrada por ${escapeHtml(s.cerrada_por)}</div>` : ''}
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
}

async function semanalCargarSemanaById(id) {
    try {
        const resDif = await fetch(`${CONFIG.API_URL}/api/semanas/${id}/diferencias`);
        const dataDif = await resDif.json();
        if (dataDif.error) {
            showToast(dataDif.error, 'error');
            return;
        }
        _semanalSemanaActual = dataDif.semana;
        _semanalDiferencias = dataDif.diferencias || [];

        // Reconstruir grupos desde las asignaciones ya guardadas
        _semReconstruirGruposDesdeAsignaciones();

        semanalRenderInfo(_semanalSemanaActual);
        semanalRenderDiferencias(dataDif);

        // Re-highlight the card
        document.querySelectorAll('.sem-semana-card').forEach(c => c.classList.remove('sem-card-activa'));
    } catch (error) {
        console.error('Error cargando semana:', error);
        showToast('Error al cargar semana', 'error');
    }
}

// Reconstruye _semGrupos desde las asignaciones ya guardadas en BD
// Agrupa productos que tienen el mismo conjunto de personas
function _semReconstruirGruposDesdeAsignaciones() {
    _semGrupos = [];
    const esCerrada = _semanalSemanaActual && _semanalSemanaActual.estado === 'cerrada';

    _semanalDiferencias.forEach(prod => {
        if (prod.justificado) return;
        if (!prod.asignacion || !prod.asignacion.personas || prod.asignacion.personas.length === 0) return;

        // Personas del producto (nombres ordenados para comparar)
        const personas = prod.asignacion.personas.map(p => p.persona).sort();
        const cantidadTotal = prod.asignacion.personas.reduce((s, p) => s + (parseFloat(p.cantidad) || 0), 0);

        // Buscar un grupo existente con las mismas personas
        const keyPersonas = personas.join('|');
        let grupo = _semGrupos.find(g => g.personas.slice().sort().join('|') === keyPersonas);

        if (!grupo) {
            grupo = { productos: [], personas: personas };
            _semGrupos.push(grupo);
        }

        grupo.productos.push({ codigo: prod.codigo, cantidad: cantidadTotal });
    });

    // Agregar grupo vacío al final para nuevas asignaciones (si no está cerrada)
    if (!esCerrada) {
        _semGrupos.push({ productos: [], personas: [] });
    }
}

// Estado local del módulo semanal - múltiples grupos
// _semGrupos = [{ productos: [{codigo, cantidad}], personas: [nombre] }, ...]
let _semGrupos = [];
let _semanalProductosSeleccionados = []; // deprecated
let _semanalProductosJustificados = [];  // deprecated
let _semanalPersonasSeleccionadas = [];  // deprecated

// Calcula cuánto ya está asignado de un producto en TODOS los grupos (excepto gIdx)
function _semCalcAsignadoOtros(codigo, excluirGIdx) {
    let total = 0;
    _semGrupos.forEach((g, i) => {
        if (i === excluirGIdx) return;
        const prod = g.productos.find(p => p.codigo === codigo);
        if (prod) total += parseFloat(prod.cantidad) || 0;
    });
    return total;
}

function semanalRenderDiferencias(data) {
    const container = document.getElementById('sem-diferencias');
    const listEl = document.getElementById('sem-productos-list');
    const diferencias = data.diferencias || [];

    if (diferencias.length === 0) {
        // Para semanas cerradas con asignaciones guardadas, continuar para mostrar el resumen
        const gruposConDatos = (_semGrupos || []).filter(g => g.productos.length > 0 && g.personas.length > 0);
        if (!esCerrada || gruposConDatos.length === 0) {
            container.classList.remove('hidden');
            listEl.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle"></i><p>No hay diferencias netas en esta semana (todo se compensó)</p></div>';
            document.getElementById('btn-sem-guardar-todo').style.display = 'none';
            return;
        }
    }

    container.classList.remove('hidden');
    const esCerrada = _semanalSemanaActual && _semanalSemanaActual.estado === 'cerrada';
    document.getElementById('btn-sem-guardar-todo').style.display = esCerrada ? 'none' : '';

    // Si no hay grupos aún, crear uno vacío (solo si no está cerrada)
    if (_semGrupos.length === 0 && !esCerrada) {
        _semGrupos.push({ productos: [], personas: [] });
    }
    // Asegurar que haya SIEMPRE un grupo vacío al final para nuevas asignaciones (no cerrada)
    if (!esCerrada) {
        const ultimo = _semGrupos[_semGrupos.length - 1];
        if (ultimo && (ultimo.productos.length > 0 || ultimo.personas.length > 0)) {
            _semGrupos.push({ productos: [], personas: [] });
        }
    }

    // KPIs
    const productosCobrar = diferencias.filter(p => !p.justificado);
    const valorACobrar = productosCobrar.reduce((s, p) =>
        s + Math.abs(parseFloat(p.diferencia) || 0) * (parseFloat(p.costo_unitario) || 0), 0);
    const valorJustificado = diferencias.filter(p => p.justificado)
        .reduce((s, p) => s + Math.abs(parseFloat(p.diferencia) || 0) * (parseFloat(p.costo_unitario) || 0), 0);

    // Calcular valor total ya asignado en todos los grupos
    let valorAsignadoTotal = 0;
    _semGrupos.forEach(g => {
        g.productos.forEach(p => {
            const prodOrig = diferencias.find(d => d.codigo === p.codigo);
            if (prodOrig && !prodOrig.justificado) {
                const costo = parseFloat(prodOrig.costo_unitario) || 0;
                valorAsignadoTotal += (parseFloat(p.cantidad) || 0) * costo;
            }
        });
    });
    const pendientePorAsignar = Math.max(0, valorACobrar - valorAsignadoTotal);
    const pendienteClass = pendientePorAsignar > 0.01 ? 'sem-kpi-neg' : 'sem-kpi-pos';
    const pendienteIcon = pendientePorAsignar > 0.01 ? 'fa-exclamation-circle' : 'fa-check-circle';

    // Render grupos
    const gruposHtml = _semGrupos.map((g, gIdx) => _semHtmlGrupo(g, gIdx, diferencias, esCerrada)).join('');

    // === Resumen consolidado por persona ===
    // Suma los montos de cada persona en todos los grupos y lista los productos que le corresponden
    const resumenPersonas = {}; // { nombre: { monto: 0, detalles: [{producto, cantidad, valor}] } }
    _semGrupos.forEach(g => {
        if (g.productos.length === 0 || g.personas.length === 0) return;
        let totalGrupo = 0;
        const productosGrupo = [];
        g.productos.forEach(p => {
            const prodOrig = diferencias.find(d => d.codigo === p.codigo);
            if (prodOrig && !prodOrig.justificado) {
                const costo = parseFloat(prodOrig.costo_unitario) || 0;
                const cant = parseFloat(p.cantidad) || 0;
                const valor = cant * costo;
                totalGrupo += valor;
                productosGrupo.push({
                    nombre: prodOrig.nombre,
                    codigo: prodOrig.codigo,
                    unidad: prodOrig.unidad || '',
                    cantidad_total: cant,
                    valor_total: valor
                });
            }
        });
        const montoPersona = totalGrupo / g.personas.length;
        const cantDivisor = g.personas.length;
        g.personas.forEach(nombre => {
            if (!resumenPersonas[nombre]) resumenPersonas[nombre] = { monto: 0, detalles: [] };
            resumenPersonas[nombre].monto += montoPersona;
            productosGrupo.forEach(p => {
                resumenPersonas[nombre].detalles.push({
                    nombre: p.nombre,
                    codigo: p.codigo,
                    unidad: p.unidad,
                    cantidad: p.cantidad_total / cantDivisor,
                    valor: p.valor_total / cantDivisor
                });
            });
        });
    });

    const personasOrdenadas = Object.keys(resumenPersonas).sort();
    let resumenConsolidadoHtml = '';
    if (personasOrdenadas.length > 0) {
        const totalConsolidado = personasOrdenadas.reduce((s, n) => s + resumenPersonas[n].monto, 0);
        resumenConsolidadoHtml = `
            <div class="sem-resumen-final">
                <div class="sem-resumen-header">
                    <h3><i class="fas fa-receipt"></i> Resumen Consolidado por Persona</h3>
                    <div style="display:flex;align-items:center;gap:10px;">
                        <span class="sem-resumen-total-chip">Total: $${totalConsolidado.toFixed(2)}</span>
                    </div>
                </div>

                <div class="sem-resumen-acciones">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;">
                            <input type="checkbox" id="sem-sel-todas" onchange="_semToggleTodasPersonas(this.checked)">
                            Seleccionar todas
                        </label>
                        <span id="sem-contador-seleccionadas" style="font-size:12px;color:var(--text-medium);">0 seleccionadas</span>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <button class="btn-sem-imprimir-sec" onclick="semanalImprimirActas()">
                            <i class="fas fa-file-pdf"></i> Imprimir Seleccionadas
                        </button>
                        <button class="btn-sem-imprimir" onclick="semanalImprimirActasTodas()">
                            <i class="fas fa-print"></i> Imprimir Consolidado (Todas)
                        </button>
                    </div>
                </div>

                <div class="sem-resumen-cards">
                    ${personasOrdenadas.map(nombre => {
                        const r = resumenPersonas[nombre];
                        // Consolidar productos del mismo código
                        const prodMap = {};
                        r.detalles.forEach(d => {
                            const k = d.codigo;
                            if (!prodMap[k]) prodMap[k] = { nombre: d.nombre, codigo: d.codigo, unidad: d.unidad, cantidad: 0, valor: 0 };
                            prodMap[k].cantidad += d.cantidad;
                            prodMap[k].valor += d.valor;
                        });
                        const productos = Object.values(prodMap);
                        const nombreSafe = nombre.replace(/"/g, '&quot;');
                        return `
                        <div class="sem-persona-card">
                            <div class="sem-persona-card-header">
                                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1;">
                                    <input type="checkbox" class="sem-persona-check" data-nombre="${nombreSafe}"
                                           onchange="_semActualizarContador()"
                                           style="width:16px;height:16px;cursor:pointer;">
                                    <i class="fas fa-user-circle"></i>
                                    <strong>${escapeHtml(nombre)}</strong>
                                </label>
                                <span class="sem-persona-monto">$${r.monto.toFixed(2)}</span>
                            </div>
                            <table class="sem-persona-detalle">
                                <thead><tr><th>Producto</th><th style="text-align:center;">Cantidad</th><th style="text-align:right;">Monto</th></tr></thead>
                                <tbody>
                                    ${productos.map(p => `
                                        <tr>
                                            <td>${escapeHtml(p.nombre)}</td>
                                            <td style="text-align:center;">${p.cantidad.toFixed(2)} ${p.unidad}</td>
                                            <td style="text-align:right;font-weight:600;">$${p.valor.toFixed(2)}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>`;
                    }).join('')}
                </div>
            </div>
        `;
    }

    listEl.innerHTML = `
        <div class="sem-kpis">
            <div class="sem-kpi sem-kpi-neg"><span class="sem-kpi-val">$${valorACobrar.toFixed(2)}</span><span class="sem-kpi-label">Total a Cobrar</span></div>
            <div class="sem-kpi sem-kpi-pos"><span class="sem-kpi-val">$${valorJustificado.toFixed(2)}</span><span class="sem-kpi-label">Justificado (no se cobra)</span></div>
            <div class="sem-kpi"><span class="sem-kpi-val">$${valorAsignadoTotal.toFixed(2)}</span><span class="sem-kpi-label">Ya asignado</span></div>
            <div class="sem-kpi ${pendienteClass}"><span class="sem-kpi-val"><i class="fas ${pendienteIcon}" style="font-size:14px;margin-right:4px;"></i>$${pendientePorAsignar.toFixed(2)}</span><span class="sem-kpi-label">Pendiente por asignar</span></div>
        </div>
        <div id="sem-grupos-container">${gruposHtml}</div>
        ${!esCerrada ? `<div style="text-align:center;margin:16px 0;">
            <button class="btn-secondary" onclick="_semAgregarGrupo()" style="padding:10px 24px;">
                <i class="fas fa-plus"></i> Agregar Grupo de Asignación
            </button>
        </div>` : ''}
        ${resumenConsolidadoHtml}
    `;

    // Guardar resumen para generar PDFs
    _semResumenPersonas = resumenPersonas;
}

let _semResumenPersonas = {};

function _semHtmlGrupo(grupo, gIdx, diferencias, esCerrada) {
    // Calcular total del grupo
    let totalGrupo = 0;
    grupo.productos.forEach(p => {
        const prodOrig = diferencias.find(d => d.codigo === p.codigo);
        if (prodOrig && !prodOrig.justificado) {
            totalGrupo += (parseFloat(p.cantidad) || 0) * (parseFloat(prodOrig.costo_unitario) || 0);
        }
    });
    const montoPorPersona = grupo.personas.length > 0 ? totalGrupo / grupo.personas.length : 0;

    // Productos HTML (checkbox + cantidad)
    const productosHtml = diferencias.map(prod => {
        if (prod.justificado) return ''; // no mostrar justificados
        const diff = parseFloat(prod.diferencia) || 0;
        const difAbs = Math.abs(diff);
        const costo = parseFloat(prod.costo_unitario) || 0;
        const unidad = prod.unidad || '';
        const difClass = diff < 0 ? 'negativa' : 'positiva';
        const difLabel = diff < 0 ? '▼' : '▲';

        const prodEnGrupo = grupo.productos.find(p => p.codigo === prod.codigo);
        const seleccionado = !!prodEnGrupo;
        const asignadoOtros = _semCalcAsignadoOtros(prod.codigo, gIdx);
        const disponible = Math.max(0, difAbs - asignadoOtros);
        const cantAsig = seleccionado ? (parseFloat(prodEnGrupo.cantidad) || disponible) : disponible;
        const valorAsig = cantAsig * costo;

        // No mostrar si no hay nada disponible y no está seleccionado
        if (disponible <= 0.001 && !seleccionado) return '';

        return `
        <label class="sec-prod-item ${seleccionado ? 'selected' : ''}" data-gidx="${gIdx}" data-codigo="${escapeHtml(prod.codigo)}">
            <input type="checkbox" ${seleccionado ? 'checked' : ''} ${esCerrada ? 'disabled' : ''}
                   onchange="_semToggleProdEnGrupo(${gIdx}, '${escapeHtml(prod.codigo)}', this.checked)">
            <div class="sec-prod-info">
                <span class="sec-prod-nombre">${escapeHtml(prod.nombre)}</span>
                <span class="sec-prod-dif ${difClass}">${difLabel} disp. ${disponible.toFixed(2)} de ${difAbs.toFixed(2)} ${unidad}</span>
            </div>
            ${seleccionado ? `
                <div class="sec-prod-qty">
                    <input type="number" class="sec-qty-input" value="${cantAsig.toFixed(2)}"
                           min="0" max="${disponible.toFixed(2)}" step="0.01"
                           ${esCerrada ? 'disabled' : ''}
                           onchange="_semActualizarCantidad(${gIdx}, '${escapeHtml(prod.codigo)}', this.value, ${disponible.toFixed(4)})"
                           oninput="_semActualizarCantidad(${gIdx}, '${escapeHtml(prod.codigo)}', this.value, ${disponible.toFixed(4)})">
                    <span class="sec-qty-unidad">${unidad}</span>
                </div>` : ''}
            <span class="sec-prod-valor" style="font-weight:${seleccionado ? '700' : '400'};color:${seleccionado ? 'var(--accent)' : '#94A3B8'};">$${valorAsig.toFixed(2)}</span>
        </label>`;
    }).join('');

    // Personas HTML
    const personasHtml = grupo.personas.length === 0
        ? '<div class="sec-empty-inner"><i class="fas fa-user-plus"></i> Agrega personas</div>'
        : grupo.personas.map((nombre, pIdx) => `
            <div class="sec-persona-chip">
                <i class="fas fa-user"></i>
                <span>${escapeHtml(nombre)}</span>
                ${!esCerrada ? `<button class="baja-item-del" onclick="_semQuitarPersonaGrupo(${gIdx}, ${pIdx})" title="Quitar"><i class="fas fa-times"></i></button>` : ''}
            </div>`).join('');

    const resumen = grupo.personas.length > 0 && totalGrupo > 0 ? `
        <div class="sec-division-info">
            <i class="fas fa-divide"></i>
            <strong>$${totalGrupo.toFixed(2)}</strong> ÷ ${grupo.personas.length} persona(s) = <strong>$${montoPorPersona.toFixed(2)}</strong> c/u
        </div>` : '';

    return `
    <div class="sec-card" data-gidx="${gIdx}" style="margin-bottom:14px;">
        <div class="sec-card-header">
            <span class="sec-nombre-input" style="pointer-events:none;"><i class="fas fa-layer-group"></i> Grupo ${gIdx + 1}</span>
            <div style="display:flex;align-items:center;gap:8px;">
                <span class="sec-total-chip" style="background:var(--accent);color:white;">$${totalGrupo.toFixed(2)}</span>
                ${!esCerrada && _semGrupos.length > 1 ? `<button class="btn-icon" onclick="_semEliminarGrupo(${gIdx})" title="Eliminar grupo" style="background:transparent;border:none;color:var(--accent);cursor:pointer;"><i class="fas fa-trash-alt"></i></button>` : ''}
            </div>
        </div>
        <div class="sec-two-col">
            <div class="sec-col">
                <div class="sec-col-header">
                    <span><i class="fas fa-box-open"></i> Productos</span>
                </div>
                <div class="sec-productos-lista" style="max-height:300px;overflow-y:auto;">${productosHtml || '<div class="sec-empty-inner">No quedan productos disponibles</div>'}</div>
            </div>
            <div class="sec-col">
                <div class="sec-col-header">
                    <span><i class="fas fa-users"></i> Personas (se divide entre ellas)</span>
                    ${!esCerrada ? `<button class="btn-secondary btn-xs" onclick="_semAbrirPersonaGrupo(${gIdx})"><i class="fas fa-plus"></i> Agregar</button>` : ''}
                </div>
                <div class="sec-personas-lista chips">${personasHtml}</div>
                ${resumen}
            </div>
        </div>
    </div>`;
}

function _semAgregarGrupo() {
    _semGrupos.push({ productos: [], personas: [] });
    semanalRenderDiferencias({ diferencias: _semanalDiferencias });
}

function _semEliminarGrupo(gIdx) {
    if (_semGrupos.length <= 1) { showToast('Debe haber al menos un grupo', 'error'); return; }
    if (!confirm('¿Eliminar este grupo?')) return;
    _semGrupos.splice(gIdx, 1);
    semanalRenderDiferencias({ diferencias: _semanalDiferencias });
}

function _semToggleProdEnGrupo(gIdx, codigo, checked) {
    const grupo = _semGrupos[gIdx];
    if (!grupo) return;
    if (checked) {
        if (!grupo.productos.find(p => p.codigo === codigo)) {
            const prodOrig = _semanalDiferencias.find(d => d.codigo === codigo);
            const difAbs = Math.abs(parseFloat(prodOrig.diferencia) || 0);
            const asignadoOtros = _semCalcAsignadoOtros(codigo, gIdx);
            const disponible = Math.max(0, difAbs - asignadoOtros);
            grupo.productos.push({ codigo, cantidad: disponible });
        }
    } else {
        grupo.productos = grupo.productos.filter(p => p.codigo !== codigo);
    }
    semanalRenderDiferencias({ diferencias: _semanalDiferencias });
}

function _semActualizarCantidad(gIdx, codigo, valor, maximo) {
    const grupo = _semGrupos[gIdx];
    if (!grupo) return;
    let cant = parseFloat(valor) || 0;
    if (cant > maximo) cant = maximo;
    if (cant < 0) cant = 0;
    const prod = grupo.productos.find(p => p.codigo === codigo);
    if (prod) prod.cantidad = cant;
    semanalRenderDiferencias({ diferencias: _semanalDiferencias });
}

async function _semAbrirPersonaGrupo(gIdx) {
    // Recargar personas si no hay o para tener datos frescos
    if (!state.personas || state.personas.length === 0) {
        await cargarPersonas();
    }
    const personas = state.personas || [];
    if (personas.length === 0) { showToast('No hay personas cargadas', 'error'); return; }
    const grupo = _semGrupos[gIdx];
    const opciones = personas.map(p => typeof p === 'string' ? p : p.nombre)
        .filter(n => !grupo.personas.includes(n));
    if (opciones.length === 0) { showToast('Todas las personas ya están en este grupo', 'info'); return; }

    let existing = document.getElementById('sem-persona-dropdown');
    if (existing) { existing.remove(); return; }

    const card = document.querySelector(`.sec-card[data-gidx="${gIdx}"]`);
    const btn = card?.querySelector('.sec-col:last-child .btn-secondary');
    if (!btn) return;

    const esMobil = window.innerWidth <= 768;

    const wrapper = document.createElement('div');
    wrapper.id = 'sem-persona-dropdown';
    if (esMobil) {
        // En móvil: modal fijo en la parte inferior
        wrapper.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:300;background:white;border-top:2px solid var(--primary);border-radius:16px 16px 0 0;box-shadow:0 -4px 20px rgba(0,0,0,0.2);max-height:60vh;display:flex;flex-direction:column;';
    } else {
        wrapper.style.cssText = 'position:absolute;right:0;top:100%;z-index:50;background:white;border:1px solid var(--border);border-radius:var(--radius-sm);box-shadow:0 4px 12px rgba(0,0,0,0.1);width:280px;max-width:90vw;margin-top:4px;';
    }
    wrapper.innerHTML = `
        <div style="padding:10px 12px;border-bottom:1px solid var(--border-light);display:flex;align-items:center;gap:8px;">
            ${esMobil ? '<button onclick="document.getElementById(\'sem-persona-dropdown\').remove()" style="background:none;border:none;font-size:18px;cursor:pointer;color:#94A3B8;padding:4px;"><i class="fas fa-times"></i></button>' : ''}
            <input type="text" id="sem-persona-buscar" placeholder="Buscar persona..."
                   style="flex:1;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;font-family:inherit;outline:none;" autofocus>
        </div>
        <div id="sem-persona-resultados" style="flex:1;overflow-y:auto;max-height:${esMobil ? '50vh' : '250px'};"></div>
    `;
    if (esMobil) {
        document.body.appendChild(wrapper);
    } else {
        btn.parentElement.style.position = 'relative';
        btn.parentElement.appendChild(wrapper);
    }

    const inputBuscar = document.getElementById('sem-persona-buscar');
    const resultados = document.getElementById('sem-persona-resultados');

    const renderLista = (filtro = '') => {
        const f = filtro.toLowerCase().trim();
        const filtradas = f ? opciones.filter(n => n.toLowerCase().includes(f)) : opciones;
        if (filtradas.length === 0) {
            resultados.innerHTML = '<div style="padding:12px;text-align:center;color:#94A3B8;font-size:12px;">Sin resultados</div>';
            return;
        }
        resultados.innerHTML = filtradas.slice(0, 50).map(n => `
            <div class="obs-agregar-item" onclick="_semAgregarPersonaAGrupo(${gIdx}, '${n.replace(/'/g, "\\'")}')">
                <i class="fas fa-user" style="color:var(--primary);"></i>
                <span>${n}</span>
            </div>
        `).join('');
    };

    renderLista();
    inputBuscar.focus();
    inputBuscar.addEventListener('input', (e) => renderLista(e.target.value));

    setTimeout(() => {
        document.addEventListener('click', function _cerrar(e) {
            if (!wrapper.contains(e.target) && e.target !== btn) {
                wrapper.remove();
                document.removeEventListener('click', _cerrar);
            }
        });
    }, 10);
}

function _semAgregarPersonaAGrupo(gIdx, nombre) {
    const grupo = _semGrupos[gIdx];
    if (!grupo) return;
    if (!grupo.personas.includes(nombre)) grupo.personas.push(nombre);
    const dropdown = document.getElementById('sem-persona-dropdown');
    if (dropdown) dropdown.remove();
    semanalRenderDiferencias({ diferencias: _semanalDiferencias });
}

function _semQuitarPersonaGrupo(gIdx, pIdx) {
    const grupo = _semGrupos[gIdx];
    if (!grupo) return;
    grupo.personas.splice(pIdx, 1);
    semanalRenderDiferencias({ diferencias: _semanalDiferencias });
}

function _semSeleccionarTodosProds() {
    _semanalProductosSeleccionados = _semanalDiferencias
        .filter(p => !_semanalProductosJustificados.includes(p.codigo))
        .map(p => p.codigo);
    semanalRenderDiferencias({ diferencias: _semanalDiferencias });
}

function _semDeseleccionarTodosProds() {
    _semanalProductosSeleccionados = [];
    semanalRenderDiferencias({ diferencias: _semanalDiferencias });
}

function _semToggleJustificar(codigo) {
    if (_semanalProductosJustificados.includes(codigo)) {
        _semanalProductosJustificados = _semanalProductosJustificados.filter(c => c !== codigo);
    } else {
        _semanalProductosJustificados.push(codigo);
        // Si estaba seleccionado para cobrar, quitarlo
        _semanalProductosSeleccionados = _semanalProductosSeleccionados.filter(c => c !== codigo);
    }
    semanalRenderDiferencias({ diferencias: _semanalDiferencias });
}

function _semAgregarTodasPersonas() {
    const personas = state.personas || [];
    _semanalPersonasSeleccionadas = personas.map(p => typeof p === 'string' ? p : p.nombre);
    semanalRenderDiferencias({ diferencias: _semanalDiferencias });
}

function _semToggleTodasPersonas(checked) {
    document.querySelectorAll('.sem-persona-check').forEach(c => c.checked = checked);
    _semActualizarContador();
}

function _semActualizarContador() {
    const seleccionadas = document.querySelectorAll('.sem-persona-check:checked').length;
    const total = document.querySelectorAll('.sem-persona-check').length;
    const cont = document.getElementById('sem-contador-seleccionadas');
    if (cont) cont.textContent = `${seleccionadas} de ${total} seleccionadas`;
    // Checkbox de "todas" se marca si todas están
    const todasCheck = document.getElementById('sem-sel-todas');
    if (todasCheck) todasCheck.checked = seleccionadas === total && total > 0;
}

function semanalImprimirActas() {
    const seleccionadas = Array.from(document.querySelectorAll('.sem-persona-check:checked'))
        .map(c => c.dataset.nombre);
    if (seleccionadas.length === 0) {
        showToast('Selecciona al menos una persona', 'error');
        return;
    }
    _semGenerarPDFActas(seleccionadas);
}

function semanalImprimirActasTodas() {
    const todas = Object.keys(_semResumenPersonas || {}).sort();
    if (todas.length === 0) {
        showToast('No hay personas asignadas', 'error');
        return;
    }
    _semGenerarPDFActas(todas);
}

async function _semGenerarPDFActas(nombres) {
    if (!_semanalSemanaActual) { showToast('No hay semana cargada', 'error'); return; }

    // Traer cédulas desde el backend
    let cedulasMap = {};
    try {
        const res = await fetch(`${CONFIG.API_URL}/api/personas-cedulas`);
        if (res.ok) cedulasMap = await res.json();
    } catch(e) { console.log('No se pudieron cargar cédulas:', e); }

    const bodegaNombre = _semanalBodegaNombre(_semanalSemanaActual.local);
    const fechaIni = _semanalFormatFechaLarga(_semanalSemanaActual.fecha_inicio);
    const fechaFin = _semanalFormatFechaLarga(_semanalSemanaActual.fecha_fin);
    const hoy = new Date().toLocaleDateString('es-EC', { day: '2-digit', month: 'long', year: 'numeric' });

    // Generar HTML de cada acta en hoja separada
    const actasHtml = nombres.map(nombre => {
        const r = _semResumenPersonas[nombre];
        if (!r) return '';
        const cedula = cedulasMap[nombre] || '________________';

        // Consolidar productos
        const prodMap = {};
        r.detalles.forEach(d => {
            const k = d.codigo;
            if (!prodMap[k]) prodMap[k] = { nombre: d.nombre, unidad: d.unidad, cantidad: 0, valor: 0 };
            prodMap[k].cantidad += d.cantidad;
            prodMap[k].valor += d.valor;
        });
        const productos = Object.values(prodMap);

        return `
            <div class="acta-page">
                <div class="acta-title">
                    <h1>Acta de Autorización de Descuentos</h1>
                </div>

                <div class="acta-dirigido">
                    <p><strong>SEÑORES</strong><br>
                    <strong>FOODIX S.A.S.</strong></p>
                </div>

                <div class="acta-fecha-lugar">
                    <p style="text-align:right;">${hoy}</p>
                </div>

                <div class="acta-declaracion">
                    <p>Yo, <strong>${nombre}</strong>, portador/a de la cédula de identidad N° <strong>${cedula}</strong>,
                    <strong>autorizo de manera expresa, voluntaria e irrevocable</strong> para que, al momento de mi liquidación o en mi próximo rol de pagos,
                    se efectúen los descuentos correspondientes de los siguientes valores y conceptos,
                    los cuales reconozco y acepto en su totalidad:</p>
                </div>

                <div class="acta-contexto">
                    <p><strong>Período:</strong> Semana del ${fechaIni} al ${fechaFin} · <strong>Local:</strong> ${bodegaNombre}</p>
                </div>

                <table class="acta-tabla">
                    <thead>
                        <tr>
                            <th>Concepto de descuento</th>
                            <th style="text-align:center;">Cantidad</th>
                            <th style="text-align:right;">Valor</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${productos.map(p => `
                            <tr>
                                <td>Diferencia de inventario — ${p.nombre}</td>
                                <td style="text-align:center;">${p.cantidad.toFixed(2)} ${p.unidad || ''}</td>
                                <td style="text-align:right;">$${p.valor.toFixed(2)}</td>
                            </tr>
                        `).join('')}
                        <tr class="acta-total">
                            <td colspan="2" style="text-align:right;"><strong>TOTAL A DESCONTAR:</strong></td>
                            <td style="text-align:right;"><strong>$${r.monto.toFixed(2)}</strong></td>
                        </tr>
                    </tbody>
                </table>

                <div class="acta-acuerdo">
                    <p>Asimismo, <strong>reconozco y acepto que todos los valores anteriormente mencionados me sean descontados
                    en mi liquidación de haberes o en mi próximo rol de pagos</strong>.</p>
                </div>

                <div class="acta-atentamente">
                    <p>Atentamente,</p>
                </div>

                <div class="acta-firma-empleado">
                    <div class="acta-linea-firma"></div>
                    <p>(Firma del empleado)</p>
                    <p><strong>${nombre}</strong></p>
                    <p>C.I.: ${cedula}</p>
                </div>
            </div>
        `;
    }).join('');

    // Abrir ventana de impresión
    const win = window.open('', '_blank', 'width=900,height=700');
    win.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Actas de Aceptación - ${fechaIni} al ${fechaFin}</title>
            <style>
                * { box-sizing: border-box; }
                body { font-family: 'Calibri', 'Arial', 'Helvetica', sans-serif; margin: 0; padding: 0; color: #000; }
                .acta-page { page-break-after: always; padding: 40px 50px; }
                .acta-page:last-child { page-break-after: avoid; }

                .acta-title { text-align: center; margin-bottom: 30px; }
                .acta-title h1 { margin: 0; color: #000; font-size: 18px; font-weight: 700; }

                .acta-dirigido { margin-bottom: 20px; font-size: 13px; }
                .acta-dirigido p { margin: 0; line-height: 1.5; }

                .acta-fecha-lugar { margin-bottom: 20px; font-size: 12px; color: #555; }
                .acta-fecha-lugar p { margin: 0; }

                .acta-declaracion { font-size: 13px; line-height: 1.7; text-align: justify; margin-bottom: 14px; }
                .acta-declaracion p { margin: 0; }

                .acta-contexto { font-size: 12px; color: #64748B; margin-bottom: 14px; padding: 8px 12px; background: #F8FAFC; border-left: 3px solid #123450; }
                .acta-contexto p { margin: 0; }

                .acta-tabla { width: 100%; border-collapse: collapse; margin: 14px 0 20px; font-size: 12px; }
                .acta-tabla th { background: #1E3A5F; color: white; padding: 8px 10px; text-align: left; font-size: 11px; font-weight: 600; border: 1px solid #1E3A5F; }
                .acta-tabla td { padding: 8px 10px; border: 1px solid #CBD5E1; }
                .acta-total { background: #F1F5F9; }
                .acta-total td { border-top: 2px solid #1E3A5F; font-size: 13px; }

                .acta-acuerdo { font-size: 13px; line-height: 1.7; text-align: justify; margin: 18px 0; }
                .acta-acuerdo p { margin: 0; }

                .acta-atentamente { margin-top: 40px; font-size: 13px; }
                .acta-atentamente p { margin: 0; }

                .acta-firma-empleado { margin-top: 40px; text-align: left; font-size: 12px; max-width: 350px; }
                .acta-linea-firma { border-top: 1px solid #000; margin-bottom: 4px; width: 100%; }
                .acta-firma-empleado p { margin: 2px 0; }

                @media print {
                    .acta-page { page-break-after: always; page-break-inside: avoid; }
                    .acta-page:last-child { page-break-after: avoid; }
                    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; }
                    html, body { height: auto; }
                }
            </style>
        </head>
        <body>
            ${actasHtml}
            <script>
                window.onload = function() { setTimeout(function() { window.print(); }, 300); };
            </script>
        </body>
        </html>
    `);
    win.document.close();
}

function semanalContinuarSemana(id, local, fechaInicio) {
    // Cambiar bodega y fecha en los selectores
    const selBodega = document.getElementById('sem-bodega');
    const inputFecha = document.getElementById('sem-fecha-lunes');
    if (selBodega) selBodega.value = local;
    if (inputFecha) {
        inputFecha.value = fechaInicio;
        semanalMostrarRango();
    }
    // Cargar la semana
    semanalCargarSemanaById(id);
    // Scroll suave hasta las diferencias
    setTimeout(() => {
        const el = document.getElementById('sem-diferencias');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 300);
}

async function semanalEliminarSemana(id, esCerrada) {
    const msg = esCerrada
        ? '⚠️ Esta semana está CERRADA. Al eliminarla, los productos asignados quedarán sin responsables y deberán ser reasignados.\n\n¿Confirmas eliminar esta semana cerrada y todas sus asignaciones?'
        : '¿Eliminar esta semana y todas sus asignaciones?';
    if (!confirm(msg)) return;
    try {
        const res = await fetch(`${CONFIG.API_URL}/api/semanas/${id}`, { method: 'DELETE' });
        if (res.ok) {
            const data = await res.json();
            const mensaje = data.estado_previo === 'cerrada'
                ? 'Semana cerrada eliminada. Los productos quedan sin asignar.'
                : 'Semana eliminada';
            showToast(mensaje, 'success');

            // Si era la semana activa, limpiar la UI
            if (_semanalSemanaActual && _semanalSemanaActual.id === id) {
                _semanalSemanaActual = null;
                _semGrupos = [];
                document.getElementById('sem-info').classList.add('hidden');
                document.getElementById('sem-diferencias').classList.add('hidden');
                document.getElementById('sem-lista-semanas').innerHTML = '';
            }

            // Recargar solo las listas (pendientes + lista de semanas de la bodega) SIN crear nueva
            semanalCargarPendientes();
            const bodega = document.getElementById('sem-bodega').value;
            if (bodega) {
                try {
                    const resSemanas = await fetch(`${CONFIG.API_URL}/api/semanas?local=${bodega}`);
                    const semanas = await resSemanas.json();
                    if (!semanas.error) semanalRenderSemanas(semanas);
                } catch(e) {}
            }
        } else {
            const data = await res.json();
            showToast(data.error || 'Error al eliminar', 'error');
        }
    } catch(e) { showToast('Error de conexión', 'error'); }
}

function _semToggleProd(checkbox, codigo) {
    if (checkbox.checked) {
        if (!_semanalProductosSeleccionados.includes(codigo)) _semanalProductosSeleccionados.push(codigo);
    } else {
        _semanalProductosSeleccionados = _semanalProductosSeleccionados.filter(c => c !== codigo);
    }
    const label = checkbox.closest('.sec-prod-item');
    if (label) label.classList.toggle('selected', checkbox.checked);
    // Re-render para actualizar división
    semanalRenderDiferencias({ diferencias: _semanalDiferencias });
}

function _semAbrirPersona() {
    const personas = state.personas || [];
    if (personas.length === 0) {
        showToast('No hay personas cargadas', 'error');
        return;
    }
    const opciones = personas.map(p => {
        const nombre = typeof p === 'string' ? p : p.nombre;
        return nombre;
    }).filter(n => !_semanalPersonasSeleccionadas.includes(n));

    if (opciones.length === 0) {
        showToast('Todas las personas ya están agregadas', 'info');
        return;
    }

    // Crear mini-dropdown temporal
    const btn = document.querySelector('.sec-col:last-child .btn-secondary');
    if (!btn) return;
    let dropdown = document.getElementById('sem-persona-dropdown');
    if (dropdown) { dropdown.remove(); return; }

    dropdown = document.createElement('div');
    dropdown.id = 'sem-persona-dropdown';
    dropdown.className = 'obs-agregar-lista';
    dropdown.style.cssText = 'display:block;position:absolute;right:0;top:100%;z-index:50;max-height:200px;overflow-y:auto;min-width:200px;';
    dropdown.innerHTML = opciones.map(n => `
        <div class="obs-agregar-item" onclick="_semSeleccionarPersona('${n.replace(/'/g, "\\'")}')">
            <i class="fas fa-user" style="color:var(--primary);"></i>
            <span>${n}</span>
        </div>
    `).join('');

    btn.parentElement.style.position = 'relative';
    btn.parentElement.appendChild(dropdown);

    // Cerrar al click fuera
    setTimeout(() => {
        document.addEventListener('click', function _cerrar(e) {
            if (!dropdown.contains(e.target) && e.target !== btn) {
                dropdown.remove();
                document.removeEventListener('click', _cerrar);
            }
        });
    }, 10);
}

function _semSeleccionarPersona(nombre) {
    if (!_semanalPersonasSeleccionadas.includes(nombre)) {
        _semanalPersonasSeleccionadas.push(nombre);
    }
    const dropdown = document.getElementById('sem-persona-dropdown');
    if (dropdown) dropdown.remove();
    semanalRenderDiferencias({ diferencias: _semanalDiferencias });
}

function _semQuitarPersona(idx) {
    _semanalPersonasSeleccionadas.splice(idx, 1);
    semanalRenderDiferencias({ diferencias: _semanalDiferencias });
}

function _semanalPersonaRowHTML(prodIdx, personaIdx, persona, cantidad, costoUnit, readOnly) {
    const monto = (parseFloat(cantidad) || 0) * costoUnit;
    const disabledAttr = readOnly ? 'disabled' : '';
    const personasOpts = (state.personas || []).map(p => {
        const nombre = typeof p === 'string' ? p : p.nombre;
        const selected = nombre === persona ? 'selected' : '';
        return `<option value="${escapeHtml(nombre)}" ${selected}>${escapeHtml(nombre)}</option>`;
    }).join('');

    return `
        <div class="sem-persona-row" data-prod-idx="${prodIdx}" data-persona-idx="${personaIdx}">
            <select class="sem-persona-select" ${disabledAttr} onchange="semanalRecalcRow(this)">
                <option value="">Seleccionar...</option>
                ${personasOpts}
            </select>
            <input type="number" class="sem-persona-cant" value="${cantidad || ''}" min="0" step="0.01"
                   placeholder="Cant." ${disabledAttr} onchange="semanalRecalcRow(this)" oninput="semanalRecalcRow(this)">
            <span class="sem-persona-monto">$${monto.toFixed(2)}</span>
            ${!readOnly ? `<button class="btn-icon sem-btn-remove-persona" onclick="semanalRemovePersonaRow(this)" title="Quitar"><i class="fas fa-times"></i></button>` : ''}
        </div>
    `;
}

function semanalAddPersonaRow(prodIdx) {
    const container = document.querySelector(`.sem-asig-container[data-idx="${prodIdx}"]`);
    if (!container) return;
    const existing = container.querySelectorAll('.sem-persona-row');
    const newIdx = existing.length;
    const prod = _semanalDiferencias[prodIdx];
    const costo = parseFloat(prod ? prod.costo_unitario : 0) || 0;
    const esCerrada = _semanalSemanaActual && _semanalSemanaActual.estado === 'cerrada';

    const addBtn = container.querySelector('.sem-btn-add-persona');
    const temp = document.createElement('div');
    temp.innerHTML = _semanalPersonaRowHTML(prodIdx, newIdx, '', '', costo, esCerrada);
    const row = temp.firstElementChild;
    container.insertBefore(row, addBtn);
}

function semanalRemovePersonaRow(btn) {
    const row = btn.closest('.sem-persona-row');
    if (!row) return;
    const container = row.closest('.sem-asig-container');
    const prodIdx = container.dataset.idx;
    row.remove();
    _semanalRecalcTotal(prodIdx);
}

function semanalRecalcRow(el) {
    const row = el.closest('.sem-persona-row');
    const container = row.closest('.sem-asig-container');
    const prodIdx = container.dataset.idx;
    const prod = _semanalDiferencias[prodIdx];
    const costo = parseFloat(prod ? prod.costo_unitario : 0) || 0;
    const cant = parseFloat(row.querySelector('.sem-persona-cant').value) || 0;
    row.querySelector('.sem-persona-monto').textContent = `$${(cant * costo).toFixed(2)}`;
    _semanalRecalcTotal(prodIdx);
}

function _semanalRecalcTotal(prodIdx) {
    const container = document.querySelector(`.sem-asig-container[data-idx="${prodIdx}"]`);
    if (!container) return;
    const rows = container.querySelectorAll('.sem-persona-row');
    const prod = _semanalDiferencias[prodIdx];
    const costo = parseFloat(prod ? prod.costo_unitario : 0) || 0;
    let totalAsig = 0;
    rows.forEach(r => {
        const cant = parseFloat(r.querySelector('.sem-persona-cant').value) || 0;
        totalAsig += cant * costo;
    });
    const totalEl = document.querySelector(`.sem-asig-total[data-idx="${prodIdx}"] .sem-asig-total-val`);
    if (totalEl) totalEl.textContent = `$${totalAsig.toFixed(2)}`;
}

async function semanalGuardarTodo() {
    if (!_semanalSemanaActual) {
        showToast('No hay semana cargada', 'error');
        return;
    }

    // Validar que hay grupos con contenido
    const gruposValidos = (_semGrupos || []).filter(g => g.productos.length > 0 && g.personas.length > 0);
    if (gruposValidos.length === 0) {
        showToast('Agrega productos y personas en al menos un grupo', 'error');
        return;
    }

    // Consolidar: por cada producto (código) sumar todas las personas de los grupos donde aparece
    // Estructura: { codigo: { codigo, nombre, unidad, diferencia_semanal, costo_unitario, personas: [{persona, cantidad}] } }
    const consolidado = {};
    gruposValidos.forEach(g => {
        g.productos.forEach(p => {
            const prodOrig = _semanalDiferencias.find(d => d.codigo === p.codigo);
            if (!prodOrig || prodOrig.justificado) return;
            if (!consolidado[p.codigo]) {
                consolidado[p.codigo] = {
                    codigo: p.codigo,
                    nombre: prodOrig.nombre,
                    unidad: prodOrig.unidad || '',
                    diferencia_semanal: parseFloat(prodOrig.diferencia) || 0,
                    costo_unitario: parseFloat(prodOrig.costo_unitario) || 0,
                    personas: []
                };
            }
            // Dividir la cantidad entre las personas del grupo
            const cantPorPersona = (parseFloat(p.cantidad) || 0) / g.personas.length;
            g.personas.forEach(nombre => {
                // Si la persona ya existe, sumar; si no, agregar
                const existe = consolidado[p.codigo].personas.find(x => x.persona === nombre);
                if (existe) {
                    existe.cantidad = parseFloat((existe.cantidad + cantPorPersona).toFixed(4));
                } else {
                    consolidado[p.codigo].personas.push({ persona: nombre, cantidad: parseFloat(cantPorPersona.toFixed(4)) });
                }
            });
        });
    });

    const asignaciones = Object.values(consolidado);
    if (asignaciones.length === 0) {
        showToast('No hay asignaciones válidas para guardar', 'error');
        return;
    }

    const btn = document.getElementById('btn-sem-guardar-todo');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...'; }

    try {
        const res = await fetch(`${CONFIG.API_URL}/api/semanas/${_semanalSemanaActual.id}/asignar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ asignaciones })
        });
        const data = await res.json();
        if (data.error) {
            showToast(data.error, 'error');
            return;
        }
        showToast(`Guardado: ${asignaciones.length} producto(s) asignado(s)`, 'success');
        semanalCargarSemanaById(_semanalSemanaActual.id);
    } catch (error) {
        console.error('Error guardando asignaciones:', error);
        showToast('Error al guardar asignaciones', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Guardar Asignaciones'; }
    }
}

async function semanalCerrar() {
    if (!_puede('semanal', 'editar')) { showToast('No tienes permiso para cerrar semanas', 'error'); return; }
    if (!_semanalSemanaActual) return;

    // Validar que todo esté asignado antes de cerrar
    const productosCobrar = (_semanalDiferencias || []).filter(p => !p.justificado);
    const valorACobrar = productosCobrar.reduce((s, p) =>
        s + Math.abs(parseFloat(p.diferencia) || 0) * (parseFloat(p.costo_unitario) || 0), 0);

    let valorAsignado = 0;
    (_semGrupos || []).forEach(g => {
        g.productos.forEach(p => {
            const prodOrig = _semanalDiferencias.find(d => d.codigo === p.codigo);
            if (prodOrig && !prodOrig.justificado) {
                valorAsignado += (parseFloat(p.cantidad) || 0) * (parseFloat(prodOrig.costo_unitario) || 0);
            }
        });
    });

    const pendiente = valorACobrar - valorAsignado;
    if (Math.abs(pendiente) > 0.01) {
        showToast(`No puedes cerrar la semana: quedan $${pendiente.toFixed(2)} por asignar`, 'error');
        return;
    }

    // Validar que cada grupo tenga al menos una persona
    const gruposSinPersonas = (_semGrupos || []).filter(g => g.productos.length > 0 && g.personas.length === 0);
    if (gruposSinPersonas.length > 0) {
        showToast(`Hay ${gruposSinPersonas.length} grupo(s) con productos pero sin personas asignadas`, 'error');
        return;
    }

    if (!confirm(`Cerrar la semana del ${_semanalFormatFechaLarga(_semanalSemanaActual.fecha_inicio)} al ${_semanalFormatFechaLarga(_semanalSemanaActual.fecha_fin)}?\n\nUna vez cerrada no se podran editar las asignaciones.`)) {
        return;
    }

    try {
        const res = await fetch(`${CONFIG.API_URL}/api/semanas/${_semanalSemanaActual.id}/cerrar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cerrada_por: state.user ? state.user.username : 'admin' })
        });
        const data = await res.json();
        if (data.error) {
            showToast(data.error, 'error');
            return;
        }
        showToast('Semana cerrada correctamente', 'success');
        semanalCargar();
    } catch (error) {
        showToast('Error al cerrar semana', 'error');
    }
}

async function semanalReabrir() {
    if (!_puede('semanal', 'eliminar')) { showToast('No tienes permiso para reabrir semanas', 'error'); return; }
    if (!_semanalSemanaActual) return;
    if (!confirm('Reabrir esta semana? Las asignaciones podran editarse nuevamente.')) return;

    try {
        const res = await fetch(`${CONFIG.API_URL}/api/semanas/${_semanalSemanaActual.id}/reabrir`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (data.error) {
            showToast(data.error, 'error');
            return;
        }
        showToast('Semana reabierta', 'success');
        semanalCargar();
    } catch (error) {
        showToast('Error al reabrir semana', 'error');
    }
}

async function semanalCargarPendientes() {
    try {
        const res = await fetch(`${CONFIG.API_URL}/api/semanas/pendientes`);
        const data = await res.json();
        const alertaEl = document.getElementById('sem-alerta-pendientes');
        if (!data || data.length === 0) {
            alertaEl.classList.add('hidden');
            return;
        }
        alertaEl.classList.remove('hidden');
        const esAdminPend = _esAdmin();
        let html = '<div class="sem-alerta-header-v2"><i class="fas fa-clock"></i> Semanas sin cerrar</div><div class="sem-pendientes-lista">';
        data.forEach(s => {
            const ini = _semanalFormatFecha(s.fecha_inicio);
            const fin = _semanalFormatFecha(s.fecha_fin);
            html += `<div class="sem-pendiente-item">
                <div class="sem-pendiente-info">
                    <span class="sem-pendiente-bodega"><i class="fas fa-warehouse"></i> ${_semanalBodegaNombre(s.local)}</span>
                    <span class="sem-pendiente-fechas">Semana ${ini} → ${fin}</span>
                    <span class="sem-pendiente-badge">Sin cerrar</span>
                </div>
                <div class="sem-pendiente-acciones">
                    <button class="btn-sem-continuar" onclick="semanalContinuarSemana(${s.id}, '${s.local}', '${s.fecha_inicio}')">
                        <i class="fas fa-edit"></i> Continuar asignación
                    </button>
                    ${esAdminPend ? `<button class="btn-sem-eliminar" onclick="semanalEliminarSemana(${s.id})" title="Eliminar semana"><i class="fas fa-trash-alt"></i></button>` : ''}
                </div>
            </div>`;
        });
        html += '</div>';
        alertaEl.innerHTML = html;
    } catch (error) {
        console.error('Error cargando pendientes:', error);
    }
}

function semanalRenderResumenPersonas(data) {
    const container = document.getElementById('sem-resumen-personas');
    const contenido = document.getElementById('sem-resumen-contenido');

    if (!data || data.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    let html = '<table class="sem-resumen-tabla"><thead><tr><th>Persona</th><th>Semanas</th><th>Cant. Total</th><th>Monto Total</th></tr></thead><tbody>';
    data.forEach(p => {
        html += `<tr>
            <td>${escapeHtml(p.persona)}</td>
            <td>${p.semanas_count || 0}</td>
            <td>${parseFloat(p.total_cantidad || 0).toFixed(2)}</td>
            <td>$${parseFloat(p.total_monto || 0).toFixed(2)}</td>
        </tr>`;
    });
    html += '</tbody></table>';
    contenido.innerHTML = html;
}

// ============================================================
// CRUCE OPERATIVO - Sub-tabs y selector global de bodega
// ============================================================

function cruceSubtab(tab) {
    document.querySelectorAll('.cruce-subtab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.cruce-subtab').forEach(el => el.classList.remove('active'));
    const panel = document.getElementById(`cruce-sub-${tab}`);
    if (panel) panel.style.display = '';
    const btn = document.querySelector(`.cruce-subtab[data-subtab="${tab}"]`);
    if (btn) btn.classList.add('active');
    // Al cambiar a historial, cargar automaticamente
    if (tab === 'historial') cargarCruceOperativo();
}

function cruceBodegaGlobalCambio() {
    // Recargar fechas de cuadrar y carga cuando cambia la bodega global
    cuadrarCargarFechas();
    cargaCargarFechas();
    // Si estamos en historial, recargar
    const histPanel = document.getElementById('cruce-sub-historial');
    if (histPanel && histPanel.style.display !== 'none') cargarCruceOperativo();
}

function getCruceBodegaGlobal() {
    const sel = document.getElementById('cruce-bodega-global');
    return sel ? sel.value : 'bodega_principal';
}

// ============================================================
// EVALUACION CUALITATIVA DEL LIDER (dentro de Semanal)
// ============================================================
let _evalCategorias = null;

function _evalParseCriterios(str) {
    if (!str) return {};
    const r = {};
    str.split('|').forEach(c => {
        const m = c.match(/^(\d+):\s*(.+)$/);
        if (m) r[parseInt(m[1])] = m[2].trim();
    });
    return r;
}

function evalModuloCargar() {
    const bodega = document.getElementById('eval-bodega').value;
    const fechaRaw = document.getElementById('eval-semana').value;
    if (!bodega) { showToast('Selecciona un local', 'error'); return; }
    if (!fechaRaw) { showToast('Selecciona una fecha', 'error'); return; }
    // Ajustar a lunes
    const d = new Date(fechaRaw + 'T12:00:00');
    const dia = d.getDay();
    const diff = dia === 0 ? -6 : 1 - dia;
    d.setDate(d.getDate() + diff);
    const lunes = d.toISOString().split('T')[0];
    document.getElementById('eval-semana').value = lunes;
    const fin = new Date(d);
    fin.setDate(fin.getDate() + 6);
    document.getElementById('eval-semana-rango').textContent = `${lunes} al ${fin.toISOString().split('T')[0]}`;

    _evalCurrentLocal = bodega;
    _evalCurrentSemanaInicio = lunes;
    _evalCurrentSemanaFin = fin.toISOString().split('T')[0];
    evalSemanalCargar();
}

let _evalCurrentLocal = null;
let _evalCurrentSemanaInicio = null;
let _evalCurrentSemanaFin = null;

async function evalSemanalCargar() {
    const bodega = _evalCurrentLocal || (_semanalSemanaActual && _semanalSemanaActual.local);
    const semanaInicio = _evalCurrentSemanaInicio || (_semanalSemanaActual && _semanalSemanaActual.fecha_inicio);
    if (!bodega || !semanaInicio) return;

    const formulario = document.getElementById('eval-formulario');
    if (formulario) formulario.classList.remove('hidden');

    // Cargar categorias (cache)
    if (!_evalCategorias) {
        try {
            const r = await fetch(`${CONFIG.API_URL}/api/eval/categorias`);
            _evalCategorias = await r.json();
        } catch(e) { return; }
    }

    // Titulo
    const LOCALES_EVAL = {'real_audiencia':'Real Audiencia','floreana':'Floreana','portugal':'Portugal','santo_cachon_real':'Santo Cachon Real','santo_cachon_portugal':'Santo Cachon Portugal','simon_bolon':'Simon Bolon'};
    const tituloEl = document.getElementById('eval-titulo-local');
    if (tituloEl) tituloEl.textContent = `Evaluacion - ${LOCALES_EVAL[bodega] || bodega}`;

    // Cargar evaluacion existente
    let existentes = {};
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/eval/semana?semana_inicio=${semanaInicio}&local=${bodega}`);
        const data = await r.json();
        if (Array.isArray(data)) data.forEach(d => { existentes[d.categoria_id] = d; });
    } catch(e) {}

    // Render preguntas
    const container = document.getElementById('eval-preguntas');
    container.innerHTML = _evalCategorias.map((cat, idx) => {
        const ex = existentes[cat.id];
        const puntaje = ex ? ex.puntaje : 0;
        const comentario = ex ? (ex.comentario || '') : '';
        const criterios = _evalParseCriterios(cat.criterios);
        const criterioActual = puntaje > 0 ? criterios[puntaje] : '';

        return `
        <div style="padding:14px 0; ${idx > 0 ? 'border-top:1px solid #e2e8f0;' : ''}">
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap;">
                <div style="flex:1; min-width:250px;">
                    <div style="font-weight:600; color:#1e293b; font-size:14px;">P${idx+1}. ${cat.nombre}</div>
                    <div style="font-size:12px; color:#94a3b8; margin-top:3px;">${cat.descripcion || ''}</div>
                </div>
                <div style="text-align:right;">
                    <div class="eval-stars" data-evalcat="${cat.id}" style="display:flex; gap:4px;">
                        ${[1,2,3,4,5].map(n => `
                            <span class="eval-star ${n <= puntaje ? 'eval-star-active' : ''}"
                                  data-val="${n}"
                                  onclick="evalSetStar(${cat.id}, ${n})"
                                  onmouseenter="evalPreviewStar(${cat.id}, ${n})"
                                  onmouseleave="evalClearPreview(${cat.id})"
                                  style="font-size:22px; cursor:pointer; color:${n <= puntaje ? '#f59e0b' : '#e2e8f0'}; transition:all 0.15s; user-select:none;">
                                <i class="fas fa-star"></i>
                            </span>
                        `).join('')}
                    </div>
                    <div id="eval-criterio-${cat.id}" style="font-size:11px; color:#64748b; margin-top:3px; max-width:280px; text-align:right; min-height:14px;">
                        ${criterioActual}
                    </div>
                </div>
            </div>
            <div style="margin-top:6px;">
                <input type="text" id="eval-comment-${cat.id}" value="${escapeHtml(comentario)}"
                       placeholder="Comentario opcional..."
                       style="width:100%; border:1px solid #e2e8f0; border-radius:6px; padding:6px 10px; font-size:13px; color:#475569;">
            </div>
        </div>`;
    }).join('');

    // Mostrar resultado si ya evaluado
    evalActualizarResultado();

    // Cargar ranking
    evalCargarRanking(semanaInicio);
}

function evalSetStar(catId, val) {
    const container = document.querySelector(`.eval-stars[data-evalcat="${catId}"]`);
    container.querySelectorAll('.eval-star').forEach(s => {
        const v = parseInt(s.dataset.val);
        s.style.color = v <= val ? '#f59e0b' : '#e2e8f0';
        s.classList.toggle('eval-star-active', v <= val);
    });
    const cat = _evalCategorias.find(c => c.id === catId);
    const criterios = cat ? _evalParseCriterios(cat.criterios) : {};
    const desc = document.getElementById(`eval-criterio-${catId}`);
    if (desc) desc.textContent = criterios[val] || '';
    evalActualizarResultado();
}

function evalPreviewStar(catId, val) {
    const container = document.querySelector(`.eval-stars[data-evalcat="${catId}"]`);
    container.querySelectorAll('.eval-star').forEach(s => {
        const v = parseInt(s.dataset.val);
        if (!s.classList.contains('eval-star-active')) {
            s.style.color = v <= val ? '#fcd34d' : '#e2e8f0';
        }
    });
    const cat = _evalCategorias.find(c => c.id === catId);
    const criterios = cat ? _evalParseCriterios(cat.criterios) : {};
    const desc = document.getElementById(`eval-criterio-${catId}`);
    if (desc) desc.textContent = criterios[val] || '';
}

function evalClearPreview(catId) {
    const container = document.querySelector(`.eval-stars[data-evalcat="${catId}"]`);
    container.querySelectorAll('.eval-star').forEach(s => {
        const v = parseInt(s.dataset.val);
        s.style.color = s.classList.contains('eval-star-active') ? '#f59e0b' : '#e2e8f0';
    });
    // Restaurar criterio activo
    const activas = container.querySelectorAll('.eval-star-active').length;
    const cat = _evalCategorias.find(c => c.id === catId);
    const criterios = cat ? _evalParseCriterios(cat.criterios) : {};
    const desc = document.getElementById(`eval-criterio-${catId}`);
    if (desc) desc.textContent = activas > 0 ? (criterios[activas] || '') : '';
}

function evalActualizarResultado() {
    if (!_evalCategorias) return;
    let total = 0, evaluadas = 0;
    _evalCategorias.forEach(cat => {
        const container = document.querySelector(`.eval-stars[data-evalcat="${cat.id}"]`);
        if (!container) return;
        const activas = container.querySelectorAll('.eval-star-active').length;
        if (activas > 0) { total += activas; evaluadas++; }
    });

    const resEl = document.getElementById('eval-resultado');
    if (evaluadas === 0) { resEl.innerHTML = ''; return; }

    let calificacion, color, icon;
    if (total >= 21) { calificacion = 'Excelente gestion'; color = '#059669'; icon = '🟢'; }
    else if (total >= 15) { calificacion = 'Buen desempeno'; color = '#2563eb'; icon = '🔵'; }
    else if (total >= 8) { calificacion = 'Gestion aceptable'; color = '#d97706'; icon = '🟡'; }
    else { calificacion = 'Gestion critica'; color = '#dc2626'; icon = '🔴'; }

    resEl.innerHTML = `
        <div style="background:${color}10; border:1px solid ${color}30; border-radius:10px; padding:14px 18px; display:flex; align-items:center; gap:14px;">
            <span style="font-size:28px;">${icon}</span>
            <div>
                <div style="font-weight:700; color:${color}; font-size:18px;">${total} / 25</div>
                <div style="font-size:13px; color:${color}; font-weight:500;">${calificacion}</div>
            </div>
            <div style="margin-left:auto; font-size:12px; color:#94a3b8;">${evaluadas}/${_evalCategorias.length} categorias</div>
        </div>`;
}

async function guardarEvalSemanal() {
    if (!_evalCategorias) return;
    const bodega = _evalCurrentLocal || (_semanalSemanaActual && _semanalSemanaActual.local);
    const semanaInicio = _evalCurrentSemanaInicio || (_semanalSemanaActual && _semanalSemanaActual.fecha_inicio);
    const semanaFin = _evalCurrentSemanaFin || (_semanalSemanaActual && _semanalSemanaActual.fecha_fin);
    if (!bodega || !semanaInicio) { showToast('Selecciona local y semana', 'error'); return; }

    const evaluaciones = [];
    let faltantes = 0;
    _evalCategorias.forEach(cat => {
        const container = document.querySelector(`.eval-stars[data-evalcat="${cat.id}"]`);
        if (!container) return;
        const activas = container.querySelectorAll('.eval-star-active').length;
        const comentario = document.getElementById(`eval-comment-${cat.id}`)?.value || '';
        if (activas === 0) { faltantes++; return; }
        evaluaciones.push({ categoria_id: cat.id, puntaje: activas, comentario });
    });

    if (faltantes > 0) {
        showToast(`Falta calificar ${faltantes} pregunta(s)`, 'error');
        return;
    }

    try {
        const r = await fetch(`${CONFIG.API_URL}/api/eval/guardar`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                local: bodega, semana_inicio: semanaInicio, semana_fin: semanaFin,
                evaluaciones, evaluado_por: state.usuario?.username || 'admin'
            })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        showToast('Evaluacion guardada', 'success');
        document.getElementById('eval-status').innerHTML =
            `<div style="color:#059669; font-size:13px;"><i class="fas fa-check-circle"></i> Guardado correctamente</div>`;
        evalCargarRanking(semanaInicio);
    } catch(e) {
        showToast('Error: ' + e.message, 'error');
    }
}

async function evalCargarRanking(semanaInicio) {
    const container = document.getElementById('eval-ranking-body');
    try {
        const [rankRes, detRes] = await Promise.all([
            fetch(`${CONFIG.API_URL}/api/eval/ranking?semana_inicio=${semanaInicio}`),
            fetch(`${CONFIG.API_URL}/api/eval/semana?semana_inicio=${semanaInicio}`)
        ]);
        const ranking = await rankRes.json();
        const detalle = await detRes.json();

        if (!Array.isArray(ranking) || ranking.length === 0) {
            container.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:20px;"><i class="fas fa-trophy" style="font-size:30px;"></i><p>Sin evaluaciones para esta semana</p></div>';
            return;
        }

        const detPorLocal = {};
        if (Array.isArray(detalle)) detalle.forEach(d => {
            if (!detPorLocal[d.local]) detPorLocal[d.local] = [];
            detPorLocal[d.local].push(d);
        });

        const LOCALES_NOMBRES = {
            'real_audiencia': 'Chios Real Audiencia', 'floreana': 'Chios Floreana', 'portugal': 'Chios Portugal',
            'santo_cachon_real': 'Santo Cachon Real', 'santo_cachon_portugal': 'Santo Cachon Portugal', 'simon_bolon': 'Simon Bolon'
        };

        container.innerHTML = ranking.map((r, i) => {
            const pos = i + 1;
            const prom = parseFloat(r.promedio);
            const total = Math.round(prom * 5);
            const pct = (prom / 5 * 100).toFixed(0);
            const nombre = LOCALES_NOMBRES[r.local] || r.local;
            const cats = detPorLocal[r.local] || [];

            let calColor, calIcon;
            if (total >= 21) { calColor = '#059669'; calIcon = '🟢'; }
            else if (total >= 15) { calColor = '#2563eb'; calIcon = '🔵'; }
            else if (total >= 8) { calColor = '#d97706'; calIcon = '🟡'; }
            else { calColor = '#dc2626'; calIcon = '🔴'; }

            const medallas = ['🥇','🥈','🥉'];

            return `
            <div style="display:flex; align-items:center; gap:14px; padding:12px 0; ${i > 0 ? 'border-top:1px solid #f1f5f9;' : ''}">
                <div style="font-size:20px; width:30px; text-align:center;">${medallas[i] || `<span style="color:#94a3b8; font-size:14px; font-weight:600;">${pos}</span>`}</div>
                <div style="flex:1;">
                    <div style="font-weight:600; color:#1e293b;">${nombre}</div>
                    <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:4px;">
                        ${cats.map(c => `<span style="font-size:11px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:4px; padding:2px 6px;">${c.categoria.split(' ')[0]}: ${'★'.repeat(c.puntaje)}<span style="color:#e2e8f0;">${'★'.repeat(5-c.puntaje)}</span></span>`).join('')}
                    </div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:22px; font-weight:700; color:${calColor};">${prom.toFixed(1)}</div>
                    <div style="font-size:11px; color:#94a3b8;">/ 5.0</div>
                </div>
            </div>`;
        }).join('');
    } catch(e) {
        console.error(e);
    }
}

// ============================================================
// MODULO DEPOSITOS
// ============================================================

async function depCargarPendientes() {
    const container = document.getElementById('dep-pend-list');
    container.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Cargando...</p></div>';
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/depositos/listar?estado=Enviado a Contabilidad`);
        const data = await r.json();
        const deps = data.depositos || [];
        if (deps.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle" style="color:var(--success);"></i><p>No hay depositos pendientes de aprobacion</p></div>';
            return;
        }
        container.innerHTML = deps.map(d => _depRenderCard(d, true)).join('');
    } catch(e) { container.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${e.message}</p></div>`; }
}

async function depCargarHistorial() {
    const desde = document.getElementById('dep-fecha-desde').value;
    const hasta = document.getElementById('dep-fecha-hasta').value;
    const cuadre = document.getElementById('dep-filtro-cuadre').value;
    if (!desde || !hasta) { showToast('Selecciona fechas', 'error'); return; }
    const container = document.getElementById('dep-hist-list');
    container.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Cargando...</p></div>';
    try {
        let url = `${CONFIG.API_URL}/api/depositos/listar?fecha_desde=${desde}&fecha_hasta=${hasta}`;
        if (cuadre) url += `&cuadre=${cuadre}`;
        const r = await fetch(url);
        const data = await r.json();
        const deps = data.depositos || [];
        if (deps.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>Sin depositos en este rango</p></div>';
            return;
        }
        container.innerHTML = `<p style="color:var(--text-gray);margin-bottom:12px;">${deps.length} depositos encontrados</p>` +
            deps.map(d => _depRenderCard(d, false)).join('');
    } catch(e) { container.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${e.message}</p></div>`; }
}

async function depCargarDescuadres() {
    const desde = document.getElementById('dep-desc-desde').value;
    const hasta = document.getElementById('dep-desc-hasta').value;
    if (!desde || !hasta) { showToast('Selecciona fechas', 'error'); return; }
    const container = document.getElementById('dep-desc-list');
    container.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Cargando...</p></div>';
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/depositos/listar?fecha_desde=${desde}&fecha_hasta=${hasta}&cuadre=Descuadra`);
        const data = await r.json();
        const deps = data.depositos || [];
        if (deps.length === 0) {
            container.innerHTML = '<div class="empty-state" style="color:var(--success);"><i class="fas fa-check-circle"></i><p>Sin descuadres en este periodo</p></div>';
            return;
        }
        container.innerHTML = `<p style="color:#dc2626;font-weight:600;margin-bottom:12px;">${deps.length} descuadres encontrados</p>` +
            deps.map(d => _depRenderCard(d, false)).join('');
    } catch(e) { container.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${e.message}</p></div>`; }
}

async function depCargarDashboard() {
    const desde = document.getElementById('dep-dash-desde').value;
    const hasta = document.getElementById('dep-dash-hasta').value;
    if (!desde || !hasta) { showToast('Selecciona fechas', 'error'); return; }
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/depositos/resumen?fecha_desde=${desde}&fecha_hasta=${hasta}`);
        const data = await r.json();

        document.getElementById('dep-dash-stats').innerHTML = `
            <div class="dashboard-stat-card">
                <div class="stat-icon" style="background:rgba(37,99,235,0.1);color:#2563eb;"><i class="fas fa-receipt"></i></div>
                <div class="stat-info"><div class="stat-valor">${data.total_depositos}</div><div class="stat-label">Total Depositos</div></div>
            </div>
            <div class="dashboard-stat-card">
                <div class="stat-icon" style="background:rgba(5,150,105,0.1);color:#059669;"><i class="fas fa-dollar-sign"></i></div>
                <div class="stat-info"><div class="stat-valor">$${(data.total_depositado||0).toLocaleString('es-EC',{minimumFractionDigits:2})}</div><div class="stat-label">Total Depositado</div></div>
            </div>
            <div class="dashboard-stat-card">
                <div class="stat-icon" style="background:rgba(5,150,105,0.1);color:#059669;"><i class="fas fa-check-circle"></i></div>
                <div class="stat-info"><div class="stat-valor">${data.cuadran}</div><div class="stat-label">Cuadran</div></div>
            </div>
            <div class="dashboard-stat-card">
                <div class="stat-icon" style="background:rgba(220,38,38,0.1);color:#dc2626;"><i class="fas fa-exclamation-triangle"></i></div>
                <div class="stat-info"><div class="stat-valor">${data.descuadres}</div><div class="stat-label">Descuadres</div></div>
            </div>
        `;

        // Tabla por local
        const locales = Object.entries(data.por_local || {}).sort((a,b) => b[1].monto - a[1].monto);
        document.getElementById('dep-dash-locales').innerHTML = locales.length ? `
            <div class="chart-card">
                <div class="chart-card-header"><i class="fas fa-store"></i> Depositos por Local</div>
                <div style="padding:16px; overflow-x:auto;">
                    <table class="eval-table" style="width:100%;">
                        <thead><tr><th>Local</th><th>Depositos</th><th>Monto Total</th><th>Descuadres</th></tr></thead>
                        <tbody>
                            ${locales.map(([local, info]) => `
                                <tr>
                                    <td style="font-weight:600;">${local}</td>
                                    <td>${info.depositos}</td>
                                    <td>$${info.monto.toLocaleString('es-EC',{minimumFractionDigits:2})}</td>
                                    <td style="color:${info.descuadres > 0 ? '#dc2626' : '#059669'}; font-weight:600;">${info.descuadres}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>` : '';
    } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

function _depRenderCard(d, mostrarAprobar) {
    const esCuadra = d.cuadre === 'Cuadra';
    const borderColor = esCuadra ? '#059669' : '#dc2626';
    const badgeColor = esCuadra ? 'background:#ecfdf5;color:#059669;' : 'background:#fef2f2;color:#dc2626;';
    const estadoBadge = d.estado === 'Aprobado por Contabilidad'
        ? '<span style="background:#ecfdf5;color:#059669;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">Aprobado</span>'
        : `<span style="background:#fef3c7;color:#d97706;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">${d.estado || 'Pendiente'}</span>`;

    const evidencias = (d.evidencias || []).map(e =>
        `<a href="${e.url}" target="_blank" style="display:inline-block;margin:4px;"><img src="${e.thumb || e.url}" style="width:60px;height:60px;object-fit:cover;border-radius:6px;border:1px solid var(--border);"></a>`
    ).join('');

    return `
    <div style="background:var(--bg-white);border:1px solid var(--border);border-left:4px solid ${borderColor};border-radius:10px;padding:16px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
            <div>
                <div style="font-weight:700;color:var(--text-dark);font-size:15px;">${d.local}</div>
                <div style="color:var(--text-gray);font-size:13px;">${d.fecha || ''} &nbsp;·&nbsp; Seq: ${d.secuencia || '-'} &nbsp;·&nbsp; ${d.num_depositos || 0} papeleta(s)</div>
            </div>
            <div style="text-align:right;">
                <div style="font-size:20px;font-weight:700;color:var(--text-dark);">$${(d.monto_contado||0).toLocaleString('es-EC',{minimumFractionDigits:2})}</div>
                <div>${estadoBadge} <span style="${badgeColor}padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">${d.cuadre || '-'}</span></div>
            </div>
        </div>
        ${d.diferencia && d.diferencia !== 0 ? `<div style="margin-top:8px;color:#dc2626;font-weight:600;font-size:13px;">Diferencia: $${Math.abs(d.diferencia).toFixed(2)}</div>` : ''}
        ${d.observacion && d.observacion !== 'No existe Observación' ? `<div style="margin-top:6px;color:var(--text-gray);font-size:12px;"><i class="fas fa-comment"></i> ${d.observacion}</div>` : ''}
        ${evidencias ? `<div style="margin-top:8px;">${evidencias}</div>` : ''}
        ${mostrarAprobar ? `<div style="margin-top:10px;text-align:right;"><button class="btn-obs-cargar" style="background:var(--success);padding:6px 16px;font-size:13px;" onclick="depAprobar('${d.id}',this)"><i class="fas fa-check"></i> Aprobar</button></div>` : ''}
    </div>`;
}

async function depAprobar(recordId, btn) {
    if (!confirm('Aprobar este deposito?')) return;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/depositos/aprobar`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({id: recordId})
        });
        if (r.ok) {
            showToast('Deposito aprobado', 'success');
            depCargarPendientes();
        } else { showToast('Error al aprobar', 'error'); btn.disabled = false; }
    } catch(e) { showToast('Error: ' + e.message, 'error'); btn.disabled = false; }
}

// CUADRAR - Solicitar nuevo cruce operativo (boton + worker)
// ============================================================
let cuadrarPollHandle = null;

async function cuadrarCargarFechas() {
    const sel = document.getElementById('cuadrar-fecha');
    const corteInp = document.getElementById('cuadrar-fecha-corte');
    if (!sel) return;
    const bodega = getCruceBodegaGlobal();
    sel.innerHTML = '<option value="">Cargando fechas...</option>';
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/cruce-op/fechas-disponibles?bodega=${bodega}`);
        const fechas = await r.json();
        if (!Array.isArray(fechas) || fechas.length === 0) {
            sel.innerHTML = '<option value="">Sin tomas fisicas</option>';
            return;
        }
        sel.innerHTML = fechas.map(f =>
            `<option value="${f.fecha}">${f.fecha} (${f.productos} productos)</option>`
        ).join('');
        // Auto-set fecha corte = fecha toma + 1 dia cuando cambia la fecha
        sel.onchange = cuadrarActualizarCorteDefault;
        cuadrarActualizarCorteDefault();
    } catch (e) {
        sel.innerHTML = '<option value="">Error cargando</option>';
        console.error(e);
    }
}

function cuadrarActualizarCorteDefault() {
    const toma = document.getElementById('cuadrar-fecha').value;
    const corteInp = document.getElementById('cuadrar-fecha-corte');
    if (!toma || !corteInp) return;
    // default: toma + 1 dia
    const d = new Date(toma + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    corteInp.value = d.toISOString().split('T')[0];
}

async function cuadrarSolicitar() {
    if (!_puede('cruce', 'editar')) { showToast('No tienes permiso para ejecutar cruces', 'error'); return; }
    const bodega = getCruceBodegaGlobal();
    const fecha = document.getElementById('cuadrar-fecha').value;
    const fechaCorte = document.getElementById('cuadrar-fecha-corte').value || fecha;
    const btn = document.getElementById('btn-cuadrar');
    const status = document.getElementById('cuadrar-status');
    const prog = document.getElementById('cuadrar-progreso');
    const progBar = document.getElementById('cuadrar-progreso-bar');
    const progMsg = document.getElementById('cuadrar-progreso-msg');

    if (!fecha) { alert('Selecciona una fecha'); return; }

    btn.disabled = true;
    status.innerHTML = '';
    prog.classList.remove('hidden');
    progBar.style.width = '5%';
    progMsg.textContent = 'Solicitando ejecucion...';

    try {
        const r = await fetch(`${CONFIG.API_URL}/api/cruce-op/solicitar`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                bodega, fecha_toma: fecha,
                fecha_corte_contifico: fechaCorte,
                usuario: state.usuario?.username || 'panel',
                rol: state.usuario?.rol || ''
            })
        });
        const data = await r.json();
        if (r.status === 409) {
            prog.classList.add('hidden');
            btn.disabled = false;
            status.innerHTML = `<div class="cuadrar-status-error"><i class="fas fa-lock"></i> ${data.error || 'Ya fue ejecutado'}</div>`;
            return;
        }
        if (!r.ok) throw new Error(data.error || 'Error solicitando');
        progMsg.textContent = `Tarea creada (id ${data.id}). Esperando worker...`;
        progBar.style.width = '15%';
        cuadrarPollEstado(data.id);
    } catch (e) {
        prog.classList.add('hidden');
        btn.disabled = false;
        status.innerHTML = `<div class="cuadrar-status-error"><i class="fas fa-exclamation-triangle"></i> Error: ${e.message}</div>`;
    }
}

function cuadrarPollEstado(ejecId) {
    const btn = document.getElementById('btn-cuadrar');
    const progBar = document.getElementById('cuadrar-progreso-bar');
    const progMsg = document.getElementById('cuadrar-progreso-msg');
    const status = document.getElementById('cuadrar-status');
    const prog = document.getElementById('cuadrar-progreso');

    let intentos = 0;
    if (cuadrarPollHandle) clearInterval(cuadrarPollHandle);

    cuadrarPollHandle = setInterval(async () => {
        intentos++;
        try {
            const r = await fetch(`${CONFIG.API_URL}/api/cruce-op/estado/${ejecId}`);
            const d = await r.json();
            if (d.estado === 'pendiente') {
                progBar.style.width = Math.min(20 + intentos * 2, 30) + '%';
                progMsg.textContent = `Esperando worker... (${intentos * 5}s)`;
            } else if (d.estado === 'en_proceso') {
                progBar.style.width = Math.min(40 + intentos, 80) + '%';
                progMsg.textContent = `Worker procesando: descargando Contifico y calculando cruce...`;
            } else if (d.estado === 'completado') {
                clearInterval(cuadrarPollHandle);
                progBar.style.width = '100%';
                progMsg.textContent = 'Cruce completado correctamente';
                btn.disabled = false;
                status.innerHTML = `<div class="cuadrar-status-ok">
                    <i class="fas fa-check-circle"></i>
                    <span>Completado &nbsp;·&nbsp; Cruzados: <b>${d.total_cruzados}</b> &nbsp;·&nbsp; Con diferencia: <b>${d.total_con_diferencia}</b> &nbsp;·&nbsp; Valor descuadre: <b>$${(d.valor_total_dif||0).toLocaleString('es-EC',{minimumFractionDigits:2,maximumFractionDigits:2})}</b></span>
                    <button class="btn-ver-detalle" onclick="verCruceDetalle(${ejecId})"><i class="fas fa-list"></i> Ver detalle</button>
                </div>`;
                setTimeout(() => {
                    // Ampliar el rango de busqueda para incluir la fecha de toma del cruce
                    const fechaToma = d.fecha_toma;
                    if (fechaToma) {
                        const desde = document.getElementById('cruce-fecha-desde');
                        const hasta = document.getElementById('cruce-fecha-hasta');
                        if (desde.value > fechaToma) desde.value = fechaToma;
                        if (hasta.value < fechaToma) hasta.value = fechaToma;
                    }
                    cargarCruceOperativo();
                    // Recargar fechas de carga a Contifico (nueva fecha con cruce disponible)
                    cargaCargarFechas();
                    prog.classList.add('hidden');
                    // Abrir automaticamente el detalle
                    verCruceDetalle(ejecId);
                }, 1200);
            } else if (d.estado === 'error') {
                clearInterval(cuadrarPollHandle);
                prog.classList.add('hidden');
                btn.disabled = false;
                status.innerHTML = `<div class="cuadrar-status-error"><i class="fas fa-exclamation-triangle"></i> Error: ${d.error_msg || 'desconocido'}</div>`;
            }

            // Timeout 5 min
            if (intentos > 60) {
                clearInterval(cuadrarPollHandle);
                progMsg.textContent = 'Tiempo de espera excedido. Verifica que el worker este corriendo en PC FINANZAS.';
                btn.disabled = false;
            }
        } catch (e) {
            console.error('poll error:', e);
        }
    }, 5000);
}

async function cruceEliminar(ejecId, bodega, fecha) {
    if (!_puede('cruce', 'eliminar')) { showToast('No tienes permiso para eliminar cruces', 'error'); return; }
    if (!confirm(`Eliminar la ejecucion de "${bodega}" del ${fecha}?`)) return;
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/cruce-op/eliminar/${ejecId}`, {method: 'DELETE'});
        if (!r.ok) throw new Error('Error del servidor');
        cargarCruceOperativo();
    } catch (e) {
        alert('Error eliminando: ' + e.message);
    }
}

// ============================================================
// CARGAR TOMA FISICA A CONTIFICO
// ============================================================
let cargaPollHandle = null;

async function cargaCargarFechas() {
    const sel = document.getElementById('carga-fecha');
    if (!sel) return;
    const bodega = getCruceBodegaGlobal();
    sel.innerHTML = '<option value="">Cargando fechas...</option>';
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/carga-contifico/fechas-con-cruce?bodega=${bodega}`);
        const fechas = await r.json();
        if (!Array.isArray(fechas) || fechas.length === 0) {
            sel.innerHTML = '<option value="">Sin cruces completados</option>';
            return;
        }
        sel.innerHTML = fechas.map(f =>
            `<option value="${f.fecha}">${f.fecha} (${f.cruzados} cruzados, ${f.con_dif} con dif)</option>`
        ).join('');
        cargaVerificarEstado();
    } catch (e) {
        sel.innerHTML = '<option value="">Error cargando</option>';
        console.error(e);
    }
}

async function cargaVerificarEstado() {
    const bodega = getCruceBodegaGlobal();
    const fecha = document.getElementById('carga-fecha')?.value;
    const btn = document.getElementById('btn-cargar-contifico');
    const status = document.getElementById('carga-status');
    const prog = document.getElementById('carga-progreso');
    if (!bodega || !fecha || !btn) return;

    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-upload"></i> <span>CARGAR A CONTIFICO</span>';
    btn.style.background = 'linear-gradient(135deg, #27ae60, #2ecc71)';
    btn.style.opacity = '1';
    status.innerHTML = '';
    prog.classList.add('hidden');

    try {
        const r = await fetch(`${CONFIG.API_URL}/api/carga-contifico/verificar?bodega=${bodega}&fecha=${fecha}`);
        const data = await r.json();

        if (data.cargado) {
            const esAdmin = state.usuario?.rol === 'admin';
            if (esAdmin) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-redo"></i> <span>RE-CARGAR</span>';
                btn.style.opacity = '1';
                btn.style.background = 'linear-gradient(135deg, #d97706, #f59e0b)';
            } else {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-check-circle"></i> <span>YA CARGADO</span>';
                btn.style.opacity = '0.6';
            }
            const fechaFin = data.timestamp_fin ? new Date(data.timestamp_fin).toLocaleString('es-EC') : '';
            status.innerHTML = `<div class="cuadrar-status-ok">
                <i class="fas fa-check-circle"></i>
                <span>Cargado a Contifico &nbsp;·&nbsp; ${data.productos_ok || 0}/${data.total_productos || 0} productos OK${data.productos_error > 0 ? ` &nbsp;·&nbsp; ${data.productos_error} con error` : ''} &nbsp;·&nbsp; ${fechaFin}</span>
            </div>`;
        } else if (data.existe && (data.estado === 'pendiente' || data.estado === 'en_proceso')) {
            btn.disabled = true;
            cargaPollEstado(data.id);
        } else {
            btn.style.opacity = '1';
        }
    } catch (e) {
        console.error('Error verificando carga:', e);
    }
}

async function cargaSolicitar() {
    if (!_puede('cruce', 'editar')) { showToast('No tienes permiso para ejecutar cargas', 'error'); return; }
    const bodega = getCruceBodegaGlobal();
    const fecha = document.getElementById('carga-fecha').value;
    const btn = document.getElementById('btn-cargar-contifico');
    const status = document.getElementById('carga-status');
    const prog = document.getElementById('carga-progreso');
    const progBar = document.getElementById('carga-progreso-bar');
    const progMsg = document.getElementById('carga-progreso-msg');

    if (!fecha) { alert('Selecciona una fecha'); return; }

    const bodNombres = {bodega_principal:'Bodega Principal', materia_prima:'Materia Prima', planta:'Planta de Produccion'};
    const esRecarga = btn.textContent.includes('RE-CARGAR');
    const msgConfirm = esRecarga
        ? `ATENCION: Esta toma ya fue cargada previamente.\n\nVa a RE-CARGAR la toma fisica de ${bodNombres[bodega] || bodega} del ${fecha} a Contifico.\n\nEsto creara un DUPLICADO en Contifico.\n\nContinuar?`
        : `Va a cargar la toma fisica de ${bodNombres[bodega] || bodega} del ${fecha} a Contifico.\n\nEste proceso NO se puede deshacer.\n\nContinuar?`;
    if (!confirm(msgConfirm)) return;

    btn.disabled = true;
    status.innerHTML = '';
    prog.classList.remove('hidden');
    progBar.style.width = '5%';
    progMsg.textContent = 'Solicitando carga...';

    try {
        const r = await fetch(`${CONFIG.API_URL}/api/carga-contifico/solicitar`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                bodega, fecha_toma: fecha,
                usuario: state.usuario?.username || 'panel',
                rol: state.usuario?.rol || ''
            })
        });
        const data = await r.json();
        if (r.status === 409) {
            prog.classList.add('hidden');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-check-circle"></i> <span>YA CARGADO</span>';
            btn.style.opacity = '0.6';
            status.innerHTML = `<div class="cuadrar-status-ok"><i class="fas fa-check-circle"></i> Ya fue cargado previamente</div>`;
            return;
        }
        if (!r.ok) throw new Error(data.error || 'Error solicitando');
        progMsg.textContent = `Tarea creada (id ${data.id}). Esperando worker en PC FINANZAS...`;
        progBar.style.width = '10%';
        cargaPollEstado(data.id);
    } catch (e) {
        prog.classList.add('hidden');
        btn.disabled = false;
        status.innerHTML = `<div class="cuadrar-status-error"><i class="fas fa-exclamation-triangle"></i> Error: ${e.message}</div>`;
    }
}

function cargaPollEstado(ejecId) {
    const btn = document.getElementById('btn-cargar-contifico');
    const progBar = document.getElementById('carga-progreso-bar');
    const progMsg = document.getElementById('carga-progreso-msg');
    const status = document.getElementById('carga-status');
    const prog = document.getElementById('carga-progreso');

    let intentos = 0;
    if (cargaPollHandle) clearInterval(cargaPollHandle);

    btn.disabled = true;
    prog.classList.remove('hidden');

    cargaPollHandle = setInterval(async () => {
        intentos++;
        try {
            const r = await fetch(`${CONFIG.API_URL}/api/carga-contifico/estado/${ejecId}`);
            const d = await r.json();
            if (d.estado === 'pendiente') {
                progBar.style.width = Math.min(10 + intentos * 2, 25) + '%';
                progMsg.textContent = `Esperando worker... (${intentos * 5}s)`;
            } else if (d.estado === 'en_proceso') {
                progBar.style.width = Math.min(30 + intentos, 85) + '%';
                progMsg.textContent = `Worker llenando formulario en Contifico... esto puede tomar varios minutos`;
            } else if (d.estado === 'completado') {
                clearInterval(cargaPollHandle);
                progBar.style.width = '100%';
                progMsg.textContent = 'Carga completada';
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-check-circle"></i> <span>YA CARGADO</span>';
                btn.style.opacity = '0.6';
                status.innerHTML = `<div class="cuadrar-status-ok">
                    <i class="fas fa-check-circle"></i>
                    <span>Cargado a Contifico &nbsp;·&nbsp; ${d.productos_ok || 0}/${d.total_productos || 0} productos OK${d.productos_error > 0 ? ` &nbsp;·&nbsp; ${d.productos_error} con error (${d.productos_error_lista || ''})` : ''}</span>
                </div>`;
                setTimeout(() => prog.classList.add('hidden'), 2000);
            } else if (d.estado === 'error') {
                clearInterval(cargaPollHandle);
                prog.classList.add('hidden');
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-upload"></i> <span>CARGAR A CONTIFICO</span>';
                btn.style.opacity = '1';
                status.innerHTML = `<div class="cuadrar-status-error"><i class="fas fa-exclamation-triangle"></i> Error: ${d.error_msg || 'desconocido'}. Puedes reintentar.</div>`;
            }

            // Timeout 15 min (la carga de muchos productos es lenta)
            if (intentos > 180) {
                clearInterval(cargaPollHandle);
                progMsg.textContent = 'Tiempo de espera excedido. Verifica que el worker este corriendo en PC FINANZAS.';
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-upload"></i> <span>CARGAR A CONTIFICO</span>';
                btn.style.opacity = '1';
            }
        } catch (e) {
            console.error('poll carga error:', e);
        }
    }, 5000);
}

// ==================== ADMIN USUARIOS ====================

const BODEGAS_NOMBRES = {
    'real_audiencia': 'Real Audiencia', 'floreana': 'Floreana', 'portugal': 'Portugal',
    'santo_cachon_real': 'Santo Cachon Real', 'santo_cachon_portugal': 'Santo Cachon Portugal',
    'simon_bolon': 'Simon Bolon', 'bodega_principal': 'Bodega Principal',
    'materia_prima': 'Materia Prima', 'planta': 'Planta Produccion'
};
let _usuariosCache = [];
let _personasLoaded = false;
let _personasData = [];

async function _cargarPersonasDatalist() {
    if (_personasLoaded) return;
    try {
        const res = await fetch(`${CONFIG.API_URL}/api/admin/personas`);
        if (!res.ok) return;
        _personasData = await res.json();
        const dl = document.getElementById('uform-personas-list');
        if (dl) {
            dl.innerHTML = _personasData.map(p => `<option value="${escapeHtml(p.nombre)}">`).join('');
            _personasLoaded = true;
        }
        // Listener para auto-llenar email al seleccionar nombre
        const inputNombre = document.getElementById('uform-nombre');
        if (inputNombre && !inputNombre._listenerAdded) {
            inputNombre.addEventListener('change', _autoLlenarEmail);
            inputNombre.addEventListener('input', _autoLlenarEmail);
            inputNombre._listenerAdded = true;
        }
    } catch (e) { console.log('Error cargando personas:', e); }
}

function _autoLlenarEmail() {
    const nombre = document.getElementById('uform-nombre').value.trim();
    const persona = _personasData.find(p => p.nombre === nombre);
    if (persona && persona.correo) {
        document.getElementById('uform-email').value = persona.correo;
    }
}

async function usuariosCargar() {
    try {
        const res = await fetch(`${CONFIG.API_URL}/api/admin/usuarios`);
        if (!res.ok) throw new Error('Error cargando usuarios');
        _usuariosCache = await res.json();
        usuariosRenderTabla();
    } catch (e) { showToast('Error cargando usuarios: ' + e.message, 'error'); }
}

const MODULOS_NOMBRES = {
    'conteo': 'Conteo', 'observaciones': 'Observaciones', 'historico': 'Historico',
    'dashboard': 'Dashboard', 'cruce': 'Cruce Operativo',
    'bajas': 'Bajas', 'semanal': 'Semanal', 'correccion': 'Corregir Conteos',
    'usuarios': 'Admin Usuarios'
};
const MODULOS_LISTA = ['conteo','observaciones','historico','dashboard','cruce','bajas','semanal','correccion','usuarios'];

function usuariosRenderTabla() {
    const tbody = document.getElementById('usuarios-tbody');
    if (!tbody) return;
    if (!_usuariosCache.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#64748B;">Sin usuarios</td></tr>';
        return;
    }
    tbody.innerHTML = _usuariosCache.map(u => {
        const rolClass = u.rol === 'admin' ? 'badge-admin' : u.rol === 'gerente' ? 'badge-gerente' : u.rol === 'supervisor' ? 'badge-supervisor' : 'badge-subgerente';
        const estadoClass = u.activo ? 'badge-activo' : 'badge-inactivo';
        const bodegas = (u.bodegas || []).map(b => `<span class="badge-bodega">${BODEGAS_NOMBRES[b] || b}</span>`).join(' ');
        return `<tr>
            <td><strong>${escapeHtml(u.username)}</strong></td>
            <td>${escapeHtml(u.nombre)}</td>
            <td><span class="badge ${rolClass}">${u.rol}</span></td>
            <td><span class="badge ${estadoClass}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
            <td>${bodegas || '<span style="color:#475569;">Sin acceso</span>'}</td>
            <td class="usuarios-acciones">
                <button class="btn-editar-user" onclick="usuariosEditar(${u.id})" title="Editar"><i class="fas fa-pen"></i></button>
                ${u.email ? `<button class="btn-reenviar-user" onclick="usuariosReenviar(${u.id}, '${escapeHtml(u.email)}')" title="Reenviar invitacion"><i class="fas fa-envelope"></i></button>` : ''}
                ${u.username !== 'admin' ? `<button class="btn-eliminar-user" onclick="usuariosEliminar(${u.id}, '${escapeHtml(u.username)}')" title="Eliminar"><i class="fas fa-trash"></i></button>` : ''}
            </td>
        </tr>`;
    }).join('');
}

function usuariosMostrarFormNuevo() {
    _cargarPersonasDatalist();
    document.getElementById('usuarios-form').classList.remove('hidden');
    document.getElementById('usuarios-form-titulo').textContent = 'Nuevo Usuario';
    document.getElementById('uform-id').value = '';
    document.getElementById('uform-username').value = '';
    document.getElementById('uform-username').disabled = false;
    document.getElementById('uform-nombre').value = '';
    document.getElementById('uform-password').value = '';
    document.getElementById('uform-password').placeholder = 'Contrasena (o enviar por email)';
    document.getElementById('uform-email').value = '';
    document.getElementById('uform-rol').value = 'subgerente';
    document.getElementById('uform-activo').value = 'true';
    document.getElementById('uform-enviar-invitacion').checked = false;
    usuariosSelNinguna();
}

function usuariosEditar(id) {
    const u = _usuariosCache.find(x => x.id === id);
    if (!u) return;
    _cargarPersonasDatalist();
    document.getElementById('usuarios-form').classList.remove('hidden');
    document.getElementById('usuarios-form-titulo').textContent = `Editar: ${u.username}`;
    document.getElementById('uform-id').value = u.id;
    document.getElementById('uform-username').value = u.username;
    document.getElementById('uform-username').disabled = false;
    document.getElementById('uform-nombre').value = u.nombre;
    document.getElementById('uform-password').value = '';
    document.getElementById('uform-password').placeholder = 'Dejar vacio para no cambiar';
    document.getElementById('uform-email').value = u.email || '';
    document.getElementById('uform-rol').value = u.rol;
    document.getElementById('uform-activo').value = u.activo ? 'true' : 'false';
    document.getElementById('uform-enviar-invitacion').checked = false;
    document.querySelectorAll('#uform-bodegas input[type="checkbox"]').forEach(cb => {
        cb.checked = (u.bodegas || []).includes(cb.value);
    });
    document.getElementById('usuarios-form').scrollIntoView({ behavior: 'smooth' });
}

function usuariosCancelarForm() {
    document.getElementById('usuarios-form').classList.add('hidden');
}

async function usuariosGuardar() {
    if (!_puede('usuarios', 'editar')) { showToast('No tienes permiso para gestionar usuarios', 'error'); return; }
    const id = document.getElementById('uform-id').value;
    const username = document.getElementById('uform-username').value.trim().toLowerCase();
    const nombre = document.getElementById('uform-nombre').value.trim();
    const password = document.getElementById('uform-password').value.trim();
    const rol = document.getElementById('uform-rol').value;
    const activo = document.getElementById('uform-activo').value === 'true';
    const bodegas = [];
    document.querySelectorAll('#uform-bodegas input[type="checkbox"]:checked').forEach(cb => bodegas.push(cb.value));

    const email = document.getElementById('uform-email').value.trim();
    const enviar_invitacion = document.getElementById('uform-enviar-invitacion').checked;

    if (!username || !nombre) { showToast('Usuario y nombre son obligatorios', 'error'); return; }
    if (!id && !password && !enviar_invitacion) { showToast('Asigna contrasena o marca enviar invitacion por email', 'error'); return; }
    if (enviar_invitacion && !email) { showToast('Email es obligatorio para enviar invitacion', 'error'); return; }

    let adminPass = localStorage.getItem('admin_pass');
    if (!adminPass) {
        adminPass = prompt('Ingresa tu contrasena de admin para confirmar:');
        if (!adminPass) return;
        localStorage.setItem('admin_pass', adminPass);
    }

    const body = { username, nombre, password, rol, activo, bodegas, email, enviar_invitacion, admin_user: state.user.username, admin_pass: adminPass };
    try {
        const url = id ? `${CONFIG.API_URL}/api/admin/usuarios/${id}` : `${CONFIG.API_URL}/api/admin/usuarios`;
        const method = id ? 'PUT' : 'POST';
        const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json();
        if (res.ok && data.success) {
            showToast(data.message || 'Guardado', 'success');
            usuariosCancelarForm();
            usuariosCargar();
        } else {
            if (res.status === 403) localStorage.removeItem('admin_pass');
            showToast(data.error || 'Error al guardar', 'error');
        }
    } catch (e) { showToast('Error de conexion', 'error'); }
}

async function usuariosEliminar(id, username) {
    if (!_puede('usuarios', 'eliminar')) { showToast('No tienes permiso para eliminar usuarios', 'error'); return; }
    if (!confirm(`Eliminar usuario "${username}"? Esta accion no se puede deshacer.`)) return;
    let adminPass = localStorage.getItem('admin_pass');
    if (!adminPass) {
        adminPass = prompt('Ingresa tu contrasena de admin para confirmar:');
        if (!adminPass) return;
        localStorage.setItem('admin_pass', adminPass);
    }
    try {
        const res = await fetch(`${CONFIG.API_URL}/api/admin/usuarios/${id}`, {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_user: state.user.username, admin_pass: adminPass })
        });
        const data = await res.json();
        if (res.ok && data.success) { showToast(data.message || 'Eliminado', 'success'); usuariosCargar(); }
        else { if (res.status === 403) localStorage.removeItem('admin_pass'); showToast(data.error || 'Error al eliminar', 'error'); }
    } catch (e) { showToast('Error de conexion', 'error'); }
}

async function usuariosReenviar(id, email) {
    if (!confirm(`Reenviar invitacion a ${email}?`)) return;
    let adminPass = localStorage.getItem('admin_pass');
    if (!adminPass) {
        adminPass = prompt('Ingresa tu contrasena de admin para confirmar:');
        if (!adminPass) return;
        localStorage.setItem('admin_pass', adminPass);
    }
    try {
        const res = await fetch(`${CONFIG.API_URL}/api/admin/usuarios/${id}/reenviar`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_user: state.user.username, admin_pass: adminPass })
        });
        const data = await res.json();
        if (res.ok && data.success) { showToast(data.message, 'success'); }
        else { if (res.status === 403) localStorage.removeItem('admin_pass'); showToast(data.error || 'Error', 'error'); }
    } catch (e) { showToast('Error de conexion', 'error'); }
}

function usuariosSelTodas() { document.querySelectorAll('#uform-bodegas input[type="checkbox"]').forEach(cb => cb.checked = true); }
function usuariosSelNinguna() { document.querySelectorAll('#uform-bodegas input[type="checkbox"]').forEach(cb => cb.checked = false); }
function usuariosSelVentas() {
    const v = ['real_audiencia','floreana','portugal','santo_cachon_real','santo_cachon_portugal','simon_bolon'];
    document.querySelectorAll('#uform-bodegas input[type="checkbox"]').forEach(cb => cb.checked = v.includes(cb.value));
}
function usuariosSelOperativas() {
    const o = ['bodega_principal','materia_prima','planta'];
    document.querySelectorAll('#uform-bodegas input[type="checkbox"]').forEach(cb => cb.checked = o.includes(cb.value));
}

// ==================== CONFIGURACION PERMISOS POR ROL ====================

async function rolesCargar() {
    const container = document.getElementById('roles-config');
    if (!container) return;
    try {
        const res = await fetch(`${CONFIG.API_URL}/api/admin/roles`);
        if (!res.ok) return;
        const rolesData = await res.json();
        const roles = ['subgerente', 'supervisor', 'gerente', 'admin'];
        const rolIcons = { subgerente: 'fa-user', supervisor: 'fa-user-check', gerente: 'fa-user-tie', admin: 'fa-user-shield' };
        const rolColors = { subgerente: '#3B82F6', supervisor: '#8B5CF6', gerente: '#D97706', admin: '#059669' };

        container.innerHTML = roles.map(rol => {
            const mods = rolesData[rol] || {};
            const rows = MODULOS_LISTA.map(m => {
                const p = mods[m] || { ver: false, editar: false, eliminar: false };
                return `<tr>
                    <td style="font-size:12px;padding:4px 8px;font-weight:500;">${MODULOS_NOMBRES[m] || m}</td>
                    <td style="text-align:center;padding:4px;"><input type="checkbox" data-mod="${m}" data-perm="ver" ${p.ver ? 'checked' : ''}></td>
                    <td style="text-align:center;padding:4px;"><input type="checkbox" data-mod="${m}" data-perm="editar" ${p.editar ? 'checked' : ''}></td>
                    <td style="text-align:center;padding:4px;"><input type="checkbox" data-mod="${m}" data-perm="eliminar" ${p.eliminar ? 'checked' : ''}></td>
                </tr>`;
            }).join('');
            return `<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:16px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
                    <i class="fas ${rolIcons[rol]}" style="color:${rolColors[rol]};font-size:18px;"></i>
                    <strong style="color:#123450;text-transform:capitalize;font-size:15px;">${rol}</strong>
                </div>
                <table id="rol-perms-${rol}" style="width:100%;border-collapse:collapse;">
                    <thead>
                        <tr style="border-bottom:1px solid #E2E8F0;">
                            <th style="text-align:left;padding:4px 8px;font-size:11px;color:#64748B;">Modulo</th>
                            <th style="text-align:center;padding:4px;font-size:11px;color:#64748B;">Ver</th>
                            <th style="text-align:center;padding:4px;font-size:11px;color:#64748B;">Editar</th>
                            <th style="text-align:center;padding:4px;font-size:11px;color:#64748B;">Eliminar</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
                <button class="btn-sm btn-primary" onclick="rolGuardar('${rol}')" style="margin-top:12px;width:100%;">
                    <i class="fas fa-save"></i> Guardar ${rol}
                </button>
            </div>`;
        }).join('');
    } catch (e) { console.log('Error cargando roles:', e); }
}

async function rolGuardar(rol) {
    const modulos = {};
    document.querySelectorAll(`#rol-perms-${rol} input[type="checkbox"]`).forEach(cb => {
        const mod = cb.dataset.mod;
        const perm = cb.dataset.perm;
        if (!modulos[mod]) modulos[mod] = { ver: false, editar: false, eliminar: false };
        modulos[mod][perm] = cb.checked;
    });

    let adminPass = localStorage.getItem('admin_pass');
    if (!adminPass) {
        adminPass = prompt('Contrasena de admin:');
        if (!adminPass) return;
        localStorage.setItem('admin_pass', adminPass);
    }

    try {
        const res = await fetch(`${CONFIG.API_URL}/api/admin/roles`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rol, modulos, admin_user: state.user.username, admin_pass: adminPass })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showToast(data.message, 'success');
        } else {
            if (res.status === 403) localStorage.removeItem('admin_pass');
            showToast(data.error || 'Error', 'error');
        }
    } catch (e) { showToast('Error de conexion', 'error'); }
}

// Helper global: verificar si el usuario puede hacer una accion en un modulo
let _dashProductosCargados = '';
async function _dashCargarProductos(fechaDesde, fechaHasta, bodega) {
    const sel = document.getElementById('dash-producto');
    if (!sel) return;
    const key = `${fechaDesde}|${fechaHasta}|${bodega}`;
    if (_dashProductosCargados === key) return; // ya cargado para estos filtros
    const valorActual = sel.value;
    try {
        const bodParam = bodega ? `&bodega=${bodega}` : '';
        const res = await fetch(`${CONFIG.API_URL}/api/reportes/productos-disponibles?fecha_desde=${fechaDesde}&fecha_hasta=${fechaHasta}${bodParam}`);
        if (!res.ok) return;
        const prods = await res.json();
        sel.innerHTML = '<option value="">Todos los productos</option>' +
            prods.map(p => `<option value="${escapeHtml(p.codigo)}" ${p.codigo === valorActual ? 'selected' : ''}>${escapeHtml(p.codigo)} - ${escapeHtml(p.nombre)}</option>`).join('');
        _dashProductosCargados = key;
    } catch (e) { console.log('Error cargando productos dash:', e); }
}

async function _refrescarPermisos() {
    if (!state.user) return;
    try {
        const res = await fetch(`${CONFIG.API_URL}/api/admin/roles`);
        if (!res.ok) return;
        const rolesData = await res.json();
        const rol = state.user.rol || 'subgerente';
        const permsRol = rolesData[rol] || {};
        state.user.permisos = permsRol;
        state.user.modulos = Object.keys(permsRol).filter(m => permsRol[m] && permsRol[m].ver);
        localStorage.setItem('user', JSON.stringify(state.user));
        showMainScreen(); // Refrescar nav con permisos actualizados
    } catch (e) { console.log('Error refrescando permisos:', e); }
}

function _puede(modulo, accion) {
    // En modo impersonación, usar permisos del usuario simulado
    const user = state._impersonando || state.user;
    if (!user) return false;
    if (!state._impersonando && (user.rol === 'admin' || user.username === 'admin')) return true;
    const perms = user.permisos;
    if (!perms || !perms[modulo]) return false;
    return perms[modulo][accion] === true;
}

// Helper: retorna true si el usuario EFECTIVO (respetando impersonacion) es admin
function _esAdmin() {
    if (state._impersonando) return state._impersonando.rol === 'admin';
    return state.user && (state.user.rol === 'admin' || state.user.username === 'admin');
}

// Helper: retorna true si el usuario EFECTIVO es admin o supervisor
function _esAdminOSupervisor() {
    if (state._impersonando) return state._impersonando.rol === 'admin' || state._impersonando.rol === 'supervisor';
    return state.user && (state.user.rol === 'admin' || state.user.rol === 'supervisor' || state.user.username === 'admin');
}

// ==================== IMPERSONACION (solo admin) ====================

async function cargarSelectorImpersonar() {
    const select = document.getElementById('btn-impersonar');
    if (!select) return;
    const esAdmin = state.user && (state.user.rol === 'admin' || state.user.username === 'admin');
    if (!esAdmin) { select.style.display = 'none'; return; }

    select.style.display = '';
    select.innerHTML = '<option value="">👁 Ver como...</option>';

    try {
        const res = await fetch(`${CONFIG.API_URL}/api/admin/usuarios`);
        if (!res.ok) return;
        const usuarios = await res.json();
        usuarios.forEach(u => {
            if (u.username === state.user.username) return; // No mostrarse a si mismo
            if (!u.activo) return;
            const opt = document.createElement('option');
            opt.value = u.username;
            opt.textContent = `${u.nombre} (${u.rol})`;
            opt.dataset.info = JSON.stringify(u);
            select.appendChild(opt);
        });
    } catch (e) { console.log('Error cargando usuarios para impersonar:', e); }

    select.onchange = function() {
        if (!this.value) { salirImpersonacion(); return; }
        const opt = this.querySelector(`option[value="${this.value}"]`);
        if (!opt) return;
        const uData = JSON.parse(opt.dataset.info);
        iniciarImpersonacion(uData);
    };
}

async function iniciarImpersonacion(uData) {
    // Cargar permisos del rol
    try {
        const res = await fetch(`${CONFIG.API_URL}/api/admin/roles`);
        if (!res.ok) return;
        const rolesData = await res.json();
        const permsRol = rolesData[uData.rol] || {};
        const modulos = Object.keys(permsRol).filter(m => permsRol[m] && permsRol[m].ver);

        // Determinar bodega asignada (igual que login)
        const bodegas = uData.bodegas || [];
        const bodegas_ventas = bodegas.filter(b => !['bodega_principal','materia_prima','planta'].includes(b));
        const bodega = bodegas_ventas.length === 1 ? bodegas_ventas[0] : null;

        state._impersonando = {
            username: uData.username,
            nombre: uData.nombre,
            rol: uData.rol,
            bodega: bodega,
            bodegas: bodegas,
            modulos: modulos,
            permisos: permsRol
        };

        // Mostrar banner
        document.getElementById('impersonar-banner').style.display = '';
        document.getElementById('impersonar-nombre').textContent = uData.nombre;
        document.getElementById('impersonar-rol').textContent = uData.rol;

        // Refrescar UI con permisos simulados
        _aplicarVistaImpersonada();
    } catch (e) { console.log('Error en impersonacion:', e); }
}

function _aplicarVistaImpersonada() {
    const imp = state._impersonando;
    if (!imp) return;

    // Actualizar nombre mostrado
    document.getElementById('user-name').textContent = imp.nombre + ' (vista)';

    // Mostrar/ocultar nav segun modulos del usuario simulado
    const userModulos = imp.modulos || [];
    document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
        const mod = btn.dataset.view;
        if (mod === 'usuarios') {
            btn.style.display = 'none';
        } else {
            btn.style.display = userModulos.includes(mod) ? '' : 'none';
        }
    });

    // Recargar bodegas con las del usuario simulado
    const origUser = state.user;
    const tempUser = { ...state.user, bodega: imp.bodega, bodegas: imp.bodegas };
    state.user = tempUser;
    cargarBodegas();
    state.user = origUser;
    // Guardar bodegas impersonadas para que cargarBodegas funcione
    state._impBodegas = imp.bodegas;
    state._impBodega = imp.bodega;
}

// ============================================================
// MODULO DESCUENTOS NOMINA
// ============================================================

let _descDetalleData = [];

async function descCargarReporte() {
    const desde = document.getElementById('desc-fecha-desde').value;
    const hasta = document.getElementById('desc-fecha-hasta').value;
    const local = document.getElementById('desc-local').value;
    if (!desde || !hasta) { showToast('Selecciona fechas', 'error'); return; }

    document.getElementById('desc-tabla-resumen').innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Cargando...</p></div>';
    document.getElementById('desc-stats').innerHTML = '';
    document.getElementById('desc-detalle').innerHTML = '';

    try {
        let url = `${CONFIG.API_URL}/api/descuentos/reporte?fecha_desde=${desde}&fecha_hasta=${hasta}`;
        if (local) url += `&local=${local}`;
        const r = await fetch(url);
        const data = await r.json();
        if (data.error) { showToast(data.error, 'error'); return; }

        _descDetalleData = data.detalle || [];
        const resumen = data.resumen || [];
        const semanas = data.semanas || [];

        // KPIs
        document.getElementById('desc-stats').innerHTML = `
            <div class="dashboard-stat-card">
                <div class="stat-icon" style="background:rgba(37,99,235,0.1);color:#2563eb;"><i class="fas fa-users"></i></div>
                <div class="stat-info"><div class="stat-valor">${data.total_personas}</div><div class="stat-label">Personas</div></div>
            </div>
            <div class="dashboard-stat-card">
                <div class="stat-icon" style="background:rgba(220,38,38,0.1);color:#dc2626;"><i class="fas fa-dollar-sign"></i></div>
                <div class="stat-info"><div class="stat-valor">$${parseFloat(data.total_descuento).toFixed(2)}</div><div class="stat-label">Total a Descontar</div></div>
            </div>
            `;

        // Tabla resumen
        if (resumen.length === 0) {
            document.getElementById('desc-tabla-resumen').innerHTML = '<div class="empty-state"><i class="fas fa-check-circle" style="color:#059669;"></i><p>No hay descuentos en este periodo</p></div>';
            return;
        }

        document.getElementById('desc-tabla-resumen').innerHTML = `
            <div class="chart-card">
                <div class="chart-card-header"><i class="fas fa-list"></i> Resumen por Persona</div>
                <div style="padding:0;overflow-x:auto;">
                    <table class="usuarios-tabla" style="width:100%;font-size:13px;margin:0;">
                        <thead><tr>
                            <th style="text-align:left;padding-left:16px;">Persona</th>
                            <th>Semanas</th>
                            <th>Total Descuento</th>
                            <th></th>
                        </tr></thead>
                        <tbody>${resumen.map(r => {
                            const monto = parseFloat(r.total_monto);
                            return `<tr>
                                <td style="font-weight:600;padding-left:16px;">${escapeHtml(r.persona)}</td>
                                <td style="text-align:center;">${r.semanas}</td>
                                <td style="text-align:center;font-weight:700;color:#dc2626;">$${monto.toFixed(2)}</td>
                                <td style="text-align:center;">
                                    <button class="btn-sm btn-secondary" onclick="descToggleDetalle('${escapeHtml(r.persona).replace(/'/g, "\\'")}')">
                                        <i class="fas fa-eye"></i> Ver
                                    </button>
                                </td>
                            </tr>`;
                        }).join('')}
                        <tr style="background:#f1f5f9;font-weight:700;">
                            <td style="padding-left:16px;">TOTAL</td>
                            <td></td>
                            <td style="text-align:center;color:#dc2626;font-size:15px;">$${parseFloat(data.total_descuento).toFixed(2)}</td>
                            <td></td>
                        </tr>
                        </tbody>
                    </table>
                </div>
            </div>`;

    } catch(e) {
        document.getElementById('desc-tabla-resumen').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${e.message}</p></div>`;
    }
}

function descToggleDetalle(persona) {
    const container = document.getElementById('desc-detalle');
    // Si ya esta mostrando esta persona, cerrar
    if (container.dataset.persona === persona && container.innerHTML) {
        container.innerHTML = '';
        container.dataset.persona = '';
        return;
    }
    container.dataset.persona = persona;
    const items = _descDetalleData.filter(d => d.persona === persona);
    if (items.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Sin detalle</p></div>';
        return;
    }

    // Agrupar por semana+local
    const grupos = {};
    items.forEach(d => {
        const key = `${d.fecha_inicio}_${d.local}`;
        if (!grupos[key]) grupos[key] = { fecha_inicio: d.fecha_inicio, fecha_fin: d.fecha_fin, local: d.local, productos: [], total: 0 };
        const monto = parseFloat(d.monto) || 0;
        grupos[key].productos.push(d);
        grupos[key].total += monto;
    });

    container.innerHTML = `
        <div class="chart-card" style="border-left:4px solid #dc2626;">
            <div class="chart-card-header">
                <i class="fas fa-user"></i> Detalle: ${escapeHtml(persona)}
                <button class="btn-sm btn-secondary" onclick="document.getElementById('desc-detalle').innerHTML=''" style="margin-left:auto;">
                    <i class="fas fa-times"></i> Cerrar
                </button>
            </div>
            <div style="padding:16px;overflow-x:auto;">
                ${Object.values(grupos).map(g => `
                    <div style="margin-bottom:16px;">
                        <div style="font-weight:600;font-size:13px;color:#1e293b;margin-bottom:6px;">
                            <i class="fas fa-calendar-week" style="color:#2563eb;"></i>
                            ${g.fecha_inicio} a ${g.fecha_fin} · ${LOCALES_NOMBRES[g.local] || g.local}
                            <span style="float:right;color:#dc2626;">$${g.total.toFixed(2)}</span>
                        </div>
                        <table class="usuarios-tabla" style="width:100%;font-size:12px;margin:0;">
                            <thead><tr><th>Codigo</th><th>Producto</th><th>Cantidad</th><th>Costo Unit.</th><th>Monto</th></tr></thead>
                            <tbody>${g.productos.map(p => `<tr>
                                <td>${escapeHtml(p.codigo)}</td>
                                <td>${escapeHtml(p.nombre)}</td>
                                <td style="text-align:center;">${parseFloat(p.cantidad || 0).toFixed(2)}</td>
                                <td style="text-align:center;">$${parseFloat(p.costo_unitario || 0).toFixed(4)}</td>
                                <td style="text-align:center;font-weight:600;color:#dc2626;">$${parseFloat(p.monto || 0).toFixed(2)}</td>
                            </tr>`).join('')}</tbody>
                        </table>
                    </div>
                `).join('')}
            </div>
        </div>`;
}

function descExportarExcel() {
    const desde = document.getElementById('desc-fecha-desde').value;
    const hasta = document.getElementById('desc-fecha-hasta').value;
    const local = document.getElementById('desc-local').value;
    if (!desde || !hasta) { showToast('Selecciona fechas primero', 'error'); return; }
    let url = `${CONFIG.API_URL}/api/descuentos/exportar-excel?fecha_desde=${desde}&fecha_hasta=${hasta}`;
    if (local) url += `&local=${local}`;
    window.open(url, '_blank');
}


// ============================================================
// MODULO CUADRES DE CAJA
// ============================================================

const LOCALES_NOMBRES = {
    'real_audiencia': 'Real Audiencia', 'floreana': 'Floreana', 'portugal': 'Portugal',
    'santo_cachon_real': 'Santo Cachon Real', 'santo_cachon_portugal': 'Santo Cachon Portugal',
    'simon_bolon': 'Simon Bolon'
};

function cuadreInit() {
    const f = document.getElementById('cuadre-fecha');
    if (f && !f.value) f.value = new Date().toISOString().split('T')[0];
}

function cuadreRecalcular() {
    const v = id => parseFloat(document.getElementById(id).value) || 0;
    const esperado = v('cuadre-venta-sistema') - v('cuadre-venta-tarjeta') - v('cuadre-venta-transferencia')
        - v('cuadre-venta-plataformas') + v('cuadre-otros-ingresos') - v('cuadre-gastos-retiros');
    const diferencia = v('cuadre-efectivo-contado') - esperado;
    document.getElementById('cuadre-esperado-val').textContent = '$' + esperado.toFixed(2);
    const difEl = document.getElementById('cuadre-diferencia-val');
    difEl.textContent = '$' + diferencia.toFixed(2);
    difEl.style.color = Math.abs(diferencia) < 1 ? '#059669' : '#dc2626';
}

async function cuadreGuardar() {
    const fecha = document.getElementById('cuadre-fecha').value;
    const local = document.getElementById('cuadre-local').value;
    if (!fecha || !local) { showToast('Fecha y local requeridos', 'error'); return; }
    const v = id => parseFloat(document.getElementById(id).value) || 0;
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/cuadres/guardar`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                fecha, local,
                venta_sistema: v('cuadre-venta-sistema'),
                efectivo_contado: v('cuadre-efectivo-contado'),
                venta_tarjeta: v('cuadre-venta-tarjeta'),
                venta_transferencia: v('cuadre-venta-transferencia'),
                venta_plataformas: v('cuadre-venta-plataformas'),
                otros_ingresos: v('cuadre-otros-ingresos'),
                gastos_retiros: v('cuadre-gastos-retiros'),
                observacion: document.getElementById('cuadre-observacion').value,
                registrado_por: state.user?.username || ''
            })
        });
        const data = await r.json();
        if (data.success) {
            showToast('Cuadre guardado correctamente', 'success');
            // Reset form
            ['cuadre-venta-sistema','cuadre-efectivo-contado','cuadre-venta-tarjeta','cuadre-venta-transferencia',
             'cuadre-venta-plataformas','cuadre-otros-ingresos','cuadre-gastos-retiros'].forEach(id => {
                document.getElementById(id).value = '0';
            });
            document.getElementById('cuadre-observacion').value = '';
            cuadreRecalcular();
        } else { showToast(data.error || 'Error al guardar', 'error'); }
    } catch(e) { showToast('Error de conexion', 'error'); }
}

async function cuadreCargarHistorial() {
    const desde = document.getElementById('cuadre-hist-desde').value;
    const hasta = document.getElementById('cuadre-hist-hasta').value;
    const local = document.getElementById('cuadre-hist-local').value;
    if (!desde || !hasta) { showToast('Selecciona fechas', 'error'); return; }
    const container = document.getElementById('cuadre-hist-list');
    container.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Cargando...</p></div>';
    try {
        let url = `${CONFIG.API_URL}/api/cuadres/listar?fecha_desde=${desde}&fecha_hasta=${hasta}`;
        if (local) url += `&local=${local}`;
        const r = await fetch(url);
        const data = await r.json();
        const cuadres = data.cuadres || [];
        if (cuadres.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>Sin cuadres en este periodo</p></div>';
            return;
        }
        container.innerHTML = `
            <p style="color:var(--text-gray);margin-bottom:12px;">${cuadres.length} cuadres encontrados</p>
            <div style="overflow-x:auto;">
                <table class="usuarios-tabla" style="width:100%;font-size:13px;">
                    <thead><tr>
                        <th>Fecha</th><th>Local</th><th>Venta Sist.</th><th>Efect. Contado</th>
                        <th>Tarjeta</th><th>Transfer.</th><th>Plataformas</th><th>Esperado</th>
                        <th>Diferencia</th><th>Acciones</th>
                    </tr></thead>
                    <tbody>${cuadres.map(c => {
                        const dif = parseFloat(c.diferencia) || 0;
                        const difColor = Math.abs(dif) < 1 ? '#059669' : '#dc2626';
                        return `<tr>
                            <td>${c.fecha}</td>
                            <td>${LOCALES_NOMBRES[c.local] || c.local}</td>
                            <td>$${parseFloat(c.venta_sistema).toFixed(2)}</td>
                            <td>$${parseFloat(c.efectivo_contado).toFixed(2)}</td>
                            <td>$${parseFloat(c.venta_tarjeta).toFixed(2)}</td>
                            <td>$${parseFloat(c.venta_transferencia).toFixed(2)}</td>
                            <td>$${parseFloat(c.venta_plataformas).toFixed(2)}</td>
                            <td>$${parseFloat(c.efectivo_esperado).toFixed(2)}</td>
                            <td style="color:${difColor};font-weight:700;">$${dif.toFixed(2)}</td>
                            <td><button class="btn-sm btn-secondary" style="color:#dc2626;" onclick="cuadreEliminar(${c.id})"><i class="fas fa-trash"></i></button></td>
                        </tr>`;
                    }).join('')}</tbody>
                </table>
            </div>`;
    } catch(e) { container.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${e.message}</p></div>`; }
}

async function cuadreEliminar(id) {
    if (!confirm('Eliminar este cuadre de caja?')) return;
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/cuadres/${id}`, {method: 'DELETE'});
        if (r.ok) { showToast('Cuadre eliminado', 'success'); cuadreCargarHistorial(); }
        else showToast('Error al eliminar', 'error');
    } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function cuadreCargarDashboard() {
    const desde = document.getElementById('cuadre-dash-desde').value;
    const hasta = document.getElementById('cuadre-dash-hasta').value;
    if (!desde || !hasta) { showToast('Selecciona fechas', 'error'); return; }
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/cuadres/resumen?fecha_desde=${desde}&fecha_hasta=${hasta}`);
        const data = await r.json();
        document.getElementById('cuadre-dash-stats').innerHTML = `
            <div class="dashboard-stat-card">
                <div class="stat-icon" style="background:rgba(37,99,235,0.1);color:#2563eb;"><i class="fas fa-receipt"></i></div>
                <div class="stat-info"><div class="stat-valor">${data.total}</div><div class="stat-label">Total Cuadres</div></div>
            </div>
            <div class="dashboard-stat-card">
                <div class="stat-icon" style="background:rgba(220,38,38,0.1);color:#dc2626;"><i class="fas fa-exclamation-triangle"></i></div>
                <div class="stat-info"><div class="stat-valor">${data.con_descuadre}</div><div class="stat-label">Con Descuadre</div></div>
            </div>
            <div class="dashboard-stat-card">
                <div class="stat-icon" style="background:rgba(220,38,38,0.1);color:#dc2626;"><i class="fas fa-dollar-sign"></i></div>
                <div class="stat-info"><div class="stat-valor">$${parseFloat(data.total_diferencia).toFixed(2)}</div><div class="stat-label">Diferencia Acumulada</div></div>
            </div>
            <div class="dashboard-stat-card">
                <div class="stat-icon" style="background:rgba(5,150,105,0.1);color:#059669;"><i class="fas fa-chart-line"></i></div>
                <div class="stat-info"><div class="stat-valor">$${parseFloat(data.avg_diferencia).toFixed(2)}</div><div class="stat-label">Diferencia Promedio</div></div>
            </div>`;

        // Chart por local
        const locales = data.por_local || [];
        if (locales.length > 0) {
            destroyChart('chart-cuadre-local');
            const ctx = document.getElementById('chart-cuadre-local').getContext('2d');
            chartInstances['chart-cuadre-local'] = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: locales.map(l => LOCALES_NOMBRES[l.local] || l.local),
                    datasets: [{
                        label: 'Diferencia Absoluta ($)',
                        data: locales.map(l => parseFloat(l.diferencia_abs)),
                        backgroundColor: CHART_COLORS_ALPHA.slice(0, locales.length)
                    }]
                },
                options: { responsive: true, plugins: { legend: { display: false } } }
            });

            // Tabla por local
            document.getElementById('cuadre-dash-tabla').innerHTML = `
                <div class="chart-card">
                    <div class="chart-card-header"><i class="fas fa-table"></i> Resumen por Local</div>
                    <div style="padding:16px;overflow-x:auto;">
                        <table class="usuarios-tabla" style="width:100%;">
                            <thead><tr><th>Local</th><th>Cuadres</th><th>Dif. Total</th><th>Dif. Promedio</th></tr></thead>
                            <tbody>${locales.map(l => `<tr>
                                <td style="font-weight:600;">${LOCALES_NOMBRES[l.local] || l.local}</td>
                                <td>${l.cuadres}</td>
                                <td style="color:${parseFloat(l.diferencia_abs) > 5 ? '#dc2626' : '#059669'};font-weight:600;">$${parseFloat(l.diferencia_abs).toFixed(2)}</td>
                                <td>$${parseFloat(l.diferencia_avg).toFixed(2)}</td>
                            </tr>`).join('')}</tbody>
                        </table>
                    </div>
                </div>`;
        }
    } catch(e) { showToast('Error: ' + e.message, 'error'); }
}


// ============================================================
// MODULO DELIVERY / PLATAFORMAS
// ============================================================

function delInit() {
    const f = document.getElementById('del-fecha');
    if (f && !f.value) f.value = new Date().toISOString().split('T')[0];
}

function delRecalcularPct() {
    const bruta = parseFloat(document.getElementById('del-venta-bruta').value) || 0;
    const pct = parseFloat(document.getElementById('del-comision-pct').value) || 0;
    document.getElementById('del-comision-monto').value = (bruta * pct / 100).toFixed(2);
    const comMonto = parseFloat(document.getElementById('del-comision-monto').value) || 0;
    document.getElementById('del-iva-comision').value = (comMonto * 0.15).toFixed(2);
    delRecalcular();
}

function delRecalcular() {
    const v = id => parseFloat(document.getElementById(id).value) || 0;
    const neto = v('del-venta-bruta') - v('del-comision-monto') - v('del-iva-comision') + v('del-propinas') + v('del-ajustes');
    const dif = v('del-depositado') - neto;
    document.getElementById('del-neto-val').textContent = '$' + neto.toFixed(2);
    const difEl = document.getElementById('del-diferencia-val');
    difEl.textContent = '$' + dif.toFixed(2);
    difEl.style.color = Math.abs(dif) < 1 ? '#059669' : '#dc2626';
}

async function delGuardar() {
    const fecha = document.getElementById('del-fecha').value;
    const local = document.getElementById('del-local').value;
    const plataforma = document.getElementById('del-plataforma').value;
    if (!fecha || !local || !plataforma) { showToast('Fecha, local y plataforma requeridos', 'error'); return; }
    const v = id => parseFloat(document.getElementById(id).value) || 0;
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/delivery/guardar`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                fecha, local, plataforma,
                total_pedidos: parseInt(document.getElementById('del-pedidos').value) || 0,
                venta_bruta: v('del-venta-bruta'), comision_pct: v('del-comision-pct'),
                comision_monto: v('del-comision-monto'), iva_comision: v('del-iva-comision'),
                propinas: v('del-propinas'), ajustes: v('del-ajustes'),
                depositado_real: v('del-depositado'),
                referencia: document.getElementById('del-referencia').value,
                observacion: document.getElementById('del-observacion').value,
                registrado_por: state.user?.username || ''
            })
        });
        const data = await r.json();
        if (data.success) {
            showToast('Liquidacion registrada', 'success');
            ['del-venta-bruta','del-comision-pct','del-comision-monto','del-iva-comision',
             'del-propinas','del-ajustes','del-depositado','del-pedidos'].forEach(id => {
                document.getElementById(id).value = '0';
            });
            document.getElementById('del-referencia').value = '';
            document.getElementById('del-observacion').value = '';
            delRecalcular();
        } else { showToast(data.error || 'Error', 'error'); }
    } catch(e) { showToast('Error de conexion', 'error'); }
}

async function delCargarHistorial() {
    const desde = document.getElementById('del-hist-desde').value;
    const hasta = document.getElementById('del-hist-hasta').value;
    if (!desde || !hasta) { showToast('Selecciona fechas', 'error'); return; }
    const local = document.getElementById('del-hist-local').value;
    const plataforma = document.getElementById('del-hist-plataforma').value;
    const container = document.getElementById('del-hist-list');
    container.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Cargando...</p></div>';
    try {
        let url = `${CONFIG.API_URL}/api/delivery/listar?fecha_desde=${desde}&fecha_hasta=${hasta}`;
        if (local) url += `&local=${local}`;
        if (plataforma) url += `&plataforma=${encodeURIComponent(plataforma)}`;
        const r = await fetch(url);
        const data = await r.json();
        const liqs = data.liquidaciones || [];
        if (liqs.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>Sin liquidaciones en este periodo</p></div>';
            return;
        }
        container.innerHTML = `
            <p style="color:var(--text-gray);margin-bottom:12px;">${liqs.length} liquidaciones encontradas</p>
            <div style="overflow-x:auto;">
                <table class="usuarios-tabla" style="width:100%;font-size:12px;">
                    <thead><tr>
                        <th>Fecha</th><th>Local</th><th>Plataforma</th><th>Pedidos</th><th>Vta Bruta</th>
                        <th>Comision</th><th>Neto</th><th>Depositado</th><th>Diferencia</th><th></th>
                    </tr></thead>
                    <tbody>${liqs.map(l => {
                        const dif = parseFloat(l.diferencia) || 0;
                        const difColor = Math.abs(dif) < 1 ? '#059669' : '#dc2626';
                        return `<tr>
                            <td>${l.fecha}</td>
                            <td>${LOCALES_NOMBRES[l.local] || l.local}</td>
                            <td><strong>${escapeHtml(l.plataforma)}</strong></td>
                            <td>${l.total_pedidos}</td>
                            <td>$${parseFloat(l.venta_bruta).toFixed(2)}</td>
                            <td>$${parseFloat(l.comision_monto).toFixed(2)} (${parseFloat(l.comision_pct).toFixed(1)}%)</td>
                            <td>$${parseFloat(l.neto_recibir).toFixed(2)}</td>
                            <td>$${parseFloat(l.depositado_real).toFixed(2)}</td>
                            <td style="color:${difColor};font-weight:700;">$${dif.toFixed(2)}</td>
                            <td><button class="btn-sm btn-secondary" style="color:#dc2626;" onclick="delEliminar(${l.id})"><i class="fas fa-trash"></i></button></td>
                        </tr>`;
                    }).join('')}</tbody>
                </table>
            </div>`;
    } catch(e) { container.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${e.message}</p></div>`; }
}

async function delEliminar(id) {
    if (!confirm('Eliminar esta liquidacion?')) return;
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/delivery/${id}`, {method: 'DELETE'});
        if (r.ok) { showToast('Eliminado', 'success'); delCargarHistorial(); }
        else showToast('Error', 'error');
    } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function delCargarDashboard() {
    const desde = document.getElementById('del-dash-desde').value;
    const hasta = document.getElementById('del-dash-hasta').value;
    if (!desde || !hasta) { showToast('Selecciona fechas', 'error'); return; }
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/delivery/resumen?fecha_desde=${desde}&fecha_hasta=${hasta}`);
        const data = await r.json();
        document.getElementById('del-dash-stats').innerHTML = `
            <div class="dashboard-stat-card">
                <div class="stat-icon" style="background:rgba(37,99,235,0.1);color:#2563eb;"><i class="fas fa-motorcycle"></i></div>
                <div class="stat-info"><div class="stat-valor">${data.total_pedidos}</div><div class="stat-label">Total Pedidos</div></div>
            </div>
            <div class="dashboard-stat-card">
                <div class="stat-icon" style="background:rgba(5,150,105,0.1);color:#059669;"><i class="fas fa-dollar-sign"></i></div>
                <div class="stat-info"><div class="stat-valor">$${parseFloat(data.total_ventas).toLocaleString('es-EC',{minimumFractionDigits:2})}</div><div class="stat-label">Venta Bruta Total</div></div>
            </div>
            <div class="dashboard-stat-card">
                <div class="stat-icon" style="background:rgba(245,158,11,0.1);color:#d97706;"><i class="fas fa-percentage"></i></div>
                <div class="stat-info"><div class="stat-valor">$${parseFloat(data.total_comisiones).toLocaleString('es-EC',{minimumFractionDigits:2})}</div><div class="stat-label">Total Comisiones</div></div>
            </div>
            <div class="dashboard-stat-card">
                <div class="stat-icon" style="background:rgba(220,38,38,0.1);color:#dc2626;"><i class="fas fa-exclamation-triangle"></i></div>
                <div class="stat-info"><div class="stat-valor">$${parseFloat(data.total_diferencia).toFixed(2)}</div><div class="stat-label">Diferencia Total</div></div>
            </div>`;

        // Chart por plataforma
        const plats = data.por_plataforma || [];
        if (plats.length > 0) {
            destroyChart('chart-del-plataforma');
            chartInstances['chart-del-plataforma'] = new Chart(document.getElementById('chart-del-plataforma').getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: plats.map(p => p.plataforma),
                    datasets: [{ data: plats.map(p => parseFloat(p.ventas)), backgroundColor: CHART_COLORS.slice(0, plats.length) }]
                },
                options: { responsive: true }
            });
        }

        // Chart por local
        const locs = data.por_local || [];
        if (locs.length > 0) {
            destroyChart('chart-del-local');
            chartInstances['chart-del-local'] = new Chart(document.getElementById('chart-del-local').getContext('2d'), {
                type: 'bar',
                data: {
                    labels: locs.map(l => LOCALES_NOMBRES[l.local] || l.local),
                    datasets: [{ label: 'Ventas ($)', data: locs.map(l => parseFloat(l.ventas)), backgroundColor: CHART_COLORS_ALPHA.slice(0, locs.length) }]
                },
                options: { responsive: true, plugins: { legend: { display: false } } }
            });
        }

        // Tabla plataformas
        document.getElementById('del-dash-tabla').innerHTML = plats.length ? `
            <div class="chart-card">
                <div class="chart-card-header"><i class="fas fa-table"></i> Resumen por Plataforma</div>
                <div style="padding:16px;overflow-x:auto;">
                    <table class="usuarios-tabla" style="width:100%;">
                        <thead><tr><th>Plataforma</th><th>Liquidaciones</th><th>Pedidos</th><th>Ventas</th><th>Comisiones</th><th>Com. % Avg</th><th>Diferencias</th></tr></thead>
                        <tbody>${plats.map(p => `<tr>
                            <td style="font-weight:600;">${escapeHtml(p.plataforma)}</td>
                            <td>${p.liquidaciones}</td>
                            <td>${p.pedidos}</td>
                            <td>$${parseFloat(p.ventas).toLocaleString('es-EC',{minimumFractionDigits:2})}</td>
                            <td>$${parseFloat(p.comisiones).toFixed(2)}</td>
                            <td>${parseFloat(p.comision_pct_avg).toFixed(1)}%</td>
                            <td style="color:${parseFloat(p.diferencia_abs) > 1 ? '#dc2626' : '#059669'};font-weight:600;">$${parseFloat(p.diferencia_abs).toFixed(2)}</td>
                        </tr>`).join('')}</tbody>
                    </table>
                </div>
            </div>` : '';
    } catch(e) { showToast('Error: ' + e.message, 'error'); }
}


// ============================================================
// MODULO FACTURAS
// ============================================================

function facInit() {
    const f = document.getElementById('fac-fecha');
    if (f && !f.value) f.value = new Date().toISOString().split('T')[0];
}

function facRecalcularIVA() {
    const subtIva = parseFloat(document.getElementById('fac-subtotal-iva').value) || 0;
    document.getElementById('fac-iva').value = (subtIva * 0.15).toFixed(2);
    facRecalcular();
}

function facRecalcular() {
    const s0 = parseFloat(document.getElementById('fac-subtotal0').value) || 0;
    const si = parseFloat(document.getElementById('fac-subtotal-iva').value) || 0;
    const iva = parseFloat(document.getElementById('fac-iva').value) || 0;
    document.getElementById('fac-total').value = (s0 + si + iva).toFixed(2);
}

async function facGuardar() {
    const fecha = document.getElementById('fac-fecha').value;
    const local = document.getElementById('fac-local').value;
    const proveedor = document.getElementById('fac-proveedor').value.trim();
    if (!fecha || !local || !proveedor) { showToast('Fecha, local y proveedor requeridos', 'error'); return; }
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/facturas/guardar`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                fecha_emision: fecha, local, proveedor,
                ruc: document.getElementById('fac-ruc').value.trim(),
                numero_factura: document.getElementById('fac-numero').value.trim(),
                autorizacion: document.getElementById('fac-autorizacion').value.trim(),
                subtotal_0: parseFloat(document.getElementById('fac-subtotal0').value) || 0,
                subtotal_iva: parseFloat(document.getElementById('fac-subtotal-iva').value) || 0,
                iva: parseFloat(document.getElementById('fac-iva').value) || 0,
                categoria: document.getElementById('fac-categoria').value,
                forma_pago: document.getElementById('fac-forma-pago').value,
                estado_pago: document.getElementById('fac-estado-pago').value,
                observacion: document.getElementById('fac-observacion').value,
                registrado_por: state.user?.username || ''
            })
        });
        const data = await r.json();
        if (data.success) {
            showToast('Factura registrada', 'success');
            ['fac-proveedor','fac-ruc','fac-numero','fac-autorizacion','fac-observacion'].forEach(id => {
                document.getElementById(id).value = '';
            });
            ['fac-subtotal0','fac-subtotal-iva','fac-iva','fac-total'].forEach(id => {
                document.getElementById(id).value = '0';
            });
        } else { showToast(data.error || 'Error', 'error'); }
    } catch(e) { showToast('Error de conexion', 'error'); }
}

async function facCargarHistorial() {
    const desde = document.getElementById('fac-hist-desde').value;
    const hasta = document.getElementById('fac-hist-hasta').value;
    if (!desde || !hasta) { showToast('Selecciona fechas', 'error'); return; }
    const local = document.getElementById('fac-hist-local').value;
    const categoria = document.getElementById('fac-hist-categoria').value;
    const estado = document.getElementById('fac-hist-estado').value;
    const container = document.getElementById('fac-hist-list');
    container.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Cargando...</p></div>';
    try {
        let url = `${CONFIG.API_URL}/api/facturas/listar?fecha_desde=${desde}&fecha_hasta=${hasta}`;
        if (local) url += `&local=${local}`;
        if (categoria) url += `&categoria=${encodeURIComponent(categoria)}`;
        if (estado) url += `&estado_pago=${encodeURIComponent(estado)}`;
        const r = await fetch(url);
        const data = await r.json();
        const facs = data.facturas || [];
        if (facs.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>Sin facturas en este periodo</p></div>';
            return;
        }
        const totalSum = facs.reduce((s,f) => s + (parseFloat(f.total)||0), 0);
        const estadoColors = {'Pagada':'#059669','Pendiente':'#d97706','Parcial':'#2563eb'};
        container.innerHTML = `
            <p style="color:var(--text-gray);margin-bottom:12px;">${facs.length} facturas — Total: <strong>$${totalSum.toLocaleString('es-EC',{minimumFractionDigits:2})}</strong></p>
            <div style="overflow-x:auto;">
                <table class="usuarios-tabla" style="width:100%;font-size:12px;">
                    <thead><tr>
                        <th>Fecha</th><th>Local</th><th>Proveedor</th><th>RUC</th><th>Nro. Factura</th>
                        <th>Categoria</th><th>Total</th><th>Estado</th><th></th>
                    </tr></thead>
                    <tbody>${facs.map(f => `<tr>
                        <td>${f.fecha_emision}</td>
                        <td>${LOCALES_NOMBRES[f.local] || f.local}</td>
                        <td style="font-weight:600;">${escapeHtml(f.proveedor)}</td>
                        <td>${escapeHtml(f.ruc || '')}</td>
                        <td>${escapeHtml(f.numero_factura || '')}</td>
                        <td>${escapeHtml(f.categoria)}</td>
                        <td style="font-weight:700;">$${parseFloat(f.total).toFixed(2)}</td>
                        <td>
                            <select onchange="facCambiarEstado(${f.id}, this.value)" style="padding:2px 6px;border-radius:4px;border:1px solid #e2e8f0;font-size:11px;font-weight:600;color:${estadoColors[f.estado_pago]||'#475569'};">
                                <option value="Pendiente" ${f.estado_pago==='Pendiente'?'selected':''}>Pendiente</option>
                                <option value="Pagada" ${f.estado_pago==='Pagada'?'selected':''}>Pagada</option>
                                <option value="Parcial" ${f.estado_pago==='Parcial'?'selected':''}>Parcial</option>
                            </select>
                        </td>
                        <td><button class="btn-sm btn-secondary" style="color:#dc2626;" onclick="facEliminar(${f.id})"><i class="fas fa-trash"></i></button></td>
                    </tr>`).join('')}</tbody>
                </table>
            </div>`;
    } catch(e) { container.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${e.message}</p></div>`; }
}

async function facCambiarEstado(id, estado) {
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/facturas/${id}`, {
            method: 'PUT', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({estado_pago: estado})
        });
        if (r.ok) showToast('Estado actualizado', 'success');
        else showToast('Error', 'error');
    } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function facEliminar(id) {
    if (!confirm('Eliminar esta factura?')) return;
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/facturas/${id}`, {method: 'DELETE'});
        if (r.ok) { showToast('Factura eliminada', 'success'); facCargarHistorial(); }
        else showToast('Error', 'error');
    } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function facCargarDashboard() {
    const desde = document.getElementById('fac-dash-desde').value;
    const hasta = document.getElementById('fac-dash-hasta').value;
    if (!desde || !hasta) { showToast('Selecciona fechas', 'error'); return; }
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/facturas/resumen?fecha_desde=${desde}&fecha_hasta=${hasta}`);
        const data = await r.json();
        document.getElementById('fac-dash-stats').innerHTML = `
            <div class="dashboard-stat-card">
                <div class="stat-icon" style="background:rgba(37,99,235,0.1);color:#2563eb;"><i class="fas fa-file-invoice"></i></div>
                <div class="stat-info"><div class="stat-valor">${data.total}</div><div class="stat-label">Total Facturas</div></div>
            </div>
            <div class="dashboard-stat-card">
                <div class="stat-icon" style="background:rgba(5,150,105,0.1);color:#059669;"><i class="fas fa-dollar-sign"></i></div>
                <div class="stat-info"><div class="stat-valor">$${parseFloat(data.total_facturado).toLocaleString('es-EC',{minimumFractionDigits:2})}</div><div class="stat-label">Total Facturado</div></div>
            </div>
            <div class="dashboard-stat-card">
                <div class="stat-icon" style="background:rgba(245,158,11,0.1);color:#d97706;"><i class="fas fa-clock"></i></div>
                <div class="stat-info"><div class="stat-valor">${data.pendientes}</div><div class="stat-label">Pendientes de Pago</div></div>
            </div>
            <div class="dashboard-stat-card">
                <div class="stat-icon" style="background:rgba(220,38,38,0.1);color:#dc2626;"><i class="fas fa-exclamation-circle"></i></div>
                <div class="stat-info"><div class="stat-valor">$${parseFloat(data.monto_pendiente).toLocaleString('es-EC',{minimumFractionDigits:2})}</div><div class="stat-label">Monto Pendiente</div></div>
            </div>`;

        // Chart por categoria
        const cats = data.por_categoria || [];
        if (cats.length > 0) {
            destroyChart('chart-fac-categoria');
            chartInstances['chart-fac-categoria'] = new Chart(document.getElementById('chart-fac-categoria').getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: cats.map(c => c.categoria),
                    datasets: [{ data: cats.map(c => parseFloat(c.monto)), backgroundColor: CHART_COLORS.slice(0, cats.length) }]
                },
                options: { responsive: true }
            });
        }

        // Chart por local
        const locs = data.por_local || [];
        if (locs.length > 0) {
            destroyChart('chart-fac-local');
            chartInstances['chart-fac-local'] = new Chart(document.getElementById('chart-fac-local').getContext('2d'), {
                type: 'bar',
                data: {
                    labels: locs.map(l => LOCALES_NOMBRES[l.local] || l.local),
                    datasets: [{ label: 'Monto ($)', data: locs.map(l => parseFloat(l.monto)), backgroundColor: CHART_COLORS_ALPHA.slice(0, locs.length) }]
                },
                options: { responsive: true, plugins: { legend: { display: false } } }
            });
        }

        // Tabla
        document.getElementById('fac-dash-tabla').innerHTML = locs.length ? `
            <div class="chart-card">
                <div class="chart-card-header"><i class="fas fa-table"></i> Resumen por Local</div>
                <div style="padding:16px;overflow-x:auto;">
                    <table class="usuarios-tabla" style="width:100%;">
                        <thead><tr><th>Local</th><th>Facturas</th><th>Monto Total</th><th>Pendientes</th></tr></thead>
                        <tbody>${locs.map(l => `<tr>
                            <td style="font-weight:600;">${LOCALES_NOMBRES[l.local] || l.local}</td>
                            <td>${l.facturas}</td>
                            <td>$${parseFloat(l.monto).toLocaleString('es-EC',{minimumFractionDigits:2})}</td>
                            <td style="color:${l.pendientes > 0 ? '#d97706' : '#059669'};font-weight:600;">${l.pendientes}</td>
                        </tr>`).join('')}</tbody>
                    </table>
                </div>
            </div>` : '';
    } catch(e) { showToast('Error: ' + e.message, 'error'); }
}


// ==================== CONFIG PRODUCTOS POR MARCA ====================

let _cprodCache = [];

async function cprodCargar() {
    const marca = document.getElementById('cprod-marca').value;
    const btnAgregar = document.getElementById('cprod-btn-agregar');
    const btnCargaInicial = document.getElementById('cprod-btn-carga-inicial');
    const resumen = document.getElementById('cprod-resumen');
    const container = document.getElementById('cprod-tabla-container');
    const buscador = document.getElementById('cprod-buscador');

    if (!marca) {
        btnAgregar.style.display = 'none';
        btnCargaInicial.style.display = 'none';
        resumen.style.display = 'none';
        if (buscador) buscador.style.display = 'none';
        container.innerHTML = `<div class="empty-state" style="padding:60px 20px;">
            <i class="fas fa-boxes-stacked" style="font-size:48px;color:var(--border);margin-bottom:16px;display:block;"></i>
            <p style="color:var(--text-gray);font-size:14px;">Selecciona una marca para ver y configurar sus productos</p>
        </div>`;
        return;
    }

    container.innerHTML = `<div class="empty-state" style="padding:40px;"><i class="fas fa-spinner fa-spin" style="font-size:24px;color:var(--primary);"></i><p style="color:var(--text-gray);margin-top:12px;">Cargando productos...</p></div>`;

    try {
        const res = await fetch(`${CONFIG.API_URL}/api/admin/productos-marca?marca=${marca}`);
        if (!res.ok) throw new Error('Error cargando productos');
        _cprodCache = await res.json();

        btnAgregar.style.display = '';
        resumen.style.display = 'flex';

        const activos = _cprodCache.filter(p => p.activo).length;
        const inactivos = _cprodCache.length - activos;
        document.getElementById('cprod-total').textContent = _cprodCache.length;
        document.getElementById('cprod-activos').textContent = activos;
        document.getElementById('cprod-inactivos').textContent = inactivos;

        btnCargaInicial.style.display = _cprodCache.length === 0 ? '' : 'none';
        if (buscador) {
            buscador.style.display = _cprodCache.length > 0 ? '' : 'none';
            document.getElementById('cprod-buscar').value = '';
        }

        cprodRenderTabla(_cprodCache);
    } catch (e) {
        container.innerHTML = `<div class="empty-state" style="padding:40px;"><i class="fas fa-exclamation-triangle" style="font-size:32px;color:var(--danger);margin-bottom:12px;display:block;"></i><p style="color:var(--text-gray);">Error: ${e.message}</p></div>`;
    }
}

function cprodFiltrar() {
    const q = (document.getElementById('cprod-buscar')?.value || '').toUpperCase();
    if (!q) { cprodRenderTabla(_cprodCache); return; }
    cprodRenderTabla(_cprodCache.filter(p => p.codigo.includes(q) || p.nombre.includes(q)));
}

function cprodRenderTabla(productos) {
    const container = document.getElementById('cprod-tabla-container');
    if (productos.length === 0) {
        container.innerHTML = `<div class="empty-state" style="padding:50px 20px;">
            <i class="fas fa-inbox" style="font-size:40px;color:var(--border);margin-bottom:14px;display:block;"></i>
            <p style="color:var(--text-gray);font-size:14px;">No hay productos configurados para esta marca.<br>Usa <b>Carga Inicial</b> para importar los productos actuales.</p>
        </div>`;
        return;
    }

    let html = `<table class="usuarios-tabla" style="width:100%;margin:0;">
        <thead><tr>
            <th style="width:36px;text-align:center;">#</th>
            <th style="width:110px;">Codigo</th>
            <th>Nombre</th>
            <th style="width:120px;text-align:center;">Medida</th>
            <th style="width:100px;text-align:center;">Equivalencia</th>
            <th style="width:130px;text-align:center;">Tipo Conteo</th>
            <th style="width:80px;text-align:center;">Estado</th>
            <th style="width:100px;text-align:center;">Acciones</th>
        </tr></thead><tbody>`;

    productos.forEach((p, i) => {
        const badgeClass = p.activo ? 'badge-activo' : 'badge-inactivo';
        const badgeText = p.activo ? 'Activo' : 'Inactivo';
        const toggleIcon = p.activo ? 'fa-toggle-on' : 'fa-toggle-off';
        const toggleColor = p.activo ? 'var(--warning)' : 'var(--success)';
        const toggleTitle = p.activo ? 'Desactivar' : 'Activar';
        const rowStyle = p.activo ? '' : 'opacity:0.55;';
        const unidad = p.unidad || 'Unidad';
        const equiv = parseFloat(p.equivalencia || 1);
        const tipoConteo = p.tipo_conteo || 'diario';
        const tipoConteoOpts = [
            {v:'diario', label:'Control Diario'},
            {v:'cruce', label:'Cruce Operativo'},
            {v:'ambos', label:'Ambos'},
        ];
        const tipoConteoColors = {diario:'#3B82F6', cruce:'#F59E0B', ambos:'#10B981'};

        html += `<tr style="${rowStyle}">
            <td style="text-align:center;color:var(--text-light);font-size:12px;">${i + 1}</td>
            <td style="font-weight:700;color:var(--primary);letter-spacing:0.02em;">${p.codigo}</td>
            <td style="color:var(--text-dark);">${p.nombre}</td>
            <td style="text-align:center;">
                <select onchange="cprodEditarCampo(${p.id},'unidad',this.value)" style="padding:5px 8px;border:1px solid var(--border-light);border-radius:6px;font-size:12px;background:var(--bg-white);color:var(--text-dark);cursor:pointer;font-family:'JetBrains Mono',monospace;">
                    ${['Unidad','Paquete','Gramos','Kilogramos','Litros','Mililitros'].map(u => `<option value="${u}" ${u===unidad?'selected':''}>${u}</option>`).join('')}
                </select>
            </td>
            <td style="text-align:center;">
                <input type="number" value="${equiv}" min="0" step="0.01"
                    onchange="cprodEditarCampo(${p.id},'equivalencia',this.value)"
                    style="width:70px;padding:5px 6px;border:1px solid var(--border-light);border-radius:6px;font-size:12px;text-align:center;background:var(--bg-white);color:var(--text-dark);font-family:'JetBrains Mono',monospace;">
            </td>
            <td style="text-align:center;">
                <select onchange="cprodEditarCampo(${p.id},'tipo_conteo',this.value)" style="padding:5px 8px;border:1px solid var(--border-light);border-radius:6px;font-size:11px;background:var(--bg-white);color:${tipoConteoColors[tipoConteo]||'#6B7280'};cursor:pointer;font-weight:600;font-family:'Inter',sans-serif;">
                    ${tipoConteoOpts.map(o => `<option value="${o.v}" ${o.v===tipoConteo?'selected':''}>${o.label}</option>`).join('')}
                </select>
            </td>
            <td style="text-align:center;">
                <span class="badge ${badgeClass}" style="font-size:0.65rem;">${badgeText}</span>
            </td>
            <td style="text-align:center;">
                <button onclick="cprodToggle(${p.id})" title="${toggleTitle}" style="background:none;border:none;color:${toggleColor};cursor:pointer;font-size:20px;padding:4px 6px;transition:transform 0.15s;" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'">
                    <i class="fas ${toggleIcon}"></i>
                </button>
                <button onclick="cprodEliminar(${p.id}, '${p.codigo}')" title="Eliminar" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:15px;padding:4px 6px;opacity:0.6;transition:opacity 0.15s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </td>
        </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

async function cprodEditarCampo(id, campo, valor) {
    try {
        const body = {};
        body[campo] = campo === 'equivalencia' ? parseFloat(valor) : valor;
        const res = await fetch(`${CONFIG.API_URL}/api/admin/productos-marca/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error('Error al guardar');
        const prod = await res.json();
        showToast(`${prod.codigo}: ${campo} = ${valor}`, 'success');
        // Actualizar cache local sin recargar toda la tabla
        const idx = _cprodCache.findIndex(p => p.id === id);
        if (idx >= 0) { _cprodCache[idx][campo] = campo === 'equivalencia' ? parseFloat(valor) : valor; }
    } catch (e) {
        showToast(e.message, 'error');
    }
}

function cprodMostrarFormAgregar() {
    document.getElementById('cprod-form-agregar').classList.remove('hidden');
    document.getElementById('cprod-codigo').value = '';
    document.getElementById('cprod-nombre').value = '';
    document.getElementById('cprod-codigo').focus();
}

function cprodCerrarForm() {
    document.getElementById('cprod-form-agregar').classList.add('hidden');
}

async function cprodAgregar() {
    const marca = document.getElementById('cprod-marca').value;
    const codigo = document.getElementById('cprod-codigo').value.trim().toUpperCase();
    const nombre = document.getElementById('cprod-nombre').value.trim().toUpperCase();
    const unidad = document.getElementById('cprod-unidad').value;
    const equivalencia = parseFloat(document.getElementById('cprod-equivalencia').value) || 1;

    if (!marca || !codigo || !nombre) {
        showToast('Completa marca, codigo y nombre', 'error');
        return;
    }

    try {
        const res = await fetch(`${CONFIG.API_URL}/api/admin/productos-marca`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ marca, codigo, nombre, unidad, equivalencia })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Error al agregar');
        }
        showToast(`Producto ${codigo} agregado`, 'success');
        cprodCerrarForm();
        cprodCargar();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function cprodToggle(id) {
    try {
        const res = await fetch(`${CONFIG.API_URL}/api/admin/productos-marca/toggle/${id}`, { method: 'PUT' });
        if (!res.ok) throw new Error('Error al cambiar estado');
        const prod = await res.json();
        showToast(`${prod.codigo} ${prod.activo ? 'activado' : 'desactivado'}`, 'success');
        cprodCargar();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function cprodEliminar(id, codigo) {
    if (!confirm(`¿Eliminar ${codigo} de esta marca? Esta accion no se puede deshacer.`)) return;
    try {
        const res = await fetch(`${CONFIG.API_URL}/api/admin/productos-marca/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Error al eliminar');
        showToast(`${codigo} eliminado`, 'success');
        cprodCargar();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function cprodCargaInicial() {
    const marca = document.getElementById('cprod-marca').value;
    if (!marca) return;
    if (!confirm(`¿Cargar los productos predeterminados de ${marca}? Esto no duplicara productos existentes.`)) return;

    try {
        const res = await fetch(`${CONFIG.API_URL}/api/admin/productos-marca/carga-inicial`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ marca })
        });
        if (!res.ok) throw new Error('Error en carga inicial');
        const data = await res.json();
        showToast(`Carga inicial completada: ${data.insertados} productos`, 'success');
        cprodCargar();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

function salirImpersonacion() {
    state._impersonando = null;
    state._impBodegas = null;
    state._impBodega = null;
    document.getElementById('impersonar-banner').style.display = 'none';
    document.getElementById('btn-impersonar').value = '';
    document.getElementById('user-name').textContent = state.user.nombre;
    showMainScreen();
}

// ==================== VOUCHER SCANNER MODULE ====================

const VS_ANON = 'sb_publishable_Dn4ehqDrb56ayi08Gt5ReA_WJ3y-rWY';
const VS_BASE = 'https://oufzmiklqcwbabaxhyjy.supabase.co';
const VS_STORAGE = 'https://oufzmiklqcwbabaxhyjy.supabase.co/storage/v1/object/public/gfc_finanzas/';
let vsToken = null;
let vsTokenExpira = 0;
let vsDatosActuales = [];
let vsFotosMap = {};
let vsCierresActuales = [];
let vsInicializado = false;

function vs_initVouchers() {
    if (!vsInicializado) {
        vsInicializado = true;
        document.getElementById('vs-filtro-fecha').value = new Date().toISOString().split('T')[0];
        vs_getToken();
    }
}

async function vs_login() {
    try {
        const res = await fetch(`${VS_BASE}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: { 'apikey': VS_ANON, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'contabilidad@chiosburger.com', password: 'mZAPXjaf6RhNotNZWlk4Nrso' })
        });
        const d = await res.json();
        if (d.access_token) {
            vsToken = d.access_token;
            vsTokenExpira = Date.now() + (d.expires_in - 60) * 1000;
            document.getElementById('vs-dot-estado').className = 'vs-dot vs-verde';
            document.getElementById('vs-txt-estado').textContent = 'Conectado';
            return true;
        }
    } catch(e) {}
    document.getElementById('vs-dot-estado').className = 'vs-dot vs-rojo';
    document.getElementById('vs-txt-estado').textContent = 'Sin conexion';
    return false;
}

async function vs_getToken() {
    if (!vsToken || Date.now() > vsTokenExpira) await vs_login();
    return vsToken;
}

function vs_apiHeaders(tk) {
    return { 'apikey': VS_ANON, 'Authorization': `Bearer ${tk}`, 'Accept-Profile': 'gfc_finanzas' };
}

async function vs_buscar() {
    const fecha = document.getElementById('vs-filtro-fecha').value;
    const local = document.getElementById('vs-filtro-local').value;
    if (!fecha) { alert('Selecciona una fecha'); return; }

    document.getElementById('vs-btn-buscar').disabled = true;
    document.getElementById('vs-tabla-contenido').innerHTML = `<div class="vs-estado-msg"><div class="vs-spinner"></div><p>Cargando datos...</p></div>`;
    document.getElementById('vs-resumen').style.display = 'none';
    document.getElementById('vs-cierre-banner').style.display = 'none';
    document.getElementById('vs-filtro-estado').style.display = 'none';
    document.getElementById('vs-btn-export').style.display = 'none';

    const tk = await vs_getToken();
    if (!tk) {
        document.getElementById('vs-tabla-contenido').innerHTML = `<div class="vs-estado-msg"><div class="icono">&#10060;</div><p>Error de conexion. Intenta de nuevo.</p></div>`;
        document.getElementById('vs-btn-buscar').disabled = false;
        return;
    }

    let urlReg = `${VS_BASE}/rest/v1/gfc_ing_voucher_registros?fecha_registro=eq.${fecha}&order=hora_registro.asc&limit=500`;
    if (local) urlReg += `&centro_costo_id=eq.${local}`;
    let urlCierre = `${VS_BASE}/rest/v1/gfc_ing_voucher_cierre_lote?fecha_cierre=eq.${fecha}&order=lote_numero.asc`;
    if (local) urlCierre += `&centro_costo_id=eq.${local}`;

    try {
        const [resReg, resCierre] = await Promise.all([
            fetch(urlReg, { headers: vs_apiHeaders(tk) }),
            fetch(urlCierre, { headers: vs_apiHeaders(tk) })
        ]);
        const registros = await resReg.json();
        const cierres = await resCierre.json();
        vsDatosActuales = registros;
        vsCierresActuales = cierres;

        vsFotosMap = {};
        if (registros.length > 0) {
            const ids = registros.map(r => r.id).join(',');
            const urlPagos = `${VS_BASE}/rest/v1/gfc_ing_voucher_pagos?registro_id=in.(${ids})&select=registro_id,foto_url,tarjeta_tipo,red,numero_transaccion,total`;
            try {
                const resPagos = await fetch(urlPagos, { headers: vs_apiHeaders(tk) });
                const pagos = await resPagos.json();
                for (const p of pagos) {
                    if (!vsFotosMap[p.registro_id]) vsFotosMap[p.registro_id] = [];
                    vsFotosMap[p.registro_id].push(p);
                }
            } catch(e) {}
        }

        vs_renderCierre(cierres);
        vs_renderResumen(registros);
        vs_renderTabla(registros);
        vs_renderFiltroCaja(registros);
        vs_renderFiltroLote(cierres);

        document.getElementById('vs-filtro-estado').style.display = registros.length > 0 ? 'flex' : 'none';
        document.getElementById('vs-btn-export').style.display = registros.length > 0 ? 'inline-block' : 'none';
        document.querySelectorAll('.vs-btn-estado').forEach(b => b.classList.remove('activo'));
        document.querySelector('.vs-btn-estado.todos').classList.add('activo');
    } catch(e) {
        document.getElementById('vs-tabla-contenido').innerHTML = `<div class="vs-estado-msg"><div class="icono">&#10060;</div><p>Error al cargar datos.</p></div>`;
    }
    document.getElementById('vs-btn-buscar').disabled = false;
}

function vs_renderFiltroLote(cierres) {
    const sel = document.getElementById('vs-filtro-lote');
    const grupo = document.getElementById('vs-grupo-lote');
    sel.innerHTML = '<option value="">— Todos los lotes —</option>';
    if (!cierres || cierres.length === 0) { grupo.style.display = 'none'; return; }
    cierres.forEach((c, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        const estado = c.estado === 'completo' ? '\u2713' : c.estado === 'con_diferencias' ? '\u26A0' : '';
        opt.textContent = `Lote ${c.lote_numero || '\u2014'} \u00B7 cierre ${c.hora_cierre ? c.hora_cierre.substring(0,5) : '\u2014'} \u00B7 $${Number(c.total_cierre||0).toFixed(2)} ${estado}`;
        sel.appendChild(opt);
    });
    grupo.style.display = 'flex';
    sel.value = '';
}

function vs_filtrarLote() {
    const idx = document.getElementById('vs-filtro-lote').value;
    if (idx === '') {
        vs_renderCierre(vsCierresActuales);
        vs_renderResumen(vsDatosActuales);
        vs_renderTabla(vsDatosActuales);
        document.getElementById('vs-tabla-count').textContent = vsDatosActuales.length + ' registros';
        document.getElementById('vs-filtro-caja').value = '';
        vs_renderFiltroCaja(vsDatosActuales);
        document.querySelectorAll('.vs-btn-estado').forEach(b => b.classList.remove('activo'));
        document.querySelector('.vs-btn-estado.todos').classList.add('activo');
        return;
    }
    const cierre = vsCierresActuales[parseInt(idx)];
    const prevCierre = parseInt(idx) > 0 ? vsCierresActuales[parseInt(idx) - 1] : null;
    vs_renderCierre([cierre]);
    const horaFin = cierre.hora_cierre || '23:59:59';
    const horaInicio = prevCierre ? (prevCierre.hora_cierre || '00:00:00') : '00:00:00';
    const datos = vsDatosActuales.filter(r => {
        const h = r.hora_registro || '00:00:00';
        return h > horaInicio && h <= horaFin;
    });
    vs_renderResumen(datos);
    vs_renderTabla(datos);
    vs_renderFiltroCaja(datos);
    document.getElementById('vs-tabla-count').textContent = datos.length + ' registros';
    document.getElementById('vs-filtro-caja').value = '';
    document.querySelectorAll('.vs-btn-estado').forEach(b => b.classList.remove('activo'));
    document.querySelector('.vs-btn-estado.todos').classList.add('activo');
}

function vs_renderFiltroCaja(registros) {
    const sel = document.getElementById('vs-filtro-caja');
    const grupo = document.getElementById('vs-grupo-caja');
    const cajeros = [...new Set(registros.map(r => r.cajero_nombre || r.registrado_por_nombre || '').filter(Boolean))].sort();
    sel.innerHTML = '<option value="">— Todas las cajas —</option>';
    cajeros.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = c;
        sel.appendChild(opt);
    });
    grupo.style.display = cajeros.length > 0 ? 'flex' : 'none';
    sel.value = '';
}

function vs_filtrarCaja() {
    const cajero = document.getElementById('vs-filtro-caja').value;
    const datos = cajero
        ? vsDatosActuales.filter(r => (r.cajero_nombre || r.registrado_por_nombre || '') === cajero)
        : vsDatosActuales;
    vs_renderResumen(datos);
    vs_renderTabla(datos);
    document.getElementById('vs-tabla-count').textContent = datos.length + ' registros';
    document.querySelectorAll('.vs-btn-estado').forEach(b => b.classList.remove('activo'));
    document.querySelector('.vs-btn-estado.todos').classList.add('activo');
}

function vs_renderCierre(cierres) {
    const banner = document.getElementById('vs-cierre-banner');
    if (!cierres || cierres.length === 0) {
        banner.style.display = 'flex';
        document.getElementById('vs-c-lote').textContent = 'Sin registro';
        ['vs-c-terminal','vs-c-red','vs-c-total','vs-c-txn','vs-c-match','vs-c-hora','vs-c-verificado'].forEach(id => {
            document.getElementById(id).textContent = '\u2014';
        });
        document.getElementById('vs-c-estado-badge').innerHTML = '<span class="vs-cierre-badge sin-cierre">Sin cierre registrado</span>';
        return;
    }
    const c = cierres[0];
    const extras = cierres.length > 1 ? ` (+${cierres.length - 1} mas)` : '';
    banner.style.display = 'flex';
    document.getElementById('vs-c-lote').textContent = (c.lote_numero || '\u2014') + extras;
    document.getElementById('vs-c-terminal').textContent = c.terminal_id || '\u2014';
    document.getElementById('vs-c-red').textContent = c.red || '\u2014';
    document.getElementById('vs-c-total').textContent = c.total_cierre != null ? '$' + Number(c.total_cierre).toFixed(2) : '\u2014';
    document.getElementById('vs-c-txn').textContent = c.cantidad_transacciones ?? '\u2014';
    document.getElementById('vs-c-match').textContent = `${c.total_coinciden ?? '\u2014'} / ${c.total_faltantes ?? '\u2014'} / ${c.total_errores ?? '\u2014'}`;
    document.getElementById('vs-c-hora').textContent = c.hora_cierre ? c.hora_cierre.substring(0,5) : '\u2014';
    document.getElementById('vs-c-verificado').textContent = c.verificado_por_nombre || '\u2014';
    let badgeClass = 'sin-cierre', badgeText = c.estado || '\u2014';
    if (c.estado === 'completo') { badgeClass = 'completo'; badgeText = 'Completo'; }
    else if (c.estado === 'con_diferencias') { badgeClass = 'diferencias'; badgeText = 'Con diferencias'; }
    document.getElementById('vs-c-estado-badge').innerHTML = `<span class="vs-cierre-badge ${badgeClass}">${badgeText}</span>`;
}

function vs_renderResumen(datos) {
    if (datos.length === 0) { document.getElementById('vs-resumen').style.display = 'none'; return; }
    const total = datos.reduce((s, r) => s + (r.factura_total || 0), 0);
    const cuadran = datos.filter(r => Math.round((r.factura_total||0)*100) === Math.round((r.vouchers_total||0)*100)).length;
    const descuadran = datos.length - cuadran;
    const difTotal = datos.reduce((s, r) => s + Math.abs(Math.round(((r.factura_total||0)-(r.vouchers_total||0))*100)/100), 0);
    const conFoto = Object.values(vsFotosMap).reduce((s, arr) => s + arr.filter(p => p.foto_url).length, 0);
    document.getElementById('vs-r-total').textContent = '$' + total.toFixed(2);
    document.getElementById('vs-r-facturas').textContent = datos.length + ' facturas';
    document.getElementById('vs-r-cuadran').textContent = cuadran;
    document.getElementById('vs-r-pct-cuadra').textContent = ((cuadran / datos.length) * 100).toFixed(1) + '% del total';
    document.getElementById('vs-r-descuadran').textContent = descuadran;
    document.getElementById('vs-r-pct-descuadra').textContent = descuadran > 0 ? ((descuadran / datos.length) * 100).toFixed(1) + '% del total' : 'Sin diferencias';
    document.getElementById('vs-r-diferencia').textContent = '$' + difTotal.toFixed(2);
    document.getElementById('vs-r-fotos').textContent = conFoto;
    document.getElementById('vs-resumen').style.display = 'grid';
}

function vs_renderTabla(datos) {
    if (datos.length === 0) {
        document.getElementById('vs-tabla-contenido').innerHTML = `<div class="vs-estado-msg"><div class="icono">&#128205;</div><p>No se encontraron transacciones para esta busqueda.</p></div>`;
        document.getElementById('vs-tabla-count').textContent = '';
        return;
    }
    document.getElementById('vs-tabla-count').textContent = datos.length + ' registros';
    let html = `<table><thead><tr>
        <th>Fotos</th><th>Hora</th><th># Factura</th><th>Cajero</th>
        <th>Tarjeta</th><th>Red</th><th>Num. Transaccion</th>
        <th style="text-align:right">Monto Factura</th>
        <th style="text-align:right">Monto Vouchers</th>
        <th style="text-align:right">Propina</th>
        <th style="text-align:right">Diferencia Real</th>
        <th>Estado</th><th>Motivo</th><th>Local</th>
    </tr></thead><tbody>`;
    for (const r of datos) {
        const facTotal = Math.round((r.factura_total || 0) * 100);
        const vchTotal = Math.round((r.vouchers_total || 0) * 100);
        const diffReal = (facTotal - vchTotal) / 100;
        const cuadra = diffReal === 0;
        const propina = (r.propina || 0) > 0;
        let badge, motivo;
        if (cuadra) {
            badge = '<span class="vs-badge cuadra">&#10003; Cuadra</span>';
            motivo = '&mdash;';
        } else if (propina && Math.abs(diffReal) === Math.round(r.propina * 100) / 100) {
            badge = '<span class="vs-badge propina">Propina</span>';
            motivo = `Propina $${r.propina.toFixed(2)}`;
        } else {
            badge = '<span class="vs-badge descuadra">&#9888; Descuadra</span>';
            motivo = escapeHtml(r.motivo_diferencia || r.comentario_diferencia || '') || '&mdash;';
        }
        const diffStr = cuadra
            ? '<span class="vs-diff-pos">$0.00</span>'
            : `<span class="vs-diff-neg">${diffReal > 0 ? '+' : ''}$${diffReal.toFixed(2)}</span>`;
        const pagos = vsFotosMap[r.id] || [];
        const nFotos = pagos.filter(p => p.foto_url).length || (r.foto_storage_path ? 1 : 0);
        let fotoCell;
        if (nFotos > 0) {
            const label = nFotos === 1 ? '1 foto' : `${nFotos} fotos`;
            fotoCell = `<button class="vs-btn-ver-fotos" onclick="vs_verFotos(${r.id})">&#128247; ${label}</button>`;
        } else {
            fotoCell = '<span class="vs-btn-sin-foto">Sin foto</span>';
        }
        const tarjetas = pagos.length > 0 ? pagos.map(p => escapeHtml(p.tarjeta_tipo || '\u2014')).join('<br>') : '\u2014';
        const redes    = pagos.length > 0 ? pagos.map(p => escapeHtml(p.red || '\u2014')).join('<br>') : '\u2014';
        const numTxns  = pagos.length > 0 ? pagos.map(p => escapeHtml(p.numero_transaccion || '\u2014')).join('<br>') : '\u2014';
        const propinaTxt = (r.propina || 0) > 0 ? `<span style="color:#92400e;font-weight:600">$${Number(r.propina).toFixed(2)}</span>` : '\u2014';
        html += `<tr>
            <td>${fotoCell}</td>
            <td class="vs-hora">${r.hora_registro ? r.hora_registro.substring(0,5) : '\u2014'}</td>
            <td class="vs-factura">${escapeHtml(r.numero_factura || '\u2014')}</td>
            <td>${escapeHtml(r.cajero_nombre || r.registrado_por_nombre || '\u2014')}</td>
            <td style="font-size:12px">${tarjetas}</td>
            <td style="font-size:12px">${redes}</td>
            <td style="font-size:12px;font-family:monospace">${numTxns}</td>
            <td class="vs-monto">$${(r.factura_total || 0).toFixed(2)}</td>
            <td class="vs-monto">$${(r.vouchers_total || 0).toFixed(2)}</td>
            <td style="text-align:right">${propinaTxt}</td>
            <td style="text-align:right">${diffStr}</td>
            <td>${badge}</td>
            <td style="font-size:12px;color:#64748b">${motivo}</td>
            <td style="font-size:12px;color:#64748b">${escapeHtml(r.sucursal_nombre || '\u2014')}</td>
        </tr>`;
    }
    html += '</tbody></table>';
    document.getElementById('vs-tabla-contenido').innerHTML = html;
}

function vs_limpiarUrl(url) {
    return url ? url.replace(/\s+/g, '') : null;
}

function vs_verFotos(registroId) {
    const r = vsDatosActuales.find(x => x.id === registroId);
    if (!r) return;
    const pagos = vsFotosMap[registroId] || [];
    document.getElementById('vs-modal-titulo').textContent = r.numero_factura || 'Factura';
    document.getElementById('vs-modal-subtitulo').textContent =
        `${r.sucursal_nombre || ''} \u00B7 ${r.fecha_registro || ''} \u00B7 Cajero: ${r.cajero_nombre || r.registrado_por_nombre || '\u2014'} \u00B7 Total: $${(r.factura_total||0).toFixed(2)}`;
    let fotosHtml = '';
    if (pagos.length > 0 && pagos.some(p => p.foto_url)) {
        pagos.filter(p => p.foto_url).forEach((p, idx) => {
            const url = vs_limpiarUrl(p.foto_url);
            const label = `Voucher ${idx+1}: ${escapeHtml(p.tarjeta_tipo || '\u2014')} \u00B7 $${(p.total||0).toFixed(2)}${p.red ? ' \u00B7 ' + escapeHtml(p.red) : ''}`;
            fotosHtml += `<div class="vs-modal-foto-item">
                <img class="vs-modal-img" src="${url}" alt="Voucher ${idx+1}" onerror="this.parentElement.style.display='none'">
                <div class="vs-modal-foto-label">${label}</div>
            </div>`;
        });
    } else if (r.foto_storage_path) {
        fotosHtml = `<div class="vs-modal-foto-item">
            <img class="vs-modal-img" src="${VS_STORAGE + r.foto_storage_path}" alt="Voucher" onerror="this.parentElement.style.display='none'">
            <div class="vs-modal-foto-label">Voucher escaneado</div>
        </div>`;
    } else {
        fotosHtml = '<p style="color:#94a3b8">No hay fotos disponibles</p>';
    }
    document.getElementById('vs-modal-fotos').innerHTML = fotosHtml;
    document.getElementById('vs-modal-foto').classList.add('visible');
}

function vs_cerrarModal(e) {
    if (e.target === document.getElementById('vs-modal-foto')) {
        document.getElementById('vs-modal-foto').classList.remove('visible');
    }
}

function vs_filtrarEstado(estado, btn) {
    document.querySelectorAll('.vs-btn-estado').forEach(b => b.classList.remove('activo'));
    btn.classList.add('activo');
    let datos = vsDatosActuales;
    if (estado === 'cuadra') datos = vsDatosActuales.filter(r => Math.round((r.factura_total||0)*100) === Math.round((r.vouchers_total||0)*100));
    if (estado === 'descuadra') datos = vsDatosActuales.filter(r => Math.round((r.factura_total||0)*100) !== Math.round((r.vouchers_total||0)*100));
    vs_renderTabla(datos);
    document.getElementById('vs-tabla-count').textContent = datos.length + ' registros';
}

function vs_exportarCSV() {
    const fecha = document.getElementById('vs-filtro-fecha').value;
    const localEl = document.getElementById('vs-filtro-local');
    const localNombre = localEl.options[localEl.selectedIndex].text.replace(/— ?| ?—/g, '').trim();
    let csv = 'Hora,Factura,Cajero,Tarjeta,Red,Monto Factura,Monto Vouchers,Diferencia Real,Estado,Motivo,Local\n';
    for (const r of vsDatosActuales) {
        const facTotal = Math.round((r.factura_total||0)*100);
        const vchTotal = Math.round((r.vouchers_total||0)*100);
        const diffReal = (facTotal - vchTotal) / 100;
        const pagos = vsFotosMap[r.id] || [];
        const estado = diffReal === 0 ? 'Cuadra' : ((r.propina || 0) > 0 ? 'Propina' : 'Descuadra');
        const motivo = (r.propina || 0) > 0 ? `Propina $${r.propina.toFixed(2)}` : (r.motivo_diferencia || '');
        csv += [
            r.hora_registro ? r.hora_registro.substring(0,5) : '',
            r.numero_factura || '',
            r.cajero_nombre || r.registrado_por_nombre || '',
            pagos.map(p => p.tarjeta_tipo || '').join(';'),
            pagos.map(p => p.red || '').join(';'),
            (r.factura_total || 0).toFixed(2),
            (r.vouchers_total || 0).toFixed(2),
            diffReal.toFixed(2),
            estado, motivo,
            r.sucursal_nombre || ''
        ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(',') + '\n';
    }
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vouchers_${fecha}_${localNombre.replace(/ /g,'_')}.csv`;
    a.click();
}
