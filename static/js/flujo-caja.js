/**
 * MODULO FLUJO DE CAJA - FOODIX
 * Proyeccion de ingresos y egresos con saldos
 * Prefijo: fc_
 */

// Estado del modulo
let fc_datos = null;
let fc_semanas = [];
let fc_semanasNums = [];
let fc_todasFechas = []; // Todas las fechas en orden

// Inicializar cuando se carga la vista
function fc_init() {
    // Establecer fecha de corte por defecto (lunes de esta semana)
    const fechaInput = document.getElementById('fc-fecha-corte');
    if (fechaInput && !fechaInput.value) {
        const hoy = new Date();
        const dia = hoy.getDay();
        const diff = dia === 0 ? -6 : 1 - dia; // Ajustar al lunes
        const lunes = new Date(hoy);
        lunes.setDate(hoy.getDate() + diff);
        fechaInput.value = lunes.toISOString().split('T')[0];
    }

    // Intentar cargar desde cache primero
    fc_cargarDesdeCache();
}

// Cargar datos desde cache (sin consultar BD)
function fc_cargarDesdeCache() {
    const container = document.getElementById('fc-tabla-container');
    const cached = sessionStorage.getItem('fc_datos_cache');

    if (cached) {
        try {
            const data = JSON.parse(cached);
            // Verificar que el cache sea del mismo dia
            const hoy = new Date().toISOString().split('T')[0];
            if (data.fecha_cache === hoy && data.datos) {
                fc_datos = data.datos;
                fc_semanas = fc_datos.semanas;
                fc_semanasNums = fc_semanas.map(s => s.num);
                window._fc_semanas = fc_semanas;

                fc_todasFechas = [];
                fc_semanas.forEach(sem => {
                    sem.dias.forEach(dia => fc_todasFechas.push(dia));
                });

                fc_renderTabla();
                fc_actualizarInfo();
                fc_cargarDatosGuardados().then(() => fc_recalcularTodo());

                console.log('Datos cargados desde cache');
                return;
            }
        } catch (e) {
            console.log('Cache invalido, mostrando mensaje');
        }
    }

    // No hay cache - mostrar mensaje para consultar
    container.innerHTML = `<div class="fc-loading">
        <p style="color:#1565c0; font-size:16px;"><i class="fas fa-info-circle"></i> Haga clic en <strong>Consultar</strong> para cargar los datos</p>
        <p style="font-size:12px;color:#666;margin-top:8px;">Los datos se mantendran en cache durante el dia.</p>
    </div>`;
}

// Cargar datos desde API con reintentos
async function fc_cargarDatos(reintentos = 0) {
    const container = document.getElementById('fc-tabla-container');
    container.innerHTML = '<div class="fc-loading"><div class="spinner"></div><p>Calculando proyecciones...</p></div>';

    try {
        // Obtener parametros de filtro
        const fechaCorte = document.getElementById('fc-fecha-corte')?.value || '';
        const numSemanas = document.getElementById('fc-num-semanas')?.value || '5';

        const url = `/api/flujo-caja/datos?fecha=${fechaCorte}&semanas=${numSemanas}`;
        const response = await fetch(url);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al cargar datos');
        }

        fc_datos = await response.json();

        if (!fc_datos.ok) {
            throw new Error(fc_datos.error || 'Error en respuesta del servidor');
        }

        fc_semanas = fc_datos.semanas;
        fc_semanasNums = fc_semanas.map(s => s.num);
        console.log('fc_semanas asignado:', fc_semanas.length, 'semanas');
        window._fc_semanas = fc_semanas; // Guardar referencia global para debug

        // Construir lista ordenada de todas las fechas
        fc_todasFechas = [];
        fc_semanas.forEach(sem => {
            sem.dias.forEach(dia => fc_todasFechas.push(dia));
        });

        fc_renderTabla();
        fc_actualizarInfo();

        // Cargar datos guardados y aplicarlos
        await fc_cargarDatosGuardados();

        fc_recalcularTodo();

        // Guardar en cache para no volver a consultar
        const cacheData = {
            fecha_cache: new Date().toISOString().split('T')[0],
            datos: fc_datos
        };
        sessionStorage.setItem('fc_datos_cache', JSON.stringify(cacheData));
        console.log('Datos guardados en cache');

    } catch (error) {
        console.error('Error flujo caja:', error);
        // Reintentar hasta 2 veces automaticamente
        if (reintentos < 2) {
            console.log(`Reintentando (${reintentos + 1}/2)...`);
            container.innerHTML = '<div class="fc-loading"><div class="spinner"></div><p>Reintentando conexion...</p></div>';
            await new Promise(r => setTimeout(r, 1500));
            return fc_cargarDatos(reintentos + 1);
        }
        container.innerHTML = `<div class="fc-loading"><p style="color:#ef4444;">Error: ${error.message}</p><p style="font-size:12px;color:#666;margin-top:8px;">Verifique la conexion e intente nuevamente.</p></div>`;
    }
}

// Actualizar info
function fc_actualizarInfo() {
    const info = document.getElementById('fc-info');
    const fecha = new Date().toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    info.textContent = `Generado: ${fecha} | Datos desde Azure PostgreSQL | TC al 86% neto (14% comision) | Ajustes: valores reales vs proyectados`;
}

// Formato de monto
function fc_formatMonto(v) {
    if (v === 0 || v === null || v === undefined) return '-';
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Formato con signo para flujos
function fc_formatFlujo(v) {
    if (v === 0 || v === null || v === undefined) return '-';
    const formatted = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (v < 0) return `(${formatted})`;
    return formatted;
}

// Renderizar tabla completa
function fc_renderTabla() {
    const container = document.getElementById('fc-tabla-container');
    const meses = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const dias = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];

    let html = '<table class="fc-tabla" id="fc-tabla">';

    // Header semanas
    html += '<tr><th class="col-concepto" rowspan="3">FLUJO DE CAJA</th>';
    fc_semanas.forEach(sem => {
        html += `<th class="col-semana header-semana sem-${sem.num}-header" onclick="fc_toggleSemana(${sem.num})" colspan="1" style="cursor:pointer;">▶ Sem ${sem.num}</th>`;
        html += `<th class="dia-col sem-${sem.num} header-semana" onclick="fc_toggleSemana(${sem.num})" colspan="8" style="display:none; cursor:pointer;">▼ Semana ${sem.num}</th>`;
    });
    html += '</tr>';

    // Header fechas (T12:00 evita problemas de zona horaria)
    html += '<tr class="header-dias">';
    fc_semanas.forEach(sem => {
        const inicio = new Date(sem.inicio + 'T12:00:00');
        const fin = new Date(sem.fin + 'T12:00:00');
        html += `<td class="col-semana sem-${sem.num}-header">${inicio.getDate()}-${meses[inicio.getMonth()+1]} al ${fin.getDate()}-${meses[fin.getMonth()+1]}</td>`;
        sem.dias.forEach((dia, i) => {
            const d = new Date(dia + 'T12:00:00');
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            html += `<td class="dia-col sem-${sem.num}${sab}">${d.getDate()}-${meses[d.getMonth()+1]}</td>`;
        });
        html += `<td class="dia-col sem-${sem.num} total-col">TOTAL</td>`;
    });
    html += '</tr>';

    // Header dias semana
    html += '<tr class="header-dias">';
    fc_semanas.forEach(sem => {
        html += `<td class="col-semana sem-${sem.num}-header"></td>`;
        dias.forEach((d, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            html += `<td class="dia-col sem-${sem.num}${sab}">${d}</td>`;
        });
        html += `<td class="dia-col sem-${sem.num} total-col"></td>`;
    });
    html += '</tr>';

    // ============ SALDO INICIAL ============
    html += fc_renderSaldoInicial();

    // ============ INGRESOS ============
    html += fc_renderSeccion('INGRESOS', 'row-section');

    // PRODUBANCO
    html += fc_renderSubseccion('BANCO PRODUBANCO', 'produbanco');
    html += fc_renderFilaIngreso('Deposito TC', 'tc', fc_datos.depositos_tc, 'neto', 'produbanco');
    html += fc_renderFilaIngreso('Deposito Efectivo', 'efectivo', fc_datos.depositos_efectivo, 'total', 'produbanco');
    html += fc_renderFilaTraspaso('produbanco');
    html += fc_renderFilaTotal('Total Produbanco', fc_datos.totales_produbanco, 'total-produbanco', 'produbanco');

    // PICHINCHA
    html += fc_renderSubseccion('BANCO PICHINCHA', 'pichincha');
    html += fc_renderFilaIngreso('Deposito DEUNA', 'deuna', fc_datos.depositos_deuna, 'total', 'pichincha');
    html += fc_renderFilaTotal('Total Pichincha', fc_datos.totales_pichincha, 'total-pichincha', 'pichincha');

    // Total Ingresos
    html += fc_renderFilaTotalIngresos();

    // ============ EGRESOS ============
    html += fc_renderSeccion('EGRESOS', 'row-section');
    html += fc_renderEgresos();

    // ============ FLUJO Y SALDO FINAL ============
    html += fc_renderFlujoYSaldo();

    html += '</table>';
    container.innerHTML = html;
}

