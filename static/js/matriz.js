// Matriz General de Productos
//
// El formulario NO tiene los campos escritos a mano: son 80 columnas y se
// desincronizarian del backend a la primera. /api/matriz/campos manda la
// definicion y aqui se dibuja. Agregar una columna alla la hace aparecer aca.
//
// Los botones de cada fila van por data-codigo + addEventListener y no por
// onclick inline: los codigos y nombres traen comillas y apostrofes que rompen
// el atributo.

const matrizEstado = {
    campos: null,        // definicion que manda el backend
    catalogos: null,     // valores existentes para los desplegables
    productos: [],
    pagina: 1,
    paginas: 1,
    total: 0,
    porPagina: 50,
    abierto: null,       // ficha abierta: { codigo, datos, esNuevo }
    grupoActivo: 'identificacion',
    buscando: null,      // timer del debounce
    abiertos: null,      // categorias desplegadas; null = todavia no se decidio
};

const MATRIZ_TODAS = 3000;      // tope de filas al agrupar (hoy hay 1264)
const MATRIZ_ABRIR_HASTA = 6;   // con mas categorias que esto, arrancan cerradas

const MATRIZ_GRUPOS = [
    ['identificacion', 'Identificacion',  'fa-tag'],
    ['conteo',         'Conteo x bodega', 'fa-clipboard-check'],
    ['equivalencias',  'Equivalencias',   'fa-scale-balanced'],
    ['precios',        'Precios',         'fa-dollar-sign'],
    ['contable',       'Contable',        'fa-book'],
    ['proveedor',      'Proveedor',       'fa-truck'],
    ['auditoria',      'Auditoria',       'fa-clock-rotate-left'],
];

// Las bodegas que tienen flag de conteo, con su nombre corto para la grilla
const MATRIZ_BODEGAS = [
    ['conteo_chios',                 'CH'],
    ['conteo_simon_bolon',           'SB'],
    ['conteo_santo_cachon',          'SC'],
    ['conteo_planta_produccion',     'PL'],
    ['conteo_bodega_principal',      'BP'],
    ['conteo_bodega_materia_prima',  'MP'],
    ['conteo_bodega_pulmon',         'PU'],
];

function matrizEsAdmin() {
    return typeof state !== 'undefined' && state.user && state.user.rol === 'admin';
}

function matrizUsuario() {
    return (typeof state !== 'undefined' && state.user) ? state.user.username : '';
}

