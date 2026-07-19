/**
 * cobertura.js
 * -----------------------------------------------------------------------
 * Pantalla "Cobertura": franjas horarias con personal deseado y minimo
 * critico. Admite reglas recurrentes (por ejemplo Lunes-Viernes 20:00-
 * 21:00 minimo 3), aplicando la franja a varios dias a la vez.
 * -----------------------------------------------------------------------
 */

import { leer, guardar, KEYS, generarId, DIAS, DIAS_LABEL } from './storage.js';

let editandoId = null;

export async function render(container) {
  editandoId = null;
  pintar(container);
}

function pintar(container) {
  const lista = leer(KEYS.COBERTURA, []);

  container.innerHTML = `
    <div class="screen">
      <div class="screen-header">
        <div>
          <h1>Cobertura</h1>
          <p>Define cuanto personal necesitas en cada franja horaria, por dia o de forma recurrente.</p>
        </div>
      </div>

      <div class="card">
        <h3 id="form-titulo">Nueva franja de cobertura</h3>
        <form id="form-cobertura">
          <input type="hidden" name="id">
          <div class="field" style="margin-bottom:12px;">
            <label>Dias aplicables</label>
            <div class="checkbox-row" id="cov-dias">
              ${DIAS.map(d => `<label><input type="checkbox" name="dia_${d}"> ${DIAS_LABEL[d]}</label>`).join('')}
            </div>
          </div>
          <div class="form-grid">
            <div class="field">
              <label for="cov-inicio">Hora inicio</label>
              <input id="cov-inicio" name="horaInicio" type="time" value="09:00" required>
            </div>
            <div class="field">
              <label for="cov-fin">Hora fin</label>
              <input id="cov-fin" name="horaFin" type="time" value="13:00" required>
            </div>
            <div class="field">
              <label for="cov-deseado">Personal deseado</label>
              <input id="cov-deseado" name="personalDeseado" type="number" min="0" value="2" required>
            </div>
            <div class="field">
              <label for="cov-minimo">Personal minimo critico</label>
              <input id="cov-minimo" name="personalMinimo" type="number" min="0" value="1" required>
            </div>
          </div>
          <div class="actions-row">
            <button type="submit" class="btn">Guardar franja</button>
            <button type="button" id="btn-cancelar-edicion" class="btn btn--secondary hidden">Cancelar edicion</button>
          </div>
        </form>
      </div>

      <div class="card">
        <h3>Franjas configuradas (${lista.length})</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Dias</th><th>Horario</th><th>Deseado</th><th>Minimo</th><th></th></tr></thead>
            <tbody>${lista.length ? lista.map(fila).join('') : vacio()}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.getElementById('form-cobertura').addEventListener('submit', (ev) => {
    ev.preventDefault();
    guardarFranja(ev.target, container);
  });
  document.getElementById('btn-cancelar-edicion').addEventListener('click', () => {
    editandoId = null;
    pintar(container);
  });
  container.querySelectorAll('[data-editar]').forEach(b => b.addEventListener('click', () => editar(b.dataset.editar, container)));
  container.querySelectorAll('[data-borrar]').forEach(b => b.addEventListener('click', () => borrar(b.dataset.borrar, container)));
}

function fila(c) {
  const dias = c.dias.map(d => DIAS_LABEL[d].slice(0, 2)).join(' ');
  const critico = c.personalMinimo > 0;
  return `
    <tr>
      <td><span class="badge badge--info">${dias}</span></td>
      <td>${c.horaInicio} - ${c.horaFin}</td>
      <td>${c.personalDeseado}</td>
      <td>${critico ? `<span class="badge badge--warn">${c.personalMinimo}</span>` : c.personalMinimo}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn--sm btn--secondary" data-editar="${c.id}">Editar</button>
        <button class="btn btn--sm btn--danger" data-borrar="${c.id}">Borrar</button>
      </td>
    </tr>
  `;
}

function vacio() {
  return `<tr class="empty-row"><td colspan="5">No hay franjas de cobertura definidas.</td></tr>`;
}

function guardarFranja(form, container) {
  const datos = new FormData(form);
  const dias = DIAS.filter(d => form.querySelector(`[name="dia_${d}"]`).checked);
  const horaInicio = datos.get('horaInicio');
  const horaFin = datos.get('horaFin');

  if (!dias.length) {
    window.UI.toast('Selecciona al menos un dia.');
    return;
  }
  if (horaInicio >= horaFin) {
    window.UI.toast('La hora de inicio debe ser anterior a la de fin.');
    return;
  }

  const franja = {
    id: editandoId || generarId(),
    dias,
    horaInicio,
    horaFin,
    personalDeseado: Number(datos.get('personalDeseado')) || 0,
    personalMinimo: Number(datos.get('personalMinimo')) || 0
  };

  const lista = leer(KEYS.COBERTURA, []);
  const idx = lista.findIndex(c => c.id === franja.id);
  if (idx >= 0) lista[idx] = franja; else lista.push(franja);
  guardar(KEYS.COBERTURA, lista);

  window.UI.toast(idx >= 0 ? 'Franja actualizada.' : 'Franja anadida.');
  editandoId = null;
  pintar(container);
}

function editar(id, container) {
  const c = leer(KEYS.COBERTURA, []).find(x => x.id === id);
  if (!c) return;
  editandoId = id;
  pintar(container);
  const form = document.getElementById('form-cobertura');
  form.querySelector('[name="horaInicio"]').value = c.horaInicio;
  form.querySelector('[name="horaFin"]').value = c.horaFin;
  form.querySelector('[name="personalDeseado"]').value = c.personalDeseado;
  form.querySelector('[name="personalMinimo"]').value = c.personalMinimo;
  DIAS.forEach(d => {
    const cb = form.querySelector(`[name="dia_${d}"]`);
    if (cb) cb.checked = c.dias.includes(d);
  });
  document.getElementById('form-titulo').textContent = 'Editar franja de cobertura';
  document.getElementById('btn-cancelar-edicion').classList.remove('hidden');
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function borrar(id, container) {
  if (!window.UI.confirmar('Eliminar esta franja de cobertura?')) return;
  guardar(KEYS.COBERTURA, leer(KEYS.COBERTURA, []).filter(c => c.id !== id));
  window.UI.toast('Franja eliminada.');
  pintar(container);
}