// Saldo Inicial (primer dia editable, resto calculado)
function fc_renderSaldoInicial() {
    let html = `<tr class="row-total" style="background:#b3e5fc !important;"><td class="col-concepto" style="background:#b3e5fc !important; font-weight:bold;">SALDO INICIAL</td>`;
    fc_semanas.forEach((sem, semIdx) => {
        // Semana colapsada - suma del primer dia
        html += `<td class="col-semana sem-${sem.num}-header monto fc-saldo-inicial-sem" data-semana="${sem.num}" style="background:#b3e5fc !important;">-</td>`;

        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            const esEditablePrimero = (semIdx === 0 && i === 0);

            if (esEditablePrimero) {
                // Primer dia de primera semana: editable
                html += `<td class="dia-col sem-${sem.num}${sab} monto" style="background:#b3e5fc !important;">
                    <input type="text" class="fc-input fc-saldo-inicial-input" data-fecha="${dia}" placeholder="0" onchange="fc_recalcularTodo()" style="background:#e1f5fe;">
                </td>`;
            } else {
                // Resto: calculado (saldo final del dia anterior)
                html += `<td class="dia-col sem-${sem.num}${sab} monto fc-saldo-inicial-dia" data-fecha="${dia}" style="background:#b3e5fc !important;">-</td>`;
            }
        });
        html += `<td class="dia-col sem-${sem.num} total-col monto" style="background:#b3e5fc !important;"></td>`;
    });
    html += '</tr>';
    return html;
}

// Fila de ingreso con campo de ajuste
function fc_renderFilaIngreso(titulo, tipo, datos, campo, grupoId = null) {
    const grupoAttr = grupoId ? ` data-grupo="${grupoId}"` : '';
    let html = `<tr class="row-banco-item"${grupoAttr}><td class="col-concepto indent-2">${titulo}</td>`;
    fc_semanas.forEach(sem => {
        let totalSem = 0;
        sem.dias.forEach(dia => {
            const val = datos[dia]?.[campo] || 0;
            totalSem += val;
        });
        html += `<td class="col-semana sem-${sem.num}-header monto fc-ingreso-${tipo}-sem" data-semana="${sem.num}">${fc_formatMonto(totalSem)}</td>`;

        sem.dias.forEach((dia, i) => {
            const val = datos[dia]?.[campo] || 0;
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            html += `<td class="dia-col sem-${sem.num}${sab} monto fc-ingreso-${tipo}-dia" data-fecha="${dia}" data-proyectado="${val}">${fc_formatMonto(val)}</td>`;
        });
        html += `<td class="dia-col sem-${sem.num} total-col monto fc-ingreso-${tipo}-total" data-semana="${sem.num}">${fc_formatMonto(totalSem)}</td>`;
    });
    html += '</tr>';

    // Fila de ajuste
    html += `<tr class="row-banco-item"${grupoAttr} style="background:#fff3e0 !important;"><td class="col-concepto indent-3" style="background:#fff3e0 !important; font-size:10px; color:#e65100;">Ajuste ${titulo}</td>`;
    fc_semanas.forEach(sem => {
        html += `<td class="col-semana sem-${sem.num}-header monto fc-ajuste-${tipo}-sem" data-semana="${sem.num}" style="background:#fff3e0 !important;">-</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            html += `<td class="dia-col sem-${sem.num}${sab} monto" style="background:#fff3e0 !important;">
                <input type="text" class="fc-input fc-ajuste-input fc-ajuste-${tipo}" data-fecha="${dia}" data-semana="${sem.num}" data-tipo="${tipo}" placeholder="0" onchange="fc_recalcularTodo()" style="background:#fff8e1; font-size:9px;">
            </td>`;
        });
        html += `<td class="dia-col sem-${sem.num} total-col monto fc-ajuste-${tipo}-total" data-semana="${sem.num}" style="background:#fff3e0 !important;">-</td>`;
    });
    html += '</tr>';

    return html;
}

function fc_renderFilaTraspaso(grupoId = null) {
    const grupoAttr = grupoId ? ` data-grupo="${grupoId}"` : '';
    let html = `<tr class="row-banco-item"${grupoAttr}><td class="col-concepto indent-2">Traspaso desde Pichincha</td>`;
    fc_semanas.forEach(sem => {
        html += `<td class="col-semana sem-${sem.num}-header monto fc-traspaso-sem" data-semana="${sem.num}">-</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            html += `<td class="dia-col sem-${sem.num}${sab} monto"><input type="text" class="fc-input fc-input-traspaso" data-fecha="${dia}" data-semana="${sem.num}" placeholder="0" onchange="fc_recalcularTodo()"></td>`;
        });
        html += `<td class="dia-col sem-${sem.num} total-col monto fc-traspaso-total" data-semana="${sem.num}">-</td>`;
    });
    html += '</tr>';
    return html;
}

function fc_renderSeccion(titulo, clase) {
    let html = `<tr class="${clase}"><td class="col-concepto">${titulo}</td>`;
    fc_semanas.forEach(sem => {
        html += `<td class="col-semana sem-${sem.num}-header"></td>`;
        for (let i = 0; i < 8; i++) {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            html += `<td class="dia-col sem-${sem.num}${sab}"></td>`;
        }
    });
    html += '</tr>';
    return html;
}

function fc_renderSubseccion(titulo, grupoId = null) {
    const grupoAttr = grupoId ? ` data-grupo-header="${grupoId}" data-expanded="true"` : '';
    const onclick = grupoId ? ` onclick="fc_toggleGrupo('${grupoId}')" style="cursor:pointer;"` : '';
    const icon = grupoId ? '<span class="fc-grupo-icon" style="margin-right:6px;">▼</span>' : '';
    let html = `<tr class="row-subsection"${grupoAttr}${onclick}><td class="col-concepto indent-1">${icon}${titulo}</td>`;
    fc_semanas.forEach(sem => {
        html += `<td class="col-semana sem-${sem.num}-header"></td>`;
        for (let i = 0; i < 8; i++) {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            html += `<td class="dia-col sem-${sem.num}${sab}"></td>`;
        }
    });
    html += '</tr>';
    return html;
}

function fc_renderFilaTotal(titulo, datos, clase, grupoId = null) {
    const grupoAttr = grupoId ? ` data-grupo="${grupoId}"` : '';
    let html = `<tr class="row-banco-total"${grupoAttr}><td class="col-concepto indent-1">${titulo}</td>`;
    fc_semanas.forEach(sem => {
        const val = datos[sem.num] || 0;
        html += `<td class="col-semana sem-${sem.num}-header monto ${clase}-sem" data-semana="${sem.num}" data-base="${val}">${fc_formatMonto(val)}</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            let valDia = 0;
            if (clase === 'total-produbanco') {
                valDia = (fc_datos.depositos_tc[dia]?.neto || 0) + (fc_datos.depositos_efectivo[dia]?.total || 0);
            } else if (clase === 'total-pichincha') {
                valDia = fc_datos.depositos_deuna[dia]?.total || 0;
            }
            html += `<td class="dia-col sem-${sem.num}${sab} monto ${clase}-dia" data-fecha="${dia}" data-base="${valDia}">${fc_formatMonto(valDia)}</td>`;
        });
        html += `<td class="dia-col sem-${sem.num} total-col monto ${clase}-total" data-semana="${sem.num}" data-base="${val}">${fc_formatMonto(val)}</td>`;
    });
    html += '</tr>';
    return html;
}

function fc_renderFilaTotalIngresos() {
    let html = `<tr class="row-total" style="background:#c8e6c9 !important;"><td class="col-concepto" style="background:#c8e6c9 !important; font-weight:bold;">TOTAL INGRESOS</td>`;
    fc_semanas.forEach(sem => {
        html += `<td class="col-semana sem-${sem.num}-header monto fc-total-ingresos-sem" data-semana="${sem.num}" style="background:#c8e6c9 !important;">-</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            html += `<td class="dia-col sem-${sem.num}${sab} monto fc-total-ingresos-dia" data-fecha="${dia}" style="background:#c8e6c9 !important;">-</td>`;
        });
        html += `<td class="dia-col sem-${sem.num} total-col monto fc-total-ingresos-total" data-semana="${sem.num}" style="background:#c8e6c9 !important;">-</td>`;
    });
    html += '</tr>';
    return html;
}