function matrizEscapar(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


// ------------------------------------------------------------ arranque

async function matrizInit() {
    if (matrizEstado.campos) {          // ya se cargo antes, solo refrescar
        matrizCargar(1);
        return;
    }
    try {
        const [rc, rk] = await Promise.all([
            fetch(`${CONFIG.API_URL}/api/matriz/campos`),
            fetch(`${CONFIG.API_URL}/api/matriz/catalogos`),
        ]);
        const dc = await rc.json();
        const dk = await rk.json();
        if (!dc.success) throw new Error(dc.error || 'No se pudo leer la definicion de campos');
        matrizEstado.campos = dc.campos;
        matrizEstado.catalogos = dk.success ? dk.catalogos : {};
        matrizLlenarFiltros();
        matrizEnganchar();
        matrizCargar(1);
    } catch (e) {
        showToast('Matriz de productos: ' + e.message, 'error');
    }
}

function matrizLlenarFiltros() {
    const c = matrizEstado.catalogos || {};
    const poner = (id, valores, etiquetaTodos) => {
        const sel = document.getElementById(id);
        if (!sel) return;
        sel.innerHTML = `<option value="">${etiquetaTodos}</option>` +
            (valores || []).map(v => `<option value="${matrizEscapar(v)}">${matrizEscapar(v)}</option>`).join('');
    };
    poner('matriz-f-estado',    c.estado,       'Todos los estados');
    poner('matriz-f-categoria', c.categoria,    'Todas las categorias');
    poner('matriz-f-uso',       c.uso_producto, 'Todos los usos');

    const sel = document.getElementById('matriz-f-cuenta');
    if (sel) {
        sel.innerHTML = '<option value="">Se cuenta en: cualquiera</option>' +
            matrizEstado.campos.filter(x => x.columna.startsWith('conteo_'))
                .map(x => `<option value="${x.columna}">Se cuenta en: ${matrizEscapar(x.etiqueta)}</option>`)
                .join('');
    }
}

let _matrizClicksEnganchados = false;

function matrizEnganchar() {
    const buscador = document.getElementById('matriz-buscar');
    if (buscador) {
        buscador.addEventListener('input', () => {
            clearTimeout(matrizEstado.buscando);
            matrizEstado.buscando = setTimeout(() => {
                matrizEstado.abiertos = null;
                matrizCargar(1);
            }, 350);
        });
    }
    ['matriz-f-estado', 'matriz-f-categoria', 'matriz-f-uso',
     'matriz-f-venta', 'matriz-f-cuenta', 'matriz-orden'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => {
            matrizEstado.abiertos = null;   // el filtro cambio: se decide de nuevo
            matrizCargar(1);
        });
    });

    const btnNuevo = document.getElementById('matriz-btn-nuevo');
    if (btnNuevo) btnNuevo.addEventListener('click', () => matrizAbrirFicha(null));

    // Un solo listener para todo el listado. Cuelga de document y no del
    // contenedor: asi no importa si #matriz-lista todavia no existe cuando esto
    // corre, ni si mas adelante se reemplaza entero.
    if (!_matrizClicksEnganchados) {
        _matrizClicksEnganchados = true;
        document.addEventListener('click', ev => {
            const cab = ev.target.closest('[data-categoria]');
            if (cab) {
                matrizAlternarGrupo(cab.getAttribute('data-categoria'));
                return;
            }
            const btn = ev.target.closest('button[data-accion]');
            if (!btn) return;
            const codigo = btn.getAttribute('data-codigo');
            if (btn.getAttribute('data-accion') === 'editar') matrizAbrirFicha(codigo);
            if (btn.getAttribute('data-accion') === 'borrar') matrizBorrar(codigo);
        });
    }
}


// ------------------------------------------------------------ listado

async function matrizCargar(pagina) {
    if (pagina) matrizEstado.pagina = pagina;
    const valor = id => (document.getElementById(id) || {}).value || '';

    // Agrupado por categoria no se pagina: partir una categoria a la mitad de
    // una pagina no le sirve a nadie. Se traen todas las que entren al filtro.
    const agrupado = matrizAgrupado();
    if (agrupado) matrizEstado.pagina = 1;

    const p = new URLSearchParams({
        q:          valor('matriz-buscar'),
        estado:     valor('matriz-f-estado'),
        categoria:  valor('matriz-f-categoria'),
        uso:        valor('matriz-f-uso'),
        venta:      valor('matriz-f-venta'),
        cuenta_en:  valor('matriz-f-cuenta'),
        orden:      valor('matriz-orden'),
        pagina:     matrizEstado.pagina,
        por_pagina: agrupado ? MATRIZ_TODAS : matrizEstado.porPagina,
    });

    const lista = document.getElementById('matriz-lista');
    if (lista) {
        lista.innerHTML = `<div class="mx-vacio">Cargando...</div>`;
    }

    try {
        const r = await fetch(`${CONFIG.API_URL}/api/matriz/productos?` + p.toString());
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'No se pudo cargar');
        matrizEstado.productos = d.productos;
        matrizEstado.total     = d.total;
        matrizEstado.paginas   = d.paginas;
        matrizPintar();
    } catch (e) {
        if (lista) {
            lista.innerHTML = `<div class="mx-vacio" style="color:#E24B4A;">
                ${matrizEscapar(e.message)}</div>`;
        }
    }
}

function matrizAgrupado() {
    const sel = document.getElementById('matriz-orden');
    return !sel || sel.value === 'categoria' || sel.value === '';
}

function matrizChip(activo, texto) {
    return `<span class="mx-chip${activo ? ' on' : ''}">${texto}</span>`;
}

