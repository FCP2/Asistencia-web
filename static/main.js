let catalogo = [];
let currentStatus = "";
let currentId = null;
let catalogIndex = {};      // índice por nombre -> objeto

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const coloresPartidos = {
  'MORENA':'#a50021',
  'PAN':'#0056a4',
  'PRI':'#0e9347',
  'PRD':'#ffcf00',
  'PT':'#d52b1e',
  'PVEM':'#78be20',
  'MC':'#f58025',
  'INDEPENDIENTE':'#888',
  'OTRO':'#666'
};

function colorPorPartido(valor) {
  if (!valor) return 'OTRO';
  const v = valor.toUpperCase().replace(/\s+/g,'');
  if (v.includes('MORENA')) return 'MORENA';
  if (v.includes('PAN'))    return 'PAN';
  if (v.includes('PRI'))    return 'PRI';
  if (v.includes('PRD'))    return 'PRD';
  if (v.includes('PT'))     return 'PT';
  if (v.includes('PVEM'))   return 'PVEM';
  if (v.includes('MC'))     return 'MC';
  return 'OTRO';
}
function resetCreateForm() {
  const ids = ['cFecha','cHora','cEvento','cConvoca','cPartido','cMuni','cLugar','cObs'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

  // select de Convoca (Cargo) vuelve a "-- Seleccione --"
  const selCargo = document.getElementById('cConvocaCargo');
  if (selCargo) selCargo.value = '';

  // quita posibles estados de validación
  document.querySelectorAll('#modalCreate .is-invalid').forEach(e => e.classList.remove('is-invalid'));
}
// util pequeño
async function withBusy(btn, fn){
  btn.disabled = true;
  btn.classList.add('disabled');
  try { await fn(); }
  finally {
    btn.disabled = false;
    btn.classList.remove('disabled');
  }
}

async function api(url, opts={}){
  const r = await fetch(url, { headers:{'Content-Type':'application/json'}, ...opts });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function statusPill(s){
  const map = {Pendiente:"secondary", Confirmado:"success", Sustituido:"warning", Cancelado:"danger"};
  const cls = map[s] || "secondary";
  return `<span class="badge text-bg-${cls}">${s||"—"}</span>`;
}

function card(inv){
  const est = statusPill(inv["Estatus"]);
  const partido = inv["Partido Político"] || '';
  const asignado = inv["Asignado A"] 
    ? `<span class="badge-soft">Asiste: ${inv["Asignado A"]}</span>` 
    : `<span class="badge-soft">Sin asignar</span>`;

  // partido
  const clave   = colorPorPartido(partido);
  const color   = coloresPartidos[clave];
  const badgePartido = partido 
    ? `<span class="badge rounded-pill me-1" style="background:${color};color:#fff;">${partido}</span>`
    : '';

  return `
  <div class="col-12 col-md-6 col-xl-4">
    <div class="card-inv p-3 h-100 d-flex flex-column">
      <div class="d-flex align-items-center gap-2 mb-1">
       <div class="mt-2">${badgePartido}</div>   <!-- 👈 aquí mostramos la cápsula -->
        <div class="hdr flex-grow-1">${inv["Evento"]||"Sin título"}</div>
        ${est}
      </div>
      <div class="text-muted small">${inv["Fecha"]||""} ${inv["Hora"]||""} • ${inv["Convoca"]||""}</div>
      <div class="text-muted small">${inv["Lugar"]||""}</div>
      <div class="mt-2">${asignado}</div>
      <div class="mt-auto d-flex gap-2 pt-2">
        <button class="btn btn-sm btn-primary flex-grow-1" data-action="assign" data-id="${inv["ID"]}">Gestionar</button>
        <button class="btn btn-sm btn-outline-secondary" data-action="details" data-id="${inv["ID"]}">Detalles</button>
      </div>
    </div>
  </div>`;
}

async function load(status=""){
  currentStatus = status;

  // para KPIs queremos el universo completo
  const all = await api('/api/invitations');
  updateKpis(all);

  // para las tarjetas aplicamos filtro (si hay)
  const list = status ? all.filter(r=>String(r.Estatus).trim()===status) : all;
  list.sort((a,b)=> (`${b.Fecha||''} ${b.Hora||''}`).localeCompare(`${a.Fecha||''} ${a.Hora||''}`));
  $('#cards').innerHTML = list.map(card).join('') || `<div class="text-muted">Sin registros.</div>`;
}


async function loadCatalog(){
  catalogo = await api('/api/catalog');       // ahora es lista de objetos
  catalogIndex = {};
  const sel = $('#selPersona');
  sel.innerHTML = '';

  // construir índice y options del select
  catalogo.forEach(r => {
    const nombre = (r.Nombre || '').trim();
    if (!nombre) return;
    catalogIndex[nombre] = r;
    const opt = document.createElement('option');
    opt.value = nombre;
    opt.textContent = nombre;
    sel.appendChild(opt);
  });
}

function updateKpis(list){
  const p = list.filter(r=>r.Estatus==='Pendiente').length;
  const c = list.filter(r=>r.Estatus==='Confirmado').length;
  const s = list.filter(r=>r.Estatus==='Sustituido').length;
  const x = list.filter(r=>r.Estatus==='Cancelado').length;
  const set = (id,val)=>{ const el = document.getElementById(id); if(el) el.textContent = val; };
  set('kpiPend', p); set('kpiConf', c); set('kpiSubs', s); set('kpiCanc', x);
}

document.addEventListener('click', async (e)=>{
  const btn = e.target.closest('button');
  if (!btn) return;

  if (btn.matches('[data-status]')){
    $$('.btn-group [data-status]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    await load(btn.dataset.status || "");
  }

    if (btn.dataset.action === 'assign'){
    currentId = btn.dataset.id;
    const modal = new bootstrap.Modal($('#modalAssign'));
        // dejar el combo limpio al abrir
    $('#selPersona').value = '';
    $('#inpRol').value = '';
    // setea persona por defecto (si existe) y su cargo
    //const firstName = Object.keys(catalogIndex)[0] || '';
    //$('#selPersona').value = firstName;
    //$('#inpRol').value = catalogIndex[firstName]?.Cargo || '';

    $('#inpComentario').value = '';
    try{
        const todos = await api('/api/invitations');
        const inv = todos.find(x=>x.ID===currentId);
        $('#assignMeta').textContent = inv ? `${inv.Evento} — ${inv.Fecha||''} ${inv.Hora||''}` : '';
        // Si la invitación ya tenía asignado, selecciona esa persona y trae su cargo
        if (inv && inv["Asignado A"]) {
        const n = inv["Asignado A"];
        $('#selPersona').value = n;
        $('#inpRol').value = catalogIndex[n]?.Cargo || $('#inpRol').value;
        }
    }catch{}
    modal.show();
    }

    if (btn.id === 'btnCrear'){
    const fecha   = ($('#cFecha').value || '').trim();
    const hora    = ($('#cHora').value || '').trim();
    const evento  = ($('#cEvento').value || '').trim();
    const convocaCargo = ($('#cConvocaCargo').value || '').trim();
    const convoca = ($('#cConvoca').value || '').trim();
    const partido = ($('#cPartido').value || '').trim();
    const muni    = ($('#cMuni').value || '').trim();
    const lugar   = ($('#cLugar').value || '').trim();
    const obs     = ($('#cObs').value || '').trim();

    // 🔴 Validar obligatorios
    if (!fecha || !hora || !evento || !convocaCargo || !convoca || !partido || !muni || !lugar) {
        alert('Por favor, completa todos los campos obligatorios antes de crear la invitación.');
        return;
    }

    const payload = {
        "Fecha": fecha,
        "Hora": hora,
        "Evento": evento,
        "Convoca Cargo": convocaCargo,
        "Convoca": convoca,
        "Partido Político": partido,
        "Municipio/Dependencia": muni,
        "Lugar": lugar,
        "Observaciones": obs
    };

    try {
        await api('/api/create',{method:'POST', body: JSON.stringify(payload)});
        bootstrap.Modal.getInstance($('#modalCreate')).hide();
        await load(currentStatus);
    } catch(err){
        alert('Error creando invitación: ' + err.message);
    }
    }

    // asignar persona
    if (btn.id === 'btnAsignar') {
    const persona = ($('#selPersona').value || '').trim();
    const cargo   = ($('#inpRol').value || '').trim();
    const cmt     = ($('#inpComentario').value || '').trim();
    await withBusy(btn, async ()=>{
            if (!persona) {
        alert('Debes seleccionar una persona antes de asignar.');
        return;
    }
    if (!cargo) {
        alert('El campo Cargo es obligatorio.');
        return;
    }

    try {
        await api('/api/assign', { 
        method:'POST', 
        body: JSON.stringify({ id: currentId, asignado: persona, rol: cargo, comentario: cmt }) 
        });
        bootstrap.Modal.getInstance($('#modalAssign')).hide();
        await load(currentStatus);
    } catch(err) {
        alert('Error en asignación: ' + err.message);
    }
        await api('/api/assign', { method:'POST', body: JSON.stringify({ id: currentId, asignado: persona, rol: cargo, comentario: cmt })});
        bootstrap.Modal.getInstance($('#modalAssign')).hide();
        await load(currentStatus);
    });

    }

    // sustituir (cambio de persona asignada)
    if (btn.id === 'btnSustituir'){
    const persona = ($('#selPersona').value || '').trim();
    const rol     = ($('#inpRol').value || '').trim();   // ← toma el cargo autollenado
    const cmt     = ($('#inpComentario').value || '').trim();

    if (!persona) { alert('Debes seleccionar la nueva persona.'); return; }
    if (!rol)     { alert('El campo Cargo es obligatorio.'); return; }

    try{
        await api('/api/reassign', { 
        method:'POST', 
        body: JSON.stringify({ id: currentId, nuevo: persona, rol: rol, comentario: cmt })
        });
        bootstrap.Modal.getInstance($('#modalAssign')).hide();
        await load(currentStatus);
    }catch(err){ 
        alert('Error al sustituir: '+err.message); 
    }
    }

  if (btn.id === 'btnCancelar'){
    const cmt = $('#inpComentario').value || 'Cancelado por indicación';
    await api('/api/cancel', {method:'POST', body: JSON.stringify({ id: currentId, comentario: cmt })});
    bootstrap.Modal.getInstance($('#modalAssign')).hide();
    await load(currentStatus);
  }

  if (btn.id === 'btnReactivar'){
    const cmt = $('#inpComentario').value || 'Reactivado';
    await api('/api/status', {method:'POST', body: JSON.stringify({ id: currentId, estatus:'Pendiente', comentario: cmt })});
    bootstrap.Modal.getInstance($('#modalAssign')).hide();
    await load(currentStatus);
  }
  // eliminar (borrado permanente)
if (btn.id === 'btnEliminar'){
  if (!confirm('¿Eliminar esta invitación? Esta acción no se puede deshacer.')) return;
  const cmt = $('#inpComentario').value || 'Eliminación solicitada desde dashboard';
  try{
    await api('/api/delete', {method:'POST', body: JSON.stringify({ id: currentId, comentario: cmt })});
    bootstrap.Modal.getInstance($('#modalAssign')).hide();
    await load(currentStatus);
  }catch(err){ alert('Error al eliminar: '+err.message); }
}
  // abrir modal detalles
    if (btn.dataset.action === 'details'){
    const todos = await api('/api/invitations');
    const inv = todos.find(x=>x.ID===btn.dataset.id);
    if (!inv) {
        alert('No se encontró la invitación.'); // fallback
        return;
    }
    const lines = [
        `<div><strong>Evento:</strong> ${inv.Evento||'—'}</div>`,
        `<div><strong>Quien Convoca:</strong> ${inv["Convoca Cargo"]||'—'}</div>`,   // 👈 nuevo
        `<div><strong>Convoca:</strong> ${inv.Convoca||'—'}</div>`,
        `<div><strong>Partido Político:</strong> ${inv["Partido Político"]||'—'}</div>`, // 👈 nuevo
        `<div><strong>Fecha/Hora:</strong> ${inv.Fecha||''} ${inv.Hora||''}</div>`,
        `<div><strong>Lugar:</strong> ${inv.Lugar||'—'}</div>`,
        `<div><strong>Estatus:</strong> ${inv.Estatus||'—'}</div>`,
        `<div><strong>Asiste:</strong> ${inv["Asignado A"]||'—'} (${inv.Rol||'—'})</div>`,
        `<div><strong>Observaciones:</strong> ${inv.Observaciones||'—'}</div>`,
        `<div class="text-muted"><strong>Última Modificación:</strong> ${inv["Última Modificación"]||''} — <strong>Modificado Por:</strong> ${inv["Modificado Por"]||''}</div>`
    ];
    $('#detailsBody').innerHTML = lines.join('');
    new bootstrap.Modal($('#modalDetails')).show();
    return;
    }
    // guardar nueva persona en Cat_Personal
    if (btn.id === 'btnGuardarPersona') {
        const nombre = ($('#npNombre').value || '').trim();
        const cargo  = ($('#npCargo').value || '').trim();
        const tel    = ($('#npTelefono').value || '').trim();
        const correo = ($('#npCorreo').value || '').trim();
        const unidad = ($('#npUnidad').value || '').trim();

        if (!nombre) { alert('El Nombre es obligatorio.'); return; }
        if (!cargo) { 
        alert('El campo Cargo es obligatorio.'); 
        return; 
        }

        // Validar teléfono: solo números y 10 dígitos
        if (tel && !/^\d{10}$/.test(tel)) {
        alert('El teléfono debe contener exactamente 10 dígitos numéricos.');
        return;
        }

        try {
            await api('/api/person/create', {
            method: 'POST',
            body: JSON.stringify({ Nombre: nombre, Cargo: cargo, Teléfono: tel, Correo: correo, 'Unidad/Región': unidad })
            });

            // Recarga catálogo y selecciona al recién creado
            await loadCatalog();
            const sel = $('#selPersona');
            sel.value = nombre;
            // Opcional: rellenar "Cargo" en el campo de gestión
            if (cargo) $('#inpRol').value = cargo;

            // Limpia subformulario y ciérralo
            $('#npNombre').value = '';
            $('#npCargo').value = '';
            $('#npTelefono').value = '';
            $('#npCorreo').value = '';
            $('#npUnidad').value = '';
            const collapseEl = document.querySelector('#newPerson');
            const clp = bootstrap.Collapse.getOrCreateInstance(collapseEl);
            clp.hide();

            alert('Persona guardada en el Catalogo');
        } catch(err) {
            alert('Error guardando persona: ' + err.message);
        }
    }
    // cancelar creación de nueva persona
    if (btn.id === 'btnCancelarPersona') {
    // limpiar campos
    $('#npNombre').value = '';
    $('#npCargo').value = '';
    $('#npTelefono').value = '';
    $('#npCorreo').value = '';
    $('#npUnidad').value = '';
    // cerrar collapse
    const collapseEl = document.querySelector('#newPerson');
    const clp = bootstrap.Collapse.getOrCreateInstance(collapseEl);
    clp.hide();
    }
});

document.addEventListener('DOMContentLoaded', async ()=> {
  await loadCatalog();
  await load("");

  // cuando cambias de persona, rellena el cargo automáticamente
  $('#selPersona')?.addEventListener('change', () => {
    const nombre = $('#selPersona').value || '';
    const info = catalogIndex[nombre];
    $('#inpRol').value = info?.Cargo || '';  // si no hay, queda vacío
  });

  // ====== Reset modal Nueva Invitación ======
  const modalEl = document.getElementById('modalCreate');
  if (modalEl) {
    // limpiar cuando se abre
    modalEl.addEventListener('show.bs.modal', () => {
      resetCreateForm();
      const f = document.getElementById('cFecha');
      if (f) f.valueAsDate = new Date();   // opcional: fecha por defecto hoy
    });

    // limpiar también al cerrar
    modalEl.addEventListener('hidden.bs.modal', () => {
      resetCreateForm();
    });
  }
});