function fc_renderEgresos() {
    let html = '';

    // PAGOS FIJOS
    html += `<tr class="row-subsection"><td class="col-concepto indent-1">PAGOS FIJOS <button class="fc-btn-add" onclick="fc_agregarSubgrupo('pagos-fijos')" title="Agregar subgrupo">+</button></td>`;
    fc_semanas.forEach(sem => {
        html += `<td class="col-semana sem-${sem.num}-header"></td>`;
        for (let i = 0; i < 8; i++) html += `<td class="dia-col sem-${sem.num}"></td>`;
    });
    html += '</tr>';

    const subgrupos = [
        { id: 'inst-pub', nombre: 'INSTITUCIONES PUBLICAS', items: ['SRI', 'IESS'] },
        { id: 'arriendos', nombre: 'ARRIENDOS', items: ['Chios Real', 'Chios Floreana', 'Chios Portugal', 'SC Portugal', 'SC Real', 'Simon Bolon', 'Planta', 'Pulmon'] },
        { id: 'prestamos', nombre: 'PRESTAMOS', items: ['Produbanco', 'Bolivariano'] },
        { id: 'nomina', nombre: 'PAGO DE NOMINA', items: ['Prim Quincena', 'Seg Quincena'] },
        { id: 'colaboradores', nombre: 'COLABORADORES', items: ['Asesoria Legal', 'Asesoria Financiera', 'Servicios de SSO', 'Servicios Limpieza'] },
        { id: 'cajas', nombre: 'CAJAS CHICAS', items: ['Chios Real', 'Chios Floreana', 'Chios Portugal', 'SC Portugal', 'SC Real', 'Simon Bolon', 'Compras', 'Marketing', 'RRHH'] },
        { id: 'entrenamiento', nombre: 'ENTRENAMIENTO Y APOYO', items: ['Apoyo Locales', 'Entrenamiento Locales'] },
        { id: 'tasas', nombre: 'TASAS Y CONTRIBUCIONES', items: ['Tasa de Turismo', 'Patente', 'Supercias', '1.5 Sobre Ingresos', 'ARCSA'] },
        { id: 'debitos', nombre: 'DEBITOS AUTOMATICOS', items: ['Celular', 'TV Pagada', 'Seguros Locales', 'Fiduciaria Vehiculo', 'Seguros Personal', 'Internet'] },
        { id: 'servicios', nombre: 'SERVICIOS BASICOS', items: ['Energia Electrica', 'Agua Potable'] },
        { id: 'tarjetas', nombre: 'TARJETAS DE CREDITO', items: ['Diners', 'Titanium', 'Produbanco Corporativa', 'Produbanco Pyme', 'Banco Internacional'] },
        { id: 'liquidaciones', nombre: 'FONDOS LIQUIDACIONES EMPLEADOS', items: ['Item 1'] },
        { id: 'agasajo', nombre: 'FONDO AGASAJO EMPLEADOS', items: ['Item 1'] },
        { id: 'legales', nombre: 'FONDOS DE GASTOS LEGALES', items: ['Item 1'] },
        { id: 'fortuitos', nombre: 'FONDOS EVENTOS FORTUITOS', items: ['Item 1'] }
    ];

    subgrupos.forEach(sg => {
        html += fc_renderSubgrupoEgreso(sg);
    });

    html += fc_renderTotalEgreso('Total Pagos Fijos', 'pagos-fijos', '#ffcdd2');

    // PAGO PROVEEDORES
    html += `<tr class="row-subsection"><td class="col-concepto indent-1">PAGO PROVEEDORES <button class="fc-btn-add" onclick="fc_agregarSubgrupo('proveedores')" title="Agregar subgrupo">+</button></td>`;
    fc_semanas.forEach(sem => {
        html += `<td class="col-semana sem-${sem.num}-header"></td>`;
        for (let i = 0; i < 8; i++) html += `<td class="dia-col sem-${sem.num}"></td>`;
    });
    html += '</tr>';

    html += fc_renderSubgrupoEgreso({ id: 'prov-principales', nombre: 'PROVEEDORES PRINCIPALES', items: ['Proveedor 1'], esProveedor: true });
    html += fc_renderTotalEgreso('Total Pago Proveedores', 'proveedores', '#ffcdd2');
    html += fc_renderTotalEgreso('TOTAL EGRESOS', 'egresos', '#ef9a9a');

    return html;
}

function fc_renderSubgrupoEgreso(sg) {
    let html = '';
    // Header del subgrupo - clickeable para colapsar/expandir
    html += `<tr class="row-banco" id="fc-grupo-${sg.id}" data-grupo-header="eg-${sg.id}" data-expanded="true" onclick="fc_toggleGrupo('eg-${sg.id}')" style="cursor:pointer;"><td class="col-concepto indent-2"><span class="fc-grupo-icon" style="margin-right:6px;">▼</span>${sg.nombre} <button class="fc-btn-add" onclick="event.stopPropagation();fc_agregarItem('${sg.id}')">+</button></td>`;
    fc_semanas.forEach(sem => {
        html += `<td class="col-semana sem-${sem.num}-header"></td>`;
        for (let i = 0; i < 8; i++) html += `<td class="dia-col sem-${sem.num}"></td>`;
    });
    html += '</tr>';

    sg.items.forEach(item => {
        html += `<tr class="row-banco-item fc-egreso-item-${sg.id}" data-grupo="eg-${sg.id}"><td class="col-concepto indent-3"><input type="text" class="fc-input-nombre" value="${item}"><button class="fc-btn-del" onclick="fc_eliminarItem(this)">x</button></td>`;
        fc_semanas.forEach(sem => {
            html += `<td class="col-semana sem-${sem.num}-header monto fc-item-sem" data-semana="${sem.num}">-</td>`;
            sem.dias.forEach((dia, i) => {
                const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
                html += `<td class="dia-col sem-${sem.num}${sab} monto"><input type="text" class="fc-input fc-input-egreso-${sg.id}" data-fecha="${dia}" data-semana="${sem.num}" placeholder="0" onchange="fc_recalcularTodo()"></td>`;
            });
            html += `<td class="dia-col sem-${sem.num} total-col monto fc-item-total" data-semana="${sem.num}">-</td>`;
        });
        html += '</tr>';
    });

    html += `<tr class="row-banco-total" id="fc-total-${sg.id}-row" data-grupo="eg-${sg.id}"><td class="col-concepto indent-2">Total ${sg.nombre.split(' ').slice(0,2).join(' ')}</td>`;
    fc_semanas.forEach(sem => {
        html += `<td class="col-semana sem-${sem.num}-header monto fc-total-${sg.id}-sem" data-semana="${sem.num}">-</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            html += `<td class="dia-col sem-${sem.num}${sab} monto fc-total-${sg.id}-dia" data-fecha="${dia}">-</td>`;
        });
        html += `<td class="dia-col sem-${sem.num} total-col monto fc-total-${sg.id}-total" data-semana="${sem.num}">-</td>`;
    });
    html += '</tr>';

    return html;
}

function fc_renderTotalEgreso(titulo, tipo, color) {
    let html = `<tr class="row-total"><td class="col-concepto indent-1" style="background:${color};">${titulo}</td>`;
    fc_semanas.forEach(sem => {
        html += `<td class="col-semana sem-${sem.num}-header monto fc-total-${tipo}-sem" data-semana="${sem.num}" style="background:${color};">-</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            html += `<td class="dia-col sem-${sem.num}${sab} monto fc-total-${tipo}-dia" data-fecha="${dia}" style="background:${color};">-</td>`;
        });
        html += `<td class="dia-col sem-${sem.num} total-col monto fc-total-${tipo}-total" data-semana="${sem.num}" style="background:${color};">-</td>`;
    });
    html += '</tr>';
    return html;
}

function fc_renderFlujoYSaldo() {
    let html = '';

    // FLUJO DEL DIA/SEMANA (Ingresos - Egresos)
    html += `<tr class="row-total" style="background:#fff9c4 !important;"><td class="col-concepto" style="background:#fff9c4 !important; font-weight:bold;">FLUJO DEL PERIODO</td>`;
    fc_semanas.forEach(sem => {
        html += `<td class="col-semana sem-${sem.num}-header monto fc-flujo-sem" data-semana="${sem.num}" style="background:#fff9c4 !important;">-</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            html += `<td class="dia-col sem-${sem.num}${sab} monto fc-flujo-dia" data-fecha="${dia}" style="background:#fff9c4 !important;">-</td>`;
        });
        html += `<td class="dia-col sem-${sem.num} total-col monto fc-flujo-total" data-semana="${sem.num}" style="background:#fff9c4 !important;">-</td>`;
    });
    html += '</tr>';

    // SALDO FINAL (Saldo Inicial + Flujo)
    html += `<tr class="row-total" style="background:#81d4fa !important;"><td class="col-concepto" style="background:#81d4fa !important; font-weight:bold;">SALDO FINAL</td>`;
    fc_semanas.forEach(sem => {
        html += `<td class="col-semana sem-${sem.num}-header monto fc-saldo-final-sem" data-semana="${sem.num}" style="background:#81d4fa !important;">-</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            html += `<td class="dia-col sem-${sem.num}${sab} monto fc-saldo-final-dia" data-fecha="${dia}" style="background:#81d4fa !important;">-</td>`;
        });
        html += `<td class="dia-col sem-${sem.num} total-col monto fc-saldo-final-total" data-semana="${sem.num}" style="background:#81d4fa !important;">-</td>`;
    });
    html += '</tr>';

    return html;
}

