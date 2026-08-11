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
    fc_asegurarEstilosFlujo();
    const container = document.getElementById('fc-tabla-container');
    const meses = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const dias = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];

    let html = '<table class="fc-tabla" id="fc-tabla">';

    // Header semanas
    html += '<tr><th class="col-concepto" rowspan="3">FLUJO DE CAJA</th>';
    html += '<th class="col-saldo" rowspan="3" style="background:#e3f2fd; min-width:80px;">SALDO</th>';
    html += '<th class="col-dias" rowspan="3" style="background:#fff3e0; min-width:50px;" title="Días de crédito">DÍAS</th>';
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

    // PRODUBANCO (total en la misma fila del banco)
    html += fc_renderSubseccionBanco('BANCO PRODUBANCO', 'produbanco');
    html += fc_renderFilaIngreso('Deposito TC', 'tc', fc_datos.depositos_tc, 'neto', 'produbanco');
    html += fc_renderFilaIngreso('Deposito Efectivo', 'efectivo', fc_datos.depositos_efectivo, 'total', 'produbanco');
    html += fc_renderFilaTraspaso('produbanco');

    // PICHINCHA (total en la misma fila del banco)
    html += fc_renderSubseccionBanco('BANCO PICHINCHA', 'pichincha');
    html += fc_renderFilaIngreso('Deposito DEUNA', 'deuna', fc_datos.depositos_deuna, 'total', 'pichincha');
    html += fc_renderFilaPlataforma('UBER', 'uber', 'pichincha');
    html += fc_renderFilaPlataforma('RAPPI', 'rappi', 'pichincha');
    html += fc_renderFilaPlataforma('PEDIDOS YA', 'pedidosya', 'pichincha');
    html += fc_renderFilaTraspasoSaliente('pichincha');

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

// Saldo Inicial por Banco (Produbanco y Pichincha separados)
function fc_renderSaldoInicial() {
    let html = '';

    // SALDO INICIAL PRODUBANCO
    html += `<tr class="row-total" style="background:#b3e5fc !important;"><td class="col-concepto" style="background:#b3e5fc !important; font-weight:bold;">SALDO INICIAL PRODUBANCO</td>`;
    html += '<td class="col-saldo" style="background:#b3e5fc !important;"></td>';
    html += '<td class="col-dias" style="background:#fff3e0 !important;"></td>';
    fc_semanas.forEach((sem, semIdx) => {
        html += `<td class="col-semana sem-${sem.num}-header monto fc-saldo-produbanco-sem" data-semana="${sem.num}" style="background:#b3e5fc !important;">-</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            const esEditablePrimero = (semIdx === 0 && i === 0);
            if (esEditablePrimero) {
                html += `<td class="dia-col sem-${sem.num}${sab} monto" style="background:#b3e5fc !important;">
                    <input type="text" class="fc-input fc-saldo-produbanco-input" data-fecha="${dia}" data-banco="produbanco" placeholder="0" onchange="fc_recalcularTodo()" style="background:#e1f5fe;">
                </td>`;
            } else {
                html += `<td class="dia-col sem-${sem.num}${sab} monto fc-saldo-produbanco-dia" data-fecha="${dia}" style="background:#b3e5fc !important;">-</td>`;
            }
        });
        html += `<td class="dia-col sem-${sem.num} total-col monto" style="background:#b3e5fc !important;"></td>`;
    });
    html += '</tr>';

    // SALDO INICIAL PICHINCHA
    html += `<tr class="row-total" style="background:#c8e6c9 !important;"><td class="col-concepto" style="background:#c8e6c9 !important; font-weight:bold;">SALDO INICIAL PICHINCHA</td>`;
    html += '<td class="col-saldo" style="background:#c8e6c9 !important;"></td>';
    html += '<td class="col-dias" style="background:#fff3e0 !important;"></td>';
    fc_semanas.forEach((sem, semIdx) => {
        html += `<td class="col-semana sem-${sem.num}-header monto fc-saldo-pichincha-sem" data-semana="${sem.num}" style="background:#c8e6c9 !important;">-</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            const esEditablePrimero = (semIdx === 0 && i === 0);
            if (esEditablePrimero) {
                html += `<td class="dia-col sem-${sem.num}${sab} monto" style="background:#c8e6c9 !important;">
                    <input type="text" class="fc-input fc-saldo-pichincha-input" data-fecha="${dia}" data-banco="pichincha" placeholder="0" onchange="fc_recalcularTodo()" style="background:#e8f5e9;">
                </td>`;
            } else {
                html += `<td class="dia-col sem-${sem.num}${sab} monto fc-saldo-pichincha-dia" data-fecha="${dia}" style="background:#c8e6c9 !important;">-</td>`;
            }
        });
        html += `<td class="dia-col sem-${sem.num} total-col monto" style="background:#c8e6c9 !important;"></td>`;
    });
    html += '</tr>';

    // SALDO INICIAL TOTAL (suma de ambos bancos)
    html += `<tr class="row-total" style="background:#90caf9 !important;"><td class="col-concepto" style="background:#90caf9 !important; font-weight:bold;">SALDO INICIAL TOTAL</td>`;
    html += '<td class="col-saldo" style="background:#90caf9 !important;"></td>';
    html += '<td class="col-dias" style="background:#fff3e0 !important;"></td>';
    fc_semanas.forEach((sem, semIdx) => {
        html += `<td class="col-semana sem-${sem.num}-header monto fc-saldo-total-sem" data-semana="${sem.num}" style="background:#90caf9 !important;">-</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            html += `<td class="dia-col sem-${sem.num}${sab} monto fc-saldo-total-dia" data-fecha="${dia}" style="background:#90caf9 !important;">-</td>`;
        });
        html += `<td class="dia-col sem-${sem.num} total-col monto" style="background:#90caf9 !important;"></td>`;
    });
    html += '</tr>';

    return html;
}

// Fila de ingreso con campo de ajuste
function fc_renderFilaIngreso(titulo, tipo, datos, campo, banco) {
    let html = `<tr class="row-banco-item fc-ingreso-item-${banco}" data-grupo="ing-${banco}"><td class="col-concepto indent-2">${titulo}</td>`;
    html += '<td class="col-saldo"></td><td class="col-dias"></td>';
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
    html += `<tr class="row-banco-item fc-ingreso-item-${banco}" data-grupo="ing-${banco}" style="background:#fff3e0 !important;"><td class="col-concepto indent-3" style="background:#fff3e0 !important; font-size:10px; color:#e65100;">Ajuste ${titulo}</td>`;
    html += '<td class="col-saldo"></td><td class="col-dias"></td>';
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

function fc_renderFilaTraspaso(banco) {
    let html = `<tr class="row-banco-item fc-ingreso-item-${banco}" data-grupo="ing-${banco}"><td class="col-concepto indent-2">Traspaso desde Pichincha</td>`;
    html += '<td class="col-saldo"></td><td class="col-dias"></td>';
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

// Fila de plataforma (UBER, RAPPI, PEDIDOS YA) - entrada manual
function fc_renderFilaPlataforma(titulo, tipo, banco) {
    let html = `<tr class="row-banco-item fc-ingreso-item-${banco}" data-grupo="ing-${banco}" style="background:#e8f5e9 !important;"><td class="col-concepto indent-2" style="background:#e8f5e9 !important;">${titulo}</td>`;
    html += '<td class="col-saldo"></td><td class="col-dias"></td>';
    fc_semanas.forEach(sem => {
        html += `<td class="col-semana sem-${sem.num}-header monto fc-plataforma-${tipo}-sem" data-semana="${sem.num}" style="background:#e8f5e9 !important;">-</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            html += `<td class="dia-col sem-${sem.num}${sab} monto" style="background:#e8f5e9 !important;">
                <input type="text" class="fc-input fc-input-plataforma fc-plataforma-${tipo}" data-fecha="${dia}" data-semana="${sem.num}" data-plataforma="${tipo}" placeholder="0" onchange="fc_recalcularTodo()" style="background:#c8e6c9;">
            </td>`;
        });
        html += `<td class="dia-col sem-${sem.num} total-col monto fc-plataforma-${tipo}-total" data-semana="${sem.num}" style="background:#e8f5e9 !important;">-</td>`;
    });
    html += '</tr>';
    return html;
}

// Fila de traspaso saliente (muestra negativo del traspaso a Produbanco)
function fc_renderFilaTraspasoSaliente(banco) {
    let html = `<tr class="row-banco-item fc-ingreso-item-${banco}" data-grupo="ing-${banco}" style="background:#ffcdd2 !important;"><td class="col-concepto indent-2" style="background:#ffcdd2 !important; color:#c62828;">Traspaso a Produbanco</td>`;
    html += '<td class="col-saldo"></td><td class="col-dias"></td>';
    fc_semanas.forEach(sem => {
        html += `<td class="col-semana sem-${sem.num}-header monto fc-traspaso-saliente-sem" data-semana="${sem.num}" style="background:#ffcdd2 !important; color:#c62828;">-</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            html += `<td class="dia-col sem-${sem.num}${sab} monto fc-traspaso-saliente-dia" data-fecha="${dia}" style="background:#ffcdd2 !important; color:#c62828;">-</td>`;
        });
        html += `<td class="dia-col sem-${sem.num} total-col monto fc-traspaso-saliente-total" data-semana="${sem.num}" style="background:#ffcdd2 !important; color:#c62828;">-</td>`;
    });
    html += '</tr>';
    return html;
}

function fc_renderSeccion(titulo, clase) {
    let html = `<tr class="${clase}"><td class="col-concepto">${titulo}</td>`;
    html += '<td class="col-saldo"></td><td class="col-dias"></td>';
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

function fc_renderSubseccion(titulo) {
    let html = `<tr class="row-subsection"><td class="col-concepto indent-1">${titulo}</td>`;
    html += '<td class="col-saldo"></td><td class="col-dias"></td>';
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

// Subseccion de banco con totales en la misma fila
function fc_renderSubseccionBanco(titulo, banco) {
    const datos = banco === 'produbanco' ? fc_datos.totales_produbanco : fc_datos.totales_pichincha;
    let html = `<tr class="row-subsection" data-grupo-header="ing-${banco}" data-expanded="true" onclick="fc_toggleGrupo('ing-${banco}')" style="font-weight:600; cursor:pointer;"><td class="col-concepto indent-1"><span class="fc-grupo-icon" style="margin-right:6px;">▼</span>${titulo}</td>`;
    html += '<td class="col-saldo"></td><td class="col-dias"></td>';
    fc_semanas.forEach(sem => {
        const val = datos[sem.num] || 0;
        html += `<td class="col-semana sem-${sem.num}-header monto total-${banco}-sem" data-semana="${sem.num}" style="font-weight:600;">${fc_formatMonto(val)}</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            let valDia = 0;
            if (banco === 'produbanco') {
                valDia = (fc_datos.depositos_tc[dia]?.neto || 0) + (fc_datos.depositos_efectivo[dia]?.total || 0);
            } else {
                valDia = fc_datos.depositos_deuna[dia]?.total || 0;
            }
            html += `<td class="dia-col sem-${sem.num}${sab} monto total-${banco}-dia" data-fecha="${dia}" style="font-weight:600;">${fc_formatMonto(valDia)}</td>`;
        });
        html += `<td class="dia-col sem-${sem.num} total-col monto total-${banco}-total" data-semana="${sem.num}" style="font-weight:600;">${fc_formatMonto(val)}</td>`;
    });
    html += '</tr>';
    return html;
}

function fc_renderFilaTotal(titulo, datos, clase) {
    let html = `<tr class="row-banco-total"><td class="col-concepto indent-1">${titulo}</td>`;
    html += '<td class="col-saldo"></td><td class="col-dias"></td>';
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
    html += '<td class="col-saldo" style="background:#c8e6c9 !important;"></td><td class="col-dias" style="background:#fff3e0 !important;"></td>';
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
    html += '<td class="col-saldo"></td><td class="col-dias"></td>';
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
    html += '<td class="col-saldo"></td><td class="col-dias"></td>';
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
    // Header clickeable para colapsar/expandir CON totales
    html += `<tr class="row-banco" id="fc-grupo-${sg.id}" data-grupo-header="eg-${sg.id}" data-expanded="true" onclick="fc_toggleGrupo('eg-${sg.id}')" style="cursor:pointer;"><td class="col-concepto indent-2"><span class="fc-grupo-icon" style="margin-right:6px;">▼</span>${sg.nombre} <button class="fc-btn-add" onclick="event.stopPropagation();fc_agregarItem('${sg.id}')">+</button></td>`;
    // Columna SALDO total del grupo (después del nombre)
    html += `<td class="col-saldo monto fc-saldo-grupo-${sg.id}" style="font-weight:600; background:#e3f2fd; min-width:80px;">-</td>`;
    // Columna DÍAS vacía para grupo (no aplica)
    html += `<td class="col-dias" style="background:#fff3e0;"></td>`;
    fc_semanas.forEach(sem => {
        html += `<td class="col-semana sem-${sem.num}-header monto fc-total-${sg.id}-sem" data-semana="${sem.num}" style="font-weight:600;">-</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            html += `<td class="dia-col sem-${sem.num}${sab} monto fc-total-${sg.id}-dia" data-fecha="${dia}" style="font-weight:600;">-</td>`;
        });
        html += `<td class="dia-col sem-${sem.num} total-col monto fc-total-${sg.id}-total" data-semana="${sem.num}" style="font-weight:600;">-</td>`;
    });
    html += '</tr>';

    sg.items.forEach((item, itemIdx) => {
        html += `<tr class="row-banco-item fc-egreso-item-${sg.id}" data-grupo="eg-${sg.id}" data-banco="produbanco" data-deuda="0" data-fc-row-id="fcr-${sg.id}-${itemIdx}"><td class="col-concepto indent-3">
            <select class="fc-select-banco" onchange="this.closest('tr').dataset.banco=this.value;fc_recalcularTodo()" title="Banco de salida">
                <option value="produbanco" selected>PRO</option>
                <option value="pichincha">PICH</option>
            </select>
            <input type="text" class="fc-input-nombre" value="${item}">
                <button class="fc-btn-facturas" onclick="event.stopPropagation();fc_abrirFacturas(this.closest('tr'))" title="Facturas pendientes"><span class="fc-icon-fac">F</span><span class="fc-badge-facturas"></span></button>
                <button class="fc-btn-del" onclick="fc_eliminarItem(this)">x</button>
        </td>`;
        // Columna SALDO del item (editable) - después del nombre
        html += `<td class="col-saldo monto" style="background:#e3f2fd; min-width:80px;">
            <input type="text" class="fc-input fc-input-saldo" placeholder="0" onchange="fc_recalcularSaldos()" style="width:70px; text-align:right; background:#e3f2fd;">
        </td>`;
        // Columna DÍAS CRÉDITO del item (editable)
        html += `<td class="col-dias monto" style="background:#fff3e0; min-width:50px;">
            <input type="number" class="fc-input fc-input-dias" placeholder="0" min="0" max="365" style="width:45px; text-align:center; background:#fff3e0;">
        </td>`;
        fc_semanas.forEach(sem => {
            html += `<td class="col-semana sem-${sem.num}-header monto fc-item-sem" data-semana="${sem.num}">-</td>`;
            sem.dias.forEach((dia, i) => {
                const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
                html += `<td class="dia-col sem-${sem.num}${sab} monto fc-celda-egreso">
                    <input type="text" class="fc-input fc-input-egreso-${sg.id}" data-fecha="${dia}" data-semana="${sem.num}" placeholder="0" onchange="fc_recalcularTodo()" onfocus="fc_onFocusEgreso(this)">
                    <button class="fc-btn-rep" onclick="fc_abrirRecurrencia(this)" title="Repetir desde aqui">&#x21bb;</button>
                </td>`;
            });
            html += `<td class="dia-col sem-${sem.num} total-col monto fc-item-total" data-semana="${sem.num}">-</td>`;
        });
        html += '</tr>';
    });

    return html;
}

function fc_renderTotalEgreso(titulo, tipo, color) {
    let html = `<tr class="row-total"><td class="col-concepto indent-1" style="background:${color};">${titulo}</td>`;
    html += `<td class="col-saldo" style="background:${color};"></td><td class="col-dias" style="background:#fff3e0;"></td>`;
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
    html += '<td class="col-saldo" style="background:#fff9c4 !important;"></td><td class="col-dias" style="background:#fff3e0 !important;"></td>';
    fc_semanas.forEach(sem => {
        html += `<td class="col-semana sem-${sem.num}-header monto fc-flujo-sem" data-semana="${sem.num}" style="background:#fff9c4 !important;">-</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            html += `<td class="dia-col sem-${sem.num}${sab} monto fc-flujo-dia" data-fecha="${dia}" style="background:#fff9c4 !important;">-</td>`;
        });
        html += `<td class="dia-col sem-${sem.num} total-col monto fc-flujo-total" data-semana="${sem.num}" style="background:#fff9c4 !important;">-</td>`;
    });
    html += '</tr>';

    // SALDO FINAL PRODUBANCO
    html += `<tr class="row-total" style="background:#b3e5fc !important;"><td class="col-concepto" style="background:#b3e5fc !important; font-weight:bold;">SALDO FINAL PRODUBANCO</td>`;
    html += '<td class="col-saldo" style="background:#b3e5fc !important;"></td><td class="col-dias" style="background:#fff3e0 !important;"></td>';
    fc_semanas.forEach(sem => {
        html += `<td class="col-semana sem-${sem.num}-header monto fc-saldo-final-produbanco-sem" data-semana="${sem.num}" style="background:#b3e5fc !important;">-</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            html += `<td class="dia-col sem-${sem.num}${sab} monto fc-saldo-final-produbanco-dia" data-fecha="${dia}" style="background:#b3e5fc !important;">-</td>`;
        });
        html += `<td class="dia-col sem-${sem.num} total-col monto fc-saldo-final-produbanco-total" data-semana="${sem.num}" style="background:#b3e5fc !important;">-</td>`;
    });
    html += '</tr>';

    // SALDO FINAL PICHINCHA
    html += `<tr class="row-total" style="background:#c8e6c9 !important;"><td class="col-concepto" style="background:#c8e6c9 !important; font-weight:bold;">SALDO FINAL PICHINCHA</td>`;
    html += '<td class="col-saldo" style="background:#c8e6c9 !important;"></td><td class="col-dias" style="background:#fff3e0 !important;"></td>';
    fc_semanas.forEach(sem => {
        html += `<td class="col-semana sem-${sem.num}-header monto fc-saldo-final-pichincha-sem" data-semana="${sem.num}" style="background:#c8e6c9 !important;">-</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            html += `<td class="dia-col sem-${sem.num}${sab} monto fc-saldo-final-pichincha-dia" data-fecha="${dia}" style="background:#c8e6c9 !important;">-</td>`;
        });
        html += `<td class="dia-col sem-${sem.num} total-col monto fc-saldo-final-pichincha-total" data-semana="${sem.num}" style="background:#c8e6c9 !important;">-</td>`;
    });
    html += '</tr>';

    // SALDO FINAL TOTAL (suma de ambos bancos)
    html += `<tr class="row-total" style="background:#81d4fa !important;"><td class="col-concepto" style="background:#81d4fa !important; font-weight:bold;">SALDO FINAL TOTAL</td>`;
    html += '<td class="col-saldo" style="background:#81d4fa !important;"></td><td class="col-dias" style="background:#fff3e0 !important;"></td>';
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
    fc_recalcularPlataformas();
    fc_recalcularIngresos();
    fc_recalcularEgresos();
    fc_recalcularFlujoYSaldos();
    fc_actualizarResumen();
    fc_recalcularTodosSaldos();
    fc_recalcularSaldos();
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
    // Actualizar por día (para mostrar el saliente en Pichincha)
    fc_todasFechas.forEach(fecha => {
        const inp = document.querySelector(`.fc-input-traspaso[data-fecha="${fecha}"]`);
        const val = inp ? (parseFloat(inp.value.replace(/,/g, '')) || 0) : 0;

        // Mostrar negativo en la fila de traspaso saliente de Pichincha
        const salienteCell = document.querySelector(`.fc-traspaso-saliente-dia[data-fecha="${fecha}"]`);
        if (salienteCell) {
            if (val > 0) {
                salienteCell.textContent = `(${fc_formatMonto(val)})`;
            } else {
                salienteCell.textContent = '-';
            }
        }
    });

    // Totales por semana
    fc_semanasNums.forEach(sem => {
        let total = 0;
        document.querySelectorAll(`.fc-input-traspaso[data-semana="${sem}"]`).forEach(inp => {
            total += parseFloat(inp.value.replace(/,/g, '')) || 0;
        });
        const semCell = document.querySelector(`.fc-traspaso-sem[data-semana="${sem}"]`);
        if (semCell) semCell.textContent = fc_formatMonto(total);
        const totalCell = document.querySelector(`.fc-traspaso-total[data-semana="${sem}"]`);
        if (totalCell) totalCell.textContent = fc_formatMonto(total);

        // Saliente (negativo)
        const salienteSem = document.querySelector(`.fc-traspaso-saliente-sem[data-semana="${sem}"]`);
        if (salienteSem) salienteSem.textContent = total > 0 ? `(${fc_formatMonto(total)})` : '-';
        const salienteTotal = document.querySelector(`.fc-traspaso-saliente-total[data-semana="${sem}"]`);
        if (salienteTotal) salienteTotal.textContent = total > 0 ? `(${fc_formatMonto(total)})` : '-';
    });
}

