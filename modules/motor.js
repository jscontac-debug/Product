/**
 * motor.js
 * -----------------------------------------------------------------------
 * El motor de generacion de cuadrantes de Product.
 *
 * DISENO: el motor NO es un algoritmo cerrado. Es un bucle de asignacion
 * por bloques de 30 minutos que, en cada decision, pregunta a un
 * REGISTRO de reglas independientes cuanto "puntua" cada candidato
 * posible. Anadir una regla nueva consiste en anadir una funcion mas al
 * registro (REGISTRO_REGLAS) sin tocar el bucle principal ni el resto de
 * reglas existentes.
 *
 * El bucle respeta un orden de prioridades:
 *   P1 Cumplir convenio       -> filtro duro (esElegible), nunca se salta.
 *   P2 Cubrir minimos/deseado -> orden de asignacion de huecos de cobertura.
 *   P3 Cubrir operaciones     -> se asignan despues de la cobertura base.
 *   P4-P9 (aperturas, cierres, domingos, horas sobrantes, coste,
 *          productividad) -> funciones de puntuacion que desempatan
 *          entre candidatos igualmente elegibles.
 *
 * El motor genera el cuadrante para el PLAZO DE TIEMPO que indique la
 * persona usuaria (una o varias semanas seguidas), calculando cada
 * semana de forma independiente y guardando el resultado en un unico
 * contenedor indexado por la fecha de inicio de cada semana.
 *
 * Este archivo expone dos pantallas: "Generar" (render) y "Resultado"
 * (renderResultado), reutilizando el mismo modulo porque comparten el
 * mismo dominio de datos (el cuadrante).
 * -----------------------------------------------------------------------
 */

import {
  leer, guardar, KEYS, DIAS, DIAS_LABEL,
  sumarDiasFecha, lunesDeSemana, numeroSemanaISO, formatoFechaCorta
} from './storage.js';

const BLOQUE_MIN = 30; // resolucion temporal del motor, en minutos

/* =========================================================================
   REGISTRO DE REGLAS (prioridades 4 a 9)
   Cada regla es: (empleado, estado, contexto, peso) => puntuacion numerica.
   Puntuaciones mas altas hacen al candidato mas atractivo para el hueco.
   Anadir una regla nueva: agrega una entrada aqui con su "id" coincidiendo
   con el id configurado en la pantalla "Reglas".
   ========================================================================= */
const REGISTRO_REGLAS = {

  aperturas(empleado, estado, ctx, peso) {
    if (!ctx.esApertura) return 0;
    return peso / (1 + estado.aperturas);
  },

  cierres(empleado, estado, ctx, peso) {
    if (!ctx.esCierre) return 0;
    return peso / (1 + estado.cierres);
  },

  domingos(empleado, estado, ctx, peso) {
    if (ctx.dia !== 'domingo') return 0;
    return peso / (1 + estado.domingos);
  },

  horasSobrantes(empleado, estado, ctx, peso) {
    // Prioriza a quien mas lejos esta de cumplir su jornada contratada,
    // para repartir las horas y no dejar huecos de contrato sin cubrir.
    const restante = Math.max(0, empleado.horasSemanales - estado.horasAsignadas);
    return peso * (restante / Math.max(1, empleado.horasSemanales));
  },

  coste(empleado, estado, ctx, peso) {
    // El coste es una opcion: si la tienda lo tiene desactivado, la regla no puntua.
    if (!ctx.costeHabilitado) return 0;
    return -peso * costeHoraEmpleado(empleado);
  },

  productividad(empleado, estado, ctx, peso) {
    // Favorece asignar a cada empleado en su propia seccion.
    if (!ctx.seccion) return 0;
    return empleado.seccion && empleado.seccion === ctx.seccion ? peso : 0;
  }
};

/** Coste horario relativo aproximado por categoria (se usa solo si el empleado no tiene coste propio). */
export function costeHoraPorCategoria(categoria) {
  const tabla = { 'Encargado': 14, 'Responsable': 13, 'Dependiente': 10.5, 'Auxiliar': 9.5 };
  return tabla[categoria] || 10;
}

/** Coste horario real de un empleado: usa su coste individual si esta definido, si no la tabla por categoria. */
export function costeHoraEmpleado(empleado) {
  if (empleado.costeHora && empleado.costeHora > 0) return empleado.costeHora;
  return costeHoraPorCategoria(empleado.categoria);
}

/* =========================================================================
   GENERACION DEL CUADRANTE (multi-semana)
   ========================================================================= */

/**
 * Genera el cuadrante para el plazo de tiempo indicado (una o varias
 * semanas consecutivas a partir de un lunes) y lo guarda en LocalStorage.
 * @param {object} tienda configuracion de tienda
 * @param {array} personal lista de empleados
 * @param {array} cobertura franjas de cobertura
 * @param {array} operaciones operaciones puntuales
 * @param {array} reglas configuracion de reglas (peso/activa)
 * @param {string} fechaInicio fecha ISO (se ajusta al lunes de esa semana)
 * @param {number} numSemanas numero de semanas consecutivas a generar
 */
