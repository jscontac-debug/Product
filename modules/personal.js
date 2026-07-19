/**
 * personal.js
 * -----------------------------------------------------------------------
 * Pantalla "Personal": alta, edicion y baja de empleados.
 * Cada empleado guarda su disponibilidad semanal, contrato, categoria,
 * seccion, turno fijo (si aplica), vacaciones y preferencias.
 * -----------------------------------------------------------------------
 */

import { leer, guardar, KEYS, generarId, DIAS, DIAS_LABEL } from './storage.js';

let editandoId = null;

export async function render(container) {
  editandoId = null;
  pintar(container);
}

function pintar(container) {
  const lista = leer(KEYS.PERSONAL, []);

  container.innerHTML = `
    <div class="screen">
      <div class="screen-header">
        <div>
          <h1>Personal</h1>
          <p>Empleados disponibles para el cuadrante y sus condiciones individuales.</p>
        </div>
      </div>

      <div class="card">
        <h3 id="form-titulo">Nuevo empleado</h3>
        <form id="form-personal">
          <input type="hidden" name="id">
          <div class="form-grid">
            <div class="field">
              <label for="pe-nombre">Nombre</label>
              <input id="pe-nombre" name="nombre" type="text" required>
            </div>
            <div class="field">
              <label for="pe-contrato">Contrato</label>
              <select id="pe-contrato" name="contrato">
                <option value="Indefinido">Indefinido</option>
                <option value="Temporal">Temporal</option>
                <option value="Parcial">Parcial</option>
              </select>
            </div>
            <div class="field">
              <label for="pe-horas">Horas semanales</label>
              <input id="pe-horas" name="horasSemanales" type="number" min="1" max="60" value="40" required>
            </div>
            <div class="field">
              <label for="pe-categoria">Categoria</label>
              <input id="pe-categoria" name="categoria" type="text" placeholder="Ej. Dependiente, Encargado">
            </div>
            <div class="field">
              <label for="pe-seccion">Seccion</label>
              <input id="pe-seccion" name="seccion" type="text" placeholder="Ej. Caja, Reposicion">
            </div>
            <div class="field">
              <label for="pe-turnofijo">Turno fijo</label>
              <select id="pe-turnofijo" name="turnoFijo">
                <option value="">Sin turno fijo</option>
                <option value="manana">Manana</option>
                <option value="tarde">Tarde</option>
                <option value="partido">Partido</option>
              </select>
            </div>
            <div class="field">
              <label for="pe-coste">Coste por hora (€)</label>
              <input id="pe-coste" name="costeHora" type="number" min="0" step="0.1" placeholder="Ej. 11.5">
            </div>
          </div>

          <div class="field" style="margin-top:12px;">
            <label>Disponibilidad semanal</label>
            <div class="checkbox-row" id="pe-disponibilidad">
              ${DIAS.map(d => `
                <label><input type="checkbox" name="disp_${d}" checked> ${DIAS_LABEL[d]}</label>
              `).join('')}
            </div>
          </div>

          <div class="form-grid" style="margin-top:12px;">
            <div class="field">
              <label for="pe-vacaciones">Vacaciones (fechas, separadas por coma)</label>
              <input id="pe-vacaciones" name="vacaciones" type="text" placeholder="2026-08-01, 2026-08-02">
            </div>
            <div class="field">
              <label for="pe-preferencias">Preferencias</label>
              <input id="pe-preferencias" name="preferencias" type="text" placeholder="Ej. Prefiere manana">
            </div>
          </div>

          <div class="actions-row">
            <button type="submit" class="btn">Guardar empleado</button>
            <button type="button" id="btn-cancelar-edicion" class="btn btn--secondary hidden">Cancelar edicion</button>
          </div>
        </form>
      </div>

      <div class="card">
        <h3>Plantilla (${lista.length})</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th><th>Contrato</th><th>Horas/sem</th><th>Categoria</th>
                <th>Seccion</th><th>Turno fijo</th><th>Coste/h</th><th>Disponibilidad</th><th></th>
              </tr>
            </thead>
            <tbody>
              ${lista.length ? lista.map(filaEmpleado).join('') : filaVacia()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.getElementById('form-personal').addEventListener('submit', (ev) => {
    ev.preventDefault();
    guardarEmpleado(ev.target, container);
  });

  document.getElementById('btn-cancelar-edicion').addEventListener('click', () => {
    editandoId = null;
    pintar(container);
  });

  container.querySelectorAll('[data-editar]').forEach(btn => {
    btn.addEventListener('click', () => iniciarEdicion(btn.dataset.editar, container));
  });
  container.querySelectorAll('[data-borrar]').forEach(btn => {
    btn.addEventListener('click', () => borrarEmpleado(btn.dataset.borrar, container));
  });
}

function filaEmpleado(e) {
  const dispTxt = DIAS.filter(d => e.disponibilidad && e.disponibilidad[d]).map(d => DIAS_LABEL[d].slice(0, 2)).join(' ');
  return `
    <tr>
      <td><strong>${esc(e.nombre)}</strong></td>
      <td>${esc(e.contrato)}</td>
      <td>${e.horasSemanales} h</td>
      <td>${esc(e.categoria)}</td>
      <td>${esc(e.seccion)}</td>
      <td>${e.turnoFijo ? esc(e.turnoFijo) : '<span class="muted">-</span>'}</td>
      <td>${e.costeHora ? e.costeHora.toFixed(2) + ' €' : '<span class="muted">-</span>'}</td>
      <td><span class="badge badge--info">${dispTxt || '-'}</span></td>
      <td style="white-space:nowrap;">
        <button class="btn btn--sm btn--secondary" data-editar="${e.id}">Editar</button>
        <button class="btn btn--sm btn--danger" data-borrar="${e.id}">Borrar</button>
      </td>
    </tr>
  `;
}

function filaVacia() {
  return `<tr class="empty-row"><td colspan="9">No hay empleados dados de alta todavia.</td></tr>`;
}

function guardarEmpleado(form, container) {
  const datos = new FormData(form);
  const disponibilidad = {};
  DIAS.forEach(d => { disponibilidad[d] = form.querySelector(`[name="disp_${d}"]`).checked; });

  const vacaciones = (datos.get('vacaciones') || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  const empleado = {
    id: editandoId || generarId(),
    nombre: (datos.get('nombre') || '').trim(),
    contrato: datos.get('contrato'),
    horasSemanales: Number(datos.get('horasSemanales')) || 0,
    categoria: (datos.get('categoria') || '').trim(),
    seccion: (datos.get('seccion') || '').trim(),
    disponibilidad,
    turnoFijo: datos.get('turnoFijo') || '',
    costeHora: Number(datos.get('costeHora')) || 0,
    vacaciones,
    preferencias: (datos.get('preferencias') || '').trim()
  };

  if (!empleado.nombre) {
    window.UI.toast('El nombre del empleado es obligatorio.');
    return;
  }

  const lista = leer(KEYS.PERSONAL, []);
  const idx = lista.findIndex(e => e.id === empleado.id);
  if (idx >= 0) lista[idx] = empleado; else lista.push(empleado);
  guardar(KEYS.PERSONAL, lista);

  window.UI.toast(idx >= 0 ? 'Empleado actualizado.' : 'Empleado anadido.');
  editandoId = null;
  pintar(container);
}

function iniciarEdicion(id, container) {
  const lista = leer(KEYS.PERSONAL, []);
  const emp = lista.find(e => e.id === id);
  if (!emp) return;
  editandoId = id;
  pintar(container);

  const form = document.getElementById('form-personal');
  form.querySelector('[name="id"]').value = emp.id;
  form.querySelector('[name="nombre"]').value = emp.nombre;
  form.querySelector('[name="contrato"]').value = emp.contrato;
  form.querySelector('[name="horasSemanales"]').value = emp.horasSemanales;
  form.querySelector('[name="categoria"]').value = emp.categoria;
  form.querySelector('[name="seccion"]').value = emp.seccion;
  form.querySelector('[name="turnoFijo"]').value = emp.turnoFijo || '';
  form.querySelector('[name="costeHora"]').value = emp.costeHora || '';
  form.querySelector('[name="vacaciones"]').value = (emp.vacaciones || []).join(', ');
  form.querySelector('[name="preferencias"]').value = emp.preferencias || '';
  DIAS.forEach(d => {
    const cb = form.querySelector(`[name="disp_${d}"]`);
    if (cb) cb.checked = !!(emp.disponibilidad && emp.disponibilidad[d]);
  });

  document.getElementById('form-titulo').textContent = 'Editar empleado: ' + emp.nombre;
  document.getElementById('btn-cancelar-edicion').classList.remove('hidden');
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function borrarEmpleado(id, container) {
  if (!window.UI.confirmar('Seguro que quieres eliminar este empleado?')) return;
  const lista = leer(KEYS.PERSONAL, []).filter(e => e.id !== id);
  guardar(KEYS.PERSONAL, lista);
  window.UI.toast('Empleado eliminado.');
  pintar(container);
}

function esc(v) { return window.UI.escapeHtml(v); }
