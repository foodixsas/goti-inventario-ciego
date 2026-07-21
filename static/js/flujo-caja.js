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
    html += '<th class="col-saldo" rowspan="3" style="background:#e3f2fd; min-width:80px;">SALDO</th>';
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
    html += '<td class="col-saldo" style="background:#b3e5fc !important;"></td>';
    html += '</tr>';

    // SALDO INICIAL PICHINCHA
    html += `<tr class="row-total" style="background:#c8e6c9 !important;"><td class="col-concepto" style="background:#c8e6c9 !important; font-weight:bold;">SALDO INICIAL PICHINCHA</td>`;
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
    // Header clickeable para colapsar/expandir CON totales
    html += `<tr class="row-banco" id="fc-grupo-${sg.id}" data-grupo-header="eg-${sg.id}" data-expanded="true" onclick="fc_toggleGrupo('eg-${sg.id}')" style="cursor:pointer;"><td class="col-concepto indent-2"><span class="fc-grupo-icon" style="margin-right:6px;">▼</span>${sg.nombre} <button class="fc-btn-add" onclick="event.stopPropagation();fc_agregarItem('${sg.id}')">+</button></td>`;
    fc_semanas.forEach(sem => {
        html += `<td class="col-semana sem-${sem.num}-header monto fc-total-${sg.id}-sem" data-semana="${sem.num}" style="font-weight:600;">-</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            html += `<td class="dia-col sem-${sem.num}${sab} monto fc-total-${sg.id}-dia" data-fecha="${dia}" style="font-weight:600;">-</td>`;
        });
        html += `<td class="dia-col sem-${sem.num} total-col monto fc-total-${sg.id}-total" data-semana="${sem.num}" style="font-weight:600;">-</td>`;
    });
    // Columna SALDO total del grupo
    html += `<td class="col-saldo monto fc-saldo-grupo-${sg.id}" style="font-weight:600; background:#e3f2fd; min-width:80px;">-</td>`;
    html += '</tr>';

    sg.items.forEach(item => {
        html += `<tr class="row-banco-item fc-egreso-item-${sg.id}" data-grupo="eg-${sg.id}" data-banco="produbanco" data-deuda="0"><td class="col-concepto indent-3">
            <select class="fc-select-banco" onchange="this.closest('tr').dataset.banco=this.value;fc_recalcularTodo()" title="Banco de salida">
                <option value="produbanco" selected>PRO</option>
                <option value="pichincha">PICH</option>
            </select>
            <input type="text" class="fc-input-nombre" value="${item}">
            <span class="fc-saldo-badge" onclick="fc_abrirDeuda(this)" title="Click para agregar deuda"></span>
            <button class="fc-btn-del" onclick="fc_eliminarItem(this)">x</button>
        </td>`;
        fc_semanas.forEach(sem => {
            html += `<td class="col-semana sem-${sem.num}-header monto fc-item-sem" data-semana="${sem.num}">-</td>`;
            sem.dias.forEach((dia, i) => {
                const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
                html += `<td class="dia-col sem-${sem.num}${sab} monto fc-celda-egreso">
                    <input type="text" class="fc-input fc-input-egreso-${sg.id}" data-fecha="${dia}" data-semana="${sem.num}" placeholder="0" onchange="fc_recalcularTodo()">
                    <button class="fc-btn-rep" onclick="fc_abrirRecurrencia(this)" title="Repetir desde aqui">&#x21bb;</button>
                </td>`;
            });
            html += `<td class="dia-col sem-${sem.num} total-col monto fc-item-total" data-semana="${sem.num}">-</td>`;
        });
        // Columna SALDO del item (editable)
        html += `<td class="col-saldo monto" style="background:#e3f2fd; min-width:80px;">
            <input type="text" class="fc-input fc-input-saldo" placeholder="0" onchange="fc_recalcularSaldos()" style="width:70px; text-align:right; background:#e3f2fd;">
        </td>`;
        html += '</tr>';
    });

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

    // SALDO FINAL PRODUBANCO
    html += `<tr class="row-total" style="background:#b3e5fc !important;"><td class="col-concepto" style="background:#b3e5fc !important; font-weight:bold;">SALDO FINAL PRODUBANCO</td>`;
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
    newRow.className = `row-banco-item fc-egreso-item-${grupo}`;
    newRow.dataset.grupo = `eg-${grupo}`;
    newRow.dataset.banco = 'produbanco';

    let celdas = `<td class="col-concepto indent-3">
        <select class="fc-select-banco" onchange="this.closest('tr').dataset.banco=this.value;fc_recalcularTodo()" title="Banco de salida">
            <option value="produbanco" selected>PRO</option>
            <option value="pichincha">PICH</option>
        </select>
        <input type="text" class="fc-input-nombre" value="Nuevo Item">
        <span class="fc-saldo-badge" onclick="fc_abrirDeuda(this)" title="Click para agregar deuda"></span>
        <button class="fc-btn-del" onclick="fc_eliminarItem(this)">x</button>
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

    // Header con totales integrados
    const headerRow = document.createElement('tr');
    headerRow.className = 'row-banco';
    headerRow.id = `fc-grupo-${grupoId}`;
    headerRow.dataset.grupoHeader = `eg-${grupoId}`;
    headerRow.dataset.expanded = 'true';
    let headerCeldas = `<td class="col-concepto indent-2"><span class="fc-grupo-icon" style="margin-right:6px;">▼</span><input type="text" class="fc-input-nombre" value="NUEVO SUBGRUPO" style="font-weight:bold;text-transform:uppercase;width:120px;"> <button class="fc-btn-add" onclick="event.stopPropagation();fc_agregarItem('${grupoId}')">+</button> <button class="fc-btn-del" onclick="fc_eliminarSubgrupo(this)">x</button></td>`;
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
    itemRow.className = `row-banco-item fc-egreso-item-${grupoId}`;
    itemRow.dataset.grupo = `eg-${grupoId}`;
    itemRow.dataset.banco = 'produbanco';

    let itemHtml = `<td class="col-concepto indent-3">
        <select class="fc-select-banco" onchange="this.closest('tr').dataset.banco=this.value;fc_recalcularTodo()" title="Banco de salida">
            <option value="produbanco" selected>PRO</option>
            <option value="pichincha">PICH</option>
        </select>
        <input type="text" class="fc-input-nombre" value="Item 1">
        <span class="fc-saldo-badge" onclick="fc_abrirDeuda(this)" title="Click para agregar deuda"></span>
        <button class="fc-btn-del" onclick="fc_eliminarItem(this)">x</button>
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

        // Generar rango amplio: desde primera semana visible hasta +52 semanas
        // Esto asegura que datos guardados en proyecciones largas se carguen en proyecciones cortas
        const primeraFecha = new Date(semanas[0].inicio + 'T12:00:00');
        const todasLasFechas = [];
        for (let i = 0; i < 52; i++) {
            const fecha = new Date(primeraFecha);
            fecha.setDate(primeraFecha.getDate() + (i * 7));
            todasLasFechas.push(fecha.toISOString().split('T')[0]);
        }
        const fechas = todasLasFechas.join(',');
        const response = await fetch(`/api/flujo-caja/cargar-guardado?fechas=${fechas}`);
        if (!response.ok) return;

        const data = await response.json();
        if (!data.ok || !data.guardados) return;

        // Consolidar egresos de todas las semanas antes de aplicar
        const egresosConsolidados = {};
        for (const [fechaSemana, guardado] of Object.entries(data.guardados)) {
            if (guardado.egresos) {
                for (const [grupo, items] of Object.entries(guardado.egresos)) {
                    if (!egresosConsolidados[grupo]) egresosConsolidados[grupo] = [];
                    items.forEach((item, idx) => {
                        // Buscar si ya existe este item por nombre
                        let existente = egresosConsolidados[grupo].find(e => e.nombre === item.nombre);
                        if (!existente) {
                            existente = { nombre: item.nombre, banco: item.banco, deuda: item.deuda || 0, saldo: item.saldo || 0, valores: {} };
                            egresosConsolidados[grupo].push(existente);
                        }
                        // Consolidar valores (fechas)
                        for (const [dia, valor] of Object.entries(item.valores || {})) {
                            if (valor) existente.valores[dia] = valor;
                        }
                        // Actualizar banco, deuda y saldo si vienen
                        if (item.banco) existente.banco = item.banco;
                        if (item.deuda) existente.deuda = item.deuda;
                        if (item.saldo) existente.saldo = item.saldo;
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
            // Crear items faltantes
            let rows = document.querySelectorAll(`.fc-egreso-item-${grupo}`);
            while (rows.length < items.length) {
                fc_agregarItem(grupo);
                rows = document.querySelectorAll(`.fc-egreso-item-${grupo}`);
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
async function fc_guardarDatos() {
    const semanas = (fc_semanas && fc_semanas.length > 0) ? fc_semanas : window._fc_semanas;
    if (!semanas || semanas.length === 0) {
        alert('No hay datos para guardar');
        return;
    }

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
                const itemData = { nombre, banco, deuda, saldo, valores: {} };
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

        // Agregar estilos
        if (!document.getElementById('fc-modal-styles')) {
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
    }

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

// Registrar en el sistema de vistas
if (typeof window.viewInitializers === 'undefined') {
    window.viewInitializers = {};
}
window.viewInitializers['flujo-caja'] = fc_init;