export function generarCuadrante(tienda, personal, cobertura, operaciones, reglas, fechaInicio, numSemanas = 1) {
  const inicio = lunesDeSemana(fechaInicio);
  const semanas = {};

  for (let i = 0; i < Math.max(1, numSemanas); i++) {
    const semanaInicio = sumarDiasFecha(inicio, i * 7);
    semanas[semanaInicio] = generarSemana(tienda, personal, cobertura, operaciones, reglas, semanaInicio);
  }

  const contenedor = {
    generadoEl: new Date().toISOString(),
    fechaInicio: inicio,
    numSemanas: Math.max(1, numSemanas),
    semanas
  };

  guardar(KEYS.CUADRANTE, contenedor);
  return contenedor;
}

/** Genera el cuadrante de UNA sola semana (funcion interna, no persiste por si sola). */
function generarSemana(tienda, personal, cobertura, operaciones, reglas, semanaInicio) {
  const reglasActivas = {};
  reglas.forEach(r => { reglasActivas[r.id] = r.activa ? r.peso : 0; });

  const jornada = calcularVentanaJornada(tienda);
  const estado = inicializarEstado(personal);
  const dias = {};

  DIAS.forEach((dia, indiceDia) => {
    const fechaDia = sumarDiasFecha(semanaInicio, indiceDia);
    const demanda = construirDemandaDia(dia, cobertura, jornada);

    dias[dia] = [];

    // --- Prioridad 2a: cubrir minimos criticos ---
    asignarCobertura(dias[dia], demanda, 'minimo', dia, indiceDia, fechaDia, jornada, tienda, personal, estado, reglasActivas);

    // --- Prioridad 2b: cubrir personal deseado (si quedan recursos) ---
    asignarCobertura(dias[dia], demanda, 'deseado', dia, indiceDia, fechaDia, jornada, tienda, personal, estado, reglasActivas);

    // --- Prioridad 3: cubrir operaciones ---
    const operacionesDia = operaciones.filter(o => o.dia === dia)
      .sort((a, b) => valorPrioridad(b.prioridad) - valorPrioridad(a.prioridad));
    operacionesDia.forEach(op => {
      asignarOperacion(dias[dia], op, dia, indiceDia, fechaDia, tienda, personal, estado, reglasActivas);
    });
  });

  return {
    semanaInicio,
    dias,
    resumenEmpleado: construirResumenEmpleado(personal, estado)
  };
}

/** Convierte la prioridad textual de una operacion en un numero para ordenar. */
function valorPrioridad(p) {
  return { 'Alta': 3, 'Media': 2, 'Baja': 1 }[p] || 1;
}

/** Calcula la ventana horaria de trabajo real (incluye tiempos antes/despues). */
function calcularVentanaJornada(tienda) {
  const inicio = window.UI.horaAMinutos(tienda.horario.apertura) - tienda.tiempoAntes;
  const fin = window.UI.horaAMinutos(tienda.horario.cierre) + tienda.tiempoDespues;
  const numBloques = Math.ceil((fin - inicio) / BLOQUE_MIN);
  return { inicio, fin, numBloques };
}

/** Clasifica un turno como "manana" o "tarde" segun su hora de inicio (usado para turno fijo y rotacion semanal). */
function clasificarTurno(inicioMin) {
  return inicioMin < window.UI.horaAMinutos('14:00') ? 'manana' : 'tarde';
}

/** Inicializa el estado acumulado (horas, turnos...) de cada empleado para UNA semana. */
function inicializarEstado(personal) {
  const estado = {};
  personal.forEach(e => {
    estado[e.id] = {
      horasAsignadas: 0,
      turnos: {},              // dia -> [{inicioMin, finMin}]
      aperturas: 0,
      cierres: 0,
      domingos: 0,
      consecutivos: 0,
      ultimoDiaIdx: -99,
      totalTurnos: 0,           // turnos asignados en toda la semana (para la regla de rotacion semanal)
      turnoSemanaTipo: null     // 'manana' | 'tarde', fijado por el primer turno de la semana
    };
    DIAS.forEach(d => { estado[e.id].turnos[d] = []; });
  });
  return estado;
}

/** Construye los arrays de demanda (minimo y deseado) por bloque para un dia. */
function construirDemandaDia(dia, cobertura, jornada) {
  const minimo = new Array(jornada.numBloques).fill(0);
  const deseado = new Array(jornada.numBloques).fill(0);

  cobertura.filter(c => c.dias.includes(dia)).forEach(c => {
    const desde = window.UI.horaAMinutos(c.horaInicio);
    const hasta = window.UI.horaAMinutos(c.horaFin);
    for (let t = desde; t < hasta; t += BLOQUE_MIN) {
      const idx = Math.floor((t - jornada.inicio) / BLOQUE_MIN);
      if (idx < 0 || idx >= jornada.numBloques) continue;
      minimo[idx] = Math.max(minimo[idx], c.personalMinimo);
      deseado[idx] = Math.max(deseado[idx], c.personalDeseado);
    }
  });

  return { minimo, deseado, asignado: new Array(jornada.numBloques).fill(0) };
}

/**
 * Asigna empleados a huecos de cobertura hasta alcanzar el objetivo
 * indicado ('minimo' o 'deseado') o hasta agotar candidatos elegibles.
 */