// ============ RECALCULAR TODO ============
function fc_recalcularTodo() {
    fc_recalcularAjustes();
    fc_recalcularTraspasos();
    fc_recalcularIngresos();
    fc_recalcularEgresos();
    fc_recalcularFlujoYSaldos();
    fc_actualizarResumen();
}

function fc_recalcularAjustes() {
    ['tc', 'efectivo', 'deuna'].forEach(tipo => {
        fc_semanasNums.forEach(sem => {
            let totalAjuste = 0;
            document.querySelectorAll(`.fc-ajuste-${tipo}[data-semana="${sem}"]`).forEach(inp => {
                totalAjuste += parseFloat(inp.value.replace(/,/g, '')) || 0;
            });
            const semCell = document.querySelector(`.fc-ajuste-${tipo}-sem[data-semana="${sem}"]`);
            if (semCell) semCell.textContent = fc_formatMonto(totalAjuste);
            const totalCell = document.querySelector(`.fc-ajuste-${tipo}-total[data-semana="${sem}"]`);
            if (totalCell) totalCell.textContent = fc_formatMonto(totalAjuste);
        });
    });
}

function fc_recalcularTraspasos() {
    fc_semanasNums.forEach(sem => {
        let total = 0;
        document.querySelectorAll(`.fc-input-traspaso[data-semana="${sem}"]`).forEach(inp => {
            total += parseFloat(inp.value.replace(/,/g, '')) || 0;
        });
        const semCell = document.querySelector(`.fc-traspaso-sem[data-semana="${sem}"]`);
        if (semCell) semCell.textContent = fc_formatMonto(total);
        const totalCell = document.querySelector(`.fc-traspaso-total[data-semana="${sem}"]`);
        if (totalCell) totalCell.textContent = fc_formatMonto(total);
    });
}

function fc_recalcularIngresos() {
    // Calcular total ingresos por dia y semana (proyectado + ajustes + traspasos)
    fc_todasFechas.forEach(fecha => {
        const tc = fc_datos.depositos_tc[fecha]?.neto || 0;
        const ef = fc_datos.depositos_efectivo[fecha]?.total || 0;
        const deuna = fc_datos.depositos_deuna[fecha]?.total || 0;

        const ajusteTc = parseFloat(document.querySelector(`.fc-ajuste-tc[data-fecha="${fecha}"]`)?.value.replace(/,/g, '') || 0);
        const ajusteEf = parseFloat(document.querySelector(`.fc-ajuste-efectivo[data-fecha="${fecha}"]`)?.value.replace(/,/g, '') || 0);
        const ajusteDeuna = parseFloat(document.querySelector(`.fc-ajuste-deuna[data-fecha="${fecha}"]`)?.value.replace(/,/g, '') || 0);
        const traspaso = parseFloat(document.querySelector(`.fc-input-traspaso[data-fecha="${fecha}"]`)?.value.replace(/,/g, '') || 0);

        const totalDia = tc + ef + deuna + ajusteTc + ajusteEf + ajusteDeuna + traspaso;

        const cell = document.querySelector(`.fc-total-ingresos-dia[data-fecha="${fecha}"]`);
        if (cell) cell.textContent = fc_formatMonto(totalDia);
    });

    // Totales por semana
    fc_semanasNums.forEach(sem => {
        let totalSem = 0;
        const semana = fc_semanas.find(s => s.num === sem);
        if (semana) {
            semana.dias.forEach(fecha => {
                const cell = document.querySelector(`.fc-total-ingresos-dia[data-fecha="${fecha}"]`);
                if (cell && cell.textContent !== '-') {
                    totalSem += parseFloat(cell.textContent.replace(/,/g, '')) || 0;
                }
            });
        }
        const semCell = document.querySelector(`.fc-total-ingresos-sem[data-semana="${sem}"]`);
        if (semCell) semCell.textContent = fc_formatMonto(totalSem);
        const totalCell = document.querySelector(`.fc-total-ingresos-total[data-semana="${sem}"]`);
        if (totalCell) totalCell.textContent = fc_formatMonto(totalSem);
    });
}

function fc_recalcularEgresos() {
    // Todos los subgrupos de pagos fijos + proveedores
    const gruposFijos = ['inst-pub', 'arriendos', 'prestamos', 'nomina', 'colaboradores', 'cajas', 'entrenamiento', 'tasas', 'debitos', 'servicios', 'tarjetas', 'liquidaciones', 'agasajo', 'legales', 'fortuitos'];
    const gruposProveedores = ['prov-principales'];

    // Agregar subgrupos dinamicos creados por el usuario
    document.querySelectorAll('[id^="fc-grupo-"]').forEach(el => {
        const id = el.id.replace('fc-grupo-', '');
        if (!gruposFijos.includes(id) && !gruposProveedores.includes(id)) {
            if (id.startsWith('prov')) {
                gruposProveedores.push(id);
            } else {
                gruposFijos.push(id);
            }
        }
    });

    const grupos = [...gruposFijos, ...gruposProveedores];

    // Por dia
    fc_todasFechas.forEach(fecha => {
        let totalPagosFijos = 0;
        let totalProveedores = 0;

        grupos.forEach(grupo => {
            let totalGrupoDia = 0;
            document.querySelectorAll(`.fc-input-egreso-${grupo}[data-fecha="${fecha}"]`).forEach(inp => {
                totalGrupoDia += parseFloat(inp.value.replace(/,/g, '')) || 0;
            });
            const cell = document.querySelector(`.fc-total-${grupo}-dia[data-fecha="${fecha}"]`);
            if (cell) cell.textContent = fc_formatMonto(totalGrupoDia);

            if (gruposProveedores.includes(grupo)) {
                totalProveedores += totalGrupoDia;
            } else {
                totalPagosFijos += totalGrupoDia;
            }
        });

        const pfCell = document.querySelector(`.fc-total-pagos-fijos-dia[data-fecha="${fecha}"]`);
        if (pfCell) pfCell.textContent = fc_formatMonto(totalPagosFijos);
        const ppCell = document.querySelector(`.fc-total-proveedores-dia[data-fecha="${fecha}"]`);
        if (ppCell) ppCell.textContent = fc_formatMonto(totalProveedores);
        const teCell = document.querySelector(`.fc-total-egresos-dia[data-fecha="${fecha}"]`);
        if (teCell) teCell.textContent = fc_formatMonto(totalPagosFijos + totalProveedores);
    });

    // Por semana
    fc_semanasNums.forEach(sem => {
        let totalPagosFijos = 0;
        let totalProveedores = 0;

        grupos.forEach(grupo => {
            let totalGrupo = 0;
            document.querySelectorAll(`.fc-input-egreso-${grupo}[data-semana="${sem}"]`).forEach(inp => {
                totalGrupo += parseFloat(inp.value.replace(/,/g, '')) || 0;
            });
            const semCell = document.querySelector(`.fc-total-${grupo}-sem[data-semana="${sem}"]`);
            if (semCell) semCell.textContent = fc_formatMonto(totalGrupo);
            const totalCell = document.querySelector(`.fc-total-${grupo}-total[data-semana="${sem}"]`);
            if (totalCell) totalCell.textContent = fc_formatMonto(totalGrupo);

            if (gruposProveedores.includes(grupo)) {
                totalProveedores += totalGrupo;
            } else {
                totalPagosFijos += totalGrupo;
            }
        });

        const pfSem = document.querySelector(`.fc-total-pagos-fijos-sem[data-semana="${sem}"]`);
        const pfTotal = document.querySelector(`.fc-total-pagos-fijos-total[data-semana="${sem}"]`);
        const ppSem = document.querySelector(`.fc-total-proveedores-sem[data-semana="${sem}"]`);
        const ppTotal = document.querySelector(`.fc-total-proveedores-total[data-semana="${sem}"]`);
        const teSem = document.querySelector(`.fc-total-egresos-sem[data-semana="${sem}"]`);
        const teTotal = document.querySelector(`.fc-total-egresos-total[data-semana="${sem}"]`);
        if (pfSem) pfSem.textContent = fc_formatMonto(totalPagosFijos);
        if (pfTotal) pfTotal.textContent = fc_formatMonto(totalPagosFijos);
        if (ppSem) ppSem.textContent = fc_formatMonto(totalProveedores);
        if (ppTotal) ppTotal.textContent = fc_formatMonto(totalProveedores);
        if (teSem) teSem.textContent = fc_formatMonto(totalPagosFijos + totalProveedores);
        if (teTotal) teTotal.textContent = fc_formatMonto(totalPagosFijos + totalProveedores);
    });

    // Actualizar totales por fila
    document.querySelectorAll('[class*="fc-egreso-item-"]').forEach(row => {
        fc_semanasNums.forEach(sem => {
            let total = 0;
            row.querySelectorAll(`[data-semana="${sem}"].fc-input`).forEach(inp => {
                total += parseFloat(inp.value.replace(/,/g, '')) || 0;
            });
            const semCell = row.querySelector(`.fc-item-sem[data-semana="${sem}"]`);
            if (semCell) semCell.textContent = fc_formatMonto(total);
            const totalCell = row.querySelector(`.fc-item-total[data-semana="${sem}"]`);
            if (totalCell) totalCell.textContent = fc_formatMonto(total);
        });
    });
}

