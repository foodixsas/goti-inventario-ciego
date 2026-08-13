// ==================== MODULO NOMINA Y TTHH ====================
// Prefijo: nom_
// Integrado en Control Contable - Azure PostgreSQL (BD movimientos)
// ================================================================

let nom_state = {
    empleados: [],
    catalogos: null,
    filtro: 'Activo',
    busqueda: '',
    empleadoActual: null,
    dashData: null,
    vistaActual: 'lista' // lista | ficha
};

// ==================== INICIALIZACION ====================

function nom_init() {
    nom_cargarCatalogos();
    nom_cargarEmpleados();
}

function nom_initDashboard() {
    nom_cargarDashboard();
}

// ==================== API HELPERS ====================

async function nom_api(endpoint, opts = {}) {
    const url = `${CONFIG.API_URL}/api/nomina${endpoint}`;
    try {
        const resp = await fetch(url, {
            headers: { 'Content-Type': 'application/json', ...opts.headers },
            ...opts
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || `Error ${resp.status}`);
        return data;
    } catch (e) {
        console.error(`[nomina] ${endpoint}:`, e);
        throw e;
    }
}

// ==================== CATALOGOS ====================

async function nom_cargarCatalogos() {
    try {
        nom_state.catalogos = await nom_api('/catalogos');
    } catch (e) {
        console.warn('No se pudieron cargar catalogos nomina:', e.message);
    }
}

// ==================== DASHBOARD ====================

async function nom_cargarDashboard() {
    const container = document.getElementById('nom-dash-body');
    if (!container) return;
    container.innerHTML = '<p style="text-align:center;color:#94a3b8;padding:40px;">Cargando dashboard...</p>';
    try {
        const data = await nom_api('/dashboard');
        nom_state.dashData = data;
        nom_renderDashboard(data);
    } catch (e) {
        container.innerHTML = `<p style="text-align:center;color:#ef4444;padding:40px;">Error: ${escapeHtml(e.message)}</p>`;
    }
}

function nom_renderDashboard(d) {
    const container = document.getElementById('nom-dash-body');
    const activos = d.activos || 0;
    const inactivos = d.inactivos || 0;
    const total = activos + inactivos;
    const costoMensual = d.costo_mensual || 0;
    const promedioSalario = d.promedio_salario || 0;

    let porAreaHTML = '';
    if (d.por_area && d.por_area.length > 0) {
        porAreaHTML = d.por_area.map(a =>
            `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;">
                <span style="font-size:13px;color:#334155;">${escapeHtml(a.area || 'Sin area')}</span>
                <span style="font-weight:600;color:#123450;">${a.cantidad}</span>
            </div>`
        ).join('');
    }

    let porTiendaHTML = '';
    if (d.por_tienda && d.por_tienda.length > 0) {
        porTiendaHTML = d.por_tienda.map(t =>
            `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;">
                <span style="font-size:13px;color:#334155;">${escapeHtml(t.tienda || 'Sin tienda')}</span>
                <span style="font-weight:600;color:#123450;">${t.cantidad}</span>
            </div>`
        ).join('');
    }

    let contratoHTML = '';
    if (d.por_contrato && d.por_contrato.length > 0) {
        contratoHTML = d.por_contrato.map(c =>
            `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;">
                <span style="font-size:13px;color:#334155;">${escapeHtml(c.tipo_contrato || 'Sin tipo')}</span>
                <span style="font-weight:600;color:#123450;">${c.cantidad}</span>
            </div>`
        ).join('');
    }

    container.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px;">
            <div style="background:#f0f9ff;border-radius:12px;padding:20px;text-align:center;">
                <div style="font-size:32px;font-weight:700;color:#123450;">${activos}</div>
                <div style="font-size:13px;color:#64748b;margin-top:4px;">Empleados Activos</div>
            </div>
            <div style="background:#fef3c7;border-radius:12px;padding:20px;text-align:center;">
                <div style="font-size:32px;font-weight:700;color:#92400e;">${inactivos}</div>
                <div style="font-size:13px;color:#64748b;margin-top:4px;">Inactivos</div>
            </div>
            <div style="background:#ecfdf5;border-radius:12px;padding:20px;text-align:center;">
                <div style="font-size:32px;font-weight:700;color:#065f46;">$${nom_fmt(costoMensual)}</div>
                <div style="font-size:13px;color:#64748b;margin-top:4px;">Costo Nomina Mensual</div>
            </div>
            <div style="background:#f5f3ff;border-radius:12px;padding:20px;text-align:center;">
                <div style="font-size:32px;font-weight:700;color:#5b21b6;">$${nom_fmt(promedioSalario)}</div>
                <div style="font-size:13px;color:#64748b;margin-top:4px;">Salario Promedio</div>
            </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;">
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">
                <div style="font-weight:600;color:#123450;margin-bottom:12px;font-size:14px;">
                    <i class="fas fa-building"></i> Por Area
                </div>
                ${porAreaHTML || '<p style="color:#94a3b8;font-size:13px;">Sin datos</p>'}
            </div>
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">
                <div style="font-weight:600;color:#123450;margin-bottom:12px;font-size:14px;">
                    <i class="fas fa-store"></i> Por Tienda
                </div>
                ${porTiendaHTML || '<p style="color:#94a3b8;font-size:13px;">Sin datos</p>'}
            </div>
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">
                <div style="font-weight:600;color:#123450;margin-bottom:12px;font-size:14px;">
                    <i class="fas fa-file-contract"></i> Por Tipo Contrato
                </div>
                ${contratoHTML || '<p style="color:#94a3b8;font-size:13px;">Sin datos</p>'}
            </div>
        </div>
    `;
}

// ==================== EMPLEADOS - LISTA ====================

async function nom_cargarEmpleados() {
    const tbody = document.getElementById('nom-emp-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:30px;">Cargando...</td></tr>';
    try {
        const data = await nom_api(`/empleados?filtro=${nom_state.filtro}&buscar=${encodeURIComponent(nom_state.busqueda)}`);
        nom_state.empleados = data.empleados || [];
        nom_renderEmpleados();
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#ef4444;padding:30px;">Error: ${escapeHtml(e.message)}</td></tr>`;
    }
}