function asignarCobertura(turnosDia, demanda, objetivo, dia, indiceDia, fechaDia, jornada, tienda, empleados, estado, reglasActivas) {
  let progreso = true;
  let intentosSinExito = 0;

  while (progreso && intentosSinExito < 500) {
    progreso = false;
    const objetivoArray = demanda[objetivo];
    let mejorIdx = -1;
    let mejorDeficit = 0;

    for (let i = 0; i < objetivoArray.length; i++) {
      const deficit = objetivoArray[i] - demanda.asignado[i];
      if (deficit > mejorDeficit) { mejorDeficit = deficit; mejorIdx = i; }
    }

    if (mejorIdx === -1) break;

    const longitud = calcularLongitudTurno(demanda, objetivo, mejorIdx, jornada, tienda);
    const candidato = elegirMejorCandidato(empleados, estado, dia, indiceDia, fechaDia, mejorIdx, longitud, jornada, tienda, reglasActivas, null);

    if (!candidato) { intentosSinExito++; continue; }

    aplicarTurno(turnosDia, demanda, candidato, estado, dia, indiceDia, jornada, mejorIdx, longitud, tienda, 'cobertura', null);
    progreso = true;
  }
}

/** Determina cuantos bloques debe durar un turno que arranca en un indice dado. */
function calcularLongitudTurno(demanda, objetivo, idxInicio, jornada, tienda) {
  // La duracion de un turno individual esta acotada por la "duracion maxima de turno"
  // configurada en Tienda (por ejemplo, 6 horas), no por el maximo de horas del dia
  // (que solo se alcanza combinando varios turnos si el convenio lo permite).
  const duracionTurnoMax = tienda.duracionTurnoMax || tienda.maxHorasDia || 6;
  const maxBloques = Math.round((duracionTurnoMax * 60) / BLOQUE_MIN);
  const minBloques = Math.min(maxBloques, Math.round(4 * 60 / BLOQUE_MIN)); // turno minimo orientativo: 4h
  let fin = idxInicio;

  while (
    fin + 1 < demanda.asignado.length &&
    (fin - idxInicio + 1) < maxBloques &&
    demanda[objetivo][fin + 1] > demanda.asignado[fin + 1]
  ) {
    fin++;
  }

  const longitud = Math.max(1, fin - idxInicio + 1);
  return Math.max(Math.min(longitud, maxBloques), Math.min(minBloques, jornada.numBloques - idxInicio));
}

/** Busca, entre los empleados elegibles, el de mayor puntuacion segun las reglas activas. */
function elegirMejorCandidato(empleados, estado, dia, indiceDia, fechaDia, idxInicio, longitud, jornada, tienda, reglasActivas, seccionRequerida) {
  const inicioMin = jornada.inicio + idxInicio * BLOQUE_MIN;
  const finMin = inicioMin + longitud * BLOQUE_MIN;
  const esApertura = idxInicio === 0;
  const esCierre = (idxInicio + longitud) >= jornada.numBloques;

  let mejor = null;
  let mejorPuntuacion = -Infinity;

  empleados.forEach(emp => {
    if (!esElegible(emp, estado[emp.id], dia, indiceDia, fechaDia, inicioMin, finMin, tienda)) return;

    const ctx = {
      dia, esApertura, esCierre,
      seccion: seccionRequerida,
      costeHabilitado: tienda.costeHabilitado !== false
    };
    let puntuacion = 0;
    Object.keys(REGISTRO_REGLAS).forEach(idRegla => {
      const peso = reglasActivas[idRegla] || 0;
      if (peso <= 0) return;
      puntuacion += REGISTRO_REGLAS[idRegla](emp, estado[emp.id], ctx, peso);
    });

    if (puntuacion > mejorPuntuacion) { mejorPuntuacion = puntuacion; mejor = emp; }
  });

  return mejor;
}

/** PRIORIDAD 1: filtro duro de cumplimiento de convenio y disponibilidad. */
function esElegible(empleado, est, dia, indiceDia, fechaDia, inicioMin, finMin, tienda) {
  if (!empleado.disponibilidad || !empleado.disponibilidad[dia]) return false;
  if (empleado.vacaciones && empleado.vacaciones.includes(fechaDia)) return false;

  const horas = (finMin - inicioMin) / 60;
  const duracionTurnoMax = tienda.duracionTurnoMax || tienda.maxHorasDia || 6;
  if (horas > duracionTurnoMax + 0.001) return false;

  const turnosHoy = est.turnos[dia];
  const horasYaHoy = turnosHoy.reduce((acc, t) => acc + (t.finMin - t.inicioMin) / 60, 0);
  if (horasYaHoy + horas > tienda.maxHorasDia + 0.001) return false;
  if (est.horasAsignadas + horas > empleado.horasSemanales + 0.001) return false;

  if (turnosHoy.length >= tienda.maxTurnos) return false;

  // Descanso minimo respecto a otros turnos del mismo dia (turnos partidos).
  for (const t of turnosHoy) {
    const solapa = inicioMin < t.finMin && finMin > t.inicioMin;
    if (solapa) return false;
    const gapHoras = Math.min(Math.abs(inicioMin - t.finMin), Math.abs(t.inicioMin - finMin)) / 60;
    if (gapHoras < tienda.descansoMinimo) return false;
  }

  // Dias consecutivos: solo se comprueba al anadir el primer turno del dia.
  if (turnosHoy.length === 0) {
    const seriaConsecutivo = est.ultimoDiaIdx === indiceDia - 1;
    const consecutivosSiSeAnade = seriaConsecutivo ? est.consecutivos + 1 : 1;
    if (consecutivosSiSeAnade > tienda.maxDiasConsecutivos) return false;
  }

  // Turno fijo: si el empleado tiene manana/tarde fijo, respetarlo de forma orientativa.
  if (empleado.turnoFijo === 'manana' && clasificarTurno(inicioMin) !== 'manana') return false;
  if (empleado.turnoFijo === 'tarde' && clasificarTurno(inicioMin) !== 'tarde') return false;

  // Rotacion semanal: si el empleado ya empezo la semana en un tipo de turno
  // (manana o tarde), se mantiene en ese mismo tipo el resto de la semana.
  if (tienda.rotacion === 'semanal' && est.turnoSemanaTipo && clasificarTurno(inicioMin) !== est.turnoSemanaTipo) {
    return false;
  }

  return true;
}

