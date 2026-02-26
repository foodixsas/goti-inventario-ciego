// ==================== DASHBOARD & CHARTS ====================

// Rastrear instancias de graficos para destruirlos antes de recrear
let chartInstances = {};

// Paleta de 6 colores corporativos (1 por bodega)
const CHART_COLORS = [
    '#1E3A5F',  // Azul corporativo
    '#B91C1C',  // Rojo corporativo
    '#059669',  // Verde
    '#D97706',  // Naranja
    '#7C3AED',  // Purpura
    '#0891B2'   // Cyan
];

const CHART_COLORS_ALPHA = [
    'rgba(30, 58, 95, 0.7)',
    'rgba(185, 28, 28, 0.7)',
    'rgba(5, 150, 105, 0.7)',
    'rgba(217, 119, 6, 0.7)',
    'rgba(124, 58, 237, 0.7)',
    'rgba(8, 145, 178, 0.7)'
];

function configureChartDefaults() {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.font.family = "'Poppins', sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.plugins.tooltip.backgroundColor = '#0F172A';
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

async function cargarDashboard() {
    const fechaDesde = document.getElementById('dash-fecha-desde').value;
    const fechaHasta = document.getElementById('dash-fecha-hasta').value;

    if (!fechaDesde || !fechaHasta) {
        showToast('Selecciona las fechas desde y hasta', 'error');
        return;
    }

    try {
        const [resDash, resTend] = await Promise.all([
            fetch(`${CONFIG.API_URL}/api/reportes/dashboard?fecha_desde=${fechaDesde}&fecha_hasta=${fechaHasta}`),
            fetch(`${CONFIG.API_URL}/api/reportes/tendencias-temporal?dias=30`)
        ]);

        if (resDash.ok && resTend.ok) {
            const datosDash = await resDash.json();
            const datosTend = await resTend.json();

            renderDashboardStats(datosDash);
            renderChartDiferenciasBodega(datosDash);
            renderChartDistribucion(datosDash);
            renderChartFaltantesSobrantes(datosDash);
            renderChartTendenciaTemporal(datosTend);
        } else {
            showToast('Error al cargar datos del dashboard', 'error');
        }
    } catch (error) {
        console.error('Error cargando dashboard:', error);
        showToast('Error de conexion al cargar dashboard', 'error');
    }
}

function renderDashboardStats(datos) {
    const container = document.getElementById('dashboard-stats');
    if (!datos || datos.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-chart-bar"></i><p>No hay datos para el rango seleccionado</p></div>';
        return;
    }

    const totales = datos.reduce((acc, d) => {
        acc.productos += d.total_productos;
        acc.contados += d.total_contados;
        acc.diferencias += d.total_con_diferencia;
        acc.sumDesv += d.promedio_diferencia_abs;
        return acc;
    }, { productos: 0, contados: 0, diferencias: 0, sumDesv: 0 });

    const promDesv = datos.length > 0 ? (totales.sumDesv / datos.length).toFixed(2) : '0';

    container.innerHTML = `
        <div class="dashboard-stat-card">
            <div class="stat-icon icon-productos"><i class="fas fa-boxes-stacked"></i></div>
            <div class="stat-info">
                <div class="stat-valor">${totales.productos.toLocaleString()}</div>
                <div class="stat-label">Total Productos</div>
            </div>
        </div>
        <div class="dashboard-stat-card">
            <div class="stat-icon icon-contados"><i class="fas fa-clipboard-check"></i></div>
            <div class="stat-info">
                <div class="stat-valor">${totales.contados.toLocaleString()}</div>
                <div class="stat-label">Contados</div>
            </div>
        </div>
        <div class="dashboard-stat-card">
            <div class="stat-icon icon-diferencias"><i class="fas fa-exclamation-triangle"></i></div>
            <div class="stat-info">
                <div class="stat-valor">${totales.diferencias.toLocaleString()}</div>
                <div class="stat-label">Con Diferencia</div>
            </div>
        </div>
        <div class="dashboard-stat-card">
            <div class="stat-icon icon-desviacion"><i class="fas fa-chart-line"></i></div>
            <div class="stat-info">
                <div class="stat-valor">${promDesv}</div>
                <div class="stat-label">Prom. Desviacion</div>
            </div>
        </div>
    `;
}

function renderChartDiferenciasBodega(datos) {
    if (typeof Chart === 'undefined') return;
    destroyChart('diferencias-bodega');
    const ctx = document.getElementById('chart-diferencias-bodega');
    if (!ctx || !datos || datos.length === 0) return;

    chartInstances['diferencias-bodega'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: datos.map(d => d.local_nombre),
            datasets: [{
                label: 'Productos con diferencia',
                data: datos.map(d => d.total_con_diferencia),
                backgroundColor: CHART_COLORS_ALPHA.slice(0, datos.length),
                borderColor: CHART_COLORS.slice(0, datos.length),
                borderWidth: 2
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { beginAtZero: true, grid: { color: '#F1F5F9' } },
                y: { grid: { display: false } }
            }
        }
    });
}