function nom_renderEmpleados() {
    const tbody = document.getElementById('nom-emp-tbody');
    const lista = nom_state.empleados;
    const count = document.getElementById('nom-emp-count');
    if (count) count.textContent = `${lista.length} empleados`;

    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:30px;">No se encontraron empleados</td></tr>';
        return;
    }

    tbody.innerHTML = lista.map(e => {
        const estadoClass = e.estado === 'Activo' ? 'background:#dcfce7;color:#166534;' :
                           e.estado === 'Liquidado' ? 'background:#fee2e2;color:#991b1b;' :
                           'background:#fef3c7;color:#92400e;';
        return `<tr style="cursor:pointer;" onclick="nom_abrirFicha(${e.id})">
            <td style="font-weight:600;">${escapeHtml(e.cedula || '')}</td>
            <td>${escapeHtml(e.nombre_completo || '')}</td>
            <td>${escapeHtml(e.cargo_texto || '')}</td>
            <td>${escapeHtml(e.tienda || '')}</td>
            <td style="text-align:right;font-weight:600;">$${nom_fmt(e.salario)}</td>
            <td>${e.fecha_ingreso ? nom_fmtFecha(e.fecha_ingreso) : ''}</td>
            <td><span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;${estadoClass}">${escapeHtml(e.estado || '')}</span></td>
            <td>
                <button class="btn-icon" onclick="event.stopPropagation();nom_abrirFicha(${e.id})" title="Ver ficha">
                    <i class="fas fa-user-edit"></i>
                </button>
            </td>
        </tr>`;
    }).join('');
}

function nom_filtrarEmpleados() {
    nom_state.filtro = document.getElementById('nom-filtro-estado').value;
    nom_state.busqueda = document.getElementById('nom-buscar').value;
    nom_cargarEmpleados();
}

function nom_buscarKeyup(e) {
    clearTimeout(nom_state._buscarTimer);
    nom_state._buscarTimer = setTimeout(() => {
        nom_state.busqueda = e.target.value;
        nom_cargarEmpleados();
    }, 400);
}

// ==================== EMPLEADOS - FICHA ====================

