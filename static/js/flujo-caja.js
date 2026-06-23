/**
 * MODULO FLUJO DE CAJA - FOODIX
 * Proyeccion de ingresos y egresos
 * Prefijo: fc_
 */

// Estado del modulo
let fc_datos = null;
let fc_semanas = [];
let fc_semanasNums = [];

// Inicializar cuando se carga la vista
function fc_init() {
    fc_cargarDatos();
}

// Cargar datos desde API
async function fc_cargarDatos() {
    const container = document.getElementById('fc-tabla-container');
    container.innerHTML = '<div class="fc-loading"><div class="spinner"></div><p>Calculando proyecciones...</p></div>';

    try {
        const response = await fetch('/api/flujo-caja/datos');
        if (!response.ok) throw new Error('Error al cargar datos');

        fc_datos = await response.json();
        fc_semanas = fc_datos.semanas;
        fc_semanasNums = fc_semanas.map(s => s.num);

        fc_renderTabla();
        fc_actualizarInfo();
        fc_actualizarResumen();

    } catch (error) {
        console.error('Error flujo caja:', error);
        container.innerHTML = '<div class="fc-loading"><p style="color:#ef4444;">Error al cargar datos. Intente nuevamente.</p></div>';
    }
}

// Actualizar info
function fc_actualizarInfo() {
    const info = document.getElementById('fc-info');
    const fecha = new Date().toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    info.textContent = `Generado: ${fecha} | Datos desde Azure PostgreSQL | TC al 86% neto (14% comision)`;
}

// Actualizar resumen cards
function fc_actualizarResumen() {
    document.getElementById('fc-resumen').style.display = 'grid';

    let totalIngresos = 0;
    fc_semanas.forEach(sem => {
        totalIngresos += (fc_datos.totales_produbanco[sem.num] || 0) + (fc_datos.totales_pichincha[sem.num] || 0);
    });

    document.getElementById('fc-total-ingresos').textContent = fc_formatMonto(totalIngresos);
    document.getElementById('fc-saldo-produbanco').textContent = fc_formatMonto(fc_datos.totales_produbanco[fc_semanas[0]?.num] || 0);
    document.getElementById('fc-total-egresos').textContent = '$0.00';
}