/** Registra el turno en el cuadrante del dia y actualiza el estado del empleado. */
function aplicarTurno(turnosDia, demanda, empleado, estado, dia, indiceDia, jornada, idxInicio, longitud, tienda, tipo, operacion) {
  const inicioMin = jornada.inicio + idxInicio * BLOQUE_MIN;
  const finMin = inicioMin + longitud * BLOQUE_MIN;
  const est = estado[empleado.id];

  for (let i = idxInicio; i < idxInicio + longitud && i < demanda.asignado.length; i++) {
    demanda.asignado[i]++;
  }

  const esPrimerTurnoDelDia = est.turnos[dia].length === 0;
  est.turnos[dia].push({ inicioMin, finMin });
  est.horasAsignadas += (finMin - inicioMin) / 60;

  if (esPrimerTurnoDelDia) {
    est.consecutivos = (est.ultimoDiaIdx === indiceDia - 1) ? est.consecutivos + 1 : 1;
    est.ultimoDiaIdx = indiceDia;
    if (dia === 'domingo') est.domingos++;
  }
  if (idxInicio === 0 && tipo === 'cobertura') est.aperturas++;
  if ((idxInicio + longitud) >= jornada.numBloques && tipo === 'cobertura') est.cierres++;

  // El primer turno de toda la semana fija el tipo (manana/tarde) para la rotacion semanal.
  if (tienda.rotacion === 'semanal' && est.totalTurnos === 0) {
    est.turnoSemanaTipo = clasificarTurno(inicioMin);
  }
  est.totalTurnos++;

  turnosDia.push({
    empleadoId: empleado.id,
    nombre: empleado.nombre,
    tipo,
    horaInicio: window.UI.minutosAHora(inicioMin),
    horaFin: window.UI.minutosAHora(finMin),
    seccion: empleado.seccion,
    operacionNombre: operacion ? operacion.nombre : null,
    operacionId: operacion ? operacion.id : null
  });
}

/** Asigna personal a una operacion puntual, reutilizando turnos existentes si es posible. */
function asignarOperacion(turnosDia, operacion, dia, indiceDia, fechaDia, tienda, empleados, estado, reglasActivas) {
  const inicioMin = window.UI.horaAMinutos(operacion.hora);
  const finMin = inicioMin + operacion.duracion;
  let cubiertos = 0;

  // 1) Reutilizar empleados que ya tienen un turno de cobertura solapado.
  turnosDia.filter(t => t.tipo === 'cobertura').forEach(t => {
    if (cubiertos >= operacion.personasNecesarias) return;
    const tIni = window.UI.horaAMinutos(t.horaInicio);
    const tFin = window.UI.horaAMinutos(t.horaFin);
    if (tIni <= inicioMin && tFin >= finMin && !t.operacionNombre) {
      t.operacionNombre = operacion.nombre;
      t.operacionId = operacion.id;
      cubiertos++;
    }
  });

  // 2) Si falta personal, crear turnos adicionales dedicados a la operacion.
  const jornadaOperacion = { inicio: inicioMin, fin: finMin, numBloques: Math.ceil((finMin - inicioMin) / BLOQUE_MIN) };
  const idxInicio = 0;
  const longitud = jornadaOperacion.numBloques || 1;

  while (cubiertos < operacion.personasNecesarias) {
    const candidato = elegirMejorCandidato(empleados, estado, dia, indiceDia, fechaDia, idxInicio, longitud, jornadaOperacion, tienda, reglasActivas, operacion.seccion);
    if (!candidato) break;
    aplicarTurno(turnosDia, { asignado: new Array(longitud).fill(0) }, candidato, estado, dia, indiceDia, jornadaOperacion, idxInicio, longitud, tienda, 'operacion', operacion);
    cubiertos++;
  }
}

/** Construye el resumen final de horas y equilibrios por empleado de una semana. */
function construirResumenEmpleado(personal, estado) {
  const resumen = {};
  personal.forEach(e => {
    const est = estado[e.id];
    resumen[e.id] = {
      nombre: e.nombre,
      horas: Math.round(est.horasAsignadas * 100) / 100,
      horasContrato: e.horasSemanales,
      aperturas: est.aperturas,
      cierres: est.cierres,
      domingos: est.domingos
    };
  });
  return resumen;
}