function fc_recalcularPlataformas() {
    ['uber', 'rappi', 'pedidosya'].forEach(plat => {
        fc_semanasNums.forEach(sem => {
            let totalSem = 0;
            document.querySelectorAll(`.fc-plataforma-${plat}[data-semana="${sem}"]`).forEach(inp => {
                totalSem += parseFloat(inp.value.replace(/,/g, '')) || 0;
            });
            const semCell = document.querySelector(`.fc-plataforma-${plat}-sem[data-semana="${sem}"]`);
            if (semCell) semCell.textContent = fc_formatMonto(totalSem);
            const totalCell = document.querySelector(`.fc-plataforma-${plat}-total[data-semana="${sem}"]`);
            if (totalCell) totalCell.textContent = fc_formatMonto(totalSem);
        });
    });
}

function fc_recalcularIngresos() {
    // Calcular total ingresos por dia y semana (proyectado + ajustes + traspasos + plataformas)
    fc_todasFechas.forEach(fecha => {
        // PRODUBANCO: TC + Efectivo + ajustes + traspaso desde Pichincha
        const tc = fc_datos.depositos_tc[fecha]?.neto || 0;
        const ef = fc_datos.depositos_efectivo[fecha]?.total || 0;
        const ajusteTc = parseFloat(document.querySelector(`.fc-ajuste-tc[data-fecha="${fecha}"]`)?.value.replace(/,/g, '') || 0);
        const ajusteEf = parseFloat(document.querySelector(`.fc-ajuste-efectivo[data-fecha="${fecha}"]`)?.value.replace(/,/g, '') || 0);
        const traspaso = parseFloat(document.querySelector(`.fc-input-traspaso[data-fecha="${fecha}"]`)?.value.replace(/,/g, '') || 0);
        const totalProdubanco = tc + ef + ajusteTc + ajusteEf + traspaso;

        // Actualizar Total Produbanco por dia
        const cellProdubanco = document.querySelector(`.total-produbanco-dia[data-fecha="${fecha}"]`);
        if (cellProdubanco) cellProdubanco.textContent = fc_formatMonto(totalProdubanco);

        // PICHINCHA: DEUNA + ajuste + plataformas - traspaso a Produbanco
        const deuna = fc_datos.depositos_deuna[fecha]?.total || 0;
        const ajusteDeuna = parseFloat(document.querySelector(`.fc-ajuste-deuna[data-fecha="${fecha}"]`)?.value.replace(/,/g, '') || 0);
        const uber = parseFloat(document.querySelector(`.fc-plataforma-uber[data-fecha="${fecha}"]`)?.value.replace(/,/g, '') || 0);
        const rappi = parseFloat(document.querySelector(`.fc-plataforma-rappi[data-fecha="${fecha}"]`)?.value.replace(/,/g, '') || 0);
        const pedidosya = parseFloat(document.querySelector(`.fc-plataforma-pedidosya[data-fecha="${fecha}"]`)?.value.replace(/,/g, '') || 0);
        const totalPichincha = deuna + ajusteDeuna + uber + rappi + pedidosya - traspaso;

        // Actualizar Total Pichincha por dia
        const cellPichincha = document.querySelector(`.total-pichincha-dia[data-fecha="${fecha}"]`);
        if (cellPichincha) cellPichincha.textContent = fc_formatMonto(totalPichincha);

        // Total Ingresos = Produbanco + Pichincha (sin duplicar traspaso)
        const totalDia = tc + ef + deuna + ajusteTc + ajusteEf + ajusteDeuna + uber + rappi + pedidosya;

        const cell = document.querySelector(`.fc-total-ingresos-dia[data-fecha="${fecha}"]`);
        if (cell) cell.textContent = fc_formatMonto(totalDia);
    });

    // Totales por semana
    fc_semanasNums.forEach(sem => {
        let totalSem = 0;
        let totalProdubanco = 0;
        let totalPichincha = 0;

        const semana = fc_semanas.find(s => s.num === sem);
        if (semana) {
            semana.dias.forEach(fecha => {
                const cell = document.querySelector(`.fc-total-ingresos-dia[data-fecha="${fecha}"]`);
                if (cell && cell.textContent !== '-') {
                    totalSem += parseFloat(cell.textContent.replace(/,/g, '')) || 0;
                }
                const cellP = document.querySelector(`.total-produbanco-dia[data-fecha="${fecha}"]`);
                if (cellP && cellP.textContent !== '-') {
                    totalProdubanco += parseFloat(cellP.textContent.replace(/,/g, '')) || 0;
                }
                const cellPich = document.querySelector(`.total-pichincha-dia[data-fecha="${fecha}"]`);
                if (cellPich && cellPich.textContent !== '-') {
                    totalPichincha += parseFloat(cellPich.textContent.replace(/,/g, '')) || 0;
                }
            });
        }
        const semCell = document.querySelector(`.fc-total-ingresos-sem[data-semana="${sem}"]`);
        if (semCell) semCell.textContent = fc_formatMonto(totalSem);
        const totalCell = document.querySelector(`.fc-total-ingresos-total[data-semana="${sem}"]`);
        if (totalCell) totalCell.textContent = fc_formatMonto(totalSem);

        // Totales banco por semana
        const pSem = document.querySelector(`.total-produbanco-sem[data-semana="${sem}"]`);
        if (pSem) pSem.textContent = fc_formatMonto(totalProdubanco);
        const pTotal = document.querySelector(`.total-produbanco-total[data-semana="${sem}"]`);
        if (pTotal) pTotal.textContent = fc_formatMonto(totalProdubanco);
        const pichSem = document.querySelector(`.total-pichincha-sem[data-semana="${sem}"]`);
        if (pichSem) pichSem.textContent = fc_formatMonto(totalPichincha);
        const pichTotal = document.querySelector(`.total-pichincha-total[data-semana="${sem}"]`);
        if (pichTotal) pichTotal.textContent = fc_formatMonto(totalPichincha);
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
    let saldoProdubanco = 0;
    let saldoPichincha = 0;

    // Obtener saldos iniciales del primer dia (inputs editables)
    const inputSaldoProdubanco = document.querySelector('.fc-saldo-produbanco-input');
    if (inputSaldoProdubanco) {
        saldoProdubanco = parseFloat(inputSaldoProdubanco.value.replace(/,/g, '')) || 0;
    }
    const inputSaldoPichincha = document.querySelector('.fc-saldo-pichincha-input');
    if (inputSaldoPichincha) {
        saldoPichincha = parseFloat(inputSaldoPichincha.value.replace(/,/g, '')) || 0;
    }

    // Calcular por cada dia en orden
    fc_todasFechas.forEach((fecha, idx) => {
        // Saldo inicial del dia = saldo final del dia anterior
        if (idx > 0) {
            const saldoProdCell = document.querySelector(`.fc-saldo-produbanco-dia[data-fecha="${fecha}"]`);
            if (saldoProdCell) saldoProdCell.textContent = fc_formatMonto(saldoProdubanco);
            const saldoPichCell = document.querySelector(`.fc-saldo-pichincha-dia[data-fecha="${fecha}"]`);
            if (saldoPichCell) saldoPichCell.textContent = fc_formatMonto(saldoPichincha);
            const saldoTotalCell = document.querySelector(`.fc-saldo-total-dia[data-fecha="${fecha}"]`);
            if (saldoTotalCell) saldoTotalCell.textContent = fc_formatMonto(saldoProdubanco + saldoPichincha);
        } else {
            // Primer dia - mostrar saldo total
            const saldoTotalCell = document.querySelector(`.fc-saldo-total-dia[data-fecha="${fecha}"]`);
            if (saldoTotalCell) saldoTotalCell.textContent = fc_formatMonto(saldoProdubanco + saldoPichincha);
        }

        // Ingresos Produbanco (TC + Efectivo + ajustes + traspaso desde Pichincha)
        const tc = fc_datos.depositos_tc[fecha]?.neto || 0;
        const ef = fc_datos.depositos_efectivo[fecha]?.total || 0;
        const ajusteTc = parseFloat(document.querySelector(`.fc-ajuste-tc[data-fecha="${fecha}"]`)?.value.replace(/,/g, '') || 0);
        const ajusteEf = parseFloat(document.querySelector(`.fc-ajuste-efectivo[data-fecha="${fecha}"]`)?.value.replace(/,/g, '') || 0);
        const traspaso = parseFloat(document.querySelector(`.fc-input-traspaso[data-fecha="${fecha}"]`)?.value.replace(/,/g, '') || 0);
        const ingresosProdubanco = tc + ef + ajusteTc + ajusteEf + traspaso;

        // Ingresos Pichincha (DEUNA + ajuste + plataformas - traspaso)
        const deuna = fc_datos.depositos_deuna[fecha]?.total || 0;
        const ajusteDeuna = parseFloat(document.querySelector(`.fc-ajuste-deuna[data-fecha="${fecha}"]`)?.value.replace(/,/g, '') || 0);
        const uber = parseFloat(document.querySelector(`.fc-plataforma-uber[data-fecha="${fecha}"]`)?.value.replace(/,/g, '') || 0);
        const rappi = parseFloat(document.querySelector(`.fc-plataforma-rappi[data-fecha="${fecha}"]`)?.value.replace(/,/g, '') || 0);
        const pedidosya = parseFloat(document.querySelector(`.fc-plataforma-pedidosya[data-fecha="${fecha}"]`)?.value.replace(/,/g, '') || 0);
        const ingresosPichincha = deuna + ajusteDeuna + uber + rappi + pedidosya - traspaso;

        // Egresos por banco (sumar según selector de banco en cada egreso)
        let egresosProdubanco = 0;
        let egresosPichincha = 0;
        document.querySelectorAll('[class*="fc-egreso-item-"]').forEach(row => {
            const banco = row.dataset.banco || 'produbanco';
            const input = row.querySelector(`[data-fecha="${fecha}"]`);
            if (input) {
                const val = parseFloat(input.value.replace(/,/g, '')) || 0;
                if (banco === 'pichincha') {
                    egresosPichincha += val;
                } else {
                    egresosProdubanco += val;
                }
            }
        });

        // Ingresos totales del dia
        const ingresosCell = document.querySelector(`.fc-total-ingresos-dia[data-fecha="${fecha}"]`);
        const ingresos = ingresosCell && ingresosCell.textContent !== '-' ? parseFloat(ingresosCell.textContent.replace(/,/g, '')) || 0 : 0;

        // Egresos totales del dia
        const egresosCell = document.querySelector(`.fc-total-egresos-dia[data-fecha="${fecha}"]`);
        const egresos = egresosCell && egresosCell.textContent !== '-' ? parseFloat(egresosCell.textContent.replace(/,/g, '')) || 0 : 0;

        // Flujo = Ingresos - Egresos
        const flujo = ingresos - egresos;
        const flujoCell = document.querySelector(`.fc-flujo-dia[data-fecha="${fecha}"]`);
        if (flujoCell) {
            flujoCell.textContent = fc_formatFlujo(flujo);
            flujoCell.style.color = flujo < 0 ? '#c62828' : '#2e7d32';
        }

        // Actualizar saldos por banco
        saldoProdubanco = saldoProdubanco + ingresosProdubanco - egresosProdubanco;
        saldoPichincha = saldoPichincha + ingresosPichincha - egresosPichincha;

        // Saldo Final por banco
        const saldoFinalProdCell = document.querySelector(`.fc-saldo-final-produbanco-dia[data-fecha="${fecha}"]`);
        if (saldoFinalProdCell) {
            saldoFinalProdCell.textContent = fc_formatFlujo(saldoProdubanco);
            saldoFinalProdCell.style.color = saldoProdubanco < 0 ? '#c62828' : '#01579b';
        }
        const saldoFinalPichCell = document.querySelector(`.fc-saldo-final-pichincha-dia[data-fecha="${fecha}"]`);
        if (saldoFinalPichCell) {
            saldoFinalPichCell.textContent = fc_formatFlujo(saldoPichincha);
            saldoFinalPichCell.style.color = saldoPichincha < 0 ? '#c62828' : '#2e7d32';
        }

        // Saldo Final Total
        const saldoFinal = saldoProdubanco + saldoPichincha;
        const saldoFinalCell = document.querySelector(`.fc-saldo-final-dia[data-fecha="${fecha}"]`);
        if (saldoFinalCell) {
            saldoFinalCell.textContent = fc_formatFlujo(saldoFinal);
            saldoFinalCell.style.color = saldoFinal < 0 ? '#c62828' : '#01579b';
        }
    });

    // Calcular totales por semana
    fc_semanas.forEach(sem => {
        let flujoSem = 0;
        let primerSaldoTotal = null;
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
                    const inpProd = document.querySelector('.fc-saldo-produbanco-input');
                    const inpPich = document.querySelector('.fc-saldo-pichincha-input');
                    const prod = parseFloat(inpProd?.value.replace(/,/g, '')) || 0;
                    const pich = parseFloat(inpPich?.value.replace(/,/g, '')) || 0;
                    primerSaldoTotal = prod + pich;
                } else {
                    const cell = document.querySelector(`.fc-saldo-total-dia[data-fecha="${fecha}"]`);
                    if (cell && cell.textContent !== '-') {
                        primerSaldoTotal = parseFloat(cell.textContent.replace(/[()]/g, '').replace(/,/g, '')) || 0;
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

        // Saldo inicial semana (total)
        const siSemCell = document.querySelector(`.fc-saldo-total-sem[data-semana="${sem.num}"]`);
        if (siSemCell) siSemCell.textContent = fc_formatMonto(primerSaldoTotal || 0);

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
    // Buscar la fila header del grupo
    const headerRow = document.getElementById(`fc-grupo-${grupo}`);
    if (!headerRow) {
        console.error('fc_agregarItem: No se encontró header para grupo:', grupo);
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
    const dynRowId = 'fcr-dyn-' + (++fc_row_id_counter);
    newRow.className = `row-banco-item fc-egreso-item-${grupo}`;
    newRow.dataset.grupo = `eg-${grupo}`;
    newRow.dataset.banco = 'produbanco';
    newRow.dataset.fcRowId = dynRowId;

    let celdas = `<td class="col-concepto indent-3">
        <select class="fc-select-banco" onchange="this.closest('tr').dataset.banco=this.value;fc_recalcularTodo()" title="Banco de salida">
            <option value="produbanco" selected>PRO</option>
            <option value="pichincha">PICH</option>
        </select>
        <input type="text" class="fc-input-nombre" value="Nuevo Item">
        <button class="fc-btn-facturas" onclick="event.stopPropagation();fc_abrirFacturas(this.closest('tr'))" title="Facturas pendientes"><span class="fc-icon-fac">F</span><span class="fc-badge-facturas"></span></button>
        <button class="fc-btn-del" onclick="fc_eliminarItem(this)">x</button>
    </td>`;
    // Columna SALDO del item (editable) - después del nombre
    celdas += `<td class="col-saldo monto" style="background:#e3f2fd; min-width:80px;">
        <input type="text" class="fc-input fc-input-saldo" placeholder="0" onchange="fc_recalcularSaldos()" style="width:70px; text-align:right; background:#e3f2fd;">
    </td>`;
    // Columna DÍAS CRÉDITO del item (editable)
    celdas += `<td class="col-dias monto" style="background:#fff3e0; min-width:50px;">
        <input type="number" class="fc-input fc-input-dias" placeholder="0" min="0" max="365" style="width:45px; text-align:center; background:#fff3e0;">
    </td>`;

    semanas.forEach(sem => {
        celdas += `<td class="col-semana sem-${sem.num}-header monto fc-item-sem" data-semana="${sem.num}">-</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            celdas += `<td class="dia-col sem-${sem.num}${sab} monto fc-celda-egreso">
                <input type="text" class="fc-input fc-input-egreso-${grupo}" data-fecha="${dia}" data-semana="${sem.num}" placeholder="0" onchange="fc_recalcularTodo()">
                <button class="fc-btn-rep" onclick="fc_abrirRecurrencia(this)" title="Repetir desde aqui">&#x21bb;</button>
            </td>`;
        });
        celdas += `<td class="dia-col sem-${sem.num} total-col monto fc-item-total" data-semana="${sem.num}">-</td>`;
    });

    newRow.innerHTML = celdas;

    // Encontrar el último item del grupo para insertar después
    const existingItems = document.querySelectorAll(`.fc-egreso-item-${grupo}`);
    if (existingItems.length > 0) {
        const lastItem = existingItems[existingItems.length - 1];
        lastItem.parentNode.insertBefore(newRow, lastItem.nextSibling);
    } else {
        // Si no hay items, insertar después del header
        headerRow.parentNode.insertBefore(newRow, headerRow.nextSibling);
    }

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
    if (!row) return;
    const nombre = row.querySelector('.fc-input-nombre')?.value || 'este item';
    if (!confirm(`¿Eliminar "${nombre}" del flujo de caja?`)) return;
    const rowId = row.dataset.fcRowId;
    if (rowId) delete fc_facturas_data[rowId];
    row.remove();
    fc_recalcularTodo();
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

    // Header con totales integrados
    const headerRow = document.createElement('tr');
    headerRow.className = 'row-banco';
    headerRow.id = `fc-grupo-${grupoId}`;
    headerRow.dataset.grupoHeader = `eg-${grupoId}`;
    headerRow.dataset.expanded = 'true';
    let headerCeldas = `<td class="col-concepto indent-2"><span class="fc-grupo-icon" style="margin-right:6px;">▼</span><input type="text" class="fc-input-nombre" value="NUEVO SUBGRUPO" style="font-weight:bold;text-transform:uppercase;width:120px;"> <button class="fc-btn-add" onclick="event.stopPropagation();fc_agregarItem('${grupoId}')">+</button> <button class="fc-btn-del" onclick="fc_eliminarSubgrupo(this)">x</button></td>`;
    headerCeldas += `<td class="col-saldo monto fc-saldo-grupo-${grupoId}" style="font-weight:600; background:#e3f2fd; min-width:80px;">-</td>`;
    headerCeldas += `<td class="col-dias" style="background:#fff3e0;"></td>`;
    semanas.forEach(sem => {
        headerCeldas += `<td class="col-semana sem-${sem.num}-header monto fc-total-${grupoId}-sem" data-semana="${sem.num}" style="font-weight:600;">-</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            headerCeldas += `<td class="dia-col sem-${sem.num}${sab} monto fc-total-${grupoId}-dia" data-fecha="${dia}" style="font-weight:600;">-</td>`;
        });
        headerCeldas += `<td class="dia-col sem-${sem.num} total-col monto fc-total-${grupoId}-total" data-semana="${sem.num}" style="font-weight:600;">-</td>`;
    });
    headerRow.innerHTML = headerCeldas;
    headerRow.style.cursor = 'pointer';
    headerRow.onclick = function(e) { if (!e.target.closest('input,button,select')) fc_toggleGrupo(`eg-${grupoId}`); };

    // Crear item row con selector de banco
    const itemRow = document.createElement('tr');
    const sgRowId = 'fcr-dyn-' + (++fc_row_id_counter);
    itemRow.className = `row-banco-item fc-egreso-item-${grupoId}`;
    itemRow.dataset.grupo = `eg-${grupoId}`;
    itemRow.dataset.banco = 'produbanco';
    itemRow.dataset.fcRowId = sgRowId;

    let itemHtml = `<td class="col-concepto indent-3">
        <select class="fc-select-banco" onchange="this.closest('tr').dataset.banco=this.value;fc_recalcularTodo()" title="Banco de salida">
            <option value="produbanco" selected>PRO</option>
            <option value="pichincha">PICH</option>
        </select>
        <input type="text" class="fc-input-nombre" value="Item 1">
        <button class="fc-btn-facturas" onclick="event.stopPropagation();fc_abrirFacturas(this.closest('tr'))" title="Facturas pendientes"><span class="fc-icon-fac">F</span><span class="fc-badge-facturas"></span></button>
        <button class="fc-btn-del" onclick="fc_eliminarItem(this)">x</button>
    </td>`;
    itemHtml += `<td class="col-saldo monto" style="background:#e3f2fd; min-width:80px;">
        <input type="text" class="fc-input fc-input-saldo" placeholder="0" onchange="fc_recalcularSaldos()" style="width:70px; text-align:right; background:#e3f2fd;">
    </td>`;
    itemHtml += `<td class="col-dias monto" style="background:#fff3e0; min-width:50px;">
        <input type="number" class="fc-input fc-input-dias" placeholder="0" min="0" max="365" style="width:45px; text-align:center; background:#fff3e0;">
    </td>`;
    semanas.forEach(sem => {
        itemHtml += `<td class="col-semana sem-${sem.num}-header monto fc-item-sem" data-semana="${sem.num}">-</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            itemHtml += `<td class="dia-col sem-${sem.num}${sab} monto fc-celda-egreso">
                <input type="text" class="fc-input fc-input-egreso-${grupoId}" data-fecha="${dia}" data-semana="${sem.num}" placeholder="0" onchange="fc_recalcularTodo()">
                <button class="fc-btn-rep" onclick="fc_abrirRecurrencia(this)" title="Repetir desde aqui">&#x21bb;</button>
            </td>`;
        });
        itemHtml += `<td class="dia-col sem-${sem.num} total-col monto fc-item-total" data-semana="${sem.num}">-</td>`;
    });
    itemRow.innerHTML = itemHtml;

    totalRow.parentNode.insertBefore(headerRow, totalRow);
    totalRow.parentNode.insertBefore(itemRow, totalRow);

    // Aplicar visibilidad correcta a las filas nuevas
    fc_aplicarVisibilidadNuevoItem(headerRow);
    fc_aplicarVisibilidadNuevoItem(itemRow);
}

function fc_eliminarSubgrupo(btn) {
    const headerRow = btn.closest('tr');
    if (!headerRow) return;
    const grupoId = headerRow.id.replace('fc-grupo-', '');

    // Eliminar todos los items del grupo
    document.querySelectorAll(`.fc-egreso-item-${grupoId}`).forEach(r => r.remove());
    // Eliminar el header
    headerRow.remove();

    fc_recalcularTodo();
}

// ============ CARGAR DATOS GUARDADOS ============
async function fc_cargarDatosGuardados() {
    try {
        const semanas = (fc_semanas && fc_semanas.length > 0) ? fc_semanas : window._fc_semanas;
        if (!semanas || semanas.length === 0) return;

        // Solo cargar semanas visibles (evita que items borrados reaparezcan de semanas anteriores)
        const todasLasFechas = semanas.map(s => s.inicio);
        const fechas = todasLasFechas.join(',');
        const response = await fetch(`/api/flujo-caja/cargar-guardado?fechas=${fechas}`);
        if (!response.ok) return;

        const data = await response.json();
        if (!data.ok || !data.guardados) return;

        // Consolidar egresos de todas las semanas antes de aplicar.
        // Orden: por fecha de actualizacion ascendente, para que los campos
        // escalares (saldo, dias, banco, deuda) del guardado MAS RECIENTE ganen.
        const entradasOrdenadas = Object.entries(data.guardados).sort((a, b) =>
            String(a[1].updated_at || '').localeCompare(String(b[1].updated_at || '')));
        const egresosConsolidados = {};
        for (const [fechaSemana, guardado] of entradasOrdenadas) {
            if (guardado.egresos) {
                for (const [grupo, items] of Object.entries(guardado.egresos)) {
                    if (!egresosConsolidados[grupo]) egresosConsolidados[grupo] = [];
                    items.forEach((item, idx) => {
                        // Buscar si ya existe este item por nombre
                        let existente = egresosConsolidados[grupo].find(e => e.nombre === item.nombre);
                        if (!existente) {
                            existente = { nombre: item.nombre, banco: item.banco, deuda: item.deuda || 0, saldo: item.saldo || 0, dias: item.dias || 0, valores: {} };
                            egresosConsolidados[grupo].push(existente);
                        }
                        // Consolidar valores (fechas)
                        for (const [dia, valor] of Object.entries(item.valores || {})) {
                            if (valor) existente.valores[dia] = valor;
                        }
                        // Actualizar banco, deuda, saldo y dias si vienen
                        if (item.banco) existente.banco = item.banco;
                        if (item.deuda) existente.deuda = item.deuda;
                        if (item.saldo) existente.saldo = item.saldo;
                        if (item.dias) existente.dias = item.dias;
                    });
                }
            }
        }

        // Aplicar datos guardados
        for (const [fechaSemana, guardado] of Object.entries(data.guardados)) {
            // Aplicar saldos iniciales por banco (solo primera semana)
            if (semanas[0].inicio === fechaSemana) {
                console.log('Cargando saldos guardados:', guardado.saldo_produbanco, guardado.saldo_pichincha);
                if (guardado.saldo_produbanco != null) {
                    const inputProdubanco = document.querySelector('.fc-saldo-produbanco-input');
                    if (inputProdubanco) {
                        inputProdubanco.value = guardado.saldo_produbanco;
                        console.log('Saldo Produbanco aplicado:', guardado.saldo_produbanco);
                    }
                }
                if (guardado.saldo_pichincha != null) {
                    const inputPichincha = document.querySelector('.fc-saldo-pichincha-input');
                    if (inputPichincha) {
                        inputPichincha.value = guardado.saldo_pichincha;
                        console.log('Saldo Pichincha aplicado:', guardado.saldo_pichincha);
                    }
                }
                // Compatibilidad con datos antiguos (saldo_inicial único)
                if (guardado.saldo_inicial && !guardado.saldo_produbanco) {
                    const inputProdubanco = document.querySelector('.fc-saldo-produbanco-input');
                    if (inputProdubanco) inputProdubanco.value = guardado.saldo_inicial;
                }
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

            // Aplicar plataformas
            if (guardado.plataformas) {
                console.log('Cargando plataformas:', guardado.plataformas);
                for (const [plat, valores] of Object.entries(guardado.plataformas)) {
                    for (const [dia, valor] of Object.entries(valores)) {
                        const input = document.querySelector(`.fc-plataforma-${plat}[data-fecha="${dia}"]`);
                        if (input && valor != null && valor > 0) {
                            input.value = valor;
                            console.log(`Plataforma ${plat} ${dia} = ${valor}`);
                        }
                    }
                }
            }

            // Egresos se aplican después del loop con datos consolidados
        }

        // Aplicar egresos consolidados (fuera del loop para evitar duplicados)
        for (const [grupo, items] of Object.entries(egresosConsolidados)) {
            // Crear items faltantes (con tope de intentos para evitar bucle infinito
            // si el grupo no existe en la pagina y fc_agregarItem no puede crear filas)
            let rows = document.querySelectorAll(`.fc-egreso-item-${grupo}`);
            let intentos = 0;
            while (rows.length < items.length && intentos < items.length + 5) {
                fc_agregarItem(grupo);
                intentos++;
                rows = document.querySelectorAll(`.fc-egreso-item-${grupo}`);
            }
            if (rows.length < items.length) {
                console.warn(`Grupo ${grupo}: no se pudieron crear todas las filas (${rows.length}/${items.length})`);
            }

            items.forEach((item, idx) => {
                if (rows[idx]) {
                    const nombreInput = rows[idx].querySelector('.fc-input-nombre');
                    if (nombreInput && item.nombre) nombreInput.value = item.nombre;

                    // Aplicar banco seleccionado
                    if (item.banco) {
                        rows[idx].dataset.banco = item.banco;
                        const select = rows[idx].querySelector('.fc-select-banco');
                        if (select) select.value = item.banco;
                    }

                    // Aplicar deuda guardada
                    if (item.deuda) {
                        rows[idx].dataset.deuda = item.deuda;
                        fc_actualizarBadgeDeuda(rows[idx]);
                    }

                    // Aplicar saldo guardado
                    if (item.saldo) {
                        const saldoInput = rows[idx].querySelector('.fc-input-saldo');
                        if (saldoInput) saldoInput.value = item.saldo;
                    }

                    // Aplicar días de crédito guardados
                    if (item.dias) {
                        const diasInput = rows[idx].querySelector('.fc-input-dias');
                        if (diasInput) diasInput.value = item.dias;
                    }

                    // Cargar facturas pendientes
                    if (item.facturas && item.facturas.length > 0) {
                        const loadedRowId = rows[idx].dataset.fcRowId;
                        if (loadedRowId) {
                            fc_facturas_data[loadedRowId] = item.facturas;
                            fc_actualizarBadgeFacturas(rows[idx]);
                        }
                    }

                    // Aplicar valores de TODAS las fechas consolidadas
                    for (const [dia, valor] of Object.entries(item.valores || {})) {
                        const input = rows[idx].querySelector(`[data-fecha="${dia}"].fc-input`);
                        if (input && valor) input.value = valor;
                    }
                }
            });
        }
    } catch (error) {
        console.error('Error cargando datos guardados:', error);
    }
}

// ============ GUARDAR DATOS ============
let fc_guardando = false;
async function fc_guardarDatos() {
    if (fc_guardando) {
        alert('Ya hay un guardado en curso, espere a que termine');
        return;
    }
    const semanas = (fc_semanas && fc_semanas.length > 0) ? fc_semanas : window._fc_semanas;
    if (!semanas || semanas.length === 0) {
        alert('No hay datos para guardar');
        return;
    }

    fc_guardando = true;
    try {
        // Guardar cada semana por separado
        for (const sem of semanas) {
            const fechaSemana = sem.inicio;
            const semanaNum = sem.num;

            // Recoger saldos iniciales por banco (solo para primera semana)
            let saldoProdubanco = 0;
            let saldoPichincha = 0;
            if (sem === semanas[0]) {
                const inputProdubanco = document.querySelector('.fc-saldo-produbanco-input');
                if (inputProdubanco) saldoProdubanco = parseFloat(inputProdubanco.value.replace(/,/g, '')) || 0;
                const inputPichincha = document.querySelector('.fc-saldo-pichincha-input');
                if (inputPichincha) saldoPichincha = parseFloat(inputPichincha.value.replace(/,/g, '')) || 0;
            }

            // Recoger ajustes
            const ajustes_tc = {};
            const ajustes_efectivo = {};
            const ajustes_deuna = {};
            const traspasos = {};

            // Plataformas
            const plataformas = { uber: {}, rappi: {}, pedidosya: {} };

            sem.dias.forEach(dia => {
                const ajTc = document.querySelector(`.fc-ajuste-tc[data-fecha="${dia}"]`);
                if (ajTc && ajTc.value) ajustes_tc[dia] = parseFloat(ajTc.value.replace(/,/g, '')) || 0;

                const ajEf = document.querySelector(`.fc-ajuste-efectivo[data-fecha="${dia}"]`);
                if (ajEf && ajEf.value) ajustes_efectivo[dia] = parseFloat(ajEf.value.replace(/,/g, '')) || 0;

                const ajDeuna = document.querySelector(`.fc-ajuste-deuna[data-fecha="${dia}"]`);
                if (ajDeuna && ajDeuna.value) ajustes_deuna[dia] = parseFloat(ajDeuna.value.replace(/,/g, '')) || 0;

                const traspaso = document.querySelector(`.fc-input-traspaso[data-fecha="${dia}"]`);
                if (traspaso && traspaso.value) traspasos[dia] = parseFloat(traspaso.value.replace(/,/g, '')) || 0;

                // Plataformas - guardar valores no vacíos
                ['uber', 'rappi', 'pedidosya'].forEach(plat => {
                    const inp = document.querySelector(`.fc-plataforma-${plat}[data-fecha="${dia}"]`);
                    if (inp && inp.value && inp.value.trim() !== '' && inp.value !== '0') {
                        const val = parseFloat(inp.value.replace(/,/g, '')) || 0;
                        if (val > 0) plataformas[plat][dia] = val;
                    }
                });
            });

            // Recoger egresos (todos los items con sus valores)
            const egresos = {};
            document.querySelectorAll('[class*="fc-egreso-item-"]').forEach(row => {
                const nombreInput = row.querySelector('.fc-input-nombre');
                const nombre = nombreInput ? nombreInput.value : 'Item';
                const clase = Array.from(row.classList).find(c => c.startsWith('fc-egreso-item-'));
                const grupo = clase ? clase.replace('fc-egreso-item-', '') : 'otros';

                if (!egresos[grupo]) egresos[grupo] = [];

                const banco = row.dataset.banco || 'produbanco';
                const deuda = parseFloat(row.dataset.deuda) || 0;
                const saldoInput = row.querySelector('.fc-input-saldo');
                const saldo = saldoInput ? (parseFloat(saldoInput.value.replace(/,/g, '')) || 0) : 0;
                const diasInput = row.querySelector('.fc-input-dias');
                const dias = diasInput ? (parseInt(diasInput.value) || 0) : 0;
                const rowId = row.dataset.fcRowId || '';
                const facturas = rowId ? (fc_facturas_data[rowId] || []) : [];
                const itemData = { nombre, banco, deuda, saldo, dias, valores: {}, facturas };
                sem.dias.forEach(dia => {
                    const input = row.querySelector(`[data-fecha="${dia}"].fc-input`);
                    if (input && input.value) {
                        itemData.valores[dia] = parseFloat(input.value.replace(/,/g, '')) || 0;
                    }
                });
                egresos[grupo].push(itemData);
            });

            // PROTECCION: no sobrescribir una semana guardada con datos vacios.
            // Una semana se considera vacia si no tiene ningun valor de egreso,
            // ajuste, traspaso, plataforma ni saldo/dias en items.
            const tieneValoresEgresos = Object.values(egresos).some(items =>
                items.some(it => Object.keys(it.valores).length > 0 || it.saldo > 0 || it.dias > 0 || it.deuda > 0));
            const tieneAjustes = Object.keys(ajustes_tc).length || Object.keys(ajustes_efectivo).length ||
                Object.keys(ajustes_deuna).length || Object.keys(traspasos).length ||
                Object.values(plataformas).some(p => Object.keys(p).length);
            const tieneSaldos = (sem === semanas[0]) && (saldoProdubanco !== 0 || saldoPichincha !== 0);
            if (!tieneValoresEgresos && !tieneAjustes && !tieneSaldos) {
                console.log(`Semana ${semanaNum} (${fechaSemana}) sin datos - se omite para no sobrescribir`);
                continue;
            }

            // Enviar al servidor
            const response = await fetch('/api/flujo-caja/guardar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fecha_semana: fechaSemana,
                    semana_num: semanaNum,
                    saldo_produbanco: saldoProdubanco,
                    saldo_pichincha: saldoPichincha,
                    ajustes_tc,
                    ajustes_efectivo,
                    ajustes_deuna,
                    traspasos,
                    plataformas,
                    egresos,
                    usuario: 'admin'
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Error al guardar');
            }
        }

        alert('Datos guardados correctamente');

    } catch (error) {
        console.error('Error guardando:', error);
        alert('Error al guardar: ' + error.message);
    } finally {
        fc_guardando = false;
    }
}

// ============ DESCARGAR EXCEL ============
function fc_descargarExcel() {
    const tabla = document.getElementById('fc-tabla');
    if (!tabla) {
        alert('No hay datos para exportar. Haga clic en Consultar primero.');
        return;
    }

    // Expandir todo antes de exportar para capturar todos los datos
    fc_expandirTodo();
    fc_expandirFilas();

    // Crear workbook usando SheetJS (incluido en la pagina)
    const wb = XLSX.utils.book_new();

    // Obtener todas las filas de la tabla (incluyendo ocultas por grupo)
    const rows = tabla.querySelectorAll('tr');
    const data = [];

    rows.forEach(row => {
        // Saltar filas ocultas por toggle de grupo
        if (row.style.display === 'none') return;

        const rowData = [];
        const cells = row.querySelectorAll('th, td');
        cells.forEach(cell => {
            // Solo incluir celdas visibles (no las colapsadas de semana)
            const style = window.getComputedStyle(cell);
            if (style.display === 'none') return;

            // Si hay input, tomar su valor
            const input = cell.querySelector('input');
            if (input) {
                rowData.push(input.value || '');
            } else {
                rowData.push(cell.textContent.trim());
            }
        });
        if (rowData.length > 0) {
            data.push(rowData);
        }
    });

    const ws = XLSX.utils.aoa_to_sheet(data);

    // Ajustar anchos de columna
    ws['!cols'] = [{ wch: 25 }];  // Primera columna mas ancha
    for (let i = 1; i < 50; i++) {
        ws['!cols'].push({ wch: 12 });
    }

    XLSX.utils.book_append_sheet(wb, ws, 'Flujo de Caja');

    // Generar nombre de archivo con fecha
    const fechaCorte = document.getElementById('fc-fecha-corte')?.value || '';
    const nombreArchivo = `Flujo_Caja_${fechaCorte || 'export'}.xlsx`;

    XLSX.writeFile(wb, nombreArchivo);
}

// ============ TOGGLE FILAS POR GRUPO ============
function fc_toggleGrupo(grupoId) {
    const header = document.querySelector(`[data-grupo-header="${grupoId}"]`);
    if (!header) return;

    const items = document.querySelectorAll(`[data-grupo="${grupoId}"]`);
    const expanded = header.dataset.expanded !== 'false';

    if (expanded) {
        items.forEach(row => row.style.display = 'none');
        header.dataset.expanded = 'false';
        const icon = header.querySelector('.fc-grupo-icon');
        if (icon) icon.textContent = '▶';
    } else {
        items.forEach(row => row.style.display = '');
        header.dataset.expanded = 'true';
        const icon = header.querySelector('.fc-grupo-icon');
        if (icon) icon.textContent = '▼';
    }
}

function fc_expandirFilas() {
    // Buscar todas las filas de items (ingresos y egresos) y mostrarlas
    document.querySelectorAll('[data-grupo]').forEach(row => row.style.display = '');

    // Actualizar iconos de headers
    document.querySelectorAll('.fc-grupo-icon').forEach(icon => icon.textContent = '▼');
    document.querySelectorAll('[data-grupo-header]').forEach(h => h.dataset.expanded = 'true');
}

function fc_colapsarFilas() {
    // Buscar todas las filas de items (ingresos y egresos) y ocultarlas
    document.querySelectorAll('[data-grupo]').forEach(row => row.style.display = 'none');

    // Actualizar iconos de headers
    document.querySelectorAll('.fc-grupo-icon').forEach(icon => icon.textContent = '▶');
    document.querySelectorAll('[data-grupo-header]').forEach(h => h.dataset.expanded = 'false');
}

// ============ CONTROL DE DEUDA ============
let fc_deuda_row = null;

function fc_abrirDeuda(badge) {
    fc_deuda_row = badge.closest('tr');
    if (!fc_deuda_row) return;

    const deudaActual = parseFloat(fc_deuda_row.dataset.deuda) || 0;
    const nombre = fc_deuda_row.querySelector('.fc-input-nombre')?.value || 'Item';

    // Calcular total pagos
    let totalPagos = 0;
    fc_deuda_row.querySelectorAll('.fc-input').forEach(inp => {
        totalPagos += parseFloat(inp.value.replace(/,/g, '')) || 0;
    });

    const saldo = deudaActual - totalPagos;

    // Crear popup inline
    let popup = document.getElementById('fc-popup-deuda');
    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'fc-popup-deuda';
        popup.innerHTML = `
            <div class="fc-popup-deuda-content">
                <div class="fc-popup-header">Control de Deuda</div>
                <div class="fc-popup-nombre"></div>
                <div class="fc-popup-row">
                    <label>Deuda Total:</label>
                    <input type="text" id="fc-deuda-valor" placeholder="0">
                </div>
                <div class="fc-popup-row fc-popup-info">
                    <span>Pagos programados:</span>
                    <span id="fc-deuda-pagos">$0</span>
                </div>
                <div class="fc-popup-row fc-popup-info">
                    <span>Saldo pendiente:</span>
                    <span id="fc-deuda-saldo">$0</span>
                </div>
                <div class="fc-popup-btns">
                    <button onclick="fc_cerrarDeuda()">Cancelar</button>
                    <button onclick="fc_guardarDeuda()" class="primary">Guardar</button>
                </div>
            </div>
        `;
        document.body.appendChild(popup);

        // Cerrar al hacer clic fuera
        popup.addEventListener('click', (e) => {
            if (e.target === popup) fc_cerrarDeuda();
        });

        // Recalcular saldo al cambiar deuda
        document.getElementById('fc-deuda-valor').addEventListener('input', function() {
            const d = parseFloat(this.value.replace(/,/g, '')) || 0;
            let p = 0;
            if (fc_deuda_row) {
                fc_deuda_row.querySelectorAll('.fc-input').forEach(inp => {
                    p += parseFloat(inp.value.replace(/,/g, '')) || 0;
                });
            }
            const s = d - p;
            document.getElementById('fc-deuda-saldo').textContent = '$' + s.toLocaleString('en-US', {minimumFractionDigits: 2});
            document.getElementById('fc-deuda-saldo').style.color = s > 0 ? '#c62828' : '#2e7d32';
        });
    }

    // Llenar datos
    popup.querySelector('.fc-popup-nombre').textContent = nombre;
    document.getElementById('fc-deuda-valor').value = deudaActual > 0 ? deudaActual : '';
    document.getElementById('fc-deuda-pagos').textContent = '$' + totalPagos.toLocaleString('en-US', {minimumFractionDigits: 2});
    document.getElementById('fc-deuda-saldo').textContent = '$' + saldo.toLocaleString('en-US', {minimumFractionDigits: 2});
    document.getElementById('fc-deuda-saldo').style.color = saldo > 0 ? '#c62828' : '#2e7d32';

    popup.classList.add('active');
    document.getElementById('fc-deuda-valor').focus();
}

function fc_cerrarDeuda() {
    const popup = document.getElementById('fc-popup-deuda');
    if (popup) popup.classList.remove('active');
    fc_deuda_row = null;
}

function fc_guardarDeuda() {
    if (!fc_deuda_row) return;

    const deuda = parseFloat(document.getElementById('fc-deuda-valor').value.replace(/,/g, '')) || 0;
    fc_deuda_row.dataset.deuda = deuda;

    // Actualizar badge
    fc_actualizarBadgeDeuda(fc_deuda_row);

    fc_cerrarDeuda();
}

function fc_actualizarBadgeDeuda(row) {
    const badge = row.querySelector('.fc-saldo-badge');
    if (!badge) return;

    const deuda = parseFloat(row.dataset.deuda) || 0;
    let totalPagos = 0;
    row.querySelectorAll('.fc-input').forEach(inp => {
        totalPagos += parseFloat(inp.value.replace(/,/g, '')) || 0;
    });

    const saldo = deuda - totalPagos;

    badge.className = 'fc-saldo-badge';
    if (deuda === 0) {
        badge.textContent = '';
    } else if (saldo <= 0) {
        badge.classList.add('pagado');
        badge.textContent = '';
    } else {
        badge.classList.add('tiene-deuda');
        badge.textContent = saldo >= 1000 ? Math.round(saldo/1000) + 'k' : Math.round(saldo);
    }
}

function fc_recalcularTodosSaldos() {
    document.querySelectorAll('[data-deuda]').forEach(row => {
        fc_actualizarBadgeDeuda(row);
    });
}

// ============ RECALCULAR SALDOS DE PROVEEDORES ============
function fc_recalcularSaldos() {
    // Recalcular saldo de cada item: Saldo = Deuda ingresada - Pagos realizados
    const grupos = {};

    document.querySelectorAll('[class*="fc-egreso-item-"]').forEach(row => {
        const saldoInput = row.querySelector('.fc-input-saldo');
        if (!saldoInput) return;

        const saldoIngresado = parseFloat(saldoInput.value.replace(/,/g, '')) || 0;

        // Sumar todos los pagos de esta fila
        let totalPagos = 0;
        row.querySelectorAll('.fc-input[data-fecha]').forEach(inp => {
            totalPagos += parseFloat(inp.value.replace(/,/g, '')) || 0;
        });

        // Calcular saldo restante
        const saldoRestante = saldoIngresado - totalPagos;

        // Guardar en dataset para uso posterior
        row.dataset.saldoIngresado = saldoIngresado;
        row.dataset.saldoRestante = saldoRestante;

        // Mostrar "resta por pagar" debajo del input (el input conserva el total digitado)
        const saldoCell = saldoInput.closest('td');
        let restaEl = saldoCell ? saldoCell.querySelector('.fc-saldo-resta') : null;
        if (saldoIngresado > 0) {
            if (!restaEl && saldoCell) {
                restaEl = document.createElement('div');
                restaEl.className = 'fc-saldo-resta';
                restaEl.style.cssText = 'font-size:9px; font-weight:600; text-align:right; margin-top:2px;';
                saldoCell.appendChild(restaEl);
            }
            if (restaEl) {
                if (saldoRestante <= 0) {
                    restaEl.textContent = 'Pagado';
                    restaEl.style.color = '#2e7d32';
                } else {
                    restaEl.textContent = 'Resta: ' + fc_formatMonto(saldoRestante);
                    restaEl.style.color = '#c62828';
                }
            }
        } else if (restaEl) {
            restaEl.remove();
        }

        // Actualizar color del input según saldo
        if (saldoIngresado > 0) {
            if (saldoRestante <= 0) {
                saldoInput.style.color = '#2e7d32'; // Verde - pagado
            } else {
                saldoInput.style.color = '#c62828'; // Rojo - pendiente
            }
        } else {
            saldoInput.style.color = '#333';
        }

        // Agrupar por grupo
        const clase = Array.from(row.classList).find(c => c.startsWith('fc-egreso-item-'));
        const grupo = clase ? clase.replace('fc-egreso-item-', '') : 'otros';
        if (!grupos[grupo]) grupos[grupo] = 0;
        grupos[grupo] += saldoRestante;
    });

    // Actualizar totales de grupos
    for (const [grupo, total] of Object.entries(grupos)) {
        const celda = document.querySelector(`.fc-saldo-grupo-${grupo}`);
        if (celda) {
            celda.textContent = total > 0 ? fc_formatMonto(total) : '-';
            celda.style.color = total > 0 ? '#c62828' : '#2e7d32';
        }
    }
}

// ============ RECURRENCIA DE GASTOS ============
let fc_recurrente_input = null;
let fc_recurrente_fecha = null;
let fc_recurrente_row = null;

function fc_abrirRecurrencia(btn) {
    const celda = btn.closest('td');
    const input = celda.querySelector('input');
    fc_recurrente_input = input;
    fc_recurrente_fecha = input.dataset.fecha;
    fc_recurrente_row = btn.closest('tr');

    const valor = parseFloat(input.value.replace(/,/g, '')) || 0;

    // Crear modal si no existe
    let modal = document.getElementById('fc-modal-recurrente');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'fc-modal-recurrente';
        modal.innerHTML = `
            <div class="fc-modal-overlay" onclick="fc_cerrarModalRecurrente()"></div>
            <div class="fc-modal-content">
                <div class="fc-modal-header">
                    <span class="fc-modal-icon">&#x21bb;</span>
                    <div>
                        <h3>Repetir valor</h3>
                        <p class="fc-fecha-inicio">Desde <strong id="fc-fecha-desde"></strong> en adelante</p>
                    </div>
                    <button class="fc-modal-close" onclick="fc_cerrarModalRecurrente()">&times;</button>
                </div>
                <div class="fc-modal-body">
                    <div class="fc-rec-grid">
                        <label class="fc-rec-option">
                            <input type="radio" name="fc-tipo-rec" value="dia-semana" checked>
                            <div class="fc-rec-card">
                                <span class="fc-rec-title">Semanal</span>
                                <span class="fc-rec-desc" id="fc-info-dia-semana">Cada lunes</span>
                            </div>
                        </label>
                        <label class="fc-rec-option">
                            <input type="radio" name="fc-tipo-rec" value="quincenal">
                            <div class="fc-rec-card">
                                <span class="fc-rec-title">Quincenal</span>
                                <span class="fc-rec-desc">Cada 15 dias</span>
                            </div>
                        </label>
                        <label class="fc-rec-option">
                            <input type="radio" name="fc-tipo-rec" value="dia-mes">
                            <div class="fc-rec-card">
                                <span class="fc-rec-title">Mensual</span>
                                <span class="fc-rec-desc" id="fc-info-dia-mes">Dia 15</span>
                            </div>
                        </label>
                        <label class="fc-rec-option">
                            <input type="radio" name="fc-tipo-rec" value="ultimo-mes">
                            <div class="fc-rec-card">
                                <span class="fc-rec-title">Fin de mes</span>
                                <span class="fc-rec-desc">Ultimo dia</span>
                            </div>
                        </label>
                        <label class="fc-rec-option">
                            <input type="radio" name="fc-tipo-rec" value="ordinal-mes">
                            <div class="fc-rec-card">
                                <span class="fc-rec-title">Ordinal</span>
                                <span class="fc-rec-desc" id="fc-info-ordinal">2do Lunes</span>
                            </div>
                        </label>
                        <label class="fc-rec-option">
                            <input type="radio" name="fc-tipo-rec" value="dias-habiles">
                            <div class="fc-rec-card">
                                <span class="fc-rec-title">Dias habiles</span>
                                <span class="fc-rec-desc">Lun a Vie</span>
                            </div>
                        </label>
                        <label class="fc-rec-option">
                            <input type="radio" name="fc-tipo-rec" value="anual">
                            <div class="fc-rec-card">
                                <span class="fc-rec-title">Anual</span>
                                <span class="fc-rec-desc" id="fc-info-anual">Mismo dia</span>
                            </div>
                        </label>
                    </div>
                    <div class="fc-rec-valor">
                        <span>$</span>
                        <input type="text" id="fc-valor-recurrente" placeholder="0.00">
                    </div>
                </div>
                <div class="fc-modal-footer">
                    <button onclick="fc_cerrarModalRecurrente()" class="fc-btn-cancelar">Cancelar</button>
                    <button onclick="fc_aplicarRecurrencia()" class="fc-btn-aplicar">Aplicar</button>
                </div>
            </div>
        `;
        modal.className = 'fc-modal';
        document.body.appendChild(modal);

        fc_asegurarEstilosFlujo();
    }

    fc_prepararModalRecurrencia(modal, valor);
}

// Estilos del modulo (badge $, boton de recurrencia oculto hasta hover, popups).
// Se inyectan desde fc_renderTabla para que el diseño sea consistente desde el
// inicio, no solo despues de abrir el modal de recurrencia.
function fc_asegurarEstilosFlujo() {
    if (document.getElementById('fc-modal-styles')) return;
    const styles = document.createElement('style');
    styles.id = 'fc-modal-styles';
    styles.textContent = `
                .fc-modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 9999; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
                .fc-modal.active { display: block; }
                .fc-modal-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); }
                .fc-modal-content { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; border-radius: 12px; width: 320px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); overflow: hidden; }
                .fc-modal-header { display: flex; align-items: center; gap: 10px; padding: 12px 15px; background: linear-gradient(135deg, #1565c0, #1976d2); color: white; }
                .fc-modal-icon { font-size: 18px; background: rgba(255,255,255,0.2); padding: 6px; border-radius: 8px; }
                .fc-modal-header h3 { margin: 0; font-size: 14px; font-weight: 600; }
                .fc-fecha-inicio { margin: 2px 0 0; font-size: 11px; opacity: 0.9; }
                .fc-modal-close { margin-left: auto; background: none; border: none; color: white; font-size: 20px; cursor: pointer; opacity: 0.7; padding: 0 5px; }
                .fc-modal-close:hover { opacity: 1; }
                .fc-modal-body { padding: 15px; }
                .fc-rec-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
                .fc-rec-option { cursor: pointer; }
                .fc-rec-option input { display: none; }
                .fc-rec-card { display: flex; flex-direction: column; padding: 10px; border: 1.5px solid #e0e0e0; border-radius: 8px; transition: all 0.15s; }
                .fc-rec-option input:checked + .fc-rec-card { border-color: #1565c0; background: #e3f2fd; }
                .fc-rec-card:hover { border-color: #90caf9; }
                .fc-rec-title { font-size: 11px; font-weight: 600; color: #333; }
                .fc-rec-desc { font-size: 10px; color: #666; margin-top: 2px; }
                .fc-rec-valor { display: flex; align-items: center; margin-top: 15px; padding-top: 12px; border-top: 1px solid #eee; gap: 5px; }
                .fc-rec-valor span { font-size: 16px; color: #666; font-weight: 500; }
                .fc-rec-valor input { flex: 1; padding: 10px; font-size: 16px; font-weight: 600; border: 1.5px solid #e0e0e0; border-radius: 8px; text-align: right; }
                .fc-rec-valor input:focus { outline: none; border-color: #1565c0; }
                .fc-modal-footer { display: flex; gap: 8px; padding: 0 15px 15px; }
                .fc-modal-footer button { flex: 1; padding: 10px; border: none; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.15s; }
                .fc-btn-cancelar { background: #f5f5f5; color: #666; }
                .fc-btn-cancelar:hover { background: #e0e0e0; }
                .fc-btn-aplicar { background: #1565c0; color: white; }
                .fc-btn-aplicar:hover { background: #0d47a1; }
                .fc-celda-egreso { position: relative; }
                .fc-btn-rep { position: absolute; right: 1px; top: 1px; background: transparent; border: none; cursor: pointer; padding: 0; font-size: 8px; opacity: 0; transition: all 0.2s; color: #90caf9; width: 12px; height: 12px; display: flex; align-items: center; justify-content: center; border-radius: 2px; }
                .fc-celda-egreso:hover .fc-btn-rep { opacity: 0.6; }
                .fc-btn-rep:hover { opacity: 1 !important; background: #1565c0; color: white; }
                .fc-celda-egreso input { width: 100%; padding-right: 12px; box-sizing: border-box; }
                .fc-saldo-badge { display: inline-block; min-width: 22px; height: 20px; line-height: 20px; text-align: center; font-size: 11px; font-weight: 600; border-radius: 4px; cursor: pointer; margin-left: 6px; vertical-align: middle; transition: all 0.15s; }
                .fc-saldo-badge:empty { background: #f0f0f0; border: 1.5px dashed #ccc; }
                .fc-saldo-badge:empty:hover { background: #e3f2fd; border-color: #1565c0; transform: scale(1.05); }
                .fc-saldo-badge:empty::before { content: '$'; color: #999; font-size: 11px; }
                .fc-saldo-badge.tiene-deuda { background: linear-gradient(135deg, #ffcdd2, #ef9a9a); color: #b71c1c; padding: 0 6px; border: none; box-shadow: 0 1px 3px rgba(198,40,40,0.2); }
                .fc-saldo-badge.pagado { background: linear-gradient(135deg, #c8e6c9, #a5d6a7); color: #1b5e20; border: none; box-shadow: 0 1px 3px rgba(46,125,50,0.2); }
                .fc-saldo-badge.pagado::before { content: '✓'; font-size: 12px; }
                #fc-popup-deuda { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.3); z-index: 9999; }
                #fc-popup-deuda.active { display: flex; align-items: center; justify-content: center; }
                .fc-popup-deuda-content { background: white; border-radius: 10px; padding: 16px; width: 240px; box-shadow: 0 8px 30px rgba(0,0,0,0.2); }
                .fc-popup-header { font-size: 12px; font-weight: 600; color: #1565c0; margin-bottom: 8px; }
                .fc-popup-nombre { font-size: 14px; font-weight: 500; color: #333; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #eee; }
                .fc-popup-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
                .fc-popup-row label { font-size: 11px; color: #666; }
                .fc-popup-row input { width: 100px; padding: 6px 8px; border: 1.5px solid #e0e0e0; border-radius: 6px; font-size: 14px; text-align: right; }
                .fc-popup-row input:focus { outline: none; border-color: #1565c0; }
                .fc-popup-info { font-size: 11px; color: #888; }
                .fc-popup-info span:last-child { font-weight: 600; }
                .fc-popup-btns { display: flex; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #eee; }
                .fc-popup-btns button { flex: 1; padding: 8px; border: none; border-radius: 6px; font-size: 11px; cursor: pointer; }
                .fc-popup-btns button:first-child { background: #f5f5f5; color: #666; }
                .fc-popup-btns button.primary { background: #1565c0; color: white; }
    `;
    document.head.appendChild(styles);
}

function fc_prepararModalRecurrencia(modal, valor) {
    // Llenar info de la fecha seleccionada
    const d = new Date(fc_recurrente_fecha + 'T12:00:00');
    const dias = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
    const diasFull = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
    const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const diaSemana = dias[d.getDay()];
    const diaSemanaFull = diasFull[d.getDay()];
    const diaMes = d.getDate();
    const ordinal = Math.ceil(diaMes / 7);
    const ordinalTxt = ['', '1er', '2do', '3er', '4to', '5to'][ordinal];

    document.getElementById('fc-fecha-desde').textContent = `${diaSemanaFull} ${diaMes} ${meses[d.getMonth()]}`;
    document.getElementById('fc-info-dia-mes').textContent = `Dia ${diaMes}`;
    document.getElementById('fc-info-dia-semana').textContent = `Cada ${diaSemana}`;
    document.getElementById('fc-info-ordinal').textContent = `${ordinalTxt} ${diaSemana}`;
    document.getElementById('fc-info-anual').textContent = `${diaMes} ${meses[d.getMonth()]}`;
    document.getElementById('fc-valor-recurrente').value = valor > 0 ? valor : '';

    modal.classList.add('active');
    setTimeout(() => document.getElementById('fc-valor-recurrente').focus(), 100);
}

function fc_cerrarModalRecurrente() {
    const modal = document.getElementById('fc-modal-recurrente');
    if (modal) modal.classList.remove('active');
    fc_recurrente_input = null;
    fc_recurrente_fecha = null;
    fc_recurrente_row = null;
}

function fc_aplicarRecurrencia() {
    if (!fc_recurrente_row || !fc_recurrente_fecha) return;

    const tipo = document.querySelector('input[name="fc-tipo-rec"]:checked').value;
    const valor = parseFloat(document.getElementById('fc-valor-recurrente').value.replace(/,/g, '')) || 0;

    if (valor <= 0) {
        alert('Ingrese un valor mayor a 0');
        return;
    }

    const semanas = (fc_semanas && fc_semanas.length > 0) ? fc_semanas : window._fc_semanas;
    if (!semanas || semanas.length === 0) {
        alert('No hay datos de semanas');
        return;
    }

    const fechaInicio = new Date(fc_recurrente_fecha + 'T12:00:00');
    const diaMesInicio = fechaInicio.getDate();
    const diaSemanaInicio = fechaInicio.getDay(); // 0=dom, 1=lun...
    const ordinalInicio = Math.ceil(diaMesInicio / 7);

    let fechasAplicar = [];

    // Recopilar todas las fechas en orden
    let todasFechas = [];
    semanas.forEach(sem => {
        sem.dias.forEach(fecha => todasFechas.push(fecha));
    });
    todasFechas.sort();

    // Filtrar solo fechas >= fecha inicio
    todasFechas = todasFechas.filter(f => f >= fc_recurrente_fecha);

    let diasDesdeInicio = 0;
    todasFechas.forEach(fecha => {
        const d = new Date(fecha + 'T12:00:00');
        const diffTime = d - fechaInicio;
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

        if (tipo === 'dia-mes') {
            // Mismo dia del mes
            if (d.getDate() === diaMesInicio) {
                fechasAplicar.push(fecha);
            }
        } else if (tipo === 'dia-semana') {
            // Mismo dia de la semana
            if (d.getDay() === diaSemanaInicio) {
                fechasAplicar.push(fecha);
            }
        } else if (tipo === 'ordinal-mes') {
            // Mismo ordinal (ej: tercer miercoles)
            if (d.getDay() === diaSemanaInicio) {
                const ordinal = Math.ceil(d.getDate() / 7);
                if (ordinal === ordinalInicio) {
                    fechasAplicar.push(fecha);
                }
            }
        } else if (tipo === 'quincenal') {
            // Cada 15 dias desde la fecha inicio
            if (diffDays % 15 === 0) {
                fechasAplicar.push(fecha);
            }
        } else if (tipo === 'ultimo-mes') {
            // Ultimo dia de cada mes
            const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
            if (d.getDate() === ultimoDia) {
                fechasAplicar.push(fecha);
            }
        } else if (tipo === 'dias-habiles') {
            // Lunes a Viernes (1-5)
            const dow = d.getDay();
            if (dow >= 1 && dow <= 5) {
                fechasAplicar.push(fecha);
            }
        } else if (tipo === 'anual') {
            // Mismo dia y mes cada año
            if (d.getDate() === diaMesInicio && d.getMonth() === fechaInicio.getMonth()) {
                fechasAplicar.push(fecha);
            }
        }
    });

    // Aplicar valor a las fechas en esta fila
    let aplicados = 0;
    fechasAplicar.forEach(fecha => {
        const input = fc_recurrente_row.querySelector(`input[data-fecha="${fecha}"]`);
        if (input) {
            input.value = valor;
            aplicados++;
        }
    });

    fc_recalcularTodo();
    fc_cerrarModalRecurrente();

    alert(`$${valor} aplicado a ${aplicados} fecha(s) desde ${fc_recurrente_fecha}`);
}

// ============ FACTURAS POR PROVEEDOR ============
let fc_facturas_data = {}; // key: rowId -> [{num, fecha, monto, vencimiento, fecha_pago}]
let fc_row_id_counter = 1000;

function fc_getFacturas(rowId) {
    if (!fc_facturas_data[rowId]) fc_facturas_data[rowId] = [];
    return fc_facturas_data[rowId];
}

// Abrir modal de facturas para un item de egreso
function fc_abrirFacturas(row) {
    const rowId = row.dataset.fcRowId;
    if (!rowId) return;
    const nombre = row.querySelector('.fc-input-nombre')?.value || 'Proveedor';
    const facturas = fc_getFacturas(rowId);

    // Opciones de fecha desde semanas visibles
    const meses = ['','ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    const diasSem = ['Dom','Lun','Mar','Mie','Jue','Vie','Sab'];
    let opcionesFechas = '<option value="">-- Pendiente --</option>';
    fc_todasFechas.forEach(f => {
        const d = new Date(f + 'T12:00:00');
        opcionesFechas += `<option value="${f}">${diasSem[d.getDay()]} ${d.getDate()}-${meses[d.getMonth()+1]}</option>`;
    });

    let modal = document.getElementById('fc-modal-facturas');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'fc-modal-facturas';
        modal.className = 'fc-modal';
        document.body.appendChild(modal);
    }

    let facturasHtml = '';
    let totalPendiente = 0;
    let totalProgramado = 0;
    let totalVencidas = 0;
    let cantVencidas = 0;
    let totalVigentes = 0;
    let cantVigentes = 0;

    const hoy = new Date();
    hoy.setHours(0,0,0,0);

    // Obtener dias de credito del item (columna DIAS)
    const diasCredito = parseInt(row.querySelector('.fc-input-dias')?.value) || 0;

    // Calcular criticidad (basado en factura mas vencida)
    let maxDiasVenc = 0;
    facturas.forEach(fac => {
        let fvr = fac.vencimiento;
        if (diasCredito > 0 && fac.fecha) {
            const fe = new Date(fac.fecha + 'T12:00:00');
            fe.setDate(fe.getDate() + diasCredito);
            fvr = fe.toISOString().split('T')[0];
        }
        if (fvr) {
            const d = Math.round((hoy - new Date(fvr + 'T12:00:00')) / (1000*60*60*24));
            if (d > maxDiasVenc) maxDiasVenc = d;
        }
    });
    let criticidad = 'BAJO', criticidadStyle = 'background:#e2e8f0;color:#475569;';
    if (maxDiasVenc > 60) { criticidad = 'CRITICO'; criticidadStyle = 'background:#dc2626;color:#fff;'; }
    else if (maxDiasVenc > 30) { criticidad = 'ALTO'; criticidadStyle = 'background:#ea580c;color:#fff;'; }
    else if (maxDiasVenc > 0) { criticidad = 'MEDIO'; criticidadStyle = 'background:#ca8a04;color:#fff;'; }

    facturas.forEach((fac, idx) => {
        const esPendiente = !fac.fecha_pago;
        if (esPendiente) totalPendiente += (fac.monto || 0);
        else totalProgramado += (fac.monto || 0);

        // Calcular vencimiento real: fecha emision + dias de credito
        // Si hay dias de credito configurados, usarlos; si no, usar el vencimiento del XLS
        let fechaVencReal = fac.vencimiento;
        if (diasCredito > 0 && fac.fecha) {
            const fEmision = new Date(fac.fecha + 'T12:00:00');
            fEmision.setDate(fEmision.getDate() + diasCredito);
            fechaVencReal = fEmision.toISOString().split('T')[0];
        }

        // Calcular dias vencidos
        let diasVencido = '';
        let claseVencido = '';
        if (fechaVencReal) {
            const fVenc = new Date(fechaVencReal + 'T12:00:00');
            const diff = Math.round((hoy - fVenc) / (1000*60*60*24));
            if (diff > 0) {
                diasVencido = `${diff}d`;
                if (diff > 60) claseVencido = 'fc-venc-critico';
                else if (diff > 30) claseVencido = 'fc-venc-alto';
                else claseVencido = 'fc-venc-medio';
            } else if (diff === 0) {
                diasVencido = 'Hoy';
                claseVencido = 'fc-venc-medio';
            } else {
                diasVencido = `${Math.abs(diff)}d`;
                claseVencido = 'fc-venc-ok';
            }
        }

        // Clasificar vencida o vigente
        const estaVencida = claseVencido && claseVencido !== 'fc-venc-ok';
        if (estaVencida) { totalVencidas += (fac.monto||0); cantVencidas++; }
        else { totalVigentes += (fac.monto||0); cantVigentes++; }

        const abono = fac.abono || 0;
        const restante = (fac.monto || 0) - abono;
        const restanteHtml = abono > 0 ? `<div style="font-size:9px;color:${restante<=0?'#16a34a':'#dc2626'};margin-top:2px;">${restante<=0?'Pagado':'Resta: $'+restante.toFixed(2)}</div>` : '';

        facturasHtml += `<tr class="${esPendiente ? 'fc-fac-pendiente' : 'fc-fac-programada'}">
            <td><input type="text" class="fc-fac-input fc-fac-num" value="${fac.num || ''}" data-idx="${idx}" data-field="num" placeholder="Nro factura"></td>
            <td><input type="date" class="fc-fac-input" value="${fac.fecha || ''}" data-idx="${idx}" data-field="fecha"></td>
            <td><input type="text" class="fc-fac-input fc-fac-monto" value="${fac.monto || ''}" data-idx="${idx}" data-field="monto" placeholder="0.00">${restanteHtml}</td>
            <td><input type="date" class="fc-fac-input" value="${fac.vencimiento || ''}" data-idx="${idx}" data-field="vencimiento"></td>
            <td class="fc-col-vencido ${claseVencido}">${diasVencido}</td>
            <td><input type="text" class="fc-fac-input fc-fac-abono" value="${abono || ''}" data-idx="${idx}" data-field="abono" placeholder="Parcial" style="width:70px;text-align:right;"></td>
            <td><select class="fc-fac-select-fecha" data-idx="${idx}" onchange="fc_cambiarFechaPagoFactura(this)">
                ${opcionesFechas.replace(`value="${fac.fecha_pago}"`, `value="${fac.fecha_pago}" selected`)}
            </select></td>
            <td><button class="fc-btn-del-fac" onclick="fc_eliminarFactura('${rowId}', ${idx})">x</button></td>
        </tr>`;
    });

    if (!facturasHtml) {
        facturasHtml = '<tr class="fc-fac-vacia"><td colspan="8">No hay facturas. Use <b>+ Agregar</b> o cargue la <b>Cartera XLS</b></td></tr>';
    }

    modal.innerHTML = `
        <div class="fc-modal-overlay" onclick="fc_cerrarFacturas()"></div>
        <div class="fc-modal-facturas-content">
            <div class="fc-modal-header" style="background:#1e293b;">
                <span class="fc-modal-icon" style="background:rgba(255,255,255,.1);">F</span>
                <div style="flex:1;">
                    <h3 style="margin:0;font-size:14px;">${nombre}</h3>
                    <div style="display:flex;gap:12px;margin-top:4px;font-size:10px;opacity:.85;">
                        <span>Credito: <b>${diasCredito} dias</b></span>
                        <span>Facturas: <b>${facturas.length}</b></span>
                    </div>
                </div>
                <button class="fc-modal-close" onclick="fc_cerrarFacturas()">&times;</button>
            </div>
            <div class="fc-fac-toolbar">
                <button onclick="fc_agregarFactura('${rowId}')" class="fc-btn-add-fac">+ Agregar Factura</button>
                ${Object.keys(fc_cartera_cargada).length > 0 ? `<button onclick="fc_mostrarBuscadorCartera('${rowId}')" class="fc-btn-buscar-cartera">Buscar en Cartera (${Object.keys(fc_cartera_cargada).length} proveedores)</button>` : ''}
            </div>
            <div class="fc-fac-body">
                <table class="fc-tabla-facturas">
                    <thead>
                        <tr><th>Nro Factura</th><th>Fecha</th><th>Monto</th><th>Vencimiento</th><th>Vencido</th><th>Abono</th><th>Pagar el</th><th></th></tr>
                    </thead>
                    <tbody id="fc-facturas-body">${facturasHtml}</tbody>
                </table>
            </div>
            <div class="fc-fac-footer">
                <div class="fc-fac-totales" style="flex-wrap:wrap;row-gap:6px;">
                    <span class="fc-fac-t-pend" title="${cantVencidas} factura(s) vencida(s)">Vencidas (${cantVencidas}): $${totalVencidas.toLocaleString('en-US',{minimumFractionDigits:2})}</span>
                    <span class="fc-fac-t-prog" title="${cantVigentes} factura(s) vigente(s)">Vigentes (${cantVigentes}): $${totalVigentes.toLocaleString('en-US',{minimumFractionDigits:2})}</span>
                    <span class="fc-fac-t-total">Total: $${(totalPendiente+totalProgramado).toLocaleString('en-US',{minimumFractionDigits:2})}</span>
                </div>
                <div style="font-size:10px;color:#64748b;margin:6px 0;">
                    Pendiente pago: <b style="color:#dc2626;">$${totalPendiente.toLocaleString('en-US',{minimumFractionDigits:2})}</b>
                    &nbsp;|&nbsp; Programado: <b style="color:#16a34a;">$${totalProgramado.toLocaleString('en-US',{minimumFractionDigits:2})}</b>
                </div>
                <div class="fc-fac-btns">
                    <button onclick="fc_cerrarFacturas()" class="fc-btn-cancelar">Cerrar</button>
                    <button onclick="fc_aplicarFacturas('${rowId}')" class="fc-btn-aplicar">Aplicar al Flujo</button>
                </div>
            </div>
        </div>
    `;

    modal.dataset.rowId = rowId;
    modal.classList.add('active');
    fc_inyectarEstilosFacturas();
}

function fc_cerrarFacturas() {
    // Guardar inputs antes de cerrar
    const modal = document.getElementById('fc-modal-facturas');
    if (modal && modal.dataset.rowId) {
        fc_guardarInputsFacturas(modal.dataset.rowId);
    }
    if (modal) modal.classList.remove('active');
}

function fc_agregarFactura(rowId) {
    fc_guardarInputsFacturas(rowId);
    const facturas = fc_getFacturas(rowId);
    facturas.push({ num: '', fecha: '', monto: 0, vencimiento: '', fecha_pago: '' });
    const row = document.querySelector(`[data-fc-row-id="${rowId}"]`);
    if (row) fc_abrirFacturas(row);
}

function fc_eliminarFactura(rowId, idx) {
    fc_guardarInputsFacturas(rowId);
    const facturas = fc_getFacturas(rowId);
    facturas.splice(idx, 1);
    const row = document.querySelector(`[data-fc-row-id="${rowId}"]`);
    if (row) fc_abrirFacturas(row);
}

function fc_cambiarFechaPagoFactura(select) {
    const modal = document.getElementById('fc-modal-facturas');
    if (!modal) return;
    const rowId = modal.dataset.rowId;
    const idx = parseInt(select.dataset.idx);
    fc_guardarInputsFacturas(rowId);
    fc_actualizarTotalesFacturasModal(rowId);
}

function fc_guardarInputsFacturas(rowId) {
    const facturas = fc_getFacturas(rowId);
    document.querySelectorAll('#fc-facturas-body .fc-fac-input').forEach(input => {
        const idx = parseInt(input.dataset.idx);
        const field = input.dataset.field;
        if (facturas[idx] && field) {
            if (field === 'monto' || field === 'abono') {
                facturas[idx][field] = parseFloat(input.value.replace(/,/g, '')) || 0;
            } else {
                facturas[idx][field] = input.value;
            }
        }
    });
    document.querySelectorAll('#fc-facturas-body .fc-fac-select-fecha').forEach(select => {
        const idx = parseInt(select.dataset.idx);
        if (facturas[idx]) facturas[idx].fecha_pago = select.value;
    });
}

function fc_actualizarTotalesFacturasModal(rowId) {
    const facturas = fc_getFacturas(rowId);
    let pend = 0, prog = 0;
    facturas.forEach(f => {
        if (!f.fecha_pago) pend += (f.monto || 0);
        else prog += (f.monto || 0);
    });
    const pe = document.querySelector('.fc-fac-t-pend');
    const pr = document.querySelector('.fc-fac-t-prog');
    const to = document.querySelector('.fc-fac-t-total');
    if (pe) pe.textContent = `Pendiente: $${pend.toLocaleString('en-US',{minimumFractionDigits:2})}`;
    if (pr) pr.textContent = `Programado: $${prog.toLocaleString('en-US',{minimumFractionDigits:2})}`;
    if (to) to.textContent = `Total: $${(pend+prog).toLocaleString('en-US',{minimumFractionDigits:2})}`;
}

// Aplicar facturas al flujo: suma por fecha_pago -> llena celdas
function fc_aplicarFacturas(rowId) {
    fc_guardarInputsFacturas(rowId);
    const facturas = fc_getFacturas(rowId);
    const row = document.querySelector(`[data-fc-row-id="${rowId}"]`);
    if (!row) return;

    // Limpiar celdas del dia de esta fila
    row.querySelectorAll('.fc-input[data-fecha]').forEach(inp => { inp.value = ''; });

    // Agrupar montos por fecha de pago (usa abono si existe, sino monto completo)
    const montosPorFecha = {};
    facturas.forEach(fac => {
        if (fac.fecha_pago) {
            const pago = (fac.abono && fac.abono > 0) ? fac.abono : (fac.monto || 0);
            if (pago > 0) {
                if (!montosPorFecha[fac.fecha_pago]) montosPorFecha[fac.fecha_pago] = 0;
                montosPorFecha[fac.fecha_pago] += pago;
            }
        }
    });

    // Llenar celdas
    for (const [fecha, monto] of Object.entries(montosPorFecha)) {
        const input = row.querySelector(`.fc-input[data-fecha="${fecha}"]`);
        if (input) input.value = monto.toFixed(2);
    }

    // Actualizar saldo con total de facturas
    const totalFac = facturas.reduce((s, f) => s + (f.monto || 0), 0);
    const saldoInput = row.querySelector('.fc-input-saldo');
    if (saldoInput && totalFac > 0) saldoInput.value = totalFac.toFixed(2);

    fc_actualizarBadgeFacturas(row);
    fc_recalcularTodo();
    fc_cerrarFacturas();
}

// Badge en el boton de facturas
function fc_actualizarBadgeFacturas(row) {
    const rowId = row.dataset.fcRowId;
    if (!rowId) return;
    const facturas = fc_facturas_data[rowId] || [];
    const badge = row.querySelector('.fc-badge-facturas');
    if (!badge) return;

    const pendientes = facturas.filter(f => !f.fecha_pago).length;
    const total = facturas.length;

    if (total === 0) {
        badge.textContent = '';
        badge.className = 'fc-badge-facturas';
    } else if (pendientes === 0) {
        badge.textContent = total;
        badge.className = 'fc-badge-facturas fc-badge-ok';
    } else {
        badge.textContent = pendientes;
        badge.className = 'fc-badge-facturas fc-badge-pend';
    }
}

// Buscar facturas desde BD (fact_detallada_compras)
async function fc_buscarFacturasBD(rowId) {
    const row = document.querySelector(`[data-fc-row-id="${rowId}"]`);
    const nombre = row?.querySelector('.fc-input-nombre')?.value || '';

    if (!nombre || nombre === 'Nuevo Item' || nombre === 'Item 1' || nombre.length < 3) {
        alert('Ingrese el nombre del proveedor primero (min 3 caracteres)');
        return;
    }

    const btn = document.querySelector('.fc-btn-buscar-bd');
    const textoOrig = btn.textContent;
    btn.textContent = 'Buscando...';
    btn.disabled = true;

    try {
        const response = await fetch(`/api/flujo-caja/facturas-proveedor?nombre=${encodeURIComponent(nombre)}`);
        if (!response.ok) throw new Error('Error en la busqueda');

        const data = await response.json();
        if (!data.ok || !data.facturas || data.facturas.length === 0) {
            alert(`No se encontraron facturas para "${nombre}"`);
            return;
        }

        fc_guardarInputsFacturas(rowId);
        const facturas = fc_getFacturas(rowId);
        const existentes = new Set(facturas.map(f => f.num));
        let agregadas = 0;

        data.facturas.forEach(fac => {
            if (!existentes.has(fac.num)) {
                facturas.push({
                    num: fac.num,
                    fecha: fac.fecha,
                    monto: fac.monto,
                    vencimiento: fac.vencimiento || '',
                    fecha_pago: ''
                });
                agregadas++;
            }
        });

        if (agregadas === 0) {
            alert('Todas las facturas encontradas ya estan en la lista');
        } else {
            alert(`${agregadas} factura(s) agregada(s) de ${data.total} encontrada(s)`);
            fc_abrirFacturas(row);
        }
    } catch (error) {
        console.error('Error buscando facturas:', error);
        alert('Error al buscar: ' + error.message);
    } finally {
        if (btn) { btn.textContent = textoOrig; btn.disabled = false; }
    }
}

// Estilos del modulo de facturas
function fc_inyectarEstilosFacturas() {
    if (document.getElementById('fc-facturas-styles')) return;
    const s = document.createElement('style');
    s.id = 'fc-facturas-styles';
    s.textContent = `
        .fc-btn-facturas { background:none; border:1px solid #90caf9; cursor:pointer; padding:1px 4px; margin-left:3px; border-radius:3px; font-size:10px; position:relative; vertical-align:middle; transition:all .15s; }
        .fc-btn-facturas:hover { background:#e3f2fd; border-color:#1565c0; }
        .fc-icon-fac { font-weight:700; color:#1565c0; font-size:9px; }
        .fc-badge-facturas { position:absolute; top:-6px; right:-6px; min-width:14px; height:14px; line-height:14px; text-align:center; font-size:8px; font-weight:700; border-radius:7px; display:none; }
        .fc-badge-facturas.fc-badge-pend { display:block; background:#e53935; color:#fff; }
        .fc-badge-facturas.fc-badge-ok { display:block; background:#1565c0; color:#fff; }

        .fc-modal-facturas-content { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); background:#fff; border-radius:10px; width:780px; max-width:95vw; max-height:88vh; display:flex; flex-direction:column; box-shadow:0 8px 32px rgba(0,0,0,.2); overflow:hidden; border:1px solid #e0e0e0; }
        .fc-fac-toolbar { display:flex; gap:8px; padding:8px 16px; background:#f8fafc; border-bottom:1px solid #e2e8f0; align-items:center; }
        .fc-btn-add-fac { padding:6px 14px; border:1px solid #1565c0; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600; background:#fff; color:#1565c0; transition:all .15s; }
        .fc-btn-add-fac:hover { background:#1565c0; color:#fff; }
        .fc-btn-buscar-cartera { padding:6px 14px; border:1px solid #1565c0; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600; background:#1565c0; color:#fff; transition:all .15s; }
        .fc-btn-buscar-cartera:hover { background:#0d47a1; }

        .fc-fac-body { overflow-y:auto; max-height:55vh; padding:0; }
        .fc-tabla-facturas { width:100%; border-collapse:collapse; font-size:11px; }
        .fc-tabla-facturas thead th { position:sticky; top:0; background:#1e293b; padding:8px 8px; text-align:left; font-weight:600; color:#fff; font-size:10px; text-transform:uppercase; letter-spacing:.5px; z-index:1; }
        .fc-tabla-facturas tbody tr { border-bottom:1px solid #f1f5f9; transition:background .1s; }
        .fc-tabla-facturas tbody tr:hover { background:#eff6ff; }
        .fc-tabla-facturas tbody tr:nth-child(even) { background:#f8fafc; }
        .fc-tabla-facturas tbody tr:nth-child(even):hover { background:#eff6ff; }
        .fc-fac-pendiente { }
        .fc-fac-programada { background:#f0fdf4 !important; }
        .fc-fac-programada:hover { background:#dcfce7 !important; }
        .fc-fac-vacia td { text-align:center; padding:40px 20px; color:#94a3b8; font-size:12px; }
        .fc-fac-input { border:1px solid #e2e8f0; border-radius:4px; padding:5px 6px; font-size:11px; width:100%; box-sizing:border-box; background:#fff; color:#1e293b; }
        .fc-fac-input:focus { outline:none; border-color:#1565c0; box-shadow:0 0 0 2px rgba(21,101,192,.15); }
        .fc-fac-num { width:130px; font-family:'Courier New',monospace; font-size:10px; }
        .fc-fac-monto { width:85px; text-align:right; font-weight:700; color:#1e293b; }
        .fc-fac-select-fecha { border:1px solid #e2e8f0; border-radius:4px; padding:5px 4px; font-size:10px; background:#fff; cursor:pointer; min-width:120px; color:#1e293b; }
        .fc-fac-select-fecha:focus { outline:none; border-color:#1565c0; }
        .fc-btn-del-fac { background:none; color:#94a3b8; border:none; cursor:pointer; padding:4px 6px; font-size:14px; font-weight:400; border-radius:4px; transition:all .15s; }
        .fc-btn-del-fac:hover { background:#fee2e2; color:#dc2626; }
        .fc-fac-footer { padding:12px 16px; border-top:1px solid #e2e8f0; background:#f8fafc; }
        .fc-fac-totales { display:flex; gap:20px; margin-bottom:10px; font-size:11px; }
        .fc-fac-t-pend { color:#dc2626; font-weight:600; background:#fef2f2; padding:3px 8px; border-radius:4px; }
        .fc-fac-t-prog { color:#16a34a; font-weight:600; background:#f0fdf4; padding:3px 8px; border-radius:4px; }
        .fc-fac-t-total { color:#1565c0; font-weight:700; background:#eff6ff; padding:3px 8px; border-radius:4px; }
        .fc-fac-btns { display:flex; gap:8px; justify-content:flex-end; }
        .fc-fac-btns .fc-btn-cancelar { padding:8px 20px; background:#fff; color:#64748b; border:1px solid #e2e8f0; border-radius:6px; font-size:12px; font-weight:500; cursor:pointer; }
        .fc-fac-btns .fc-btn-cancelar:hover { background:#f1f5f9; }
        .fc-fac-btns .fc-btn-aplicar { padding:8px 20px; background:#1565c0; color:#fff; border:none; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; }
        .fc-fac-btns .fc-btn-aplicar:hover { background:#0d47a1; }
        .fc-tabla-facturas td { padding:6px 8px; }

        .fc-cartera-item:hover td { background:#eff6ff !important; }
        .fc-cartera-item td { border-bottom:1px solid #f1f5f9; padding:8px 10px !important; }

        .fc-col-vencido { text-align:center; font-size:10px; font-weight:600; padding:3px 6px; white-space:nowrap; }
        .fc-venc-critico { color:#dc2626; }
        .fc-venc-critico::before { content:''; display:inline-block; width:6px; height:6px; border-radius:50%; background:#dc2626; margin-right:3px; }
        .fc-venc-alto { color:#ea580c; }
        .fc-venc-alto::before { content:''; display:inline-block; width:6px; height:6px; border-radius:50%; background:#ea580c; margin-right:3px; }
        .fc-venc-medio { color:#ca8a04; }
        .fc-venc-medio::before { content:''; display:inline-block; width:6px; height:6px; border-radius:50%; background:#ca8a04; margin-right:3px; }
        .fc-venc-ok { color:#16a34a; }
        .fc-venc-ok::before { content:''; display:inline-block; width:6px; height:6px; border-radius:50%; background:#16a34a; margin-right:3px; }

        .fc-picker-facturas { position:absolute; z-index:9999; background:#fff; border:1px solid #e2e8f0; border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,.15); min-width:300px; max-height:280px; overflow-y:auto; font-size:11px; }
        .fc-picker-facturas .fc-picker-header { padding:10px 12px; background:#1e293b; color:#fff; font-weight:600; font-size:11px; display:flex; justify-content:space-between; align-items:center; border-radius:7px 7px 0 0; }
        .fc-picker-facturas .fc-picker-item { display:flex; align-items:center; padding:8px 12px; border-bottom:1px solid #f1f5f9; cursor:pointer; gap:8px; transition:background .1s; }
        .fc-picker-facturas .fc-picker-item:hover { background:#eff6ff; }
        .fc-picker-facturas .fc-picker-item.checked { background:#eff6ff; border-left:3px solid #1565c0; }
        .fc-picker-facturas .fc-picker-item input[type=checkbox] { accent-color:#1565c0; }
        .fc-picker-facturas .fc-picker-footer { padding:8px 12px; background:#f8fafc; display:flex; justify-content:space-between; align-items:center; border-top:1px solid #e2e8f0; position:sticky; bottom:0; border-radius:0 0 7px 7px; }
    `;
    document.head.appendChild(s);
}

// ============ BUSCADOR EN CARTERA CARGADA ============

function fc_mostrarBuscadorCartera(rowId) {
    const contenedor = document.querySelector('.fc-fac-body');
    if (!contenedor) return;

    // Construir lista de proveedores de la cartera
    const proveedores = Object.entries(fc_cartera_cargada)
        .map(([k, v]) => ({ key: k, nombre: v.nombre, cant: v.facturas.length, total: v.facturas.reduce((s,f) => s + f.monto, 0) }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre));

    let listaHtml = '';
    proveedores.forEach(p => {
        listaHtml += `<tr class="fc-cartera-item" onclick="fc_seleccionarProveedorCartera('${rowId}','${p.key}')" style="cursor:pointer;">
            <td style="padding:6px 8px; font-size:11px;">${p.nombre}</td>
            <td style="padding:6px 8px; font-size:11px; text-align:center;">${p.cant}</td>
            <td style="padding:6px 8px; font-size:11px; text-align:right; font-weight:600;">$${p.total.toLocaleString('en-US',{minimumFractionDigits:2})}</td>
        </tr>`;
    });

    contenedor.innerHTML = `
        <div style="padding:10px;">
            <input type="text" id="fc-filtro-cartera" placeholder="Filtrar proveedor..."
                oninput="fc_filtrarCartera()"
                style="width:100%;padding:8px 12px;border:1.5px solid #ccc;border-radius:6px;font-size:12px;margin-bottom:8px;box-sizing:border-box;">
            <div style="max-height:45vh;overflow-y:auto;">
                <table style="width:100%;border-collapse:collapse;" id="fc-tabla-cartera">
                    <thead><tr style="background:#e8eaf6;">
                        <th style="padding:6px 8px;text-align:left;font-size:11px;">Proveedor</th>
                        <th style="padding:6px 8px;text-align:center;font-size:11px;">Facturas</th>
                        <th style="padding:6px 8px;text-align:right;font-size:11px;">Total Pend.</th>
                    </tr></thead>
                    <tbody>${listaHtml}</tbody>
                </table>
            </div>
            <button onclick="fc_volverListaFacturas('${rowId}')" style="margin-top:8px;padding:6px 12px;background:#607d8b;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;">Volver a facturas</button>
        </div>
    `;

    setTimeout(() => document.getElementById('fc-filtro-cartera')?.focus(), 100);
}

function fc_filtrarCartera() {
    const filtro = (document.getElementById('fc-filtro-cartera')?.value || '').toUpperCase();
    document.querySelectorAll('.fc-cartera-item').forEach(row => {
        const nombre = row.cells[0].textContent.toUpperCase();
        row.style.display = nombre.includes(filtro) ? '' : 'none';
    });
}

function fc_seleccionarProveedorCartera(rowId, provKey) {
    const cartera = fc_cartera_cargada[provKey];
    if (!cartera) return;

    const facturas = fc_getFacturas(rowId);
    const existentes = new Set(facturas.map(f => f.num));
    let agregadas = 0;

    cartera.facturas.forEach(fac => {
        if (!existentes.has(fac.num)) {
            facturas.push({ ...fac });
            agregadas++;
        }
    });

    // Actualizar nombre del item con el del proveedor
    const row = document.querySelector(`[data-fc-row-id="${rowId}"]`);
    if (row) {
        const nombreInput = row.querySelector('.fc-input-nombre');
        if (nombreInput && (nombreInput.value === 'Nuevo Item' || nombreInput.value === 'Item 1' || nombreInput.value === 'Proveedor 1')) {
            nombreInput.value = cartera.nombre;
        }
        fc_actualizarBadgeFacturas(row);
        fc_abrirFacturas(row); // Reabrir modal con las facturas cargadas
    }
}

function fc_volverListaFacturas(rowId) {
    const row = document.querySelector(`[data-fc-row-id="${rowId}"]`);
    if (row) fc_abrirFacturas(row);
}

// Cuando un input de egreso recibe foco, si tiene facturas abre el picker
function fc_onFocusEgreso(input) {
    const row = input.closest('tr');
    if (!row) return;
    const rowId = row.dataset.fcRowId;
    if (!rowId) return;
    const facturas = fc_facturas_data[rowId];
    if (facturas && facturas.length > 0) {
        input.blur();
        fc_abrirPickerFacturas(input);
    }
}

// ============ PICKER DE FACTURAS EN CELDA DEL DIA ============

function fc_abrirPickerFacturas(inputEgreso) {
    // Cerrar picker existente
    fc_cerrarPickerFacturas();

    const row = inputEgreso.closest('tr');
    if (!row) return;
    const rowId = row.dataset.fcRowId;
    if (!rowId) return;

    const facturas = fc_facturas_data[rowId];
    if (!facturas || facturas.length === 0) return; // Sin facturas, input normal

    const fecha = inputEgreso.dataset.fecha;
    if (!fecha) return;

    // Facturas disponibles: sin fecha_pago O asignadas a esta misma fecha
    const disponibles = facturas.map((fac, idx) => ({ ...fac, idx }))
        .filter(f => !f.fecha_pago || f.fecha_pago === fecha);

    if (disponibles.length === 0) return;

    const picker = document.createElement('div');
    picker.className = 'fc-picker-facturas';
    picker.id = 'fc-picker-activo';

    const meses = ['','ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    const d = new Date(fecha + 'T12:00:00');
    const fechaLabel = `${d.getDate()}-${meses[d.getMonth()+1]}`;

    let itemsHtml = '';
    disponibles.forEach(fac => {
        const checked = fac.fecha_pago === fecha;
        const vencInfo = fac.vencimiento ? ` | Venc: ${fac.vencimiento.substring(5)}` : '';
        itemsHtml += `<div class="fc-picker-item ${checked ? 'checked' : ''}" data-fac-idx="${fac.idx}" onclick="fc_toggleFacturaPicker(this, '${rowId}', '${fecha}')">
            <input type="checkbox" ${checked ? 'checked' : ''} style="pointer-events:none;">
            <span style="flex:1;">${fac.num || '(sin nro)'}</span>
            <span style="font-weight:600;">$${(fac.monto||0).toLocaleString('en-US',{minimumFractionDigits:2})}</span>
            <span style="font-size:9px;color:#888;">${vencInfo}</span>
        </div>`;
    });

    picker.innerHTML = `
        <div class="fc-picker-header">
            <span>Facturas para ${fechaLabel}</span>
            <button onclick="fc_cerrarPickerFacturas()" style="background:none;border:none;color:#fff;cursor:pointer;font-size:14px;">&times;</button>
        </div>
        ${itemsHtml}
        <div class="fc-picker-footer">
            <span id="fc-picker-total">$0.00</span>
            <button onclick="fc_aplicarPickerFacturas('${rowId}','${fecha}')" style="background:#1565c0;color:#fff;border:none;border-radius:4px;padding:4px 12px;cursor:pointer;font-size:11px;">OK</button>
        </div>
    `;

    // Posicionar cerca del input
    const rect = inputEgreso.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.top = (rect.bottom + 2) + 'px';
    picker.style.left = Math.max(rect.left - 100, 10) + 'px';
    document.body.appendChild(picker);

    // Actualizar total
    fc_actualizarTotalPicker(rowId, fecha);

    // Cerrar al hacer clic fuera (delay para que el click de apertura no lo cierre)
    fc_pickerAbierto = Date.now();
    document.addEventListener('mousedown', fc_clickFueraPicker, true);
}

let fc_pickerAbierto = 0;

function fc_clickFueraPicker(e) {
    // Ignorar si el picker acaba de abrirse (< 300ms)
    if (Date.now() - fc_pickerAbierto < 300) return;
    const picker = document.getElementById('fc-picker-activo');
    if (picker && !picker.contains(e.target)) {
        fc_cerrarPickerFacturas();
    }
}

function fc_cerrarPickerFacturas() {
    const picker = document.getElementById('fc-picker-activo');
    if (picker) picker.remove();
    document.removeEventListener('mousedown', fc_clickFueraPicker, true);
}

function fc_toggleFacturaPicker(div, rowId, fecha) {
    const facturas = fc_facturas_data[rowId];
    const idx = parseInt(div.dataset.facIdx);
    if (!facturas || !facturas[idx]) return;

    const cb = div.querySelector('input[type="checkbox"]');
    const isChecked = cb.checked;

    if (isChecked) {
        // Desmarcar: quitar fecha_pago
        facturas[idx].fecha_pago = '';
        cb.checked = false;
        div.classList.remove('checked');
    } else {
        // Marcar: asignar fecha_pago
        facturas[idx].fecha_pago = fecha;
        cb.checked = true;
        div.classList.add('checked');
    }

    fc_actualizarTotalPicker(rowId, fecha);
}

function fc_actualizarTotalPicker(rowId, fecha) {
    const facturas = fc_facturas_data[rowId] || [];
    const total = facturas.filter(f => f.fecha_pago === fecha).reduce((s, f) => s + ((f.abono && f.abono > 0) ? f.abono : (f.monto || 0)), 0);
    const el = document.getElementById('fc-picker-total');
    if (el) {
        el.textContent = `$${total.toLocaleString('en-US',{minimumFractionDigits:2})}`;
        el.style.fontWeight = '700';
        el.style.color = total > 0 ? '#1565c0' : '#666';
    }
}

function fc_aplicarPickerFacturas(rowId, fecha) {
    const facturas = fc_facturas_data[rowId] || [];
    const total = facturas.filter(f => f.fecha_pago === fecha).reduce((s, f) => s + ((f.abono && f.abono > 0) ? f.abono : (f.monto || 0)), 0);

    // Buscar el input de esa fecha en la fila
    const row = document.querySelector(`[data-fc-row-id="${rowId}"]`);
    if (row) {
        const input = row.querySelector(`.fc-input[data-fecha="${fecha}"]`);
        if (input) {
            input.value = total > 0 ? total.toFixed(2) : '';
        }
        fc_actualizarBadgeFacturas(row);
    }

    fc_cerrarPickerFacturas();
    fc_recalcularTodo();
}

// ============ CARGA MASIVA CARTERA POR PAGAR (XLS) ============

// Almacen global de cartera cargada: { proveedorNorm: [facturas] }
let fc_cartera_cargada = {};

// Dias de credito por proveedor (nombre parcial -> dias)
const fc_dias_credito = {
    'A TU PUERTA':7,'AGROVOLCANES':15,'ALIMANDUCARE':7,'ARCA CONTINENTAL':1,
    'AROMAPISOS':30,'CARSNACK':30,'CHIRAPI':7,'CITROFSANT':15,'CLEAN CORI':30,
    'COOK ALIMENTOS':0,'CORPORACION FAVORITA':0,'DELI WOOF':7,'DIHERKA':30,
    'DINADEC':7,'DISTRIBUIDORA LM':15,'DURAGAS':15,'EL HUEVITO FELIZ':7,
    'FLORALP':30,'FOODS BUSINESS':30,'FULL PACKING':30,'GRAN VERDE':7,
    'GRUPO JERUSALEN':30,'HERMINIA SANCHEZ':30,'IBD':30,
    'INTEGRACION AVICOLA':8,'ISOLATOT':30,'JM SERVICIOS':7,
    'JORGE PADILLA':7,'PADILLA URQUIZO':7,'KRUPY':7,'KYPROSS':7,
    'LA FABRIL':21,'LA REINA MIEL':7,'LUDY CHIFLES':0,'LUMER':45,'CLASSIC BUN':45,
    'MALDONADO LANDAZO':30,'GLOBAL FLEXO':30,'MARCELLOS':7,'MASTER MEAT':21,
    'MIGAPAN':15,'NIRSA':20,'OLMEDO':7,'ALBACORA':7,
    'OSCAR CASTILLO':7,'PAPEL ART':30,'POLYPAPELES':15,'PROADA':30,'DOBLE A':30,
    'PROALCO':0,'PROALMEX':30,'PRONACA':30,'PUBLIJOB':30,'RONALS PAPAS':15,
    'SIGMA':21,'SOLUCIONES INDUSTRIALES':15,'TRESCO':15,'UNILIMPIO':15,'XPERTPLAG':30
};

function fc_buscarDiasCredito(nombreProveedor) {
    const upper = nombreProveedor.toUpperCase();
    for (const [key, dias] of Object.entries(fc_dias_credito)) {
        if (upper.includes(key)) return dias;
    }
    return 0;
}

function fc_cargarCarteraXLS() {
    document.getElementById('fc-input-cartera').click();
}

function fc_procesarCarteraXLS(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

            // Buscar fila de headers (contiene "Proveedor" y "# Documento")
            let headerIdx = -1;
            for (let i = 0; i < Math.min(rows.length, 10); i++) {
                const fila = rows[i].map(c => String(c).trim());
                if (fila.some(c => c === 'Proveedor') && fila.some(c => c.includes('Documento'))) {
                    headerIdx = i;
                    break;
                }
            }
            if (headerIdx === -1) {
                alert('No se reconoce el formato del archivo. Asegurese de usar CarteraPorPagar de Contifico.');
                return;
            }

            const headers = rows[headerIdx].map(c => String(c).trim());
            const colProv = headers.indexOf('Proveedor');
            const colRazon = headers.findIndex(h => h.includes('Social'));
            const colTipo = headers.findIndex(h => h.includes('Tipo'));
            const colDoc = headers.findIndex(h => h.includes('Documento') && !h.includes('Tipo') && !h.includes('Valor') && !h.includes('modificado'));
            const colEmision = headers.findIndex(h => h.includes('Emisi'));
            const colVenc = headers.findIndex(h => h.includes('Vencimiento'));
            const colTotal = headers.indexOf('Total');
            const colValDoc = headers.findIndex(h => h.includes('Valor documento'));
            const colRet = headers.findIndex(h => h.includes('Retenciones'));
            const colPagos = headers.findIndex(h => h.includes('Pagos'));

            // Parsear facturas (solo tipo FAC)
            fc_cartera_cargada = {};
            let totalFacturas = 0;
            let proveedoresSet = new Set();

            for (let i = headerIdx + 1; i < rows.length; i++) {
                const r = rows[i];
                const tipo = String(r[colTipo] || '').trim();
                if (tipo !== 'FAC') continue; // Solo facturas

                const proveedor = String(r[colProv] || '').trim();
                if (!proveedor) continue;

                const numDoc = String(r[colDoc] || '').trim();
                const total = parseFloat(r[colTotal]) || 0;
                if (total <= 0) continue; // Solo pendientes con saldo

                // Parsear fechas (pueden venir como DD/MM/YYYY o como numero Excel)
                const fechaEmision = fc_parsearFechaXLS(r[colEmision]);
                const fechaVenc = fc_parsearFechaXLS(r[colVenc]);

                const key = fc_normalizarNombre(proveedor);
                if (!fc_cartera_cargada[key]) fc_cartera_cargada[key] = { nombre: proveedor, facturas: [] };

                fc_cartera_cargada[key].facturas.push({
                    num: numDoc,
                    fecha: fechaEmision,
                    monto: total,
                    vencimiento: fechaVenc,
                    fecha_pago: ''
                });
                totalFacturas++;
                proveedoresSet.add(key);
            }

            // El XLS manda: eliminar todos los items de proveedores y recrear desde la cartera
            // Primero, eliminar TODOS los items del grupo prov-principales
            document.querySelectorAll('.fc-egreso-item-prov-principales').forEach(row => row.remove());

            // Crear un item por cada proveedor de la cartera
            const grupoId = 'prov-principales';
            const headerRow = document.getElementById(`fc-grupo-${grupoId}`);
            if (!headerRow) {
                alert('No se encontro el grupo PROVEEDORES PRINCIPALES en egresos');
                return;
            }

            // Ordenar proveedores por total descendente
            const proveedoresOrdenados = Object.entries(fc_cartera_cargada)
                .map(([k, v]) => ({ key: k, nombre: v.nombre, facturas: v.facturas, total: v.facturas.reduce((s,f) => s + f.monto, 0) }))
                .sort((a, b) => b.total - a.total);

            let facturasAsignadas = 0;
            const semanas = (fc_semanas && fc_semanas.length > 0) ? fc_semanas : window._fc_semanas;
            if (!semanas || semanas.length === 0) {
                alert('Primero consulte los datos (boton Consultar)');
                return;
            }

            // Referencia para insertar despues del header
            let insertAfter = headerRow;

            // Cargar catalogo de proveedores de BD antes de crear items
            await fc_cargarProveedoresBD();

            proveedoresOrdenados.forEach(prov => {
                const dynRowId = 'fcr-dyn-' + (++fc_row_id_counter);
                const provBD = fc_buscarProveedorBD(prov.nombre);
                const diasCred = provBD ? provBD.dias_credito : fc_buscarDiasCredito(prov.nombre);

                const newRow = document.createElement('tr');
                newRow.className = `row-banco-item fc-egreso-item-${grupoId}`;
                newRow.dataset.grupo = `eg-${grupoId}`;
                newRow.dataset.banco = 'produbanco';
                newRow.dataset.fcRowId = dynRowId;

                let celdas = `<td class="col-concepto indent-3">
                    <select class="fc-select-banco" onchange="this.closest('tr').dataset.banco=this.value;fc_recalcularTodo()" title="Banco de salida">
                        <option value="produbanco" selected>PRO</option>
                        <option value="pichincha">PICH</option>
                    </select>
                    <input type="text" class="fc-input-nombre" value="${prov.nombre}">
                    <button class="fc-btn-facturas" onclick="event.stopPropagation();fc_abrirFacturas(this.closest('tr'))" title="Facturas pendientes"><span class="fc-icon-fac">F</span><span class="fc-badge-facturas fc-badge-pend">${prov.facturas.length}</span></button>
                    <button class="fc-btn-del" onclick="fc_eliminarItem(this)">x</button>
                </td>`;
                celdas += `<td class="col-saldo monto" style="background:#e3f2fd; min-width:80px;">
                    <input type="text" class="fc-input fc-input-saldo" value="${prov.total.toFixed(2)}" onchange="fc_recalcularSaldos()" style="width:70px; text-align:right; background:#e3f2fd;">
                </td>`;
                celdas += `<td class="col-dias monto" style="background:#fff3e0; min-width:50px;">
                    <input type="number" class="fc-input fc-input-dias" value="${diasCred}" min="0" max="365" style="width:45px; text-align:center; background:#fff3e0;">
                </td>`;

                semanas.forEach(sem => {
                    celdas += `<td class="col-semana sem-${sem.num}-header monto fc-item-sem" data-semana="${sem.num}">-</td>`;
                    sem.dias.forEach((dia, i) => {
                        const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
                        celdas += `<td class="dia-col sem-${sem.num}${sab} monto fc-celda-egreso">
                            <input type="text" class="fc-input fc-input-egreso-${grupoId}" data-fecha="${dia}" data-semana="${sem.num}" placeholder="0" onchange="fc_recalcularTodo()" onfocus="fc_onFocusEgreso(this)">
                            <button class="fc-btn-rep" onclick="fc_abrirRecurrencia(this)" title="Repetir desde aqui">&#x21bb;</button>
                        </td>`;
                    });
                    celdas += `<td class="dia-col sem-${sem.num} total-col monto fc-item-total" data-semana="${sem.num}">-</td>`;
                });

                newRow.innerHTML = celdas;
                insertAfter.parentNode.insertBefore(newRow, insertAfter.nextSibling);
                insertAfter = newRow;

                // Cargar facturas
                fc_facturas_data[dynRowId] = prov.facturas.map(f => ({...f}));
                facturasAsignadas += prov.facturas.length;

                // Aplicar visibilidad correcta
                fc_aplicarVisibilidadNuevoItem(newRow);
            });

            fc_recalcularTodo();

            // Resumen
            let msg = `Cartera cargada:\n`;
            msg += `- ${totalFacturas} facturas de ${proveedoresOrdenados.length} proveedores\n`;
            msg += `- Todos creados en PROVEEDORES PRINCIPALES\n`;
            msg += `- Ordenados por monto (mayor a menor)\n`;
            msg += `\nUse el boton F en cada proveedor para ver facturas y asignar fechas de pago.`;
            alert(msg);

        } catch (err) {
            console.error('Error procesando XLS:', err);
            alert('Error al procesar archivo: ' + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
    input.value = ''; // Reset para permitir cargar mismo archivo
}

function fc_parsearFechaXLS(val) {
    if (!val) return '';
    // Si es numero (fecha Excel)
    if (typeof val === 'number') {
        const fecha = new Date((val - 25569) * 86400 * 1000);
        return fecha.toISOString().split('T')[0];
    }
    // Si es string DD/MM/YYYY
    const str = String(val).trim();
    const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    // Si ya es YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    return str;
}

function fc_normalizarNombre(nombre) {
    return nombre.toUpperCase().trim()
        .replace(/[.,\-_\/\\]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\b(S\.?A\.?S\.?|S\.?A\.?|CIA\.?\s*LTDA\.?|CIA\.?|LTDA\.?)\b/gi, '')
        .trim();
}

// ============ CATALOGO DE PROVEEDORES ============
let fc_proveedores_bd = []; // Cache del catalogo

async function fc_abrirProveedores() {
    let modal = document.getElementById('fc-modal-proveedores');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'fc-modal-proveedores';
        modal.className = 'fc-modal';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="fc-modal-overlay" onclick="fc_cerrarProveedores()"></div>
        <div class="fc-modal-facturas-content" style="width:950px;max-height:90vh;">
            <div class="fc-modal-header" style="background:#0d47a1;">
                <span class="fc-modal-icon" style="background:rgba(255,255,255,.1);"><i class="fas fa-address-book"></i></span>
                <div style="flex:1;">
                    <h3 style="margin:0;font-size:14px;">Catalogo de Proveedores</h3>
                    <p style="margin:2px 0 0;font-size:10px;opacity:.85;">Gestione criticidad, dias de credito y datos de proveedores</p>
                </div>
                <button class="fc-modal-close" onclick="fc_cerrarProveedores()">&times;</button>
            </div>
            <div class="fc-fac-toolbar">
                <button onclick="fc_provAgregar()" class="fc-btn-add-fac">+ Nuevo Proveedor</button>
                <button onclick="fc_provSincronizarDesdeCartera()" class="fc-btn-buscar-cartera" style="background:#7b1fa2;">Sincronizar desde Cartera</button>
                <button onclick="fc_provGuardarTodos()" class="fc-btn-buscar-cartera">Guardar Todos</button>
                <input type="text" id="fc-prov-filtro" placeholder="Filtrar..." oninput="fc_provFiltrar()" style="margin-left:auto;border:1px solid #e2e8f0;border-radius:6px;padding:5px 10px;font-size:11px;width:150px;">
            </div>
            <div class="fc-fac-body" style="max-height:60vh;">
                <table class="fc-tabla-facturas" id="fc-tabla-proveedores">
                    <thead>
                        <tr>
                            <th style="min-width:180px;">Proveedor</th>
                            <th style="min-width:100px;">N. Comercial</th>
                            <th style="min-width:80px;">Criticidad</th>
                            <th style="width:55px;">Dias Cr.</th>
                            <th style="width:80px;">Despacho</th>
                            <th style="min-width:120px;">Productos/Serv.</th>
                            <th style="min-width:120px;">Observaciones</th>
                            <th style="width:30px;"></th>
                        </tr>
                    </thead>
                    <tbody id="fc-prov-body"><tr><td colspan="8" style="text-align:center;padding:20px;color:#94a3b8;">Cargando...</td></tr></tbody>
                </table>
            </div>
            <div class="fc-fac-footer">
                <div class="fc-fac-totales"><span class="fc-fac-t-total" id="fc-prov-count">0 proveedores</span></div>
                <div class="fc-fac-btns">
                    <button onclick="fc_cerrarProveedores()" class="fc-btn-cancelar">Cerrar</button>
                </div>
            </div>
        </div>
    `;

    modal.classList.add('active');
    fc_inyectarEstilosFacturas();
    await fc_provCargar();
}

function fc_cerrarProveedores() {
    const modal = document.getElementById('fc-modal-proveedores');
    if (modal) modal.classList.remove('active');
}

async function fc_provCargar() {
    try {
        const res = await fetch('/api/flujo-caja/proveedores');
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        fc_proveedores_bd = data.proveedores;
        fc_provRender();
    } catch (e) {
        console.error('Error cargando proveedores:', e);
        document.getElementById('fc-prov-body').innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;color:#dc2626;">Error: ${e.message}</td></tr>`;
    }
}

function fc_provRender() {
    const tbody = document.getElementById('fc-prov-body');
    if (!tbody) return;

    if (fc_proveedores_bd.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#94a3b8;">No hay proveedores. Agregue manualmente o sincronice desde la Cartera.</td></tr>';
        document.getElementById('fc-prov-count').textContent = '0 proveedores';
        return;
    }

    let html = '';
    fc_proveedores_bd.forEach((p, idx) => {
        const critOpts = ['BAJO','MEDIO','ALTO','CRITICO'].map(c =>
            `<option value="${c}" ${p.criticidad===c?'selected':''}>${c}</option>`
        ).join('');

        const critColor = {BAJO:'#e2e8f0',MEDIO:'#fef3c7',ALTO:'#fed7aa',CRITICO:'#fecaca'}[p.criticidad] || '#e2e8f0';

        html += `<tr class="fc-prov-row" data-idx="${idx}">
            <td><input type="text" class="fc-fac-input fc-prov-field" value="${p.nombre}" data-field="nombre" style="font-weight:600;"></td>
            <td><input type="text" class="fc-fac-input fc-prov-field" value="${p.nombre_comercial}" data-field="nombre_comercial"></td>
            <td><select class="fc-fac-select-fecha fc-prov-field" data-field="criticidad" style="background:${critColor};font-weight:600;font-size:10px;" onchange="this.style.background={'BAJO':'#e2e8f0','MEDIO':'#fef3c7','ALTO':'#fed7aa','CRITICO':'#fecaca'}[this.value]">${critOpts}</select></td>
            <td><input type="number" class="fc-fac-input fc-prov-field" value="${p.dias_credito}" data-field="dias_credito" style="width:45px;text-align:center;"></td>
            <td><input type="text" class="fc-fac-input fc-prov-field" value="${p.dia_despacho}" data-field="dia_despacho" style="font-size:10px;"></td>
            <td><input type="text" class="fc-fac-input fc-prov-field" value="${p.productos_servicios}" data-field="productos_servicios" style="font-size:10px;"></td>
            <td><input type="text" class="fc-fac-input fc-prov-field" value="${p.observaciones}" data-field="observaciones" style="font-size:10px;"></td>
            <td><button class="fc-btn-del-fac" onclick="fc_provEliminar(${p.id},'${p.nombre.replace(/'/g,"\\'")}')">x</button></td>
        </tr>`;
    });

    tbody.innerHTML = html;
    document.getElementById('fc-prov-count').textContent = `${fc_proveedores_bd.length} proveedores`;
}

function fc_provFiltrar() {
    const filtro = (document.getElementById('fc-prov-filtro')?.value || '').toUpperCase();
    document.querySelectorAll('.fc-prov-row').forEach(row => {
        const nombre = row.querySelector('[data-field="nombre"]')?.value?.toUpperCase() || '';
        const comercial = row.querySelector('[data-field="nombre_comercial"]')?.value?.toUpperCase() || '';
        row.style.display = (nombre.includes(filtro) || comercial.includes(filtro)) ? '' : 'none';
    });
}

function fc_provAgregar() {
    fc_proveedores_bd.push({
        id: 0, nombre: '', nombre_comercial: '', criticidad: 'BAJO',
        dias_credito: 0, dia_despacho: '', productos_servicios: '', observaciones: ''
    });
    fc_provRender();
    // Enfocar el ultimo
    const rows = document.querySelectorAll('.fc-prov-row');
    const last = rows[rows.length - 1];
    if (last) last.querySelector('[data-field="nombre"]')?.focus();
}

async function fc_provEliminar(id, nombre) {
    if (!confirm(`¿Eliminar "${nombre}" del catalogo?`)) return;
    if (id > 0) {
        try {
            await fetch(`/api/flujo-caja/proveedores/${id}`, { method: 'DELETE' });
        } catch (e) { console.error(e); }
    }
    await fc_provCargar();
}

async function fc_provGuardarTodos() {
    // Leer valores del DOM
    const proveedores = [];
    document.querySelectorAll('.fc-prov-row').forEach(row => {
        const p = {};
        row.querySelectorAll('.fc-prov-field').forEach(input => {
            const field = input.dataset.field;
            if (field === 'dias_credito') p[field] = parseInt(input.value) || 0;
            else if (input.tagName === 'SELECT') p[field] = input.value;
            else p[field] = input.value;
        });
        if (p.nombre && p.nombre.trim()) proveedores.push(p);
    });

    if (proveedores.length === 0) { alert('No hay proveedores para guardar'); return; }

    try {
        const res = await fetch('/api/flujo-caja/proveedores/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ proveedores })
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        alert(`${data.guardados} proveedor(es) guardado(s)`);
        await fc_provCargar();
    } catch (e) {
        alert('Error al guardar: ' + e.message);
    }
}

function fc_provSincronizarDesdeCartera() {
    if (Object.keys(fc_cartera_cargada).length === 0) {
        alert('Primero cargue la Cartera XLS desde el boton "Cargar Cartera"');
        return;
    }

    // Agregar proveedores de la cartera que no existan
    const existentes = new Set(fc_proveedores_bd.map(p => p.nombre.toUpperCase()));
    let agregados = 0;

    for (const [key, val] of Object.entries(fc_cartera_cargada)) {
        if (!existentes.has(val.nombre.toUpperCase())) {
            const diasCred = fc_buscarDiasCredito(val.nombre);
            fc_proveedores_bd.push({
                id: 0, nombre: val.nombre, nombre_comercial: '',
                criticidad: 'BAJO', dias_credito: diasCred,
                dia_despacho: '', productos_servicios: '', observaciones: ''
            });
            agregados++;
        }
    }

    fc_provRender();
    if (agregados > 0) alert(`${agregados} proveedor(es) agregado(s) desde la cartera. Recuerde dar clic en "Guardar Todos".`);
    else alert('Todos los proveedores de la cartera ya estan en el catalogo');
}

// Obtener datos de proveedor desde BD al cargar cartera
async function fc_cargarProveedoresBD() {
    try {
        const res = await fetch('/api/flujo-caja/proveedores');
        const data = await res.json();
        if (data.ok) fc_proveedores_bd = data.proveedores;
    } catch (e) { console.error(e); }
}

// Buscar proveedor en catalogo BD por nombre
function fc_buscarProveedorBD(nombre) {
    const upper = nombre.toUpperCase();
    return fc_proveedores_bd.find(p => p.nombre.toUpperCase() === upper) ||
           fc_proveedores_bd.find(p => upper.includes(p.nombre.toUpperCase()) || p.nombre.toUpperCase().includes(upper));
}

// ============ PAGOS RECURRENTES ============
let fc_recurrentes_bd = [];

async function fc_abrirRecurrentes() {
    let modal = document.getElementById('fc-modal-recurrentes');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'fc-modal-recurrentes';
        modal.className = 'fc-modal';
        document.body.appendChild(modal);
    }

    const diasSemNombres = ['Dom','Lun','Mar','Mie','Jue','Vie','Sab'];
    const frecuencias = [
        {v:'semanal',t:'Semanal'},
        {v:'quincenal',t:'Quincenal (1 y 15)'},
        {v:'mensual',t:'Mensual'},
        {v:'ultimo-mes',t:'Fin de mes'},
        {v:'dias-habiles',t:'Dias habiles (L-V)'}
    ];
    const grupos = [
        {v:'inst-pub',t:'Instituciones Publicas'},
        {v:'arriendos',t:'Arriendos'},
        {v:'prestamos',t:'Prestamos'},
        {v:'nomina',t:'Nomina'},
        {v:'colaboradores',t:'Colaboradores'},
        {v:'cajas',t:'Cajas Chicas'},
        {v:'servicios',t:'Servicios Basicos'},
        {v:'debitos',t:'Debitos Automaticos'},
        {v:'tarjetas',t:'Tarjetas de Credito'},
        {v:'entrenamiento',t:'Entrenamiento'},
        {v:'tasas',t:'Tasas y Contribuciones'},
        {v:'prov-principales',t:'Proveedores'}
    ];

    modal.innerHTML = `
        <div class="fc-modal-overlay" onclick="fc_cerrarRecurrentes()"></div>
        <div class="fc-modal-facturas-content" style="width:900px;max-height:90vh;">
            <div class="fc-modal-header" style="background:#00695c;">
                <span class="fc-modal-icon" style="background:rgba(255,255,255,.1);"><i class="fas fa-redo"></i></span>
                <div style="flex:1;">
                    <h3 style="margin:0;font-size:14px;">Pagos Recurrentes</h3>
                    <p style="margin:2px 0 0;font-size:10px;opacity:.85;">Se proyectan automaticamente en cualquier semana que visualice</p>
                </div>
                <button class="fc-modal-close" onclick="fc_cerrarRecurrentes()">&times;</button>
            </div>
            <div class="fc-fac-toolbar">
                <button onclick="fc_recAgregar()" class="fc-btn-add-fac" style="border-color:#00695c;color:#00695c;">+ Nuevo Pago</button>
                <button onclick="fc_recGuardarTodos()" class="fc-btn-buscar-cartera" style="background:#00695c;">Guardar Todos</button>
                <span style="margin-left:auto;font-size:10px;color:#64748b;" id="fc-rec-count">0 pagos</span>
            </div>
            <div class="fc-fac-body" style="max-height:60vh;">
                <table class="fc-tabla-facturas" id="fc-tabla-recurrentes">
                    <thead>
                        <tr>
                            <th style="min-width:150px;">Nombre</th>
                            <th style="min-width:100px;">Grupo</th>
                            <th style="width:80px;">Monto</th>
                            <th style="min-width:100px;">Frecuencia</th>
                            <th style="width:55px;">Dia Mes</th>
                            <th style="width:70px;">Dia Sem.</th>
                            <th style="width:60px;">Banco</th>
                            <th style="width:40px;">Activo</th>
                            <th style="min-width:100px;">Observaciones</th>
                            <th style="width:30px;"></th>
                        </tr>
                    </thead>
                    <tbody id="fc-rec-body"><tr><td colspan="10" style="text-align:center;padding:20px;color:#94a3b8;">Cargando...</td></tr></tbody>
                </table>
            </div>
            <div class="fc-fac-footer">
                <div style="font-size:10px;color:#64748b;">Los pagos activos se proyectan automaticamente al consultar el flujo de caja.</div>
                <div class="fc-fac-btns">
                    <button onclick="fc_cerrarRecurrentes()" class="fc-btn-cancelar">Cerrar</button>
                </div>
            </div>
        </div>
    `;

    modal.classList.add('active');
    fc_inyectarEstilosFacturas();
    await fc_recCargar();
}

function fc_cerrarRecurrentes() {
    const modal = document.getElementById('fc-modal-recurrentes');
    if (modal) modal.classList.remove('active');
}

async function fc_recCargar() {
    try {
        const res = await fetch('/api/flujo-caja/recurrentes');
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        fc_recurrentes_bd = data.pagos;
        fc_recRender();
    } catch (e) {
        document.getElementById('fc-rec-body').innerHTML = `<tr><td colspan="10" style="text-align:center;padding:20px;color:#dc2626;">Error: ${e.message}</td></tr>`;
    }
}

function fc_recRender() {
    const tbody = document.getElementById('fc-rec-body');
    if (!tbody) return;

    const frecOpts = (sel) => ['semanal','quincenal','mensual','ultimo-mes','dias-habiles']
        .map(f => `<option value="${f}" ${f===sel?'selected':''}>${f}</option>`).join('');
    const grupoOpts = (sel) => [
        ['inst-pub','Inst. Publicas'],['arriendos','Arriendos'],['prestamos','Prestamos'],
        ['nomina','Nomina'],['colaboradores','Colaboradores'],['cajas','Cajas Chicas'],
        ['servicios','Serv. Basicos'],['debitos','Debitos Auto.'],['tarjetas','Tarjetas Cred.'],
        ['entrenamiento','Entrenamiento'],['tasas','Tasas/Contrib.'],['prov-principales','Proveedores']
    ].map(([v,t]) => `<option value="${v}" ${v===sel?'selected':''}>${t}</option>`).join('');
    const diaSemOpts = (sel) => ['Dom','Lun','Mar','Mie','Jue','Vie','Sab']
        .map((d,i) => `<option value="${i}" ${i===sel?'selected':''}>${d}</option>`).join('');

    if (fc_recurrentes_bd.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;color:#94a3b8;">No hay pagos recurrentes configurados.</td></tr>';
        document.getElementById('fc-rec-count').textContent = '0 pagos';
        return;
    }

    let html = '';
    fc_recurrentes_bd.forEach((p, idx) => {
        html += `<tr class="fc-rec-row" data-idx="${idx}" data-id="${p.id}" style="${!p.activo?'opacity:.5':''}">
            <td><input type="text" class="fc-fac-input fc-rec-field" value="${p.nombre}" data-field="nombre" style="font-weight:600;"></td>
            <td><select class="fc-fac-select-fecha fc-rec-field" data-field="grupo">${grupoOpts(p.grupo)}</select></td>
            <td><input type="text" class="fc-fac-input fc-rec-field" value="${p.monto}" data-field="monto" style="text-align:right;font-weight:600;width:70px;"></td>
            <td><select class="fc-fac-select-fecha fc-rec-field" data-field="frecuencia">${frecOpts(p.frecuencia)}</select></td>
            <td><input type="number" class="fc-fac-input fc-rec-field" value="${p.dia_mes}" data-field="dia_mes" min="1" max="31" style="width:45px;text-align:center;"></td>
            <td><select class="fc-fac-select-fecha fc-rec-field" data-field="dia_semana">${diaSemOpts(p.dia_semana)}</select></td>
            <td><select class="fc-fac-select-fecha fc-rec-field" data-field="banco">
                <option value="produbanco" ${p.banco==='produbanco'?'selected':''}>PRO</option>
                <option value="pichincha" ${p.banco==='pichincha'?'selected':''}>PICH</option>
            </select></td>
            <td><input type="checkbox" class="fc-rec-field" data-field="activo" ${p.activo?'checked':''}></td>
            <td><input type="text" class="fc-fac-input fc-rec-field" value="${p.observaciones}" data-field="observaciones" style="font-size:10px;"></td>
            <td><button class="fc-btn-del-fac" onclick="fc_recEliminar(${p.id},'${p.nombre.replace(/'/g,"\\'")}')">x</button></td>
        </tr>`;
    });

    tbody.innerHTML = html;
    document.getElementById('fc-rec-count').textContent = `${fc_recurrentes_bd.length} pagos`;
}

function fc_recAgregar() {
    fc_recurrentes_bd.push({
        id: 0, nombre: '', grupo: 'pagos-fijos', monto: 0, frecuencia: 'mensual',
        dia_mes: 1, dia_semana: 1, banco: 'produbanco', activo: true, observaciones: ''
    });
    fc_recRender();
    const rows = document.querySelectorAll('.fc-rec-row');
    rows[rows.length - 1]?.querySelector('[data-field="nombre"]')?.focus();
}

async function fc_recEliminar(id, nombre) {
    if (!confirm(`¿Eliminar pago recurrente "${nombre}"?`)) return;
    if (id > 0) {
        try { await fetch(`/api/flujo-caja/recurrentes/${id}`, { method: 'DELETE' }); } catch (e) { console.error(e); }
    }
    await fc_recCargar();
}

async function fc_recGuardarTodos() {
    const pagos = [];
    document.querySelectorAll('.fc-rec-row').forEach(row => {
        const p = { id: parseInt(row.dataset.id) || 0 };
        row.querySelectorAll('.fc-rec-field').forEach(el => {
            const field = el.dataset.field;
            if (field === 'activo') p[field] = el.checked;
            else if (field === 'monto') p[field] = parseFloat(el.value.replace(/,/g,'')) || 0;
            else if (field === 'dia_mes' || field === 'dia_semana') p[field] = parseInt(el.value) || 0;
            else if (el.tagName === 'SELECT') p[field] = el.value;
            else p[field] = el.value;
        });
        if (p.nombre && p.nombre.trim()) pagos.push(p);
    });

    if (pagos.length === 0) { alert('No hay pagos para guardar'); return; }

    try {
        let guardados = 0;
        for (const p of pagos) {
            const res = await fetch('/api/flujo-caja/recurrentes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(p)
            });
            const data = await res.json();
            if (data.ok) guardados++;
        }
        alert(`${guardados} pago(s) recurrente(s) guardado(s)`);
        await fc_recCargar();
    } catch (e) {
        alert('Error al guardar: ' + e.message);
    }
}

// Proyectar pagos recurrentes en las celdas del flujo
async function fc_proyectarRecurrentes() {
    try {
        const res = await fetch('/api/flujo-caja/recurrentes');
        const data = await res.json();
        if (!data.ok || !data.pagos) return;

        const pagosActivos = data.pagos.filter(p => p.activo);
        if (pagosActivos.length === 0) return;

        const semanas = (fc_semanas && fc_semanas.length > 0) ? fc_semanas : window._fc_semanas;
        if (!semanas || semanas.length === 0) return;

        pagosActivos.forEach(pago => {
            // Buscar la fila de egreso que coincida por nombre
            let targetRow = null;
            document.querySelectorAll('[class*="fc-egreso-item-"]').forEach(row => {
                const nombre = row.querySelector('.fc-input-nombre')?.value || '';
                if (nombre.toUpperCase() === pago.nombre.toUpperCase()) targetRow = row;
            });

            // Si no existe, crear el item en el grupo correspondiente
            if (!targetRow) {
                const grupoHeader = document.getElementById(`fc-grupo-${pago.grupo}`);
                if (!grupoHeader) return;
                fc_agregarItem(pago.grupo);
                const items = document.querySelectorAll(`.fc-egreso-item-${pago.grupo}`);
                targetRow = items[items.length - 1];
                if (targetRow) {
                    const nombreInput = targetRow.querySelector('.fc-input-nombre');
                    if (nombreInput) nombreInput.value = pago.nombre;
                    targetRow.dataset.banco = pago.banco;
                    const selectBanco = targetRow.querySelector('.fc-select-banco');
                    if (selectBanco) selectBanco.value = pago.banco;
                }
            }
            if (!targetRow) return;

            // Calcular fechas donde aplica el pago
            fc_todasFechas.forEach(fecha => {
                const d = new Date(fecha + 'T12:00:00');
                let aplica = false;

                if (pago.frecuencia === 'mensual') {
                    aplica = d.getDate() === pago.dia_mes;
                } else if (pago.frecuencia === 'quincenal') {
                    aplica = d.getDate() === 1 || d.getDate() === 15;
                } else if (pago.frecuencia === 'semanal') {
                    aplica = d.getDay() === pago.dia_semana;
                } else if (pago.frecuencia === 'ultimo-mes') {
                    const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
                    aplica = d.getDate() === ultimoDia;
                } else if (pago.frecuencia === 'dias-habiles') {
                    aplica = d.getDay() >= 1 && d.getDay() <= 5;
                }

                if (aplica) {
                    const input = targetRow.querySelector(`.fc-input[data-fecha="${fecha}"]`);
                    if (input && !input.value) {
                        input.value = pago.monto.toFixed(2);
                    }
                }
            });
        });

        fc_recalcularTodo();
    } catch (e) {
        console.error('Error proyectando recurrentes:', e);
    }
}

// ============ PLAN DE PAGO DE DEUDAS ============

function fc_calcularPlanDeudas() {
    const container = document.getElementById('fc-deudas-container');
    const body = document.getElementById('fc-deudas-body');
    container.style.display = '';

    const hoy = new Date();
    hoy.setHours(0,0,0,0);

    // Recopilar todas las facturas vencidas +60 dias de todos los proveedores
    const deudasCriticas = [];

    document.querySelectorAll('[class*="fc-egreso-item-"]').forEach(row => {
        const rowId = row.dataset.fcRowId;
        if (!rowId) return;
        const facturas = fc_facturas_data[rowId] || [];
        if (facturas.length === 0) return;

        const nombre = row.querySelector('.fc-input-nombre')?.value || 'Proveedor';
        const diasCredito = parseInt(row.querySelector('.fc-input-dias')?.value) || 0;

        facturas.forEach(fac => {
            let fechaVencReal = fac.vencimiento;
            if (diasCredito > 0 && fac.fecha) {
                const fe = new Date(fac.fecha + 'T12:00:00');
                fe.setDate(fe.getDate() + diasCredito);
                fechaVencReal = fe.toISOString().split('T')[0];
            }
            if (!fechaVencReal) return;

            const fVenc = new Date(fechaVencReal + 'T12:00:00');
            const diasVenc = Math.round((hoy - fVenc) / (1000*60*60*24));

            if (diasVenc > 0) {
                const abono = fac.abono || 0;
                const pendiente = (fac.monto || 0) - abono;
                if (pendiente <= 0) return;

                deudasCriticas.push({
                    proveedor: nombre,
                    factura: fac.num || '(sin nro)',
                    monto: fac.monto || 0,
                    abonado: abono,
                    pendiente: pendiente,
                    diasVencido: diasVenc,
                    vencimiento: fechaVencReal,
                    programado: !!fac.fecha_pago,
                    rowId: rowId
                });
            }
        });
    });

    // Ordenar por dias vencido (mas antiguo primero)
    deudasCriticas.sort((a, b) => b.diasVencido - a.diasVencido);

    // Calcular flujo disponible (ahorro proyectado de las semanas visibles)
    let totalIngresos = 0;
    let totalEgresos = 0;
    fc_semanasNums.forEach(sem => {
        const ingCell = document.querySelector(`.fc-total-ingresos-sem[data-semana="${sem}"]`);
        if (ingCell && ingCell.textContent !== '-') totalIngresos += parseFloat(ingCell.textContent.replace(/,/g,'')) || 0;
        const egrCell = document.querySelector(`.fc-total-egresos-sem[data-semana="${sem}"]`);
        if (egrCell && egrCell.textContent !== '-') totalEgresos += parseFloat(egrCell.textContent.replace(/,/g,'')) || 0;
    });
    const flujoDisponible = totalIngresos - totalEgresos;

    // Totales
    const totalDeudaCritica = deudasCriticas.reduce((s, d) => s + d.pendiente, 0);
    const deudas60 = deudasCriticas.filter(d => d.diasVencido > 60);
    const deudas30 = deudasCriticas.filter(d => d.diasVencido <= 60 && d.diasVencido > 30);
    const deudas0 = deudasCriticas.filter(d => d.diasVencido <= 30);
    const total60 = deudas60.reduce((s, d) => s + d.pendiente, 0);
    const total30 = deudas30.reduce((s, d) => s + d.pendiente, 0);
    const total0 = deudas0.reduce((s, d) => s + d.pendiente, 0);

    // Estimar meses para pagar con ahorro
    const mesesParaPagar = flujoDisponible > 0 ? Math.ceil(totalDeudaCritica / flujoDisponible * (fc_semanas?.length || 4) / 4.3) : 0;

    // Agrupar por proveedor para resumen
    const porProveedor = {};
    deudasCriticas.forEach(d => {
        if (!porProveedor[d.proveedor]) porProveedor[d.proveedor] = { total: 0, facturas: 0, maxDias: 0 };
        porProveedor[d.proveedor].total += d.pendiente;
        porProveedor[d.proveedor].facturas++;
        if (d.diasVencido > porProveedor[d.proveedor].maxDias) porProveedor[d.proveedor].maxDias = d.diasVencido;
    });

    let html = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px;">
            <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;">
                <div style="font-size:10px;color:#991b1b;font-weight:600;">DEUDA VENCIDA TOTAL</div>
                <div style="font-size:20px;font-weight:700;color:#dc2626;">$${totalDeudaCritica.toLocaleString('en-US',{minimumFractionDigits:2})}</div>
                <div style="font-size:10px;color:#991b1b;">${deudasCriticas.length} facturas de ${Object.keys(porProveedor).length} proveedores</div>
            </div>
            <div style="background:${flujoDisponible>=0?'#f0fdf4':'#fef2f2'};border:1px solid ${flujoDisponible>=0?'#bbf7d0':'#fecaca'};border-radius:8px;padding:12px;">
                <div style="font-size:10px;color:#64748b;font-weight:600;">FLUJO DISPONIBLE (${fc_semanas?.length||0} sem)</div>
                <div style="font-size:20px;font-weight:700;color:${flujoDisponible>=0?'#16a34a':'#dc2626'};">$${flujoDisponible.toLocaleString('en-US',{minimumFractionDigits:2})}</div>
                <div style="font-size:10px;color:#64748b;">Ingresos - Egresos proyectados</div>
            </div>
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px;">
                <div style="font-size:10px;color:#1e40af;font-weight:600;">TIEMPO ESTIMADO</div>
                <div style="font-size:20px;font-weight:700;color:#1565c0;">${mesesParaPagar > 0 ? mesesParaPagar + ' mes(es)' : 'N/A'}</div>
                <div style="font-size:10px;color:#1e40af;">Para cancelar deuda vencida</div>
            </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px;">
            <div style="background:#dc2626;color:#fff;border-radius:6px;padding:8px 12px;text-align:center;">
                <div style="font-size:10px;opacity:.8;">+60 dias (${deudas60.length} fac)</div>
                <div style="font-size:16px;font-weight:700;">$${total60.toLocaleString('en-US',{minimumFractionDigits:2})}</div>
            </div>
            <div style="background:#ea580c;color:#fff;border-radius:6px;padding:8px 12px;text-align:center;">
                <div style="font-size:10px;opacity:.8;">30-60 dias (${deudas30.length} fac)</div>
                <div style="font-size:16px;font-weight:700;">$${total30.toLocaleString('en-US',{minimumFractionDigits:2})}</div>
            </div>
            <div style="background:#ca8a04;color:#fff;border-radius:6px;padding:8px 12px;text-align:center;">
                <div style="font-size:10px;opacity:.8;">1-30 dias (${deudas0.length} fac)</div>
                <div style="font-size:16px;font-weight:700;">$${total0.toLocaleString('en-US',{minimumFractionDigits:2})}</div>
            </div>
        </div>

        <h4 style="margin:0 0 8px;font-size:12px;color:#1e293b;">Facturas vencidas +60 dias (prioridad de pago)</h4>
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
            <thead>
                <tr style="background:#1e293b;color:#fff;">
                    <th style="padding:8px;text-align:left;">Proveedor</th>
                    <th style="padding:8px;text-align:left;">Factura</th>
                    <th style="padding:8px;text-align:right;">Monto</th>
                    <th style="padding:8px;text-align:right;">Abonado</th>
                    <th style="padding:8px;text-align:right;">Pendiente</th>
                    <th style="padding:8px;text-align:center;">Dias Venc.</th>
                    <th style="padding:8px;text-align:center;">Estado</th>
                </tr>
            </thead>
            <tbody>`;

    if (deudas60.length === 0) {
        html += '<tr><td colspan="7" style="text-align:center;padding:20px;color:#16a34a;">No hay facturas vencidas +60 dias</td></tr>';
    } else {
        deudas60.forEach(d => {
            const estadoHtml = d.programado
                ? '<span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:3px;font-size:9px;font-weight:600;">PROGRAMADO</span>'
                : '<span style="background:#fef2f2;color:#dc2626;padding:2px 8px;border-radius:3px;font-size:9px;font-weight:600;">PENDIENTE</span>';
            html += `<tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:6px 8px;font-weight:600;">${d.proveedor}</td>
                <td style="padding:6px 8px;font-family:monospace;font-size:10px;">${d.factura}</td>
                <td style="padding:6px 8px;text-align:right;">$${d.monto.toLocaleString('en-US',{minimumFractionDigits:2})}</td>
                <td style="padding:6px 8px;text-align:right;color:#16a34a;">${d.abonado > 0 ? '$'+d.abonado.toLocaleString('en-US',{minimumFractionDigits:2}) : '-'}</td>
                <td style="padding:6px 8px;text-align:right;font-weight:700;color:#dc2626;">$${d.pendiente.toLocaleString('en-US',{minimumFractionDigits:2})}</td>
                <td style="padding:6px 8px;text-align:center;font-weight:700;color:#dc2626;">${d.diasVencido}d</td>
                <td style="padding:6px 8px;text-align:center;">${estadoHtml}</td>
            </tr>`;
        });
    }

    html += `</tbody></table>`;

    // Tabla resumen por proveedor
    const provOrdenado = Object.entries(porProveedor).sort((a, b) => b[1].total - a[1].total);
    html += `
        <h4 style="margin:16px 0 8px;font-size:12px;color:#1e293b;">Resumen por Proveedor (todas las vencidas)</h4>
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
            <thead>
                <tr style="background:#f1f5f9;">
                    <th style="padding:6px 8px;text-align:left;">Proveedor</th>
                    <th style="padding:6px 8px;text-align:center;">Facturas</th>
                    <th style="padding:6px 8px;text-align:right;">Total Pendiente</th>
                    <th style="padding:6px 8px;text-align:center;">Max Dias Venc.</th>
                </tr>
            </thead>
            <tbody>`;

    provOrdenado.forEach(([prov, datos]) => {
        const critColor = datos.maxDias > 60 ? '#dc2626' : datos.maxDias > 30 ? '#ea580c' : '#ca8a04';
        html += `<tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:6px 8px;font-weight:600;">${prov}</td>
            <td style="padding:6px 8px;text-align:center;">${datos.facturas}</td>
            <td style="padding:6px 8px;text-align:right;font-weight:700;color:#dc2626;">$${datos.total.toLocaleString('en-US',{minimumFractionDigits:2})}</td>
            <td style="padding:6px 8px;text-align:center;font-weight:700;color:${critColor};">${datos.maxDias}d</td>
        </tr>`;
    });

    html += '</tbody></table>';
    body.innerHTML = html;
}

// Mostrar plan de deudas automaticamente al cargar datos del flujo
const fc_origCargarDatos = fc_cargarDatos;
fc_cargarDatos = async function(reintentos) {
    await fc_origCargarDatos(reintentos);
    await fc_proyectarRecurrentes();
};

// Registrar en el sistema de vistas
if (typeof window.viewInitializers === 'undefined') {
    window.viewInitializers = {};
}
window.viewInitializers['flujo-caja'] = fc_init;
