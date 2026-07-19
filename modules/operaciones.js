/**
 * operaciones.js
 * -----------------------------------------------------------------------
 * Pantalla "Operaciones": tareas puntuales que requieren personal en un
 * momento concreto (recepcion de camion, reposicion, inventario...).
 * El motor las cubre en su prioridad 3, despues del convenio y los
 * minimos criticos de cobertura.
 * -----------------------------------------------------------------------
 */

import { leer, guardar, KEYS, generarId, DIAS_LABEL } from './storage.js';

const OPERACIONES_SUGERIDAS = ['Recepcion camion', 'Reposicion', 'Inventario', 'Limpieza', 'Horneado', 'Etiquetado', 'Cambio de precios'];

let editandoId = null;

export async function render(container) {
  editandoId = null;
  pintar(container);
}

function pintar(container) {
  const lista = leer(KEYS.OPERACIONES, []);

  container.innerHTML = `
    <div class="screen">
      <div class="screen-header">
        <div>
          <h1>Operaciones</h1>
          <p>Tareas puntuales que necesitan personal asignado en un dia y hora concretos.</p>
        </div>
      </div>

      <div class="card">
        <h3 id="form-titulo">Nueva operacion</h3>
        <form id="form-operacion">
          <input type="hidden" name="id">
          <div class="form-grid">
            <div class="field">
              <label for="op-nombre">Nombre</label>
              <input id="op-nombre" name="nombre" list="op-sugeridas" type="text" required>
              <datalist id="op-sugeridas">
                ${OPERACIONES_SUGERIDAS.map(n => `<option value="${n}">`).join('')}
              </datalist>
            </div>
            <div class="field">
              <label for="op-dia">Dia</label>
              <select id="op-dia" name="dia">
                ${Object.keys(DIAS_LABEL).map(d => `<option value="${d}">${DIAS_LABEL[d]}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label for="op-hora">Hora</label>
              <input id="op-hora" name="hora" type="time" value="09:00" required>
            </div>
            <div class="field">
              <label for="op-duracion">Duracion (min)</label>
              <input id="op-duracion" name="duracion" type="number" min="5" step="5" value="60" required>
            </div>
            <div class="field">
              <label for="op-personas">Personas necesarias</label>
              <input id="op-personas" name="personasNecesarias" type="number" min="1" value="1" required>
            </div>
            <div class="field">
              <label for="op-prioridad">Prioridad</label>
              <select id="op-prioridad" name="prioridad">
                <option value="Alta">Alta</option>
                <option value="Media" selected>Media</option>
                <option value="Baja">Baja</option>
              </select>
            </div>
            <div class="field">
              <label for="op-seccion">Seccion</label>
              <input id="op-seccion" name="seccion" type="text" placeholder="Ej. Reposicion">
            </div>
          </div>
          <div class="actions-row">
            <button type="submit" class="btn">Guardar operacion</button>
            <button type="button" id="btn-cancelar-edicion" class="btn btn--secondary hidden">Cancelar edicion</button>
          </div>
        </form>
      </div>

      <div class="card">
        <h3>Operaciones planificadas (${lista.length})</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Nombre</th><th>Dia</th><th>Hora</th><th>Duracion</th><th>Personas</th><th>Prioridad</th><th>Seccion</th><th></th></tr></thead>
            <tbody>${lista.length ? lista.map(fila).join('') : vacio()}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.getElementById('form-operacion').addEventListener('submit', (ev) => {
    ev.preventDefault();
    guardarOperacion(ev.target, container);
  });
  document.getElementById('btn-cancelar-edicion').addEventListener('click', () => {
    editandoId = null;
    pintar(container);
  });
  container.querySelectorAll('[data-editar]').forEach(b => b.addEventListener('click', () => editar(b.dataset.editar, container)));
  container.querySelectorAll('[data-borrar]').forEach(b => b.addEventListener('click', () => borrar(b.dataset.borrar, container)));
}

function fila(o) {
  const badge = o.prioridad === 'Alta' ? 'badge--bad' : (o.prioridad === 'Media' ? 'badge--warn' : 'badge--neutral');
  return `
    <tr>
      <td><strong>${esc(o.nombre)}</strong></td>
      <td>${DIAS_LABEL[o.dia] || o.dia}</td>
      <td>${o.hora}</td>
      <td>${o.duracion} min</td>
      <td>${o.personasNecesarias}</td>
      <td><span class="badge ${badge}">${esc(o.prioridad)}</span></td>
      <td>${esc(o.seccion) || '-'}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn--sm btn--secondary" data-editar="${o.id}">Editar</button>
        <button class="btn btn--sm btn--danger" data-borrar="${o.id}">Borrar</button>
      </td>
    </tr>
  `;
}

function vacio() {
  return `<tr class="empty-row"><td colspan="8">No hay operaciones planificadas.</td></tr>`;
}

function guardarOperacion(form, container) {
  const datos = new FormData(form);
  const operacion = {
    id: editandoId || generarId(),
    nombre: (datos.get('nombre') || '').trim(),
    dia: datos.get('dia'),
    hora: datos.get('hora'),
    duracion: Number(datos.get('duracion')) || 30,
    personasNecesarias: Number(datos.get('personasNecesarias')) || 1,
    prioridad: datos.get('prioridad'),
    seccion: (datos.get('seccion') || '').trim()
  };

  if (!operacion.nombre) {
    window.UI.toast('El nombre de la operacion es obligatorio.');
    return;
  }

  const lista = leer(KEYS.OPERACIONES, []);
  const idx = lista.findIndex(o => o.id === operacion.id);
  if (idx >= 0) lista[idx] = operacion; else lista.push(operacion);
  guardar(KEYS.OPERACIONES, lista);

  window.UI.toast(idx >= 0 ? 'Operacion actualizada.' : 'Operacion anadida.');
  editandoId = null;
  pintar(container);
}

function editar(id, container) {
  const o = leer(KEYS.OPERACIONES, []).find(x => x.id === id);
  if (!o) return;
  editandoId = id;
  pintar(container);
  const form = document.getElementById('form-operacion');
  form.querySelector('[name="nombre"]').value = o.nombre;
  form.querySelector('[name="dia"]').value = o.dia;
  form.querySelector('[name="hora"]').value = o.hora;
  form.querySelector('[name="duracion"]').value = o.duracion;
  form.querySelector('[name="personasNecesarias"]').value = o.personasNecesarias;
  form.querySelector('[name="prioridad"]').value = o.prioridad;
  form.querySelector('[name="seccion"]').value = o.seccion;
  document.getElementById('form-titulo').textContent = 'Editar operacion';
  document.getElementById('btn-cancelar-edicion').classList.remove('hidden');
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function borrar(id, container) {
  if (!window.UI.confirmar('Eliminar esta operacion?')) return;
  guardar(KEYS.OPERACIONES, leer(KEYS.OPERACIONES, []).filter(o => o.id !== id));
  window.UI.toast('Operacion eliminada.');
  pintar(container);
}

function esc(v) { return window.UI.escapeHtml(v); }