function renderChartDistribucion(datos) {
    if (typeof Chart === 'undefined') return;
    destroyChart('distribucion');
    const ctx = document.getElementById('chart-distribucion');
    if (!ctx || !datos || datos.length === 0) return;

    chartInstances['distribucion'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: datos.map(d => d.local_nombre),
            datasets: [{
                data: datos.map(d => d.total_con_diferencia),
                backgroundColor: CHART_COLORS.slice(0, datos.length),
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { font: { size: 11 } }
                }
            },
            cutout: '55%'
        }
    });
}

function renderChartFaltantesSobrantes(datos) {
    if (typeof Chart === 'undefined') return;
    destroyChart('faltantes-sobrantes');
    const ctx = document.getElementById('chart-faltantes-sobrantes');
    if (!ctx || !datos || datos.length === 0) return;

    chartInstances['faltantes-sobrantes'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: datos.map(d => d.local_nombre),
            datasets: [
                {
                    label: 'Faltantes',
                    data: datos.map(d => d.total_faltantes),
                    backgroundColor: 'rgba(185, 28, 28, 0.7)',
                    borderColor: '#B91C1C',
                    borderWidth: 2
                },
                {
                    label: 'Sobrantes',
                    data: datos.map(d => d.total_sobrantes),
                    backgroundColor: 'rgba(5, 150, 105, 0.7)',
                    borderColor: '#059669',
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' }
            },
            scales: {
                x: { grid: { display: false } },
                y: { beginAtZero: true, grid: { color: '#F1F5F9' } }
            }
        }
    });
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

    chartInstances['tendencia-temporal'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: fechasCortas,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' }
            },
            scales: {
                x: { grid: { color: '#F1F5F9' } },
                y: { beginAtZero: true, grid: { color: '#F1F5F9' }, title: { display: true, text: 'Productos con diferencia' } }
            }
        }
    });
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

    // Verificar sesion guardada
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
        state.user = JSON.parse(savedUser);
        showMainScreen();
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
    document.getElementById('btn-cargar-productos').addEventListener('click', cargarProductos);
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
            showMainScreen();
            showToast(`Bienvenido, ${data.user.nombre}`, 'success');
            return;
        }
    } catch (error) {
        console.log('Servidor no disponible, usando autenticacion local');
    }

    // Fallback: autenticacion local
    const localUser = CONFIG.USUARIOS_LOCAL[username];
    if (localUser && localUser.password === password) {
        state.user = { username, nombre: localUser.nombre, rol: localUser.rol, bodega: localUser.bodega || null };
        localStorage.setItem('user', JSON.stringify(state.user));
        showMainScreen();
        showToast(`Bienvenido, ${localUser.nombre}`, 'success');
    } else {
        errorDiv.textContent = 'Usuario o contraseña incorrectos';
        errorDiv.classList.remove('hidden');
    }
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

    // Mostrar/ocultar nav Cruce Op. segun admin
    const isAdmin = state.user && state.user.username === 'admin';
    document.querySelectorAll('.nav-admin-only').forEach(el => {
        el.style.display = isAdmin ? '' : 'none';
    });

    // Recargar bodegas filtradas segun usuario
    cargarBodegas();
}

// ==================== NAVEGACION ====================