// La categoria se muestra como columna solo cuando NO se esta agrupando: dentro
// de un grupo, repetirla en cada fila es ruido.
function matrizCabecera(conCategoria) {
    return `<thead><tr>
        <th>Codigo</th>
        <th>Producto</th>
        ${conCategoria ? '<th>Categoria</th>' : ''}
        <th>Uso</th>
        <th>Und. min</th>
        <th class="mx-centro">Venta</th>
        <th title="Bodegas donde este producto se cuenta">Se cuenta en</th>
        <th class="mx-centro">Estado</th>
        <th></th>
    </tr></thead>`;
}

function matrizFila(p, conCategoria) {
    const inactivo = p.estado !== 'Activo';
    const chips = MATRIZ_BODEGAS.map(([col, corto]) => matrizChip(p[col], corto)).join('');
    const cod = matrizEscapar(p.codigo);
    return `<tr class="${inactivo ? 'mx-off' : ''}">
        <td class="mx-cod">${cod}</td>
        <td class="mx-nombre">${matrizEscapar(p.nombre_producto)}</td>
        ${conCategoria ? `<td class="mx-tenue">${matrizEscapar(p.categoria)}</td>` : ''}
        <td class="mx-tenue">${matrizEscapar(p.uso_producto)}</td>
        <td class="mx-tenue">${matrizEscapar(p.und_min)}</td>
        <td class="mx-centro"><span class="mx-badge ${p.para_la_venta ? 'mx-ok' : 'mx-no'}">
            ${p.para_la_venta ? 'Si' : 'No'}</span></td>
        <td style="line-height:1.7;">${chips}</td>
        <td class="mx-centro"><span class="mx-badge ${inactivo ? 'mx-no' : 'mx-ok'}">
            ${matrizEscapar(p.estado)}</span></td>
        <td class="mx-der">
            <button type="button" class="mx-accion mx-editar" data-accion="editar"
                    data-codigo="${cod}" title="Ver y editar la ficha de ${cod}">Editar</button>
            ${matrizEsAdmin() ? `<button type="button" class="mx-accion mx-borrar" data-accion="borrar"
                    data-codigo="${cod}" title="Borrar definitivamente ${cod} de la matriz">Borrar</button>` : ''}
        </td></tr>`;
}

function matrizPintar() {
    const lista = document.getElementById('matriz-lista');
    if (!lista) return;

    if (!matrizEstado.productos.length) {
        lista.innerHTML = `<div class="mx-vacio">Ningun producto con esos filtros</div>`;
    } else if (matrizAgrupado()) {
        matrizPintarAgrupado(lista);
    } else {
        lista.innerHTML = `<div class="mx-cat abierta"><div style="overflow-x:auto;">
            <table class="mx-tabla">${matrizCabecera(true)}<tbody>
            ${matrizEstado.productos.map(p => matrizFila(p, true)).join('')}
            </tbody></table></div></div>`;
    }

    matrizPintarPie();
}

// Los productos ya vienen ordenados por categoria y codigo desde el servidor,
// asi que agrupar es solo cortar donde cambia la categoria.
function matrizAgrupar() {
    const grupos = [];
    let actual = null;
    matrizEstado.productos.forEach(p => {
        const cat = p.categoria || '(sin categoria)';
        if (!actual || actual.categoria !== cat) {
            actual = { categoria: cat, filas: [] };
            grupos.push(actual);
        }
        actual.filas.push(p);
    });
    return grupos;
}

function matrizPintarAgrupado(lista) {
    const grupos = matrizAgrupar();

    // Con pocas categorias se abren todas; con muchas se dejan cerradas y la
    // pantalla queda como un indice en el que se elige adonde entrar.
    if (matrizEstado.abiertos === null) {
        matrizEstado.abiertos = new Set(
            grupos.length <= MATRIZ_ABRIR_HASTA ? grupos.map(g => g.categoria) : []);
    }

    lista.innerHTML = grupos.map(g => {
        const abierto = matrizEstado.abiertos.has(g.categoria);
        const cat = matrizEscapar(g.categoria);
        const inactivos = g.filas.filter(p => p.estado !== 'Activo').length;
        return `<div class="mx-cat${abierto ? ' abierta' : ''}">
            <div class="mx-cat-head" data-categoria="${cat}">
                <span class="mx-chev">&#9654;</span>
                <span class="mx-cat-nombre">${cat}</span>
                <span class="mx-cat-meta">${g.filas.length}
                    ${g.filas.length === 1 ? 'producto' : 'productos'}${
                    inactivos ? ` &middot; <b>${inactivos} inactivo${inactivos === 1 ? '' : 's'}</b>` : ''}</span>
            </div>
            ${abierto ? `<div style="overflow-x:auto;">
                <table class="mx-tabla">${matrizCabecera(false)}<tbody>
                ${g.filas.map(p => matrizFila(p, false)).join('')}
                </tbody></table></div>` : ''}
        </div>`;
    }).join('');
}