function fc_recalcularFlujoYSaldos() {
    let saldoAnterior = 0;

    // Obtener saldo inicial del primer dia (input editable)
    const inputSaldoInicial = document.querySelector('.fc-saldo-inicial-input');
    if (inputSaldoInicial) {
        saldoAnterior = parseFloat(inputSaldoInicial.value.replace(/,/g, '')) || 0;
    }

    // Calcular por cada dia en orden
    fc_todasFechas.forEach((fecha, idx) => {
        // Saldo inicial del dia = saldo final del dia anterior
        if (idx > 0) {
            const saldoInicialCell = document.querySelector(`.fc-saldo-inicial-dia[data-fecha="${fecha}"]`);
            if (saldoInicialCell) saldoInicialCell.textContent = fc_formatMonto(saldoAnterior);
        }

        // Ingresos del dia
        const ingresosCell = document.querySelector(`.fc-total-ingresos-dia[data-fecha="${fecha}"]`);
        const ingresos = ingresosCell && ingresosCell.textContent !== '-' ? parseFloat(ingresosCell.textContent.replace(/,/g, '')) || 0 : 0;

        // Egresos del dia
        const egresosCell = document.querySelector(`.fc-total-egresos-dia[data-fecha="${fecha}"]`);
        const egresos = egresosCell && egresosCell.textContent !== '-' ? parseFloat(egresosCell.textContent.replace(/,/g, '')) || 0 : 0;

        // Flujo = Ingresos - Egresos
        const flujo = ingresos - egresos;
        const flujoCell = document.querySelector(`.fc-flujo-dia[data-fecha="${fecha}"]`);
        if (flujoCell) {
            flujoCell.textContent = fc_formatFlujo(flujo);
            flujoCell.style.color = flujo < 0 ? '#c62828' : '#2e7d32';
        }

        // Saldo Final = Saldo Inicial + Flujo
        const saldoFinal = saldoAnterior + flujo;
        const saldoFinalCell = document.querySelector(`.fc-saldo-final-dia[data-fecha="${fecha}"]`);
        if (saldoFinalCell) {
            saldoFinalCell.textContent = fc_formatFlujo(saldoFinal);
            saldoFinalCell.style.color = saldoFinal < 0 ? '#c62828' : '#01579b';
        }

        saldoAnterior = saldoFinal;
    });

    // Calcular totales por semana
    fc_semanas.forEach(sem => {
        let flujoSem = 0;
        let primerSaldoInicial = null;
        let ultimoSaldoFinal = 0;

        sem.dias.forEach((fecha, idx) => {
            const flujoCell = document.querySelector(`.fc-flujo-dia[data-fecha="${fecha}"]`);
            if (flujoCell && flujoCell.textContent !== '-') {
                let val = flujoCell.textContent.replace(/[()]/g, '').replace(/,/g, '');
                if (flujoCell.textContent.includes('(')) val = -parseFloat(val);
                else val = parseFloat(val);
                flujoSem += val || 0;
            }

            if (idx === 0) {
                if (sem === fc_semanas[0]) {
                    const inp = document.querySelector('.fc-saldo-inicial-input');
                    primerSaldoInicial = parseFloat(inp?.value.replace(/,/g, '')) || 0;
                } else {
                    const cell = document.querySelector(`.fc-saldo-inicial-dia[data-fecha="${fecha}"]`);
                    if (cell && cell.textContent !== '-') {
                        primerSaldoInicial = parseFloat(cell.textContent.replace(/[()]/g, '').replace(/,/g, '')) || 0;
                    }
                }
            }

            const sfCell = document.querySelector(`.fc-saldo-final-dia[data-fecha="${fecha}"]`);
            if (sfCell && sfCell.textContent !== '-') {
                let val = sfCell.textContent.replace(/[()]/g, '').replace(/,/g, '');
                if (sfCell.textContent.includes('(')) val = -parseFloat(val);
                else val = parseFloat(val);
                ultimoSaldoFinal = val || 0;
            }
        });

        // Saldo inicial semana
        const siSemCell = document.querySelector(`.fc-saldo-inicial-sem[data-semana="${sem.num}"]`);
        if (siSemCell) siSemCell.textContent = fc_formatMonto(primerSaldoInicial || 0);

        // Flujo semana
        const flujoSemCell = document.querySelector(`.fc-flujo-sem[data-semana="${sem.num}"]`);
        if (flujoSemCell) {
            flujoSemCell.textContent = fc_formatFlujo(flujoSem);
            flujoSemCell.style.color = flujoSem < 0 ? '#c62828' : '#2e7d32';
        }
        const flujoTotalCell = document.querySelector(`.fc-flujo-total[data-semana="${sem.num}"]`);
        if (flujoTotalCell) {
            flujoTotalCell.textContent = fc_formatFlujo(flujoSem);
            flujoTotalCell.style.color = flujoSem < 0 ? '#c62828' : '#2e7d32';
        }

        // Saldo final semana
        const sfSemCell = document.querySelector(`.fc-saldo-final-sem[data-semana="${sem.num}"]`);
        if (sfSemCell) {
            sfSemCell.textContent = fc_formatFlujo(ultimoSaldoFinal);
            sfSemCell.style.color = ultimoSaldoFinal < 0 ? '#c62828' : '#01579b';
        }
        const sfTotalCell = document.querySelector(`.fc-saldo-final-total[data-semana="${sem.num}"]`);
        if (sfTotalCell) {
            sfTotalCell.textContent = fc_formatFlujo(ultimoSaldoFinal);
            sfTotalCell.style.color = ultimoSaldoFinal < 0 ? '#c62828' : '#01579b';
        }
    });
}

function fc_actualizarResumen() {
    document.getElementById('fc-resumen').style.display = 'grid';

    let totalIngresos = 0;
    let totalEgresos = 0;
    fc_semanasNums.forEach(sem => {
        const ingCell = document.querySelector(`.fc-total-ingresos-sem[data-semana="${sem}"]`);
        if (ingCell && ingCell.textContent !== '-') {
            totalIngresos += parseFloat(ingCell.textContent.replace(/,/g, '')) || 0;
        }
        const egrCell = document.querySelector(`.fc-total-egresos-sem[data-semana="${sem}"]`);
        if (egrCell && egrCell.textContent !== '-') {
            totalEgresos += parseFloat(egrCell.textContent.replace(/,/g, '')) || 0;
        }
    });

    const totalIngEl = document.getElementById('fc-total-ingresos');
    const totalEgrEl = document.getElementById('fc-total-egresos');
    if (totalIngEl) totalIngEl.textContent = '$' + fc_formatMonto(totalIngresos);
    if (totalEgrEl) totalEgrEl.textContent = '$' + fc_formatMonto(totalEgresos);

    // Saldo final de la ultima semana
    const ultimaSem = fc_semanas[fc_semanas.length - 1];
    if (ultimaSem) {
        const sfCell = document.querySelector(`.fc-saldo-final-sem[data-semana="${ultimaSem.num}"]`);
        if (sfCell && sfCell.textContent !== '-') {
            const saldoEl = document.getElementById('fc-saldo-produbanco');
            if (saldoEl) saldoEl.textContent = '$' + sfCell.textContent;
        }
    }
}

// ============ TOGGLE SEMANAS ============
function fc_toggleSemana(num) {
    const dias = document.querySelectorAll(`.sem-${num}`);
    const headers = document.querySelectorAll(`.sem-${num}-header`);
    const expanded = dias[0]?.classList.contains('visible');

    if (expanded) {
        dias.forEach(d => { d.classList.remove('visible'); d.style.display = 'none'; });
        headers.forEach(h => h.style.display = '');
    } else {
        dias.forEach(d => { d.classList.add('visible'); d.style.display = ''; });
        headers.forEach(h => h.style.display = 'none');
    }
}

function fc_expandirTodo() {
    fc_semanasNums.forEach(num => {
        document.querySelectorAll(`.sem-${num}`).forEach(d => { d.classList.add('visible'); d.style.display = ''; });
        document.querySelectorAll(`.sem-${num}-header`).forEach(h => h.style.display = 'none');
    });
}