async function nom_abrirFicha(id) {
    const listaDiv = document.getElementById('nom-emp-lista');
    const fichaDiv = document.getElementById('nom-emp-ficha');
    listaDiv.style.display = 'none';
    fichaDiv.style.display = 'block';
    nom_state.vistaActual = 'ficha';

    if (id === 'nuevo') {
        nom_state.empleadoActual = null;
        nom_renderFicha({});
        document.getElementById('nom-ficha-titulo').textContent = 'Nuevo Empleado';
        return;
    }

    document.getElementById('nom-ficha-titulo').textContent = 'Cargando...';
    try {
        const data = await nom_api(`/empleados/${id}`);
        nom_state.empleadoActual = data;
        nom_renderFicha(data);
        document.getElementById('nom-ficha-titulo').textContent = data.nombre_completo || 'Ficha del Empleado';
    } catch (e) {
        document.getElementById('nom-ficha-titulo').textContent = 'Error';
        document.getElementById('nom-ficha-body').innerHTML = `<p style="color:#ef4444;">${escapeHtml(e.message)}</p>`;
    }
}

function nom_volverLista() {
    document.getElementById('nom-emp-lista').style.display = 'block';
    document.getElementById('nom-emp-ficha').style.display = 'none';
    nom_state.vistaActual = 'lista';
    nom_state.empleadoActual = null;
}