function matrizAlternarGrupo(categoria) {
    if (!matrizEstado.abiertos) matrizEstado.abiertos = new Set();
    if (matrizEstado.abiertos.has(categoria)) {
        matrizEstado.abiertos.delete(categoria);
    } else {
        matrizEstado.abiertos.add(categoria);
    }
    matrizPintarAgrupado(document.getElementById('matriz-lista'));
}

function matrizPintarPie() {
    const agrupado = matrizAgrupado();
    const info = document.getElementById('matriz-info');
    if (info) {
        if (agrupado) {
            const grupos = matrizAgrupar().length;
            info.textContent = `${matrizEstado.total} productos en ${grupos} categorias`;
        } else {
            const desde = matrizEstado.total ? (matrizEstado.pagina - 1) * matrizEstado.porPagina + 1 : 0;
            const hasta = Math.min(matrizEstado.pagina * matrizEstado.porPagina, matrizEstado.total);
            info.textContent = `${desde}\u2013${hasta} de ${matrizEstado.total} productos`;
        }
    }

    // La paginacion no aplica agrupado: se muestran los botones de plegar
    const paginador = document.getElementById('matriz-paginador');
    if (paginador) paginador.style.display = agrupado ? 'none' : 'flex';
    const plegado = document.getElementById('matriz-plegado');
    if (plegado) plegado.style.display = agrupado ? 'flex' : 'none';

    const pag = document.getElementById('matriz-paginas');
    if (pag) pag.textContent = `Pagina ${matrizEstado.pagina} de ${matrizEstado.paginas || 1}`;
    const btnAnt = document.getElementById('matriz-ant');
    const btnSig = document.getElementById('matriz-sig');
    if (btnAnt) btnAnt.disabled = matrizEstado.pagina <= 1;
    if (btnSig) btnSig.disabled = matrizEstado.pagina >= matrizEstado.paginas;
}

function matrizTodos(abrir) {
    const grupos = matrizAgrupar();
    matrizEstado.abiertos = new Set(abrir ? grupos.map(g => g.categoria) : []);
    matrizPintarAgrupado(document.getElementById('matriz-lista'));
}

function matrizPagina(salto) {
    const destino = matrizEstado.pagina + salto;
    if (destino < 1 || destino > matrizEstado.paginas) return;
    matrizCargar(destino);
}


// ------------------------------------------------------------ ficha

async function matrizAbrirFicha(codigo) {
    let datos = {};
    if (codigo) {
        try {
            const r = await fetch(`${CONFIG.API_URL}/api/matriz/productos/${encodeURIComponent(codigo)}`);
            const d = await r.json();
            if (!d.success) throw new Error(d.error || 'No se pudo abrir');
            datos = d.producto;
        } catch (e) {
            showToast(e.message, 'error');
            return;
        }
    } else {
        datos = { estado: 'Activo' };
    }

    matrizEstado.abierto = { codigo: codigo, datos: datos, esNuevo: !codigo };
    matrizEstado.grupoActivo = 'identificacion';

    document.getElementById('matriz-ficha-titulo').innerHTML = codigo
        ? `<i class="fas fa-pen"></i> ${matrizEscapar(datos.nombre_producto || codigo)}
           <span style="font-family:'DM Mono',monospace;font-size:12px;color:#64748b;margin-left:8px;">${matrizEscapar(codigo)}</span>`
        : '<i class="fas fa-plus-circle"></i> Nuevo producto';

    matrizPintarPestanas();
    matrizPintarGrupo();
    document.getElementById('matriz-ficha').style.display = 'flex';
}