// Formato de monto
function fc_formatMonto(v) {
    if (v === 0 || v === null || v === undefined) return '-';
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
        html += `<th class="col-semana header-semana sem-${sem.num}-header" onclick="fc_toggleSemana(${sem.num})" colspan="1">Sem ${sem.num}</th>`;
        html += `<th class="dia-col sem-${sem.num} header-semana" colspan="8" style="display:none;">Semana ${sem.num}</th>`;
    });
    html += '</tr>';

    // Header fechas
    html += '<tr class="header-dias">';
    fc_semanas.forEach(sem => {
        const inicio = new Date(sem.inicio);
        const fin = new Date(sem.fin);
        html += `<td class="col-semana sem-${sem.num}-header">${inicio.getDate()}-${meses[inicio.getMonth()+1]} al ${fin.getDate()}-${meses[fin.getMonth()+1]}</td>`;
        sem.dias.forEach((dia, i) => {
            const d = new Date(dia);
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

    // INGRESOS
    html += fc_renderSeccion('INGRESOS', 'row-section');

    // PRODUBANCO
    html += fc_renderSubseccion('BANCO PRODUBANCO');
    html += fc_renderFilaMontos('Deposito TC', fc_datos.depositos_tc, 'neto');
    html += fc_renderFilaMontos('Deposito Efectivo', fc_datos.depositos_efectivo, 'total');
    html += fc_renderFilaTraspaso();
    html += fc_renderFilaTotal('Total Produbanco', fc_datos.totales_produbanco, 'total-produbanco');

    // PICHINCHA
    html += fc_renderSubseccion('BANCO PICHINCHA');
    html += fc_renderFilaMontos('Deposito DEUNA', fc_datos.depositos_deuna, 'total');
    html += fc_renderFilaTotal('Total Pichincha', fc_datos.totales_pichincha, 'total-pichincha');

    // Total Ingresos
    html += fc_renderFilaTotalGeneral('TOTAL INGRESOS', 'total-ingresos', '#c8e6c9');

    // EGRESOS
    html += fc_renderSeccion('EGRESOS', 'row-section');
    html += fc_renderEgresos();

    html += '</table>';
    container.innerHTML = html;
}

// Helpers para renderizar filas
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

function fc_renderFilaMontos(titulo, datos, campo) {
    let html = `<tr class="row-banco-item"><td class="col-concepto indent-2">${titulo}</td>`;
    fc_semanas.forEach(sem => {
        let totalSem = 0;
        // Columna semana colapsada
        sem.dias.forEach(dia => {
            const val = datos[dia]?.[campo] || 0;
            totalSem += val;
        });
        html += `<td class="col-semana sem-${sem.num}-header monto">${fc_formatMonto(totalSem)}</td>`;

        // Columnas dias
        sem.dias.forEach((dia, i) => {
            const val = datos[dia]?.[campo] || 0;
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            html += `<td class="dia-col sem-${sem.num}${sab} monto">${fc_formatMonto(val)}</td>`;
        });
        html += `<td class="dia-col sem-${sem.num} total-col monto">${fc_formatMonto(totalSem)}</td>`;
    });
    html += '</tr>';
    return html;
}

function fc_renderFilaTraspaso() {
    let html = `<tr class="row-banco-item"><td class="col-concepto indent-2">Traspaso desde Pichincha</td>`;
    fc_semanas.forEach(sem => {
        html += `<td class="col-semana sem-${sem.num}-header monto fc-traspaso-sem" data-semana="${sem.num}">-</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            html += `<td class="dia-col sem-${sem.num}${sab} monto"><input type="text" class="fc-input fc-input-traspaso" data-fecha="${dia}" data-semana="${sem.num}" placeholder="0" onchange="fc_recalcularTraspasos()"></td>`;
        });
        html += `<td class="dia-col sem-${sem.num} total-col monto fc-traspaso-total" data-semana="${sem.num}">-</td>`;
    });
    html += '</tr>';
    return html;
}

function fc_renderFilaTotal(titulo, datos, clase) {
    let html = `<tr class="row-banco-total"><td class="col-concepto indent-1">${titulo}</td>`;
    fc_semanas.forEach(sem => {
        const val = datos[sem.num] || 0;
        html += `<td class="col-semana sem-${sem.num}-header monto ${clase}" data-semana="${sem.num}" data-base="${val}">${fc_formatMonto(val)}</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            // Calcular valor del dia
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

function fc_renderFilaTotalGeneral(titulo, clase, color) {
    let html = `<tr class="row-total"><td class="col-concepto" style="background:${color};">${titulo}</td>`;
    fc_semanas.forEach(sem => {
        const prod = fc_datos.totales_produbanco[sem.num] || 0;
        const pich = fc_datos.totales_pichincha[sem.num] || 0;
        const total = prod + pich;
        html += `<td class="col-semana sem-${sem.num}-header monto ${clase}" data-semana="${sem.num}" style="background:${color};">${fc_formatMonto(total)}</td>`;
        sem.dias.forEach((dia, i) => {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            const tc = fc_datos.depositos_tc[dia]?.neto || 0;
            const ef = fc_datos.depositos_efectivo[dia]?.total || 0;
            const deuna = fc_datos.depositos_deuna[dia]?.total || 0;
            const valDia = tc + ef + deuna;
            html += `<td class="dia-col sem-${sem.num}${sab} monto" style="background:${color};">${fc_formatMonto(valDia)}</td>`;
        });
        html += `<td class="dia-col sem-${sem.num} total-col monto" style="background:${color};">${fc_formatMonto(total)}</td>`;
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

    // Subgrupos de pagos fijos
    const subgrupos = [
        { id: 'inst-pub', nombre: 'INSTITUCIONES PUBLICAS', items: ['SRI', 'IESS'] },
        { id: 'arriendos', nombre: 'ARRIENDOS', items: ['Arriendo Local'] },
        { id: 'nomina', nombre: 'PAGO DE NOMINA', items: ['Nomina Quincena'] },
        { id: 'cajas', nombre: 'CAJAS CHICAS', items: ['Reposicion Cajas'] }
    ];

    subgrupos.forEach(sg => {
        html += fc_renderSubgrupoEgreso(sg);
    });

    // Total Pagos Fijos
    html += fc_renderTotalEgreso('Total Pagos Fijos', 'pagos-fijos', '#ffcdd2');

    // PAGO PROVEEDORES
    html += `<tr class="row-subsection"><td class="col-concepto indent-1">PAGO PROVEEDORES <button class="fc-btn-add" onclick="fc_agregarSubgrupo('proveedores')" title="Agregar subgrupo">+</button></td>`;
    fc_semanas.forEach(sem => {
        html += `<td class="col-semana sem-${sem.num}-header"></td>`;
        for (let i = 0; i < 8; i++) html += `<td class="dia-col sem-${sem.num}"></td>`;
    });
    html += '</tr>';

    // Subgrupo proveedores
    html += fc_renderSubgrupoEgreso({ id: 'prov-principales', nombre: 'PROVEEDORES PRINCIPALES', items: ['Proveedor 1'], esProveedor: true });

    // Total Proveedores
    html += fc_renderTotalEgreso('Total Pago Proveedores', 'proveedores', '#ffcdd2');

    // TOTAL EGRESOS
    html += fc_renderTotalEgreso('TOTAL EGRESOS', 'egresos', '#ef9a9a');

    return html;
}

function fc_renderSubgrupoEgreso(sg) {
    let html = '';

    // Header subgrupo
    html += `<tr class="row-banco" id="fc-grupo-${sg.id}"><td class="col-concepto indent-2">${sg.nombre} <button class="fc-btn-add" onclick="fc_agregarItem('${sg.id}')">+</button></td>`;
    fc_semanas.forEach(sem => {
        html += `<td class="col-semana sem-${sem.num}-header"></td>`;
        for (let i = 0; i < 8; i++) html += `<td class="dia-col sem-${sem.num}"></td>`;
    });
    html += '</tr>';

    // Items
    sg.items.forEach(item => {
        html += `<tr class="row-banco-item fc-egreso-item-${sg.id}"><td class="col-concepto indent-3"><input type="text" class="fc-input-nombre" value="${item}"><button class="fc-btn-del" onclick="fc_eliminarItem(this)">×</button></td>`;
        fc_semanas.forEach(sem => {
            html += `<td class="col-semana sem-${sem.num}-header monto fc-item-sem" data-semana="${sem.num}">-</td>`;
            sem.dias.forEach((dia, i) => {
                const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
                html += `<td class="dia-col sem-${sem.num}${sab} monto"><input type="text" class="fc-input fc-input-egreso-${sg.id}" data-fecha="${dia}" data-semana="${sem.num}" placeholder="0" onchange="fc_recalcularEgresos()"></td>`;
            });
            html += `<td class="dia-col sem-${sem.num} total-col monto fc-item-total" data-semana="${sem.num}">-</td>`;
        });
        html += '</tr>';
    });

    // Total subgrupo
    html += `<tr class="row-banco-total" id="fc-total-${sg.id}-row"><td class="col-concepto indent-2">Total ${sg.nombre.split(' ').slice(0,2).join(' ')}</td>`;
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

// Toggle semana expandir/colapsar
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

// Recalcular traspasos
function fc_recalcularTraspasos() {
    fc_semanasNums.forEach(sem => {
        let total = 0;
        document.querySelectorAll(`.fc-input-traspaso[data-semana="${sem}"]`).forEach(inp => {
            total += parseFloat(inp.value.replace(/,/g, '')) || 0;
        });

        // Actualizar celda semana
        const semCell = document.querySelector(`.fc-traspaso-sem[data-semana="${sem}"]`);
        if (semCell) semCell.textContent = fc_formatMonto(total);

        // Actualizar celda total
        const totalCell = document.querySelector(`.fc-traspaso-total[data-semana="${sem}"]`);
        if (totalCell) totalCell.textContent = fc_formatMonto(total);

        // Actualizar totales de bancos
        const prodBase = parseFloat(document.querySelector(`.total-produbanco[data-semana="${sem}"]`)?.dataset.base) || 0;
        const prodCell = document.querySelector(`.total-produbanco[data-semana="${sem}"]`);
        if (prodCell) prodCell.textContent = fc_formatMonto(prodBase + total);

        const pichBase = parseFloat(document.querySelector(`.total-pichincha[data-semana="${sem}"]`)?.dataset.base) || 0;
        const pichCell = document.querySelector(`.total-pichincha[data-semana="${sem}"]`);
        if (pichCell) pichCell.textContent = fc_formatMonto(pichBase - total);
    });
}

// Recalcular egresos
function fc_recalcularEgresos() {
    const grupos = ['inst-pub', 'arriendos', 'nomina', 'cajas', 'prov-principales'];

    fc_semanasNums.forEach(sem => {
        let totalPagosFijos = 0;
        let totalProveedores = 0;

        grupos.forEach(grupo => {
            let totalGrupo = 0;
            document.querySelectorAll(`.fc-input-egreso-${grupo}[data-semana="${sem}"]`).forEach(inp => {
                totalGrupo += parseFloat(inp.value.replace(/,/g, '')) || 0;
            });

            // Update group totals
            const semCell = document.querySelector(`.fc-total-${grupo}-sem[data-semana="${sem}"]`);
            if (semCell) semCell.textContent = fc_formatMonto(totalGrupo);
            const totalCell = document.querySelector(`.fc-total-${grupo}-total[data-semana="${sem}"]`);
            if (totalCell) totalCell.textContent = fc_formatMonto(totalGrupo);

            if (grupo.startsWith('prov')) {
                totalProveedores += totalGrupo;
            } else {
                totalPagosFijos += totalGrupo;
            }
        });

        // Update section totals
        document.querySelector(`.fc-total-pagos-fijos-sem[data-semana="${sem}"]`).textContent = fc_formatMonto(totalPagosFijos);
        document.querySelector(`.fc-total-pagos-fijos-total[data-semana="${sem}"]`).textContent = fc_formatMonto(totalPagosFijos);
        document.querySelector(`.fc-total-proveedores-sem[data-semana="${sem}"]`).textContent = fc_formatMonto(totalProveedores);
        document.querySelector(`.fc-total-proveedores-total[data-semana="${sem}"]`).textContent = fc_formatMonto(totalProveedores);

        const totalEgresos = totalPagosFijos + totalProveedores;
        document.querySelector(`.fc-total-egresos-sem[data-semana="${sem}"]`).textContent = fc_formatMonto(totalEgresos);
        document.querySelector(`.fc-total-egresos-total[data-semana="${sem}"]`).textContent = fc_formatMonto(totalEgresos);
    });

    // Update item row totals
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

    // Update card
    let totalEgresosGeneral = 0;
    fc_semanasNums.forEach(sem => {
        const cell = document.querySelector(`.fc-total-egresos-sem[data-semana="${sem}"]`);
        if (cell && cell.textContent !== '-') {
            totalEgresosGeneral += parseFloat(cell.textContent.replace(/,/g, '')) || 0;
        }
    });
    document.getElementById('fc-total-egresos').textContent = '$' + fc_formatMonto(totalEgresosGeneral);
}

// Agregar item a subgrupo
function fc_agregarItem(grupo) {
    const totalRow = document.getElementById(`fc-total-${grupo}-row`);
    if (!totalRow) return;

    const newRow = document.createElement('tr');
    newRow.className = `row-banco-item fc-egreso-item-${grupo}`;

    let celdas = `<td class="col-concepto indent-3"><input type="text" class="fc-input-nombre" value="Nuevo Item"><button class="fc-btn-del" onclick="fc_eliminarItem(this)">×</button></td>`;
    fc_semanasNums.forEach(sem => {
        celdas += `<td class="col-semana sem-${sem}-header monto fc-item-sem" data-semana="${sem}">-</td>`;
        for (let i = 0; i < 7; i++) {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            celdas += `<td class="dia-col sem-${sem}${sab} monto"><input type="text" class="fc-input fc-input-egreso-${grupo}" data-semana="${sem}" placeholder="0" onchange="fc_recalcularEgresos()"></td>`;
        }
        celdas += `<td class="dia-col sem-${sem} total-col monto fc-item-total" data-semana="${sem}">-</td>`;
    });

    newRow.innerHTML = celdas;
    totalRow.parentNode.insertBefore(newRow, totalRow);
}

// Eliminar item
function fc_eliminarItem(btn) {
    const row = btn.closest('tr');
    if (row) {
        row.remove();
        fc_recalcularEgresos();
    }
}

// Agregar subgrupo
let fc_subgrupoCounter = 0;
function fc_agregarSubgrupo(tipo) {
    fc_subgrupoCounter++;
    const grupoId = tipo === 'proveedores' ? `prov${fc_subgrupoCounter}` : `nuevo${fc_subgrupoCounter}`;

    const targetSelector = tipo === 'proveedores' ? '.fc-total-proveedores-sem' : '.fc-total-pagos-fijos-sem';
    const totalRow = document.querySelector(targetSelector)?.closest('tr');
    if (!totalRow) return;

    // Create header
    const headerRow = document.createElement('tr');
    headerRow.className = 'row-banco';
    headerRow.id = `fc-grupo-${grupoId}`;
    let headerCeldas = `<td class="col-concepto indent-2"><input type="text" class="fc-input-nombre" value="NUEVO SUBGRUPO" style="font-weight:bold;text-transform:uppercase;width:140px;"> <button class="fc-btn-add" onclick="fc_agregarItem('${grupoId}')">+</button> <button class="fc-btn-del" onclick="fc_eliminarSubgrupo(this)">×</button></td>`;
    fc_semanasNums.forEach(sem => {
        headerCeldas += `<td class="col-semana sem-${sem}-header"></td>`;
        for (let i = 0; i < 8; i++) headerCeldas += `<td class="dia-col sem-${sem}"></td>`;
    });
    headerRow.innerHTML = headerCeldas;

    // Create item
    const itemRow = document.createElement('tr');
    itemRow.className = `row-banco-item fc-egreso-item-${grupoId}`;
    let itemCeldas = `<td class="col-concepto indent-3"><input type="text" class="fc-input-nombre" value="Item 1"><button class="fc-btn-del" onclick="fc_eliminarItem(this)">×</button></td>`;
    fc_semanasNums.forEach(sem => {
        itemCeldas += `<td class="col-semana sem-${sem}-header monto fc-item-sem" data-semana="${sem}">-</td>`;
        for (let i = 0; i < 7; i++) {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            itemCeldas += `<td class="dia-col sem-${sem}${sab} monto"><input type="text" class="fc-input fc-input-egreso-${grupoId}" data-semana="${sem}" placeholder="0" onchange="fc_recalcularEgresos()"></td>`;
        }
        itemCeldas += `<td class="dia-col sem-${sem} total-col monto fc-item-total" data-semana="${sem}">-</td>`;
    });
    itemRow.innerHTML = itemCeldas;

    // Create total row
    const subTotalRow = document.createElement('tr');
    subTotalRow.className = 'row-banco-total';
    subTotalRow.id = `fc-total-${grupoId}-row`;
    let totalCeldas = `<td class="col-concepto indent-2">Total Subgrupo</td>`;
    fc_semanasNums.forEach(sem => {
        totalCeldas += `<td class="col-semana sem-${sem}-header monto fc-total-${grupoId}-sem" data-semana="${sem}">-</td>`;
        for (let i = 0; i < 7; i++) {
            const sab = i === 5 ? ' dia-sab' : (i === 6 ? ' dia-dom' : '');
            totalCeldas += `<td class="dia-col sem-${sem}${sab} monto fc-total-${grupoId}-dia">-</td>`;
        }
        totalCeldas += `<td class="dia-col sem-${sem} total-col monto fc-total-${grupoId}-total" data-semana="${sem}">-</td>`;
    });
    subTotalRow.innerHTML = totalCeldas;

    totalRow.parentNode.insertBefore(headerRow, totalRow);
    totalRow.parentNode.insertBefore(itemRow, totalRow);
    totalRow.parentNode.insertBefore(subTotalRow, totalRow);
}

// Eliminar subgrupo
function fc_eliminarSubgrupo(btn) {
    const headerRow = btn.closest('tr');
    if (!headerRow) return;
    const grupoId = headerRow.id.replace('fc-grupo-', '');

    document.querySelectorAll(`.fc-egreso-item-${grupoId}`).forEach(r => r.remove());
    const totalRow = document.getElementById(`fc-total-${grupoId}-row`);
    if (totalRow) totalRow.remove();
    headerRow.remove();

    fc_recalcularEgresos();
}

// Registrar en el sistema de vistas
if (typeof window.viewInitializers === 'undefined') {
    window.viewInitializers = {};
}
window.viewInitializers['flujo-caja'] = fc_init;