function fc_colapsarTodo() {
    fc_semanasNums.forEach(num => {
        document.querySelectorAll(`.sem-${num}`).forEach(d => { d.classList.remove('visible'); d.style.display = 'none'; });
        document.querySelectorAll(`.sem-${num}-header`).forEach(h => h.style.display = '');
    });
}

// ============ EGRESOS DINAMICOS ============

// Obtener estructura de semanas desde el DOM (mas robusto que variables)
function fc_getSemanasFromDOM() {
    const semanas = [];

    // Buscar todas las celdas de semanas en el header (tienen clase sem-X-header)
    const headerCells = document.querySelectorAll('th.header-semana[class*="sem-"][class*="-header"]');
    const semanaNums = new Set();

    headerCells.forEach(cell => {
        const match = cell.className.match(/sem-(\d+)-header/);
        if (match) semanaNums.add(parseInt(match[1]));
    });

    // Para cada semana, obtener sus dias
    semanaNums.forEach(num => {
        const diasCells = document.querySelectorAll(`.fc-ingreso-tc-dia[data-fecha]`);
        const dias = [];

        diasCells.forEach(cell => {
            const fecha = cell.dataset.fecha;
            // Verificar que esta celda pertenece a esta semana
            if (cell.classList.contains(`sem-${num}`) ||
                cell.closest(`td.sem-${num}`) ||
                cell.closest('tr')?.querySelector(`td.sem-${num}`)) {
                // Verificar por semana usando inputs cercanos
            }
        });
    });

    // Metodo mas directo: leer de inputs existentes que tienen data-fecha y data-semana
    const inputsConFecha = document.querySelectorAll('.fc-input[data-fecha][data-semana]');
    const semanaMap = new Map();

    inputsConFecha.forEach(input => {
        const fecha = input.dataset.fecha;
        const semNum = parseInt(input.dataset.semana);
        if (!semanaMap.has(semNum)) {
            semanaMap.set(semNum, { num: semNum, dias: [] });
        }
        if (!semanaMap.get(semNum).dias.includes(fecha)) {
            semanaMap.get(semNum).dias.push(fecha);
        }
    });

    // Convertir a array ordenado
    const result = Array.from(semanaMap.values()).sort((a, b) => a.num - b.num);

    // Ordenar dias dentro de cada semana
    result.forEach(sem => {
        sem.dias.sort();
    });

    return result;
}