function matrizCerrarFicha() {
    document.getElementById('matriz-ficha').style.display = 'none';
    matrizEstado.abierto = null;
}

function matrizPintarPestanas() {
    const cont = document.getElementById('matriz-pestanas');
    if (!cont) return;
    cont.innerHTML = MATRIZ_GRUPOS.map(([id, etiqueta, icono]) => {
        const activa = id === matrizEstado.grupoActivo;
        return `<button type="button" data-grupo="${id}"
            style="padding:8px 14px;border:none;border-bottom:2px solid ${activa ? '#1d4ed8' : 'transparent'};
                   background:none;cursor:pointer;font-size:12px;font-weight:${activa ? '700' : '500'};
                   color:${activa ? '#1d4ed8' : '#64748b'};white-space:nowrap;">
            <i class="fas ${icono}"></i> ${etiqueta}</button>`;
    }).join('');

    cont.querySelectorAll('button[data-grupo]').forEach(b => {
        b.addEventListener('click', () => {
            matrizGuardarVisible();          // no perder lo tecleado al cambiar de pestana
            matrizEstado.grupoActivo = b.getAttribute('data-grupo');
            matrizPintarPestanas();
            matrizPintarGrupo();
        });
    });
}

// Lo que este escrito en la pestana visible vuelve al objeto en memoria. Sin
// esto, cambiar de pestana borraria lo que se acaba de escribir.
function matrizGuardarVisible() {
    const a = matrizEstado.abierto;
    if (!a) return;
    document.querySelectorAll('#matriz-campos [data-columna]').forEach(el => {
        const col = el.getAttribute('data-columna');
        a.datos[col] = (el.type === 'checkbox') ? el.checked : el.value;
    });
}

