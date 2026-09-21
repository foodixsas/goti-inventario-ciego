// Informes de inventario: semanales y mensuales, para consultarlos desde el
// panel en vez de buscar el HTML en la carpeta de una PC.
//
// El informe se abre incrustado en un iframe. Son documentos completos y
// autocontenidos (traen su tipografia y sus iconos dentro), asi que se ven
// igual aqui que abiertos aparte, y se ven igual hoy que en un ano.
//
// Las semanas SIN informe tambien se listan, marcadas como pendientes. Un
// hueco tiene que verse: si solo se mostrara lo que existe, una semana que
// nunca se emitio desapareceria del listado y nadie la echaria de menos.

let iiPeriodos = null;
let iiPestana = 'semanal';

function iiInit() {
    iiPestana = 'semanal';
    iiCargar();
}

async function iiCargar() {
    const cont = document.getElementById('ii-lista');
    if (!cont) return;
    cont.innerHTML = '<div class="loading-msg">Cargando informes...</div>';
    try {
        const r = await fetch('/api/informes-inv/periodos');
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || 'respuesta invalida');
        iiPeriodos = d;
        iiPintar();
    } catch (e) {
        cont.innerHTML = '<div class="empty-msg">No se pudo traer el listado: '
            + (e.message || e) + '</div>';
    }
}

function iiTab(cual) {
    iiPestana = cual;
    document.querySelectorAll('.ii-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === cual);
    });
    iiPintar();
}

function iiPintar() {
    const cont = document.getElementById('ii-lista');
    if (!cont || !iiPeriodos) return;

    const filas = iiPestana === 'semanal'
        ? iiFilasSemanas() : iiFilasMeses();

    if (!filas.length) {
        cont.innerHTML = '<div class="empty-msg">Todavia no hay informes de '
            + 'este tipo.</div>';
        return;
    }
    cont.innerHTML = filas.join('');

    // Nada de onclick en linea: el id del informe viaja en data-id y el
    // manejador se engancha aca.
    cont.querySelectorAll('[data-informe]').forEach(b => {
        b.addEventListener('click', () => iiVer(b.dataset.informe,
                                                b.dataset.titulo));
    });
    cont.querySelectorAll('[data-nueva]').forEach(b => {
        b.addEventListener('click', (ev) => {
            ev.stopPropagation();
            window.open('/api/informes-inv/' + b.dataset.nueva + '/ver',
                        '_blank');
        });
    });
}

function iiFecha(s) {
    if (!s) return '';
    const p = String(s).slice(0, 10).split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
}

function iiFilasSemanas() {
    return (iiPeriodos.semanas || []).map(s => {
        const rango = iiFecha(s.inicio) + ' al ' + iiFecha(s.fin);
        if (!s.informe_id) {
            return '<div class="ii-fila ii-pendiente">'
                + '<div class="ii-fila-info">'
                + '<div class="ii-fila-titulo">' + rango + '</div>'
                + '<div class="ii-fila-sub">' + s.filas
                + ' conteos cargados &middot; sin informe generado</div>'
                + '</div>'
                + '<span class="ii-badge ii-badge-pend">Pendiente</span>'
                + '</div>';
        }
        return '<div class="ii-fila">'
            + '<div class="ii-fila-info">'
            + '<div class="ii-fila-titulo">' + (s.titulo || rango) + '</div>'
            + '<div class="ii-fila-sub">' + rango + '</div>'
            + '</div>'
            + '<div class="ii-fila-acciones">'
            + '<button class="btn-sm btn-primary" data-informe="' + s.informe_id
            + '" data-titulo="' + (s.titulo || rango).replace(/"/g, '&quot;')
            + '">Ver</button>'
            + '<button class="btn-sm" data-nueva="' + s.informe_id
            + '" title="Abrir en otra pestana">'
            + '<i class="fas fa-external-link-alt"></i></button>'
            + '</div></div>';
    });
}

function iiFilasMeses() {
    return (iiPeriodos.meses || []).map(m => {
        const detalle = m.semanas_con_informe + ' de ' + m.semanas
            + ' semanas con informe';
        if (!m.informe_id) {
            return '<div class="ii-fila ii-pendiente">'
                + '<div class="ii-fila-info">'
                + '<div class="ii-fila-titulo">' + m.etiqueta + '</div>'
                + '<div class="ii-fila-sub">' + detalle
                + ' &middot; sin informe mensual</div>'
                + '</div>'
                + '<span class="ii-badge ii-badge-pend">Pendiente</span>'
                + '</div>';
        }
        return '<div class="ii-fila">'
            + '<div class="ii-fila-info">'
            + '<div class="ii-fila-titulo">' + m.etiqueta + '</div>'
            + '<div class="ii-fila-sub">' + detalle + '</div>'
            + '</div>'
            + '<div class="ii-fila-acciones">'
            + '<button class="btn-sm btn-primary" data-informe="' + m.informe_id
            + '" data-titulo="' + m.etiqueta + '">Ver</button>'
            + '<button class="btn-sm" data-nueva="' + m.informe_id
            + '" title="Abrir en otra pestana">'
            + '<i class="fas fa-external-link-alt"></i></button>'
            + '</div></div>';
    });
}

function iiVer(id, titulo) {
    const modal = document.getElementById('ii-modal');
    const marco = document.getElementById('ii-marco');
    const tit = document.getElementById('ii-modal-titulo');
    const link = document.getElementById('ii-modal-nueva');
    if (!modal || !marco) return;
    tit.textContent = titulo || 'Informe';
    link.href = '/api/informes-inv/' + id + '/ver';
    marco.src = '/api/informes-inv/' + id + '/ver';
    modal.style.display = 'flex';
}

function iiCerrar() {
    const modal = document.getElementById('ii-modal');
    const marco = document.getElementById('ii-marco');
    if (modal) modal.style.display = 'none';
    // Se suelta el src para que el informe deje de ocupar memoria al cerrar.
    if (marco) marco.src = 'about:blank';
}

// Enganches de la pantalla. Van aca y no en el HTML para no repetir la regla
// de la casa: sin onclick en linea.
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.ii-tab').forEach(b => {
        b.addEventListener('click', () => iiTab(b.dataset.tab));
    });
    const cerrar = document.getElementById('ii-modal-cerrar');
    if (cerrar) cerrar.addEventListener('click', iiCerrar);
    const modal = document.getElementById('ii-modal');
    if (modal) modal.addEventListener('click', (ev) => {
        if (ev.target === modal) iiCerrar();   // clic fuera = cerrar
    });
});