function nom_renderFicha(emp) {
    const body = document.getElementById('nom-ficha-body');
    const cat = nom_state.catalogos || {};
    const tiendas = cat.tiendas || ['Chios Real Audiencia','Chios Portugal','Chios Floreana','Santo Cachon Real Audiencia','Santo Cachon Portugal','Simon Bolon','Planta','Oficinas'];
    const areas = cat.areas || ['Operaciones','Produccion','Administracion','Contabilidad','Marketing','Talento Humano'];
    const marcas = cat.marcas || ['Chios','Santo Cachon','Simon Bolon','FOODIX'];
    const tiposContrato = cat.tipos_contrato || ['Contrato Indefinido con Periodo de Prueba','Contrato Sector Turistico','Contrato Pasantias','Contrato Practicas','Contrato por Servicios Profesionales'];
    const formasPago = ['Transferencia','Cheque','Efectivo'];
    const bancos = ['Produbanco','Pichincha','Guayaquil','Pacifico','Internacional','Bolivariano','Austro'];
    const tiposCuenta = ['Ahorros','Corriente'];
    const estadosCivil = ['Soltero/a','Casado/a','Divorciado/a','Viudo/a','Union Libre'];
    const generos = ['Masculino','Femenino','Otro'];

    function sel(name, value, options, placeholder) {
        let html = `<select id="nom-f-${name}" name="${name}" class="nom-input"><option value="">${placeholder || 'Seleccionar...'}</option>`;
        for (const o of options) {
            html += `<option value="${o}" ${value === o ? 'selected' : ''}>${o}</option>`;
        }
        return html + '</select>';
    }

    function inp(name, value, type, placeholder) {
        return `<input id="nom-f-${name}" name="${name}" type="${type || 'text'}" value="${escapeHtml(value || '')}" class="nom-input" placeholder="${placeholder || ''}">`;
    }

    body.innerHTML = `
        <div class="nom-ficha-grid">
            <!-- DATOS PERSONALES -->
            <div class="nom-ficha-section">
                <div class="nom-ficha-section-title"><i class="fas fa-user"></i> Datos Personales</div>
                <div class="nom-ficha-row">
                    <div class="nom-field"><label>Cedula / Documento</label>${inp('cedula', emp.cedula, 'text', '1712345678')}</div>
                    <div class="nom-field"><label>Nombre Completo</label>${inp('nombre_completo', emp.nombre_completo, 'text', 'Apellido1 Apellido2 Nombre1 Nombre2')}</div>
                </div>
                <div class="nom-ficha-row">
                    <div class="nom-field"><label>Email Personal</label>${inp('email', emp.email, 'email')}</div>
                    <div class="nom-field"><label>Celular</label>${inp('celular', emp.celular)}</div>
                </div>
                <div class="nom-ficha-row">
                    <div class="nom-field"><label>Fecha Nacimiento</label>${inp('fecha_nacimiento', emp.fecha_nacimiento, 'date')}</div>
                    <div class="nom-field"><label>Genero</label>${sel('genero', emp.genero, generos)}</div>
                    <div class="nom-field"><label>Estado Civil</label>${sel('estado_civil', emp.estado_civil, estadosCivil)}</div>
                </div>
                <div class="nom-ficha-row">
                    <div class="nom-field"><label>Nacionalidad</label>${inp('nacionalidad', emp.nacionalidad || 'Ecuatoriano')}</div>
                    <div class="nom-field"><label>Direccion</label>${inp('direccion', emp.direccion)}</div>
                </div>
            </div>

            <!-- DATOS LABORALES -->
            <div class="nom-ficha-section">
                <div class="nom-ficha-section-title"><i class="fas fa-briefcase"></i> Datos Laborales</div>
                <div class="nom-ficha-row">
                    <div class="nom-field"><label>Empresa</label>${sel('empresa', emp.empresa || 'FOODIX SAS', ['FOODIX SAS','ROCIO GONZALEZ'])}</div>
                    <div class="nom-field"><label>Marca</label>${sel('marca', emp.marca, marcas)}</div>
                    <div class="nom-field"><label>Tienda</label>${sel('tienda', emp.tienda, tiendas)}</div>
                </div>
                <div class="nom-ficha-row">
                    <div class="nom-field"><label>Area</label>${sel('area', emp.area, areas)}</div>
                    <div class="nom-field"><label>Cargo</label>${inp('cargo_texto', emp.cargo_texto)}</div>
                    <div class="nom-field"><label>Cargo Jerarquico</label>${sel('cargo_jerarquico_texto', emp.cargo_jerarquico_texto, cat.cargos_jerarquicos || ['Director General','Jefe de Area','Gerente de Tienda','Subgerente de Tienda','Analista','Supervisor','Operario de Produccion','Polifuncional','Auxiliar','Asistente','Pasante / Practicante'])}</div>
                </div>
                <div class="nom-ficha-row">
                    <div class="nom-field"><label>Fecha Ingreso</label>${inp('fecha_ingreso', emp.fecha_ingreso, 'date')}</div>
                    <div class="nom-field"><label>Tipo Contrato</label>${sel('tipo_contrato', emp.tipo_contrato, tiposContrato)}</div>
                    <div class="nom-field"><label>Estado</label>${sel('estado', emp.estado || 'Activo', ['Activo','Inactivo','Liquidado','Periodo de Prueba'])}</div>
                </div>
            </div>

            <!-- DATOS DE NOMINA -->
            <div class="nom-ficha-section">
                <div class="nom-ficha-section-title"><i class="fas fa-dollar-sign"></i> Datos de Nomina</div>
                <div class="nom-ficha-row">
                    <div class="nom-field"><label>Salario Mensual</label>${inp('salario', emp.salario, 'number')}</div>
                    <div class="nom-field"><label>Descuento por Cargo</label>${inp('descuento_por_cargo', emp.descuento_por_cargo, 'number')}</div>
                    <div class="nom-field"><label>Bono Cumpleanos</label>${inp('bono_cumpleanos', emp.bono_cumpleanos, 'number')}</div>
                </div>
                <div class="nom-ficha-row">
                    <div class="nom-field"><label>Jornada</label>${sel('jornada', emp.jornada || 'Completa', ['Completa','Parcial'])}</div>
                    <div class="nom-field"><label>Horas/Mes</label>${inp('horas_mes', emp.horas_mes || 240, 'number')}</div>
                    <div class="nom-field"><label>Decimos</label>${sel('decimos', emp.decimos || 'Mensualizado', ['Mensualizado','Acumulado'])}</div>
                </div>
            </div>

            <!-- DATOS BANCARIOS -->
            <div class="nom-ficha-section">
                <div class="nom-ficha-section-title"><i class="fas fa-university"></i> Datos Bancarios</div>
                <div class="nom-ficha-row">
                    <div class="nom-field"><label>Forma de Pago</label>${sel('forma_pago', emp.forma_pago || 'Transferencia', formasPago)}</div>
                    <div class="nom-field"><label>Banco</label>${sel('banco', emp.banco, bancos)}</div>
                    <div class="nom-field"><label>Tipo Cuenta</label>${sel('tipo_cuenta', emp.tipo_cuenta, tiposCuenta)}</div>
                    <div class="nom-field"><label>Numero Cuenta</label>${inp('numero_cuenta', emp.numero_cuenta)}</div>
                </div>
            </div>

            <!-- CONTACTOS EMERGENCIA -->
            <div class="nom-ficha-section">
                <div class="nom-ficha-section-title"><i class="fas fa-phone-alt"></i> Contactos de Emergencia</div>
                <div class="nom-ficha-row">
                    <div class="nom-field"><label>Contacto 1 - Nombre</label>${inp('emergencia1_nombre', emp.emergencia1_nombre)}</div>
                    <div class="nom-field"><label>Telefono</label>${inp('emergencia1_telefono', emp.emergencia1_telefono)}</div>
                    <div class="nom-field"><label>Relacion</label>${sel('emergencia1_relacion', emp.emergencia1_relacion, ['Padre','Madre','Conyuge','Hermano/a','Tio/a','Pareja','Amigo/a'])}</div>
                </div>
                <div class="nom-ficha-row">
                    <div class="nom-field"><label>Contacto 2 - Nombre</label>${inp('emergencia2_nombre', emp.emergencia2_nombre)}</div>
                    <div class="nom-field"><label>Telefono</label>${inp('emergencia2_telefono', emp.emergencia2_telefono)}</div>
                    <div class="nom-field"><label>Relacion</label>${sel('emergencia2_relacion', emp.emergencia2_relacion, ['Padre','Madre','Conyuge','Hermano/a','Tio/a','Pareja','Amigo/a'])}</div>
                </div>
            </div>
        </div>

        <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0;">
            <button class="btn-secondary" onclick="nom_volverLista()"><i class="fas fa-arrow-left"></i> Volver</button>
            ${emp.id ? `<button class="btn-secondary" style="color:#ef4444;border-color:#ef4444;" onclick="nom_eliminarEmpleado(${emp.id})"><i class="fas fa-trash"></i> Eliminar</button>` : ''}
            <button class="btn-primary" onclick="nom_guardarEmpleado()"><i class="fas fa-save"></i> Guardar</button>
        </div>
    `;
}

