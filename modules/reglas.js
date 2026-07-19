/**
 * reglas.js
 * -----------------------------------------------------------------------
 * Pantalla "Reglas": permite activar/desactivar cada regla del motor y
 * ajustar su peso relativo, respetando el orden de prioridad.
 * El usuario puede tambien reordenar prioridades (salvo "Cumplir
 * convenio", que siempre es la maxima prioridad y no se puede apagar).
 *
 * Estas reglas se leen desde KEYS.REGLAS y son consumidas por
 * motor.js. Anadir una nueva regla al motor no requiere tocar esta
 * pantalla: basta con registrarla en el REGISTRO_REGLAS de motor.js y
 * anadir su entrada de configuracion aqui (o via storage).
 * -----------------------------------------------------------------------
 */

import { leer, guardar, KEYS, reglasPorDefecto } from './storage.js';

export async function render(container) {
  pintar(container);
}

function pintar(container) {
  let reglas = leer(KEYS.REGLAS, []);
  if (!reglas.length) reglas = reglasPorDefecto();
  reglas = [...reglas].sort((a, b) => a.prioridad - b.prioridad);

  container.innerHTML = `
    <div class="screen">
      <div class="screen-header">
        <div>
          <h1>Reglas</h1>
          <p>El motor trabaja por prioridades. Reordena, activa o desactiva reglas y ajusta su peso.</p>
        </div>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Prioridad</th><th>Regla</th><th>Activa</th><th>Peso</th><th></th></tr>
            </thead>
            <tbody>
              ${reglas.map((r, i) => filaRegla(r, i, reglas.length)).join('')}
            </tbody>
          </table>
        </div>
        <div class="actions-row">
          <button id="btn-restaurar" class="btn btn--secondary">Restaurar valores por defecto</button>
        </div>
      </div>

      <div class="card">
        <h3>Como funciona el motor</h3>
        <p class="muted">Las reglas se evalúan de mayor a menor prioridad. Las de prioridad 1 y 2 son restricciones
        que casi nunca se saltan (convenio y minimos criticos); el resto son objetivos de optimizacion que el motor
        intenta cumplir en la medida de lo posible sin romper las anteriores. Puedes anadir nuevas reglas al motor
        sin modificar el resto del sistema: cada regla es una funcion independiente.</p>
      </div>
    </div>
  `;

  container.querySelectorAll('[data-toggle]').forEach(cb => {
    cb.addEventListener('change', () => cambiarActiva(cb.dataset.toggle, cb.checked, container));
  });
  container.querySelectorAll('[data-peso]').forEach(inp => {
    inp.addEventListener('change', () => cambiarPeso(inp.dataset.peso, inp.value, container));
  });
  container.querySelectorAll('[data-subir]').forEach(b => b.addEventListener('click', () => mover(b.dataset.subir, -1, container)));
  container.querySelectorAll('[data-bajar]').forEach(b => b.addEventListener('click', () => mover(b.dataset.bajar, 1, container)));
  document.getElementById('btn-restaurar').addEventListener('click', () => {
    if (!window.UI.confirmar('Restaurar las reglas a los valores por defecto?')) return;
    guardar(KEYS.REGLAS, reglasPorDefecto());
    window.UI.toast('Reglas restauradas.');
    pintar(container);
  });
}

function filaRegla(r, i, total) {
  const bloqueada = r.id === 'convenio';
  return `
    <tr>
      <td><span class="badge badge--neutral">P${r.prioridad}</span></td>
      <td><strong>${esc(r.nombre)}</strong></td>
      <td>
        <input type="checkbox" data-toggle="${r.id}" ${r.activa ? 'checked' : ''} ${bloqueada ? 'disabled' : ''}>
      </td>
      <td style="width:110px;">
        <input type="number" min="1" max="2000" value="${r.peso}" data-peso="${r.id}" style="width:80px; padding:5px 7px; border:1px solid var(--color-border); border-radius:6px;">
      </td>
      <td style="white-space:nowrap;">
        <button class="btn btn--sm btn--secondary" data-subir="${r.id}" ${i === 0 ? 'disabled' : ''} title="Subir prioridad">&uarr;</button>
        <button class="btn btn--sm btn--secondary" data-bajar="${r.id}" ${i === total - 1 ? 'disabled' : ''} title="Bajar prioridad">&darr;</button>
      </td>
    </tr>
  `;
}

function cambiarActiva(id, activa, container) {
  const reglas = leer(KEYS.REGLAS, []);
  const r = reglas.find(x => x.id === id);
  if (r) r.activa = activa;
  guardar(KEYS.REGLAS, reglas);
  window.UI.toast(activa ? 'Regla activada.' : 'Regla desactivada.');
}

function cambiarPeso(id, valor, container) {
  const reglas = leer(KEYS.REGLAS, []);
  const r = reglas.find(x => x.id === id);
  if (r) r.peso = Math.max(1, Number(valor) || 1);
  guardar(KEYS.REGLAS, reglas);
  window.UI.toast('Peso actualizado.');
}

function mover(id, direccion, container) {
  const reglas = leer(KEYS.REGLAS, []).sort((a, b) => a.prioridad - b.prioridad);
  const idx = reglas.findIndex(x => x.id === id);
  const destino = idx + direccion;
  if (destino < 0 || destino >= reglas.length) return;
  // Intercambia la posicion (prioridad) entre la regla movida y la vecina.
  const tmp = reglas[idx].prioridad;
  reglas[idx].prioridad = reglas[destino].prioridad;
  reglas[destino].prioridad = tmp;
  guardar(KEYS.REGLAS, reglas);
  pintar(container);
}

function esc(v) { return window.UI.escapeHtml(v); }