function matrizControl(campo, valor) {
    const col = campo.columna;
    const cat = (matrizEstado.catalogos || {})[col];
    const base = `padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;width:100%;
                  background:#fff;color:#0f172a;`;

    if (campo.tipo === 'ro') {
        const texto = valor === null || valor === undefined || valor === '' ? '—' : String(valor);
        return `<div style="${base}background:#f8fafc;color:#64748b;">${matrizEscapar(texto)}</div>`;
    }
    if (campo.tipo === 'bool') {
        return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 0;">
            <input type="checkbox" data-columna="${col}" ${valor ? 'checked' : ''}
                   style="width:17px;height:17px;cursor:pointer;accent-color:#1d4ed8;">
            <span style="font-size:12px;color:#475569;">${valor ? 'Si' : 'No'}</span></label>`;
    }
    if (campo.tipo === 'area') {
        return `<textarea data-columna="${col}" rows="3" style="${base}resize:vertical;">${matrizEscapar(valor)}</textarea>`;
    }
    if (campo.tipo === 'array') {
        const texto = Array.isArray(valor) ? valor.join(', ') : (valor || '');
        return `<input type="text" data-columna="${col}" value="${matrizEscapar(texto)}"
                   placeholder="separar con comas" style="${base}">`;
    }
    // El codigo no se toca una vez creado: es la clave de la tabla
    if (col === 'codigo' && !matrizEstado.abierto.esNuevo) {
        return `<div style="${base}background:#f8fafc;color:#64748b;font-family:'DM Mono',monospace;">
                ${matrizEscapar(valor)}</div>`;
    }
    // Lista cerrada: se elige, no se escribe. Escribir aqui es siempre un error
    // (un 'activo' en minuscula sacaria al producto de todos los filtros).
    if (campo.opciones && campo.opciones.length) {
        const actual = (valor === null || valor === undefined) ? '' : String(valor);
        // Si lo guardado no esta en la lista se muestra igual, para no pisarlo sin avisar
        const extra = (actual && campo.opciones.indexOf(actual) === -1)
            ? `<option value="${matrizEscapar(actual)}" selected>${matrizEscapar(actual)} (valor actual)</option>`
            : '';
        const opciones = campo.opciones.map(v =>
            `<option value="${matrizEscapar(v)}"${v === actual ? ' selected' : ''}>${matrizEscapar(v)}</option>`
        ).join('');
        return `<select data-columna="${col}" style="${base}cursor:pointer;">
                    <option value=""${actual ? '' : ' selected'}>— sin definir —</option>
                    ${extra}${opciones}
                </select>`;
    }

    if (cat && cat.length) {
        // Lista con escritura libre: el valor de hoy puede no estar en el catalogo
        const opciones = cat.map(v => `<option value="${matrizEscapar(v)}">`).join('');
        return `<input type="text" data-columna="${col}" value="${matrizEscapar(valor)}"
                   list="matriz-lista-${col}" style="${base}">
                <datalist id="matriz-lista-${col}">${opciones}</datalist>`;
    }
    const tipoHtml = campo.tipo === 'num' ? 'text' : 'text';   // num como texto: aqui se escribe 1,5
    return `<input type="${tipoHtml}" data-columna="${col}" value="${matrizEscapar(valor)}" style="${base}">`;
}

function matrizPintarGrupo() {
    const cont = document.getElementById('matriz-campos');
    const a = matrizEstado.abierto;
    if (!cont || !a) return;

    const campos = matrizEstado.campos.filter(c => c.grupo === matrizEstado.grupoActivo);

    // El conteo se lee por pares flag+unidad, no como una lista suelta
    if (matrizEstado.grupoActivo === 'conteo') {
        const general = campos.find(c => c.columna === 'unidad_de_conteo_general');
        const filas = MATRIZ_BODEGAS.map(([flagCol]) => {
            const flag = campos.find(c => c.columna === flagCol);
            const uni  = campos.find(c => c.columna === flagCol.replace('conteo_', 'unidad_conteo_'));
            if (!flag) return '';
            return `<tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:6px 10px;font-size:12px;font-weight:600;color:#334155;">${matrizEscapar(flag.etiqueta)}</td>
                <td style="padding:6px 10px;width:90px;">${matrizControl(flag, a.datos[flag.columna])}</td>
                <td style="padding:6px 10px;">${uni ? matrizControl(uni, a.datos[uni.columna]) : ''}</td></tr>`;
        }).join('');

        cont.innerHTML = `
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;
                        margin-bottom:14px;font-size:11.5px;color:#1e40af;line-height:1.5;">
                <i class="fas fa-circle-info"></i>
                Marca en que bodegas se cuenta este producto y con que unidad.
                <b>Hoy el conteo diario y el cruce operativo NO leen de aqui</b>: leen
                <i>Productos por Marca</i>. Esta parametrizacion queda guardada, pero no
                cambia el conteo hasta que se conecten las dos.
            </div>
            ${general ? `<div style="max-width:340px;margin-bottom:14px;">
                <label style="display:block;font-size:11px;font-weight:700;color:#64748b;
                              text-transform:uppercase;letter-spacing:0.04em;margin-bottom:5px;">
                    ${matrizEscapar(general.etiqueta)}</label>
                ${matrizControl(general, a.datos[general.columna])}</div>` : ''}
            <table style="width:100%;border-collapse:collapse;">
                <thead><tr style="background:#f8fafc;">
                    <th style="padding:7px 10px;text-align:left;font-size:10px;color:#64748b;
                               text-transform:uppercase;letter-spacing:0.05em;">Bodega</th>
                    <th style="padding:7px 10px;text-align:left;font-size:10px;color:#64748b;
                               text-transform:uppercase;letter-spacing:0.05em;">Se cuenta</th>
                    <th style="padding:7px 10px;text-align:left;font-size:10px;color:#64748b;
                               text-transform:uppercase;letter-spacing:0.05em;">Unidad de conteo</th>
                </tr></thead><tbody>${filas}</tbody></table>`;
    } else {
        cont.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;">` +
            campos.map(c => `<div>
                <label style="display:block;font-size:11px;font-weight:700;color:#64748b;
                              text-transform:uppercase;letter-spacing:0.04em;margin-bottom:5px;">
                    ${matrizEscapar(c.etiqueta)}</label>
                ${matrizControl(c, a.datos[c.columna])}</div>`).join('') + `</div>`;
    }

    // El texto del checkbox sigue al checkbox
    cont.querySelectorAll('input[type=checkbox][data-columna]').forEach(chk => {
        chk.addEventListener('change', () => {
            const etiqueta = chk.parentElement.querySelector('span');
            if (etiqueta) etiqueta.textContent = chk.checked ? 'Si' : 'No';
        });
    });
}