function cambiarVista(viewName) {
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
    }

    // Auto-renderizar observaciones al entrar
    if (viewName === 'observaciones') {
        renderObservaciones();
    }

    // Auto-cargar bajas al entrar
    if (viewName === 'bajas') {
        cargarBajas();
        poblarPersonasBaja();
    }

    // Auto-cargar dashboard al entrar
    if (viewName === 'dashboard') {
        const dashDesde = document.getElementById('dash-fecha-desde');
        const dashHasta = document.getElementById('dash-fecha-hasta');
        if (!dashDesde.value || !dashHasta.value) {
            const hoy = new Date();
            const hace30 = new Date();
            hace30.setDate(hoy.getDate() - 30);
            dashDesde.value = hace30.toISOString().split('T')[0];
            dashHasta.value = hoy.toISOString().split('T')[0];
        }
        cargarDashboard();
    }
}

// ==================== BODEGAS ====================

function cargarBodegas() {
    const selectBodega = document.getElementById('bodega-select');
    const filtroBodega = document.getElementById('filtro-bodega');
    const reporteBodega = document.getElementById('reporte-bodega');

    // Bodega asignada al usuario (null = ve todas)
    const bodegaUsuario = state.user ? state.user.bodega : null;

    const bodegas = bodegaUsuario
        ? CONFIG.BODEGAS.filter(b => b.id === bodegaUsuario)
        : CONFIG.BODEGAS;

    // Limpiar selects
    selectBodega.innerHTML = bodegaUsuario ? '' : '<option value="">Seleccionar bodega...</option>';
    filtroBodega.innerHTML = bodegaUsuario ? '' : '<option value="">Todas las bodegas</option>';
    if (reporteBodega) reporteBodega.innerHTML = bodegaUsuario ? '' : '<option value="">Seleccionar bodega...</option>';

    bodegas.forEach(bodega => {
        const opt = `<option value="${bodega.id}">${bodega.nombre}</option>`;
        selectBodega.innerHTML += opt;
        filtroBodega.innerHTML += opt;
        if (reporteBodega) reporteBodega.innerHTML += opt;
    });

    // Si tiene bodega asignada, seleccionarla automaticamente
    if (bodegaUsuario) {
        selectBodega.value = bodegaUsuario;
        filtroBodega.value = bodegaUsuario;
        if (reporteBodega) reporteBodega.value = bodegaUsuario;
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
                showToast('No hay datos para esta fecha y bodega', 'warning');
                renderProductosVacio();
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
                costo_unitario: parseFloat(p.costo_unitario) || 0
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
                    await Promise.all([cargarAsignaciones(fecha, local), cargarPersonas()]);
                    renderProductosInventario();
                    showToast('Conteo ya completado - todos los productos coinciden.', 'success');
                    return;
                }

                // Verificar si TODOS los productos ya tienen conteo 2 (finalizado)
                const todosConConteo2 = state.productos.every(p => p.cantidad_contada_2 !== null);
                if (todosConConteo2) {
                    state.etapaConteo = 3;
                    await Promise.all([cargarAsignaciones(fecha, local), cargarPersonas()]);
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
                    await Promise.all([cargarAsignaciones(fecha, local), cargarPersonas()]);
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

    // Construir tabla principal
    let tablaHtml = `
        <div class="etapa-indicator etapa-${state.etapaConteo}">
            <i class="fas fa-${state.etapaConteo === 1 ? 'edit' : state.etapaConteo === 2 ? 'exclamation-triangle' : 'check-circle'}"></i>
            ${etapaTexto}
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

    // Actualizar observaciones en la pestaña separada
    renderObservaciones();

    // Renderizar modulo de asignacion de diferencias (solo etapa 3)
    const asigContainer = document.getElementById('asignaciones-container');
    if (asigContainer) {
        if (state.etapaConteo === 3) {
            const productosConDif = productosAMostrar.filter(prod => {
                const conteo2 = prod.cantidad_contada_2 !== null && prod.cantidad_contada_2 !== undefined;
                const cantidadFinal = conteo2 ? prod.cantidad_contada_2 : prod.cantidad_contada;
                return cantidadFinal - prod.cantidad_sistema !== 0;
            });
            if (productosConDif.length > 0) {
                renderAsignacionesDiferencias(asigContainer, productosConDif);
            } else {
                asigContainer.innerHTML = '';
            }
        } else {
            asigContainer.innerHTML = '';
        }
    }

    totalSpan.textContent = productosAMostrar.length;
    actualizarContador();
}

async function guardarConteoDirecto(input) {
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
            body: JSON.stringify({ id, cantidad_contada: cantidad, conteo: conteoNum })
        });

        if (response.ok) {
            // Actualizar estado local
            const prod = state.productos.find(p => p.id === id);
            if (prod) {
                if (conteoNum === 2) {
                    prod.cantidad_contada_2 = cantidad;
                } else {
                    prod.cantidad_contada = cantidad;
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

async function guardarTodasObservaciones() {
    const inputs = document.querySelectorAll('.input-observacion');
    if (inputs.length === 0) return;

    const btn = document.querySelector('.btn-guardar-obs');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
    }

    let errores = 0;
    for (const input of inputs) {
        const id = parseInt(input.dataset.id);
        const observaciones = input.value.trim();

        try {
            const response = await fetch(`${CONFIG.API_URL}/api/inventario/guardar-observacion`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, observaciones })
            });

            if (response.ok) {
                const prod = state.productos.find(p => p.id === id);
                if (prod) prod.observaciones = observaciones;
                input.classList.add('guardado');
                setTimeout(() => input.classList.remove('guardado'), 1500);
            } else {
                errores++;
                input.classList.add('error');
                setTimeout(() => input.classList.remove('error'), 1500);
            }
        } catch (error) {
            errores++;
        }
    }

    if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Guardar Observaciones';
    }

    if (errores === 0) {
        showToast('Observaciones guardadas correctamente', 'success');
    } else {
        showToast(`${errores} observaciones no se pudieron guardar`, 'error');
    }
}

async function guardarObservacion(input) {
    const id = parseInt(input.dataset.id);
    const observaciones = input.value.trim();

    try {
        const response = await fetch(`${CONFIG.API_URL}/api/inventario/guardar-observacion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, observaciones })
        });

        if (response.ok) {
            const prod = state.productos.find(p => p.id === id);
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

function renderObservaciones() {
    const obsContainer = document.getElementById('observaciones-container');
    if (!obsContainer) return;

    if (state.etapaConteo !== 3 || !state.productos || state.productos.length === 0) {
        obsContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-comment-alt"></i>
                <p>Completa un conteo para ver las observaciones de productos con diferencia</p>
            </div>`;
        return;
    }

    const productosConDif = state.productos.filter(prod => {
        const conteo2 = prod.cantidad_contada_2 !== null && prod.cantidad_contada_2 !== undefined;
        const cantidadFinal = conteo2 ? prod.cantidad_contada_2 : prod.cantidad_contada;
        return cantidadFinal - prod.cantidad_sistema !== 0;
    });

    if (productosConDif.length === 0) {
        obsContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-check-circle"></i>
                <p>No hay productos con diferencia</p>
            </div>`;
        return;
    }

    obsContainer.innerHTML = `
        <div class="tabla-obs-container">
            <div class="obs-header">
                <i class="fas fa-clipboard-list"></i>
                Observaciones (${productosConDif.length} con diferencia)
            </div>
            <table class="tabla-observaciones">
                <thead>
                    <tr>
                        <th class="obs-col-producto">Producto</th>
                        <th class="obs-col-dif">Dif</th>
                        <th class="obs-col-obs">Observación</th>
                    </tr>
                </thead>
                <tbody>
                    ${productosConDif.map(prod => {
                        const conteo2 = prod.cantidad_contada_2 !== null && prod.cantidad_contada_2 !== undefined;
                        const cantidadFinal = conteo2 ? prod.cantidad_contada_2 : prod.cantidad_contada;
                        const diferencia = cantidadFinal - prod.cantidad_sistema;
                        const difClass = diferencia < 0 ? 'negativa' : 'positiva';
                        return `
                            <tr>
                                <td class="obs-nombre">${prod.nombre}</td>
                                <td class="obs-dif ${difClass}">${diferencia > 0 ? '+' : ''}${diferencia.toFixed(3)}</td>
                                <td class="obs-input-cell">
                                    <input type="text"
                                           class="input-observacion"
                                           value="${(prod.observaciones || '').replace(/"/g, '&quot;')}"
                                           placeholder="Escribir motivo..."
                                           data-id="${prod.id}"
                                           onchange="guardarObservacion(this)"
                                           onkeypress="if(event.key==='Enter') this.blur()">
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
            <div class="obs-footer">
                <button class="btn-guardar-obs" onclick="guardarTodasObservaciones()">
                    <i class="fas fa-save"></i> Guardar Observaciones
                </button>
            </div>
        </div>
    `;
}

// ==================== MODULO: ASIGNACION DE DIFERENCIAS ====================

async function cargarPersonas() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(`${CONFIG.API_URL}/api/personas`, { signal: controller.signal });
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

    container.innerHTML = `
        <div class="asig-container">
            <div class="asig-header">
                <i class="fas fa-users"></i>
                Asignacion de Diferencias (${totalProductos} productos)
                <span class="asig-header-status">${completosCount}/${totalProductos} completos</span>
            </div>
            ${valorTotalGeneral > 0 ? `<div class="asig-valor-general"><i class="fas fa-dollar-sign"></i> Valor total diferencias: <strong>$${valorTotalGeneral.toFixed(2)}</strong></div>` : ''}
            ${productosHtml}
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
                        body: JSON.stringify({ id, cantidad_contada: cantidad, conteo: conteoNum })
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
                body: JSON.stringify({ id, cantidad_contada: cantidad })
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