/* =========================================================================
   PANTALLA "GENERAR"
   ========================================================================= */

export async function render(container) {
  const tienda = leer(KEYS.TIENDA);
  const personal = leer(KEYS.PERSONAL, []);
  const cobertura = leer(KEYS.COBERTURA, []);
  const operaciones = leer(KEYS.OPERACIONES, []);
  const reglas = leer(KEYS.REGLAS, []);
  const cuadrante = leer(KEYS.CUADRANTE);

  const problemas = [];
  if (!tienda || !tienda.nombre) problemas.push('Completa la configuracion de la Tienda.');
  if (!personal.length) problemas.push('Da de alta al menos un empleado en Personal.');
  if (!cobertura.length) problemas.push('Define al menos una franja en Cobertura.');

  const lunesSugerido = lunesDeSemana(new Date().toISOString().slice(0, 10));

  container.innerHTML = `
    <div class="screen">
      <div class="screen-header">
        <div>
          <h1>Generar cuadrante</h1>
          <p>El motor calculara el cuadrante optimo aplicando las reglas configuradas, por orden de prioridad.</p>
        </div>
      </div>

      ${problemas.length ? `
        <div class="card">
          <h3>Antes de generar</h3>
          <ul class="issue-list">
            ${problemas.map(p => `<li class="issue-item issue-item--warn"><span class="issue-item__icon">!</span><span>${p}</span></li>`).join('')}
          </ul>
        </div>
      ` : ''}

      <div class="card">
        <h3>Plazo de tiempo a generar</h3>
        <div class="form-grid">
          <div class="field">
            <label for="gen-semana">Lunes de la primera semana</label>
            <input id="gen-semana" type="date" value="${lunesSugerido}">
          </div>
          <div class="field">
            <label for="gen-numsemanas">Numero de semanas</label>
            <input id="gen-numsemanas" type="number" min="1" max="26" value="1">
          </div>
        </div>
        <p class="muted" style="margin-top:6px;">Si la fecha elegida no es un lunes, se ajustara automaticamente al lunes de esa semana.</p>
        <div class="actions-row">
          <button id="btn-generar" class="btn" ${problemas.length ? 'disabled' : ''}>Generar cuadrante</button>
          ${cuadrante ? '<button id="btn-ver-resultado" class="btn btn--secondary">Ver ultimo resultado</button>' : ''}
        </div>
        <p class="muted" id="gen-estado" style="margin-top:10px;"></p>
      </div>

      <div class="card">
        <h3>Datos que usara el motor</h3>
        <div class="grid grid-4">
          <div class="stat"><div class="stat__value">${personal.length}</div><div class="stat__label">Empleados</div></div>
          <div class="stat"><div class="stat__value">${cobertura.length}</div><div class="stat__label">Franjas cobertura</div></div>
          <div class="stat"><div class="stat__value">${operaciones.length}</div><div class="stat__label">Operaciones</div></div>
          <div class="stat"><div class="stat__value">${reglas.filter(r => r.activa).length}/${reglas.length}</div><div class="stat__label">Reglas activas</div></div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('btn-generar').addEventListener('click', () => {
    const fechaInicio = document.getElementById('gen-semana').value || lunesSugerido;
    const numSemanas = Math.max(1, Number(document.getElementById('gen-numsemanas').value) || 1);
    const estadoTexto = document.getElementById('gen-estado');
    estadoTexto.textContent = 'Calculando...';
    // Se difiere un instante para que el navegador pinte el mensaje antes del calculo.
    setTimeout(() => {
      try {
        generarCuadrante(tienda, personal, cobertura, operaciones, reglas, fechaInicio, numSemanas);
        window.UI.toast(numSemanas > 1 ? `Cuadrante generado para ${numSemanas} semanas.` : 'Cuadrante generado correctamente.');
        window.irA('resultado');
      } catch (err) {
        console.error(err);
        estadoTexto.textContent = 'Se produjo un error al generar el cuadrante.';
      }
    }, 30);
  });

  const btnVer = document.getElementById('btn-ver-resultado');
  if (btnVer) btnVer.addEventListener('click', () => window.irA('resultado'));
}

/* =========================================================================
   PANTALLA "RESULTADO"
   Cuadrante semana a semana, en forma de rejilla por bloques de 30 min,
   con navegacion entre semanas, boton de impresion y vistas adicionales.
   ========================================================================= */

let vistaActual = 'cuadrante';
let semanaSeleccionada = null;

export async function renderResultado(container) {
  const contenedor = leer(KEYS.CUADRANTE);

  if (!contenedor || !contenedor.semanas || !Object.keys(contenedor.semanas).length) {
    container.innerHTML = `
      <div class="screen">
        <div class="card">
          <h3>Todavia no hay ningun cuadrante generado</h3>
          <p class="muted">Ve a la pantalla "Generar" para calcular el primer cuadrante.</p>
          <button class="btn" id="btn-ir-generar">Ir a Generar</button>
        </div>
      </div>
    `;
    document.getElementById('btn-ir-generar').addEventListener('click', () => window.irA('generar'));
    return;
  }

  const tienda = leer(KEYS.TIENDA);
  const cobertura = leer(KEYS.COBERTURA, []);
  const personal = leer(KEYS.PERSONAL, []);
  const semanasKeys = Object.keys(contenedor.semanas).sort();

  if (!semanaSeleccionada || !contenedor.semanas[semanaSeleccionada]) {
    semanaSeleccionada = semanasKeys[0];
  }

  container.innerHTML = `
    <div class="screen">
      <div class="screen-header no-print">
        <div>
          <h1>Resultado</h1>
          <p>Cuadrante generado el ${new Date(contenedor.generadoEl).toLocaleString('es-ES')} · ${contenedor.numSemanas} semana(s)</p>
        </div>
        <button id="btn-imprimir" class="btn btn--secondary">🖨️ Imprimir</button>
      </div>

      <div class="tabs no-print">
        <button class="tab-btn" data-vista="cuadrante">Cuadrante semanal</button>
        <button class="tab-btn" data-vista="periodo">Resumen del periodo</button>
        <button class="tab-btn" data-vista="empleado">Por empleado</button>
      </div>

      <div id="vista-contenido"></div>
    </div>
  `;

  document.getElementById('btn-imprimir').addEventListener('click', () => window.print());

  container.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.vista === vistaActual);
    b.addEventListener('click', () => {
      vistaActual = b.dataset.vista;
      container.querySelectorAll('.tab-btn').forEach(x => x.classList.toggle('active', x === b));
      pintarVista(document.getElementById('vista-contenido'), contenedor, semanasKeys, tienda, cobertura, personal);
    });
  });

  pintarVista(document.getElementById('vista-contenido'), contenedor, semanasKeys, tienda, cobertura, personal);
}

function pintarVista(el, contenedor, semanasKeys, tienda, cobertura, personal) {
  if (vistaActual === 'cuadrante') return pintarVistaCuadrante(el, contenedor, semanasKeys, tienda, cobertura);
  if (vistaActual === 'periodo') return pintarVistaPeriodo(el, contenedor, semanasKeys, tienda, personal);
  if (vistaActual === 'empleado') return pintarVistaEmpleado(el, contenedor, semanasKeys, personal);
}

/* ---------- Vista "Cuadrante semanal" (rejilla por bloques de 30 min) ---------- */

function pintarVistaCuadrante(el, contenedor, semanasKeys, tienda, cobertura) {
  const semana = contenedor.semanas[semanaSeleccionada];
  const jornada = calcularVentanaJornada(tienda);
  const { anio, semana: numISO } = numeroSemanaISO(semanaSeleccionada);
  const fechaFin = sumarDiasFecha(semanaSeleccionada, 6);
  const idx = semanasKeys.indexOf(semanaSeleccionada);

  el.innerHTML = `
    <div class="card semana-nav no-print">
      <button id="btn-semana-anterior" class="btn btn--secondary" ${idx <= 0 ? 'disabled' : ''}>&#9664; Semana anterior</button>
      <div class="semana-nav__titulo">
        <strong>Semana ${numISO} · ${anio}</strong>
        <span class="muted">${formatoFechaCorta(semanaSeleccionada)} a ${formatoFechaCorta(fechaFin)}</span>
      </div>
      <select id="sel-semana">
        ${semanasKeys.map(k => {
          const w = numeroSemanaISO(k);
          return `<option value="${k}" ${k === semanaSeleccionada ? 'selected' : ''}>${w.anio}-${String(w.semana).padStart(2, '0')}</option>`;
        }).join('')}
      </select>
      <button id="btn-semana-siguiente" class="btn btn--secondary" ${idx >= semanasKeys.length - 1 ? 'disabled' : ''}>Semana siguiente &#9654;</button>
    </div>

    <div id="dias-semana">
      ${DIAS.map((dia, indiceDia) => renderDiaGrid(dia, indiceDia, semana, jornada, cobertura)).join('')}
    </div>
  `;

  const irASemana = (nuevaClave) => {
    semanaSeleccionada = nuevaClave;
    pintarVistaCuadrante(el, contenedor, semanasKeys, tienda, cobertura);
  };

  document.getElementById('btn-semana-anterior').addEventListener('click', () => {
    if (idx > 0) irASemana(semanasKeys[idx - 1]);
  });
  document.getElementById('btn-semana-siguiente').addEventListener('click', () => {
    if (idx < semanasKeys.length - 1) irASemana(semanasKeys[idx + 1]);
  });
  document.getElementById('sel-semana').addEventListener('change', (ev) => irASemana(ev.target.value));
}

/** Pinta la rejilla de un dia: filas de empleados x columnas de bloques de 30 minutos. */
function renderDiaGrid(dia, indiceDia, semana, jornada, cobertura) {
  const turnosDia = semana.dias[dia] || [];
  const fechaDia = sumarDiasFecha(semana.semanaInicio, indiceDia);
  const demanda = construirDemandaDia(dia, cobertura, jornada);

  // Empleados que trabajan ese dia, ordenados por hora de inicio.
  const empleadosDia = [...new Set(turnosDia.map(t => t.empleadoId))]
    .map(id => turnosDia.find(t => t.empleadoId === id))
    .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));

  const bloques = [];
  for (let i = 0; i < jornada.numBloques; i++) bloques.push(jornada.inicio + i * BLOQUE_MIN);

  const cabecera = bloques.map(min => {
    const finBloque = window.UI.minutosAHora(min + BLOQUE_MIN);
    return `<th>${window.UI.minutosAHora(min)}<br>${finBloque}</th>`;
  }).join('');

  const filasEmpleados = empleadosDia.map(ref => {
    const turnosEmpleado = turnosDia.filter(t => t.empleadoId === ref.empleadoId);
    const horasDia = turnosEmpleado.reduce((acc, t) => acc + (window.UI.horaAMinutos(t.horaFin) - window.UI.horaAMinutos(t.horaInicio)) / 60, 0);
    const celdas = bloques.map(min => {
      const enBloque = turnosEmpleado.find(t => window.UI.horaAMinutos(t.horaInicio) <= min && window.UI.horaAMinutos(t.horaFin) > min);
      if (!enBloque) return '<td></td>';
      const claseOp = enBloque.tipo === 'operacion' || enBloque.operacionId ? ' celda-op' : '';
      const titulo = enBloque.operacionNombre ? ` title="${esc(enBloque.operacionNombre)}"` : '';
      return `<td class="celda-turno${claseOp}"${titulo}>1</td>`;
    }).join('');
    return `<tr><td class="col-empleado">${esc(ref.nombre)}</td>${celdas}<td class="col-horas">${horasDia.toFixed(2)}</td></tr>`;
  }).join('');

  const totales = bloques.map((min, i) => {
    const asignado = demanda.asignado[i];
    const minimo = demanda.minimo[i];
    const deseado = demanda.deseado[i];
    let clase = 'total-ok';
    if (asignado < minimo) clase = 'total-bad';
    else if (asignado < deseado) clase = 'total-warn';
    return { asignado, minimo, deseado, clase };
  });

  const horasAsignadasDia = empleadosDia.reduce((acc, ref) => {
    const turnosEmpleado = turnosDia.filter(t => t.empleadoId === ref.empleadoId);
    return acc + turnosEmpleado.reduce((a, t) => a + (window.UI.horaAMinutos(t.horaFin) - window.UI.horaAMinutos(t.horaInicio)) / 60, 0);
  }, 0);
  const maxSimultaneo = totales.length ? Math.max(...totales.map(t => t.asignado)) : 0;
  const minSimultaneo = totales.length ? Math.min(...totales.map(t => t.asignado)) : 0;
  const franjasDeficit = totales.filter(t => t.asignado < t.minimo).length;

  return `
    <div class="card dia-grid-card">
      <div class="dia-grid-card__header">
        <h3>${DIAS_LABEL[dia]}</h3>
        <span class="muted">${formatoFechaCorta(fechaDia)}</span>
      </div>
      <div class="table-wrap">
        <table class="grid-turnos">
          <thead><tr><th class="col-empleado">Empleado/a</th>${cabecera}<th class="col-horas">Horas</th></tr></thead>
          <tbody>
            ${filasEmpleados || `<tr class="empty-row"><td colspan="${bloques.length + 2}">Sin personal asignado este dia.</td></tr>`}
            <tr class="fila-total">
              <td class="col-empleado">TOTAL ASIGNADO</td>
              ${totales.map(t => `<td class="${t.clase}">${t.asignado}</td>`).join('')}
              <td class="col-horas">${horasAsignadasDia.toFixed(2)}</td>
            </tr>
            <tr class="fila-referencia">
              <td class="col-empleado">COBERTURA DESEADA</td>
              ${totales.map(t => `<td>${t.deseado}</td>`).join('')}
              <td>—</td>
            </tr>
            <tr class="fila-referencia">
              <td class="col-empleado">MINIMO CRITICO</td>
              ${totales.map(t => `<td>${t.minimo}</td>`).join('')}
              <td>—</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="grid grid-4" style="margin-top:12px;">
        <div class="stat"><div class="stat__value">${horasAsignadasDia.toFixed(2)}</div><div class="stat__label">Horas asignadas</div></div>
        <div class="stat"><div class="stat__value">${maxSimultaneo}</div><div class="stat__label">Maximo simultaneo</div></div>
        <div class="stat"><div class="stat__value">${minSimultaneo}</div><div class="stat__label">Minimo simultaneo</div></div>
        <div class="stat ${franjasDeficit ? 'stat--bad' : 'stat--ok'}"><div class="stat__value">${franjasDeficit}</div><div class="stat__label">Franjas con deficit</div></div>
      </div>
    </div>
  `;
}

/* ---------- Vista "Resumen del periodo" (agregado real de todas las semanas generadas) ---------- */

function pintarVistaPeriodo(el, contenedor, semanasKeys, tienda, personal) {
  const costeHabilitado = tienda.costeHabilitado !== false;
  const totalesPorEmpleado = {};
  personal.forEach(p => { totalesPorEmpleado[p.id] = { nombre: p.nombre, horas: 0, coste: 0, aperturas: 0, cierres: 0, domingos: 0 }; });

  let horasTotales = 0;
  let costeTotalPeriodo = 0;

  semanasKeys.forEach(k => {
    const semana = contenedor.semanas[k];
    Object.entries(semana.resumenEmpleado).forEach(([id, r]) => {
      if (!totalesPorEmpleado[id]) totalesPorEmpleado[id] = { nombre: r.nombre, horas: 0, coste: 0, aperturas: 0, cierres: 0, domingos: 0 };
      totalesPorEmpleado[id].horas += r.horas;
      totalesPorEmpleado[id].aperturas += r.aperturas;
      totalesPorEmpleado[id].cierres += r.cierres;
      totalesPorEmpleado[id].domingos += r.domingos;
      horasTotales += r.horas;
    });
  });

  personal.forEach(p => {
    const t = totalesPorEmpleado[p.id];
    if (!t) return;
    t.coste = t.horas * costeHoraEmpleado(p);
    costeTotalPeriodo += t.coste;
  });

  const filas = Object.values(totalesPorEmpleado).map(t => `
    <tr>
      <td>${esc(t.nombre)}</td>
      <td>${window.UI.formatoHoras(t.horas)}</td>
      ${costeHabilitado ? `<td>${t.coste.toFixed(2)} €</td>` : ''}
      <td>${t.aperturas}</td>
      <td>${t.cierres}</td>
      <td>${t.domingos}</td>
    </tr>
  `).join('');

  el.innerHTML = `
    <div class="card">
      <h3>Totales del periodo generado (${semanasKeys.length} semana${semanasKeys.length === 1 ? '' : 's'})</h3>
      <div class="grid ${costeHabilitado ? 'grid-2' : 'grid-1'}" style="margin-bottom:16px;">
        <div class="stat"><div class="stat__value">${window.UI.formatoHoras(horasTotales)}</div><div class="stat__label">Horas totales del periodo</div></div>
        ${costeHabilitado ? `<div class="stat"><div class="stat__value">${costeTotalPeriodo.toFixed(0)} €</div><div class="stat__label">Coste total estimado</div></div>` : ''}
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Empleado</th><th>Horas totales</th>
              ${costeHabilitado ? '<th>Coste estimado</th>' : ''}
              <th>Aperturas</th><th>Cierres</th><th>Domingos</th>
            </tr>
          </thead>
          <tbody>${filas || `<tr class="empty-row"><td colspan="${costeHabilitado ? 6 : 5}">Sin datos</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `;
}

/* ---------- Vista "Por empleado" (detalle semana a semana) ---------- */

function pintarVistaEmpleado(el, contenedor, semanasKeys, personal) {
  el.innerHTML = `
    <div class="card">
      <div class="form-grid">
        <div class="field">
          <label for="sel-empleado">Empleado</label>
          <select id="sel-empleado">
            ${personal.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="sel-semana-emp">Semana</label>
          <select id="sel-semana-emp">
            ${semanasKeys.map(k => {
              const w = numeroSemanaISO(k);
              return `<option value="${k}" ${k === semanaSeleccionada ? 'selected' : ''}>${w.anio}-${String(w.semana).padStart(2, '0')} (${formatoFechaCorta(k)})</option>`;
            }).join('')}
          </select>
        </div>
      </div>
      <div id="detalle-empleado" style="margin-top:14px;"></div>
    </div>
  `;

  const selEmp = document.getElementById('sel-empleado');
  const selSemana = document.getElementById('sel-semana-emp');

  const pintarDetalle = () => {
    const id = selEmp.value;
    const claveSemana = selSemana.value;
    const semana = contenedor.semanas[claveSemana];
    const emp = personal.find(p => p.id === id);
    const resumen = (semana.resumenEmpleado || {})[id] || {};
    const filas = DIAS.map(d => {
      const turnos = (semana.dias[d] || []).filter(t => t.empleadoId === id);
      const texto = turnos.length ? turnos.map(t => `${t.horaInicio}-${t.horaFin}${t.operacionNombre ? ' (' + esc(t.operacionNombre) + ')' : ''}`).join(', ') : '<span class="muted">Libre</span>';
      return `<tr><td>${DIAS_LABEL[d]}</td><td>${texto}</td></tr>`;
    }).join('');

    document.getElementById('detalle-empleado').innerHTML = `
      <div class="grid grid-4" style="margin-bottom:14px;">
        <div class="stat"><div class="stat__value">${window.UI.formatoHoras(resumen.horas || 0)}</div><div class="stat__label">Horas esta semana</div></div>
        <div class="stat"><div class="stat__value">${emp ? emp.horasSemanales : 0} h</div><div class="stat__label">Contrato semanal</div></div>
        <div class="stat"><div class="stat__value">${resumen.aperturas || 0}</div><div class="stat__label">Aperturas</div></div>
        <div class="stat"><div class="stat__value">${resumen.cierres || 0}</div><div class="stat__label">Cierres</div></div>
      </div>
      <div class="table-wrap">
        <table><thead><tr><th>Dia</th><th>Turno</th></tr></thead><tbody>${filas}</tbody></table>
      </div>
    `;
  };

  selEmp.addEventListener('change', pintarDetalle);
  selSemana.addEventListener('change', pintarDetalle);
  if (personal.length) pintarDetalle();
}

function esc(v) { return window.UI.escapeHtml(v); }