function fc_agregarItem(grupo) {
    const totalRow = document.getElementById(`fc-total-${grupo}-row`);
    if (!totalRow) {
        console.error('fc_agregarItem: No se encontró totalRow para grupo:', grupo);
        return;
    }

    // Obtener semanas: primero intentar variables, luego DOM
    let semanas = (fc_semanas && fc_semanas.length > 0) ? fc_semanas : window._fc_semanas;

    // Si aun esta vacio, extraer del DOM
    if (!semanas || semanas.length === 0) {
        semanas = fc_getSemanasFromDOM();
        console.log('fc_agregarItem: Semanas extraidas del DOM:', semanas.length);
    }

    if (!semanas || semanas.length === 0) {
        alert('Error: No hay datos de semanas. Recargue la pagina.');
        return;
    }

    const newRow = document.createElement('tr');
    newRow.className = `row-banco-item fc-egreso-item-${grupo}`;
    newRow.dataset.grupo = `eg-${grupo}`;

    let celdas = `<td class="col-concepto indent-3"><input type="text" class="fc-input-nombre" value="Nuevo Item"><button class="fc-btn-del" onclick="fc_eliminarItem(this)">x</button></td>`;

    semanas.forEach(sem => {
        celdas += `<td class="col-semana sem-${sem.num}-header monto fc-item-sem" data-semana="${sem.num}">-</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            celdas += `<td class="dia-col sem-${sem.num}${sab} monto"><input type="text" class="fc-input fc-input-egreso-${grupo}" data-fecha="${dia}" data-semana="${sem.num}" placeholder="0" onchange="fc_recalcularTodo()"></td>`;
        });
        celdas += `<td class="dia-col sem-${sem.num} total-col monto fc-item-total" data-semana="${sem.num}">-</td>`;
    });

    newRow.innerHTML = celdas;
    totalRow.parentNode.insertBefore(newRow, totalRow);

    // Aplicar visibilidad correcta segun estado actual de las semanas
    fc_aplicarVisibilidadNuevoItem(newRow);
}

// Aplicar visibilidad correcta a nuevo item basado en estado actual de semanas
function fc_aplicarVisibilidadNuevoItem(row) {
    fc_semanasNums.forEach(num => {
        const diasVisibles = document.querySelector(`.sem-${num}.visible`);
        const celdas = row.querySelectorAll(`.sem-${num}`);
        const headers = row.querySelectorAll(`.sem-${num}-header`);

        if (diasVisibles) {
            // Semana expandida
            celdas.forEach(c => { c.classList.add('visible'); c.style.display = ''; });
            headers.forEach(h => h.style.display = 'none');
        } else {
            // Semana colapsada
            celdas.forEach(c => { c.classList.remove('visible'); c.style.display = 'none'; });
            headers.forEach(h => h.style.display = '');
        }
    });
}

function fc_eliminarItem(btn) {
    const row = btn.closest('tr');
    if (row) {
        row.remove();
        fc_recalcularTodo();
    }
}

let fc_subgrupoCounter = 0;
function fc_agregarSubgrupo(tipo) {
    // Obtener semanas: primero variables, luego DOM
    let semanas = (fc_semanas && fc_semanas.length > 0) ? fc_semanas : window._fc_semanas;

    // Si aun esta vacio, extraer del DOM
    if (!semanas || semanas.length === 0) {
        semanas = fc_getSemanasFromDOM();
    }

    if (!semanas || semanas.length === 0) {
        alert('Error: No hay datos de semanas. Recargue la pagina.');
        return;
    }

    fc_subgrupoCounter++;
    const grupoId = tipo === 'proveedores' ? `prov${fc_subgrupoCounter}` : `nuevo${fc_subgrupoCounter}`;

    const targetSelector = tipo === 'proveedores' ? '.fc-total-proveedores-sem' : '.fc-total-pagos-fijos-sem';
    const totalRow = document.querySelector(targetSelector)?.closest('tr');
    if (!totalRow) return;

    const headerRow = document.createElement('tr');
    headerRow.className = 'row-banco';
    headerRow.id = `fc-grupo-${grupoId}`;
    headerRow.dataset.grupoHeader = `eg-${grupoId}`;
    headerRow.dataset.expanded = 'true';
    headerRow.style.cursor = 'pointer';
    headerRow.onclick = function(e) { if (!e.target.closest('button') && !e.target.closest('input')) fc_toggleGrupo(`eg-${grupoId}`); };
    let headerCeldas = `<td class="col-concepto indent-2"><span class="fc-grupo-icon" style="margin-right:6px;">▼</span><input type="text" class="fc-input-nombre" value="NUEVO SUBGRUPO" style="font-weight:bold;text-transform:uppercase;width:140px;"> <button class="fc-btn-add" onclick="event.stopPropagation();fc_agregarItem('${grupoId}')">+</button> <button class="fc-btn-del" onclick="event.stopPropagation();fc_eliminarSubgrupo(this)">x</button></td>`;
    semanas.forEach(sem => {
        headerCeldas += `<td class="col-semana sem-${sem.num}-header"></td>`;
        for (let i = 0; i < 8; i++) headerCeldas += `<td class="dia-col sem-${sem.num}"></td>`;
    });
    headerRow.innerHTML = headerCeldas;

    // Crear item row
    const itemRow = document.createElement('tr');
    itemRow.className = `row-banco-item fc-egreso-item-${grupoId}`;
    itemRow.dataset.grupo = `eg-${grupoId}`;

    let itemHtml = `<td class="col-concepto indent-3"><input type="text" class="fc-input-nombre" value="Item 1"><button class="fc-btn-del" onclick="fc_eliminarItem(this)">x</button></td>`;
    semanas.forEach(sem => {
        itemHtml += `<td class="col-semana sem-${sem.num}-header monto fc-item-sem" data-semana="${sem.num}">-</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            itemHtml += `<td class="dia-col sem-${sem.num}${sab} monto"><input type="text" class="fc-input fc-input-egreso-${grupoId}" data-fecha="${dia}" data-semana="${sem.num}" placeholder="0" onchange="fc_recalcularTodo()"></td>`;
        });
        itemHtml += `<td class="dia-col sem-${sem.num} total-col monto fc-item-total" data-semana="${sem.num}">-</td>`;
    });
    itemRow.innerHTML = itemHtml;

    const subTotalRow = document.createElement('tr');
    subTotalRow.className = 'row-banco-total';
    subTotalRow.id = `fc-total-${grupoId}-row`;
    subTotalRow.dataset.grupo = `eg-${grupoId}`;
    let totalCeldas = `<td class="col-concepto indent-2">Total Subgrupo</td>`;
    semanas.forEach(sem => {
        totalCeldas += `<td class="col-semana sem-${sem.num}-header monto fc-total-${grupoId}-sem" data-semana="${sem.num}">-</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            totalCeldas += `<td class="dia-col sem-${sem.num}${sab} monto fc-total-${grupoId}-dia" data-fecha="${dia}">-</td>`;
        });
        totalCeldas += `<td class="dia-col sem-${sem.num} total-col monto fc-total-${grupoId}-total" data-semana="${sem.num}">-</td>`;
    });
    subTotalRow.innerHTML = totalCeldas;

    totalRow.parentNode.insertBefore(headerRow, totalRow);
    totalRow.parentNode.insertBefore(itemRow, totalRow);
    totalRow.parentNode.insertBefore(subTotalRow, totalRow);

    // Aplicar visibilidad correcta a todas las filas nuevas
    fc_aplicarVisibilidadNuevoItem(headerRow);
    fc_aplicarVisibilidadNuevoItem(itemRow);
    fc_aplicarVisibilidadNuevoItem(subTotalRow);
}

function fc_eliminarSubgrupo(btn) {
    const headerRow = btn.closest('tr');
    if (!headerRow) return;
    const grupoId = headerRow.id.replace('fc-grupo-', '');

    document.querySelectorAll(`.fc-egreso-item-${grupoId}`).forEach(r => r.remove());
    const totalRow = document.getElementById(`fc-total-${grupoId}-row`);
    if (totalRow) totalRow.remove();
    headerRow.remove();

    fc_recalcularTodo();
}

// ============ CARGAR DATOS GUARDADOS ============
async function fc_cargarDatosGuardados() {
    try {
        const semanas = (fc_semanas && fc_semanas.length > 0) ? fc_semanas : window._fc_semanas;
        if (!semanas || semanas.length === 0) return;

        const fechas = semanas.map(s => s.inicio).join(',');
        const response = await fetch(`/api/flujo-caja/cargar-guardado?fechas=${fechas}`);
        if (!response.ok) return;

        const data = await response.json();
        if (!data.ok || !data.guardados) return;

        // Aplicar datos guardados
        for (const [fechaSemana, guardado] of Object.entries(data.guardados)) {
            // Aplicar saldo inicial (solo primera semana)
            if (guardado.saldo_inicial && semanas[0].inicio === fechaSemana) {
                const inputSaldo = document.querySelector('.fc-saldo-inicial-input');
                if (inputSaldo) inputSaldo.value = guardado.saldo_inicial;
            }

            // Aplicar ajustes
            if (guardado.ajustes_tc) {
                for (const [dia, valor] of Object.entries(guardado.ajustes_tc)) {
                    const input = document.querySelector(`.fc-ajuste-tc[data-fecha="${dia}"]`);
                    if (input && valor) input.value = valor;
                }
            }
            if (guardado.ajustes_efectivo) {
                for (const [dia, valor] of Object.entries(guardado.ajustes_efectivo)) {
                    const input = document.querySelector(`.fc-ajuste-efectivo[data-fecha="${dia}"]`);
                    if (input && valor) input.value = valor;
                }
            }
            if (guardado.ajustes_deuna) {
                for (const [dia, valor] of Object.entries(guardado.ajustes_deuna)) {
                    const input = document.querySelector(`.fc-ajuste-deuna[data-fecha="${dia}"]`);
                    if (input && valor) input.value = valor;
                }
            }

            // Aplicar traspasos
            if (guardado.traspasos) {
                for (const [dia, valor] of Object.entries(guardado.traspasos)) {
                    const input = document.querySelector(`.fc-input-traspaso[data-fecha="${dia}"]`);
                    if (input && valor) input.value = valor;
                }
            }

            // Aplicar egresos - crear items faltantes si es necesario
            if (guardado.egresos) {
                for (const [grupo, items] of Object.entries(guardado.egresos)) {
                    let rows = document.querySelectorAll(`.fc-egreso-item-${grupo}`);

                    // Crear items faltantes si hay mas guardados que renderizados
                    while (rows.length < items.length) {
                        fc_agregarItem(grupo);
                        rows = document.querySelectorAll(`.fc-egreso-item-${grupo}`);
                    }

                    items.forEach((item, idx) => {
                        if (rows[idx]) {
                            // Aplicar nombre
                            const nombreInput = rows[idx].querySelector('.fc-input-nombre');
                            if (nombreInput && item.nombre) nombreInput.value = item.nombre;

                            // Aplicar valores
                            for (const [dia, valor] of Object.entries(item.valores || {})) {
                                const input = rows[idx].querySelector(`[data-fecha="${dia}"].fc-input`);
                                if (input && valor) input.value = valor;
                            }
                        }
                    });
                }
            }
        }
    } catch (error) {
        console.error('Error cargando datos guardados:', error);
    }
}

// ============ GUARDAR DATOS ============
async function fc_guardarDatos() {
    const semanas = (fc_semanas && fc_semanas.length > 0) ? fc_semanas : window._fc_semanas;
    if (!semanas || semanas.length === 0) {
        alert('No hay datos para guardar');
        return;
    }

    // Mostrar indicador de guardando
    const btnGuardar = document.querySelector('button[onclick="fc_guardarDatos()"]');
    const textoOriginal = btnGuardar ? btnGuardar.innerHTML : '';
    if (btnGuardar) {
        btnGuardar.disabled = true;
        btnGuardar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
    }

    try {
        // Guardar cada semana por separado
        for (const sem of semanas) {
            const fechaSemana = sem.inicio;
            const semanaNum = sem.num;

            // Recoger saldo inicial (solo para primera semana)
            let saldoInicial = 0;
            const inputSaldo = document.querySelector('.fc-saldo-inicial-input');
            if (inputSaldo && sem === semanas[0]) {
                saldoInicial = parseFloat(inputSaldo.value.replace(/,/g, '')) || 0;
            }

            // Recoger ajustes
            const ajustes_tc = {};
            const ajustes_efectivo = {};
            const ajustes_deuna = {};
            const traspasos = {};

            sem.dias.forEach(dia => {
                const ajTc = document.querySelector(`.fc-ajuste-tc[data-fecha="${dia}"]`);
                if (ajTc && ajTc.value) ajustes_tc[dia] = parseFloat(ajTc.value.replace(/,/g, '')) || 0;

                const ajEf = document.querySelector(`.fc-ajuste-efectivo[data-fecha="${dia}"]`);
                if (ajEf && ajEf.value) ajustes_efectivo[dia] = parseFloat(ajEf.value.replace(/,/g, '')) || 0;

                const ajDeuna = document.querySelector(`.fc-ajuste-deuna[data-fecha="${dia}"]`);
                if (ajDeuna && ajDeuna.value) ajustes_deuna[dia] = parseFloat(ajDeuna.value.replace(/,/g, '')) || 0;

                const traspaso = document.querySelector(`.fc-input-traspaso[data-fecha="${dia}"]`);
                if (traspaso && traspaso.value) traspasos[dia] = parseFloat(traspaso.value.replace(/,/g, '')) || 0;
            });

            // Recoger egresos (todos los items con sus valores)
            const egresos = {};
            document.querySelectorAll('[class*="fc-egreso-item-"]').forEach(row => {
                const nombreInput = row.querySelector('.fc-input-nombre');
                const nombre = nombreInput ? nombreInput.value : 'Item';
                const clase = Array.from(row.classList).find(c => c.startsWith('fc-egreso-item-'));
                const grupo = clase ? clase.replace('fc-egreso-item-', '') : 'otros';

                if (!egresos[grupo]) egresos[grupo] = [];

                const itemData = { nombre, valores: {} };
                sem.dias.forEach(dia => {
                    const input = row.querySelector(`[data-fecha="${dia}"].fc-input`);
                    if (input && input.value) {
                        itemData.valores[dia] = parseFloat(input.value.replace(/,/g, '')) || 0;
                    }
                });
                egresos[grupo].push(itemData);
            });

            // Enviar al servidor
            const response = await fetch('/api/flujo-caja/guardar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fecha_semana: fechaSemana,
                    semana_num: semanaNum,
                    saldo_inicial: saldoInicial,
                    ajustes_tc,
                    ajustes_efectivo,
                    ajustes_deuna,
                    traspasos,
                    egresos,
                    usuario: 'admin'
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Error al guardar');
            }
        }

        // Restaurar boton y mostrar exito
        if (btnGuardar) {
            btnGuardar.disabled = false;
            btnGuardar.innerHTML = '<i class="fas fa-check"></i> Guardado!';
            setTimeout(() => { btnGuardar.innerHTML = textoOriginal; }, 2000);
        }

    } catch (error) {
        console.error('Error guardando:', error);
        // Restaurar boton en caso de error
        if (btnGuardar) {
            btnGuardar.disabled = false;
            btnGuardar.innerHTML = textoOriginal;
        }
        alert('Error al guardar: ' + error.message);
    }
}

// ============ DESCARGAR EXCEL ============
function fc_descargarExcel() {
    const tabla = document.getElementById('fc-tabla');
    if (!tabla) {
        alert('No hay datos para exportar. Haga clic en Consultar primero.');
        return;
    }

    const fechaCorte = document.getElementById('fc-fecha-corte')?.value || '';
    const numSemanas = document.getElementById('fc-num-semanas')?.value || '2';

    // Estilos para Excel
    const estilos = `
        <style>
            table { border-collapse: collapse; font-family: Calibri, Arial; font-size: 11pt; }
            th, td { border: 1px solid #999; padding: 6px 10px; }
            .header-main { background: #123450; color: white; font-weight: bold; font-size: 12pt; text-align: center; }
            .header-semana { background: #1565c0; color: white; font-weight: bold; text-align: center; }
            .header-dia { background: #e3f2fd; font-weight: bold; text-align: center; font-size: 10pt; }
            .seccion { background: #123450; color: white; font-weight: bold; font-size: 11pt; }
            .subseccion { background: #1976d2; color: white; font-weight: bold; }
            .subgrupo { background: #bbdefb; font-weight: bold; }
            .item { background: white; padding-left: 20px; }
            .total-grupo { background: #e1f5fe; font-weight: bold; font-style: italic; }
            .total-seccion { background: #b3e5fc; font-weight: bold; }
            .total-general { background: #81d4fa; font-weight: bold; font-size: 11pt; }
            .saldo-inicial { background: #b3e5fc; font-weight: bold; }
            .saldo-final { background: #01579b; color: white; font-weight: bold; }
            .flujo-positivo { background: #c8e6c9; }
            .flujo-negativo { background: #ffcdd2; }
            .egreso-seccion { background: #c62828; color: white; font-weight: bold; }
            .egreso-subseccion { background: #ef5350; color: white; font-weight: bold; }
            .egreso-subgrupo { background: #ffcdd2; font-weight: bold; }
            .egreso-total { background: #ffebee; font-weight: bold; }
            .monto { text-align: right; mso-number-format: "#,##0.00"; }
            .weekend { background: #f5f5f5; }
        </style>
    `;

    // Construir tabla HTML con formato
    let html = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
        <head>
            <meta charset="UTF-8">
            <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
            <x:Name>Flujo de Caja</x:Name>
            <x:WorksheetOptions><x:FreezePanes/><x:FrozenNoSplit/><x:SplitHorizontal>3</x:SplitHorizontal>
            <x:SplitVertical>1</x:SplitVertical></x:WorksheetOptions>
            </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
            ${estilos}
        </head>
        <body>
        <table>
    `;

    // Titulo
    const semanas = fc_semanas || window._fc_semanas || [];
    const totalCols = 1 + (semanas.length * 9); // concepto + (header + 7 dias + total) por semana
    html += `<tr><td colspan="${totalCols}" class="header-main">FLUJO DE CAJA - FOODIX | Fecha Corte: ${fechaCorte} | Semanas: ${numSemanas}</td></tr>`;

    // Headers de semanas
    html += '<tr><td class="header-main">CONCEPTO</td>';
    semanas.forEach(sem => {
        html += `<td class="header-semana" colspan="9">SEMANA ${sem.num} (${sem.inicio} al ${sem.fin})</td>`;
    });
    html += '</tr>';

    // Headers de dias
    html += '<tr><td class="header-dia"></td>';
    const diasNombre = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];
    semanas.forEach(sem => {
        html += '<td class="header-dia">Sem</td>';
        sem.dias.forEach((dia, i) => {
            const d = new Date(dia + 'T12:00:00');
            const isWeekend = i >= 5 ? ' weekend' : '';
            html += `<td class="header-dia${isWeekend}">${diasNombre[i]} ${d.getDate()}</td>`;
        });
        html += '<td class="header-dia" style="background:#1565c0;color:white;">TOTAL</td>';
    });
    html += '</tr>';

    // Procesar filas de la tabla original
    const rows = tabla.querySelectorAll('tr');
    rows.forEach((row, rowIdx) => {
        if (rowIdx < 3) return; // Saltar headers ya procesados

        const cells = row.querySelectorAll('th, td');
        if (cells.length === 0) return;

        // Determinar tipo de fila por clases
        const rowClasses = row.className || '';
        let rowStyle = '';

        if (rowClasses.includes('row-section')) {
            if (row.textContent.includes('EGRESO')) {
                rowStyle = 'egreso-seccion';
            } else {
                rowStyle = 'seccion';
            }
        } else if (rowClasses.includes('row-subsection')) {
            rowStyle = 'subseccion';
        } else if (rowClasses.includes('row-banco') && !rowClasses.includes('item') && !rowClasses.includes('total')) {
            if (row.closest && row.textContent.includes('PAGO')) {
                rowStyle = 'egreso-subgrupo';
            } else {
                rowStyle = 'subgrupo';
            }
        } else if (rowClasses.includes('row-banco-total')) {
            rowStyle = 'total-grupo';
        } else if (rowClasses.includes('row-total')) {
            if (row.textContent.includes('SALDO INICIAL')) {
                rowStyle = 'saldo-inicial';
            } else if (row.textContent.includes('SALDO FINAL')) {
                rowStyle = 'saldo-final';
            } else if (row.textContent.includes('FLUJO')) {
                rowStyle = 'total-general';
            } else {
                rowStyle = 'total-seccion';
            }
        } else if (rowClasses.includes('row-banco-item')) {
            rowStyle = 'item';
        }

        html += '<tr>';
        cells.forEach((cell, cellIdx) => {
            // Saltar celdas ocultas
            if (cell.style.display === 'none' || cell.classList.contains('sem-') && !cell.classList.contains('visible')) {
                // Solo incluir si es visible o es header de semana
                if (!cell.classList.toString().includes('-header')) return;
            }

            const input = cell.querySelector('input');
            let valor = input ? (input.value || '') : cell.textContent.trim();

            // Detectar si es monto
            const isMonto = cell.classList.contains('monto') || !isNaN(parseFloat(valor.replace(/,/g, '')));
            const montoClass = isMonto ? ' monto' : '';

            // Detectar weekend
            const isWeekend = cell.classList.contains('dia-sab') || cell.classList.contains('dia-dom') ? ' weekend' : '';

            // Detectar flujo negativo
            let flujoClass = '';
            if (valor.includes('(') && valor.includes(')')) {
                flujoClass = ' flujo-negativo';
            } else if (rowStyle === 'total-general' && !valor.includes('(') && parseFloat(valor.replace(/,/g, '')) > 0) {
                flujoClass = ' flujo-positivo';
            }

            const finalClass = rowStyle + montoClass + isWeekend + flujoClass;
            html += `<td class="${finalClass}">${valor}</td>`;
        });
        html += '</tr>';
    });

    html += '</table></body></html>';

    // Descargar como archivo Excel
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Flujo_Caja_${fechaCorte || 'export'}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ============ TOGGLE FILAS POR GRUPO ============
function fc_toggleGrupo(grupoId) {
    const header = document.querySelector(`[data-grupo-header="${grupoId}"]`);
    if (!header) return;

    const items = document.querySelectorAll(`[data-grupo="${grupoId}"]`);
    const expanded = header.dataset.expanded !== 'false';

    if (expanded) {
        // Colapsar
        items.forEach(row => row.style.display = 'none');
        header.dataset.expanded = 'false';
        const icon = header.querySelector('.fc-grupo-icon');
        if (icon) icon.textContent = '▶';
    } else {
        // Expandir
        items.forEach(row => row.style.display = '');
        header.dataset.expanded = 'true';
        const icon = header.querySelector('.fc-grupo-icon');
        if (icon) icon.textContent = '▼';
    }
}

function fc_expandirFilas() {
    document.querySelectorAll('[data-grupo-header]').forEach(header => {
        const grupoId = header.dataset.grupoHeader;
        document.querySelectorAll(`[data-grupo="${grupoId}"]`).forEach(row => row.style.display = '');
        header.dataset.expanded = 'true';
        const icon = header.querySelector('.fc-grupo-icon');
        if (icon) icon.textContent = '▼';
    });
}

function fc_colapsarFilas() {
    document.querySelectorAll('[data-grupo-header]').forEach(header => {
        const grupoId = header.dataset.grupoHeader;
        document.querySelectorAll(`[data-grupo="${grupoId}"]`).forEach(row => row.style.display = 'none');
        header.dataset.expanded = 'false';
        const icon = header.querySelector('.fc-grupo-icon');
        if (icon) icon.textContent = '▶';
    });
}

// Registrar en el sistema de vistas
if (typeof window.viewInitializers === 'undefined') {
    window.viewInitializers = {};
}
window.viewInitializers['flujo-caja'] = fc_init;