async function nom_guardarEmpleado() {
    const fields = ['cedula','nombre_completo','email','celular','fecha_nacimiento','genero','estado_civil',
        'nacionalidad','direccion','empresa','marca','tienda','area','cargo_texto','cargo_jerarquico_texto',
        'fecha_ingreso','tipo_contrato','estado','salario','descuento_por_cargo','bono_cumpleanos',
        'jornada','horas_mes','decimos','forma_pago','banco','tipo_cuenta','numero_cuenta',
        'emergencia1_nombre','emergencia1_telefono','emergencia1_relacion',
        'emergencia2_nombre','emergencia2_telefono','emergencia2_relacion'];

    const payload = {};
    for (const f of fields) {
        const el = document.getElementById(`nom-f-${f}`);
        if (el) {
            let val = el.value.trim();
            if (['salario','descuento_por_cargo','bono_cumpleanos','horas_mes'].includes(f)) {
                val = parseFloat(val) || 0;
            }
            payload[f] = val;
        }
    }

    if (!payload.cedula || !payload.nombre_completo) {
        nom_toast('Cedula y nombre son obligatorios', 'error');
        return;
    }

    try {
        const id = nom_state.empleadoActual?.id;
        if (id) {
            await nom_api(`/empleados/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
            nom_toast('Empleado actualizado');
        } else {
            await nom_api('/empleados', { method: 'POST', body: JSON.stringify(payload) });
            nom_toast('Empleado creado');
        }
        nom_volverLista();
        nom_cargarEmpleados();
    } catch (e) {
        nom_toast(e.message, 'error');
    }
}

async function nom_eliminarEmpleado(id) {
    if (!confirm('Seguro que desea eliminar este empleado?')) return;
    try {
        await nom_api(`/empleados/${id}`, { method: 'DELETE' });
        nom_toast('Empleado eliminado');
        nom_volverLista();
        nom_cargarEmpleados();
    } catch (e) {
        nom_toast(e.message, 'error');
    }
}

// ==================== NOMINA - LISTA ====================

async function nom_initNomina() {
    const tbody = document.getElementById('nom-nomina-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:30px;">Cargando nominas...</td></tr>';
    try {
        const data = await nom_api('/nominas');
        nom_renderNominas(data.nominas || []);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#ef4444;padding:30px;">Error: ${escapeHtml(e.message)}</td></tr>`;
    }
}

function nom_renderNominas(lista) {
    const tbody = document.getElementById('nom-nomina-tbody');
    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:30px;">No hay nominas procesadas</td></tr>';
        return;
    }
    tbody.innerHTML = lista.map(n => {
        const estadoStyle = n.estado === 'Aprobado' ? 'background:#dcfce7;color:#166534;' :
                           n.estado === 'Borrador' ? 'background:#fef3c7;color:#92400e;' :
                           'background:#dbeafe;color:#1e40af;';
        return `<tr>
            <td>${escapeHtml(n.periodo || '')}</td>
            <td>${escapeHtml(n.tipo || '')}</td>
            <td style="text-align:center;">${n.num_empleados || 0}</td>
            <td style="text-align:right;font-weight:600;">$${nom_fmt(n.total_ingresos)}</td>
            <td style="text-align:right;">$${nom_fmt(n.total_descuentos)}</td>
            <td style="text-align:right;font-weight:700;color:#065f46;">$${nom_fmt(n.total_pagar)}</td>
            <td><span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;${estadoStyle}">${escapeHtml(n.estado || '')}</span></td>
            <td>
                <button class="btn-icon" onclick="nom_verNomina(${n.id})" title="Ver detalle">
                    <i class="fas fa-eye"></i>
                </button>
            </td>
        </tr>`;
    }).join('');
}

async function nom_nuevaNomina() {
    const periodo = document.getElementById('nom-nuevo-periodo')?.value;
    const tipo = document.getElementById('nom-nuevo-tipo')?.value;
    if (!periodo) { nom_toast('Seleccione un periodo', 'error'); return; }
    try {
        const res = await nom_api('/nominas/procesar', {
            method: 'POST',
            body: JSON.stringify({ periodo, tipo: tipo || 'Mensual' })
        });
        nom_toast(`Nomina procesada: ${res.num_empleados} empleados`);
        nom_initNomina();
    } catch (e) {
        nom_toast(e.message, 'error');
    }
}

async function nom_verNomina(id) {
    // Mostrar detalle en sub-vista
    const listaDiv = document.getElementById('nom-nomina-lista');
    const detDiv = document.getElementById('nom-nomina-detalle');
    listaDiv.style.display = 'none';
    detDiv.style.display = 'block';

    detDiv.innerHTML = '<p style="text-align:center;color:#94a3b8;padding:40px;">Cargando detalle...</p>';
    try {
        const data = await nom_api(`/nominas/${id}`);
        nom_renderNominaDetalle(data, id);
    } catch (e) {
        detDiv.innerHTML = `<p style="color:#ef4444;padding:20px;">${escapeHtml(e.message)}</p>`;
    }
}

function nom_renderNominaDetalle(data, grupoId) {
    const detDiv = document.getElementById('nom-nomina-detalle');
    const grupo = data.grupo || {};
    const detalles = data.detalles || [];

    let rows = detalles.map(d => {
        const rubrosIng = (d.rubros || []).filter(r => r.tipo === 'ingreso');
        const rubrosDes = (d.rubros || []).filter(r => r.tipo === 'descuento');
        return `<tr>
            <td>${escapeHtml(d.nombre_completo || '')}</td>
            <td style="text-align:right;">$${nom_fmt(d.sueldo_base)}</td>
            <td style="text-align:center;">${d.dias_trabajados || 30}</td>
            <td style="text-align:right;color:#065f46;">$${nom_fmt(d.total_ingresos)}</td>
            <td style="text-align:right;color:#991b1b;">$${nom_fmt(d.total_descuentos)}</td>
            <td style="text-align:right;font-weight:700;">$${nom_fmt(d.liquido_pagar)}</td>
        </tr>`;
    }).join('');

    detDiv.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <div>
                <h3 style="margin:0;color:#123450;">${escapeHtml(grupo.periodo || '')} - ${escapeHtml(grupo.tipo || '')}</h3>
                <span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:#dbeafe;color:#1e40af;">${escapeHtml(grupo.estado || '')}</span>
            </div>
            <div style="display:flex;gap:8px;">
                ${grupo.estado === 'Borrador' ? `<button class="btn-primary" onclick="nom_aprobarNomina(${grupoId})"><i class="fas fa-check"></i> Aprobar</button>` : ''}
                <button class="btn-secondary" onclick="nom_volverNominaLista()"><i class="fas fa-arrow-left"></i> Volver</button>
            </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;">
            <div style="background:#f0f9ff;border-radius:8px;padding:12px;text-align:center;">
                <div style="font-size:20px;font-weight:700;color:#123450;">${detalles.length}</div>
                <div style="font-size:11px;color:#64748b;">Empleados</div>
            </div>
            <div style="background:#ecfdf5;border-radius:8px;padding:12px;text-align:center;">
                <div style="font-size:20px;font-weight:700;color:#065f46;">$${nom_fmt(grupo.total_ingresos)}</div>
                <div style="font-size:11px;color:#64748b;">Total Ingresos</div>
            </div>
            <div style="background:#fef2f2;border-radius:8px;padding:12px;text-align:center;">
                <div style="font-size:20px;font-weight:700;color:#991b1b;">$${nom_fmt(grupo.total_descuentos)}</div>
                <div style="font-size:11px;color:#64748b;">Total Descuentos</div>
            </div>
            <div style="background:#f5f3ff;border-radius:8px;padding:12px;text-align:center;">
                <div style="font-size:20px;font-weight:700;color:#5b21b6;">$${nom_fmt(grupo.total_pagar)}</div>
                <div style="font-size:11px;color:#64748b;">Neto a Pagar</div>
            </div>
        </div>
        <div style="overflow-x:auto;">
            <table class="nom-table">
                <thead><tr>
                    <th>Empleado</th><th style="text-align:right;">Sueldo</th><th style="text-align:center;">Dias</th>
                    <th style="text-align:right;">Ingresos</th><th style="text-align:right;">Descuentos</th><th style="text-align:right;">Neto</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

function nom_volverNominaLista() {
    document.getElementById('nom-nomina-lista').style.display = 'block';
    document.getElementById('nom-nomina-detalle').style.display = 'none';
}

async function nom_aprobarNomina(id) {
    if (!confirm('Aprobar esta nomina?')) return;
    try {
        await nom_api(`/nominas/${id}/aprobar`, { method: 'POST' });
        nom_toast('Nomina aprobada');
        nom_verNomina(id);
    } catch (e) {
        nom_toast(e.message, 'error');
    }
}

// ==================== UTILIDADES ====================

function nom_fmt(n) {
    return (parseFloat(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function nom_fmtFecha(f) {
    if (!f) return '';
    const d = new Date(f + 'T00:00:00');
    if (isNaN(d)) return f;
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

function nom_toast(msg, type) {
    // Usa el toast global si existe
    if (typeof showToast === 'function') {
        showToast(msg, type === 'error' ? 'error' : 'success');
        return;
    }
    const tc = document.getElementById('toast-container');
    if (!tc) { alert(msg); return; }
    const t = document.createElement('div');
    t.className = `toast ${type === 'error' ? 'toast-error' : 'toast-success'}`;
    t.innerHTML = `<i class="fas fa-${type === 'error' ? 'exclamation-circle' : 'check-circle'}"></i> ${escapeHtml(msg)}`;
    tc.appendChild(t);
    setTimeout(() => t.remove(), 4000);
}

// ==================== PERIODO HELPER ====================

function nom_generarPeriodos() {
    const sel = document.getElementById('nom-nuevo-periodo');
    if (!sel) return;
    const hoy = new Date();
    sel.innerHTML = '<option value="">Seleccionar periodo...</option>';
    for (let i = 0; i < 6; i++) {
        const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
        const periodo = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        const label = d.toLocaleDateString('es-EC', { month: 'long', year: 'numeric' });
        sel.innerHTML += `<option value="${periodo}">${label.charAt(0).toUpperCase() + label.slice(1)}</option>`;
    }
}