async function matrizGuardarFicha() {
    const a = matrizEstado.abierto;
    if (!a) return;
    matrizGuardarVisible();

    const cuerpo = { usuario: matrizUsuario() };
    matrizEstado.campos.forEach(c => {
        if (c.grupo === 'auditoria') return;
        if (c.columna === 'codigo' && !a.esNuevo) return;
        if (c.columna in a.datos) cuerpo[c.columna] = a.datos[c.columna];
    });

    if (a.esNuevo && !(cuerpo.codigo || '').trim()) {
        showToast('El codigo es obligatorio', 'error');
        matrizEstado.grupoActivo = 'identificacion';
        matrizPintarPestanas(); matrizPintarGrupo();
        return;
    }

    const btn = document.getElementById('matriz-btn-guardar');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...'; }

    try {
        const url = a.esNuevo
            ? `${CONFIG.API_URL}/api/matriz/productos`
            : `${CONFIG.API_URL}/api/matriz/productos/${encodeURIComponent(a.codigo)}`;
        const r = await fetch(url, {
            method: a.esNuevo ? 'POST' : 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cuerpo),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'No se pudo guardar');
        showToast(a.esNuevo ? 'Producto creado' : 'Cambios guardados', 'success');
        matrizCerrarFicha();
        if (a.esNuevo) matrizEstado.catalogos = null;   // pudo aparecer categoria nueva
        matrizCargar();
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-floppy-disk"></i> Guardar'; }
    }
}


// ------------------------------------------------------------ borrar

async function matrizBorrar(codigo) {
    if (!matrizEsAdmin()) {
        showToast('Solo un administrador puede borrar productos', 'error');
        return;
    }

    // Primero se mira donde esta usado: borrar deja huerfano al historico
    let usos = [];
    try {
        const r = await fetch(`${CONFIG.API_URL}/api/matriz/productos/${encodeURIComponent(codigo)}/uso`);
        const d = await r.json();
        if (d.success) usos = d.usos;
    } catch (e) { /* si falla, el backend vuelve a revisar antes de borrar */ }

    if (usos.length) {
        const detalle = usos.map(u => `• ${u.donde}: ${u.registros}`).join('\n');
        alert(`No se puede borrar ${codigo}.\n\nEsta usado en:\n${detalle}\n\n` +
              `Abrilo y ponelo en estado Inactivo: deja de ofrecerse y el historico ` +
              `sigue teniendo a que apuntar.`);
        return;
    }

    // Se nombra el producto, no solo el codigo: el codigo suelto no dice nada y
    // asi se ve si el click cayo en la fila equivocada.
    const fila = matrizEstado.productos.find(x => x.codigo === codigo) || {};
    const nombre = fila.nombre_producto || '(sin nombre)';

    if (!confirm(`BORRAR DEFINITIVAMENTE\n\n` +
                 `${codigo}  ${nombre}\n\n` +
                 `Desaparece de la matriz y no se puede recuperar.\n\n` +
                 `Si lo que queres es que deje de usarse, cancela esto, ` +
                 `abri el producto y ponelo en estado Inactivo.`)) return;

    // Escribir el codigo obliga a mirar cual es. Un OK de mas no alcanza.
    const tecleado = prompt(`Para confirmar, escribi el codigo del producto:\n\n${codigo}`);
    if (tecleado === null) return;
    if ((tecleado || '').trim().toUpperCase() !== codigo.toUpperCase()) {
        showToast('El codigo no coincide. No se borro nada.', 'error');
        return;
    }

    const clave = prompt('Tu contrasena de administrador para confirmar:');
    if (!clave) return;

    try {
        const r = await fetch(`${CONFIG.API_URL}/api/matriz/productos/${encodeURIComponent(codigo)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_user: matrizUsuario(), admin_pass: clave }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'No se pudo borrar');
        showToast(`Producto ${codigo} borrado`, 'success');
        matrizCargar();
    } catch (e) {
        showToast(e.message, 'error');
    }
}