async function buscarHistorico() {
    const fechaDesde = document.getElementById('fecha-desde').value;
    const fechaHasta = document.getElementById('fecha-hasta').value;
    const bodega = document.getElementById('filtro-bodega').value;

    const container = document.getElementById('historico-list');

    if (!fechaDesde || !fechaHasta) {
        showToast('Selecciona las fechas desde y hasta', 'error');
        return;
    }

    try {
        let url = `${CONFIG.API_URL}/api/historico?fecha_desde=${fechaDesde}&fecha_hasta=${fechaHasta}`;
        if (bodega) url += `&bodega=${bodega}`;

        const response = await fetch(url);
        if (response.ok) {
            const datos = await response.json();

            if (datos.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-search"></i>
                        <p>No se encontraron registros para el rango seleccionado</p>
                    </div>
                `;
                return;
            }

            // Buscar nombre de bodega
            const getNombreBodega = (id) => {
                const b = CONFIG.BODEGAS.find(b => b.id === id);
                return b ? b.nombre : id;
            };

            container.innerHTML = datos.map(item => {
                const badgeClass = item.estado === 'completo' ? 'badge-completo' :
                                   item.estado === 'en_proceso' ? 'badge-proceso' : 'badge-pendiente';
                const badgeText = item.estado === 'completo' ? 'Completo' :
                                  item.estado === 'en_proceso' ? 'En Proceso' : 'Pendiente';
                const badgeIcon = item.estado === 'completo' ? 'check-circle' :
                                  item.estado === 'en_proceso' ? 'clock' : 'hourglass-start';

                return `
                    <div class="historico-card">
                        <div class="historico-card-header">
                            <div class="historico-card-info">
                                <div class="historico-bodega-nombre">${getNombreBodega(item.local)}</div>
                                <div class="historico-card-fecha">${formatearFecha(item.fecha)}</div>
                            </div>
                            <span class="badge ${badgeClass}">
                                <i class="fas fa-${badgeIcon}"></i> ${badgeText}
                            </span>
                        </div>
                        <div class="historico-card-stats">
                            <div class="historico-stat">
                                <span class="stat-valor">${item.total_productos}</span>
                                <span class="stat-label">Productos</span>
                            </div>
                            <div class="historico-stat">
                                <span class="stat-valor">${item.total_contados}</span>
                                <span class="stat-label">Contados</span>
                            </div>
                            <div class="historico-stat stat-diferencias">
                                <span class="stat-valor">${item.total_con_diferencia}</span>
                                <span class="stat-label">Con Dif.</span>
                            </div>
                        </div>
                        <div class="historico-progress">
                            <div class="progress-bar">
                                <div class="progress-fill ${badgeClass}" style="width: ${item.porcentaje}%"></div>
                            </div>
                            <span class="progress-text">${item.porcentaje}%</span>
                        </div>
                    </div>
                `;
            }).join('');
        }
    } catch (error) {
        console.error('Error buscando historico:', error);
        showToast('Error al buscar historico', 'error');
    }
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
                                    <th>Observacion</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${datos.map(p => {
                                    const difClass = p.diferencia < 0 ? 'negativa' : 'positiva';
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
                                            <td class="col-obs">${p.observaciones || '-'}</td>
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
    const bodega = document.getElementById('cruce-bodega').value;

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
            <div class="cruce-ejec-card" onclick="verCruceDetalle(${e.id})">
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
let _bajaAutocompletResultados = [];

function poblarPersonasBaja() {
    const sel = document.getElementById('baja-persona');
    if (!sel) return;
    // Guardar valor actual
    const valorActual = sel.value;
    // Obtener personas del state o localStorage
    let personas = state.personas || [];
    if (!personas.length) {
        try {
            const cache = localStorage.getItem('personas_cache');
            if (cache) personas = JSON.parse(cache);
        } catch(e) {}
    }
    // Repoblar
    sel.innerHTML = '<option value="">Seleccionar persona...</option>';
    personas.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        sel.appendChild(opt);
    });
    if (valorActual) sel.value = valorActual;
}

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
            renderTablaBajas(data);
        })
        .catch(() => showToast('Error al cargar bajas', 'error'));
}

function renderTablaBajas(bajas) {
    const container = document.getElementById('baja-tabla-container');
    if (!bajas.length) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle"></i><p>No hay bajas registradas en el periodo seleccionado</p></div>';
        return;
    }

    const totalCosto = bajas.reduce((sum, b) => sum + b.costo_total, 0);
    const BODEGAS = {
        'real_audiencia': 'Real Audiencia', 'floreana': 'Floreana',
        'portugal': 'Portugal', 'santo_cachon_real': 'S.Cachon Real',
        'santo_cachon_portugal': 'S.Cachon Portugal', 'simon_bolon': 'Simon Bolon'
    };

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
                    <th>Persona</th>
                    <th>Motivo</th>
                    <th>Costo Total</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
    `;

    for (const b of bajas) {
        html += `
            <tr>
                <td>${b.fecha}</td>
                <td>${BODEGAS[b.local] || b.local}</td>
                <td><code>${b.codigo}</code></td>
                <td>${b.nombre}</td>
                <td>${b.cantidad}</td>
                <td>${b.unidad}</td>
                <td><strong>${b.persona}</strong></td>
                <td>${b.motivo || '-'}</td>
                <td class="merma-costo-cell">$${b.costo_total.toFixed(2)}</td>
                <td><button class="btn-eliminar-merma" onclick="eliminarBaja(${b.id})" title="Eliminar"><i class="fas fa-trash"></i></button></td>
            </tr>
        `;
    }

    html += `
            </tbody>
            <tfoot>
                <tr class="merma-total-row">
                    <td colspan="8"><strong>TOTAL BAJAS</strong></td>
                    <td><strong>$${totalCosto.toFixed(2)}</strong></td>
                    <td></td>
                </tr>
            </tfoot>
        </table>
        </div>
    `;

    container.innerHTML = html;
}

function registrarBaja() {
    const fecha = document.getElementById('baja-fecha').value;
    const local = document.getElementById('baja-bodega').value;
    const codigo = document.getElementById('baja-codigo').value.trim();
    const nombre = document.getElementById('baja-nombre').value.trim();
    const unidad = document.getElementById('baja-unidad').value.trim();
    const cantidad = parseFloat(document.getElementById('baja-cantidad').value) || 0;
    const persona = document.getElementById('baja-persona').value;
    const motivo = document.getElementById('baja-motivo').value.trim();
    const costo_unitario = parseFloat(document.getElementById('baja-costo-unitario').value) || 0;

    if (!fecha || !local || !codigo || !nombre || cantidad <= 0) {
        showToast('Completa: fecha, bodega, producto y cantidad mayor a 0', 'error');
        return;
    }
    if (!persona) {
        showToast('Selecciona una persona responsable', 'error');
        return;
    }

    fetch(`${CONFIG.API_URL}/api/bajas/registrar`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({fecha, local, codigo, nombre, unidad, cantidad, persona, motivo, costo_unitario})
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) { showToast(data.error, 'error'); return; }
        showToast('Baja registrada correctamente', 'success');
        limpiarFormularioBaja();
        cargarBajas();
    })
    .catch(() => showToast('Error al registrar baja', 'error'));
}

function eliminarBaja(id) {
    if (!confirm('¿Eliminar esta baja? Esta acción no se puede deshacer.')) return;
    fetch(`${CONFIG.API_URL}/api/bajas/${id}`, {method: 'DELETE'})
        .then(r => r.json())
        .then(data => {
            if (data.error) { showToast(data.error, 'error'); return; }
            showToast('Baja eliminada', 'success');
            cargarBajas();
        })
        .catch(() => showToast('Error al eliminar', 'error'));
}

function limpiarFormularioBaja() {
    document.getElementById('baja-codigo').value = '';
    document.getElementById('baja-nombre').value = '';
    document.getElementById('baja-unidad').value = '';
    document.getElementById('baja-cantidad').value = '';
    document.getElementById('baja-motivo').value = '';
    document.getElementById('baja-costo-unitario').value = '';
    document.getElementById('baja-costo-total').value = '$0.00';
    document.getElementById('baja-autocomplete').classList.add('hidden');
    _bajaAutocompletResultados = [];
}

function calcularCostoBaja() {
    const cantidad = parseFloat(document.getElementById('baja-cantidad').value) || 0;
    const costoUnit = parseFloat(document.getElementById('baja-costo-unitario').value) || 0;
    const total = cantidad * costoUnit;
    document.getElementById('baja-costo-total').value = `$${total.toFixed(2)}`;
}

async function cargarProductosBaja() {
    const fecha = document.getElementById('baja-fecha').value;
    const local = document.getElementById('baja-bodega').value;
    if (!fecha || !local) return;
    _bajaProductos = [];
    try {
        const resp = await fetch(`${CONFIG.API_URL}/api/inventario/consultar?fecha=${fecha}&local=${local}`);
        const data = await resp.json();
        if (data.productos) {
            _bajaProductos = data.productos;
        }
    } catch(e) {
        // No crítico - el autocomplete funcionará vacío
    }
}

function buscarProductoBaja(term) {
    const lista = document.getElementById('baja-autocomplete');
    if (!lista) return;
    if (!term || term.length < 2) {
        lista.classList.add('hidden');
        return;
    }
    const termLower = term.toLowerCase();
    _bajaAutocompletResultados = _bajaProductos
        .filter(p => p.codigo.toLowerCase().includes(termLower) || p.nombre.toLowerCase().includes(termLower))
        .slice(0, 8);

    if (!_bajaAutocompletResultados.length) {
        lista.classList.add('hidden');
        return;
    }

    lista.innerHTML = _bajaAutocompletResultados.map((p, i) => `
        <div class="merma-autocomplete-item" onclick="seleccionarProductoBaja(${i})">
            <strong>${p.codigo}</strong> &mdash; ${p.nombre}
            <span class="merma-ac-unidad">${p.unidad || ''}</span>
        </div>
    `).join('');
    lista.classList.remove('hidden');
}

function seleccionarProductoBaja(idx) {
    const p = _bajaAutocompletResultados[idx];
    if (!p) return;
    document.getElementById('baja-codigo').value = p.codigo;
    document.getElementById('baja-nombre').value = p.nombre;
    document.getElementById('baja-unidad').value = p.unidad || '';
    document.getElementById('baja-costo-unitario').value = p.costo_unitario || 0;
    document.getElementById('baja-autocomplete').classList.add('hidden');
    calcularCostoBaja();
    document.getElementById('baja-cantidad').focus();
}
