/**
 * storage.js
 * -----------------------------------------------------------------------
 * Capa unica de acceso a datos de la aplicacion.
 * Toda lectura/escritura de datos persistentes pasa por este modulo.
 * Motor de almacenamiento: LocalStorage del navegador.
 *
 * Ningun otro modulo debe llamar a localStorage directamente.
 * Esto permite cambiar el motor de persistencia en el futuro (por
 * ejemplo IndexedDB) tocando un unico archivo.
 * -----------------------------------------------------------------------
 */

const PREFIX = 'product_app_';

/** Claves de las colecciones que gestiona la aplicacion. */
export const KEYS = {
  TIENDA: 'tienda',
  PERSONAL: 'personal',
  COBERTURA: 'cobertura',
  OPERACIONES: 'operaciones',
  REGLAS: 'reglas',
  CUADRANTE: 'cuadrante',
  VALIDACION: 'validacion',
  META: 'meta'
};

/**
 * Lee una coleccion completa desde LocalStorage.
 * @param {string} key clave logica (usar KEYS.*)
 * @param {*} fallback valor por defecto si no existe
 */
export function leer(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`storage: error leyendo "${key}"`, err);
    return fallback;
  }
}

/**
 * Escribe una coleccion completa en LocalStorage.
 * @param {string} key clave logica (usar KEYS.*)
 * @param {*} valor dato serializable
 */
export function guardar(key, valor) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(valor));
    return true;
  } catch (err) {
    console.error(`storage: error guardando "${key}"`, err);
    return false;
  }
}

/** Elimina una coleccion. */
export function eliminar(key) {
  localStorage.removeItem(PREFIX + key);
}

/** Genera un identificador unico simple (suficiente para uso local). */
export function generarId() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/**
 * Comprueba si la aplicacion ya tiene datos inicializados.
 */
export function estaInicializada() {
  return leer(KEYS.META) !== null;
}

/**
 * Carga los datos de demostracion (data/demo.json) en LocalStorage.
 * Solo se ejecuta la primera vez que se abre la aplicacion.
 */
export async function inicializarConDemo() {
  try {
    const resp = await fetch('data/demo.json');
    const demo = await resp.json();
    guardar(KEYS.TIENDA, demo.tienda);
    guardar(KEYS.PERSONAL, demo.personal);
    guardar(KEYS.COBERTURA, demo.cobertura);
    guardar(KEYS.OPERACIONES, demo.operaciones);
    guardar(KEYS.REGLAS, demo.reglas);
    guardar(KEYS.CUADRANTE, null);
    guardar(KEYS.VALIDACION, null);
    guardar(KEYS.META, { version: 1, creado: new Date().toISOString() });
    return true;
  } catch (err) {
    console.error('storage: no se pudo cargar demo.json', err);
    // Si falla la carga de demo, se inicializa vacio para que la app funcione igual.
    inicializarVacia();
    return false;
  }
}

/** Inicializa todas las colecciones vacias (sin datos de demo). */
export function inicializarVacia() {
  guardar(KEYS.TIENDA, estructuraTiendaVacia());
  guardar(KEYS.PERSONAL, []);
  guardar(KEYS.COBERTURA, []);
  guardar(KEYS.OPERACIONES, []);
  guardar(KEYS.REGLAS, reglasPorDefecto());
  guardar(KEYS.CUADRANTE, null);
  guardar(KEYS.VALIDACION, null);
  guardar(KEYS.META, { version: 1, creado: new Date().toISOString() });
}

/** Estructura vacia por defecto de la configuracion de tienda. */
export function estructuraTiendaVacia() {
  return {
    nombre: '',
    convenio: '',
    horario: { apertura: '09:00', cierre: '21:00' },
    tiempoAntes: 15,
    tiempoDespues: 15,
    rotacion: 'semanal',
    maxHorasDia: 9,
    duracionTurnoMin: 4,
    duracionTurnoMax: 6,
    maxTurnos: 2,
    maxDiasConsecutivos: 6,
    descansoMinimo: 12,
    costeHabilitado: true
  };
}

/** Listado de reglas del motor con su prioridad, activadas por defecto. */
export function reglasPorDefecto() {
  return [
    { id: 'convenio', nombre: 'Cumplir convenio', prioridad: 1, activa: true, peso: 1000 },
    { id: 'minimos', nombre: 'Cubrir minimos criticos', prioridad: 2, activa: true, peso: 500 },
    { id: 'operaciones', nombre: 'Cubrir operaciones', prioridad: 3, activa: true, peso: 250 },
    { id: 'aperturas', nombre: 'Equilibrar aperturas', prioridad: 4, activa: true, peso: 60 },
    { id: 'cierres', nombre: 'Equilibrar cierres', prioridad: 5, activa: true, peso: 55 },
    { id: 'domingos', nombre: 'Equilibrar domingos', prioridad: 6, activa: true, peso: 50 },
    { id: 'horasSobrantes', nombre: 'Reducir horas sobrantes', prioridad: 7, activa: true, peso: 30 },
    { id: 'coste', nombre: 'Reducir coste', prioridad: 8, activa: true, peso: 20 },
    { id: 'productividad', nombre: 'Mejorar productividad', prioridad: 9, activa: true, peso: 10 }
  ];
}

/** Dias de la semana usados en toda la aplicacion (formato interno). */
export const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
export const DIAS_LABEL = {
  lunes: 'Lunes', martes: 'Martes', miercoles: 'Miercoles', jueves: 'Jueves',
  viernes: 'Viernes', sabado: 'Sabado', domingo: 'Domingo'
};

/* ---------------------------------------------------------------------
 * Utilidades de fecha compartidas. Se centralizan aqui porque tanto el
 * motor (generacion multi-semana) como validacion/informes/dashboard
 * (navegacion entre semanas generadas) las necesitan por igual.
 * ------------------------------------------------------------------- */

/** Suma (o resta) dias a una fecha ISO (yyyy-mm-dd) y devuelve otra fecha ISO. */
export function sumarDiasFecha(fechaIso, dias) {
  if (!fechaIso) return '';
  const d = new Date(fechaIso + 'T00:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Ajusta cualquier fecha ISO al lunes de esa misma semana. */
export function lunesDeSemana(fechaIso) {
  if (!fechaIso) return fechaIso;
  const d = new Date(fechaIso + 'T00:00:00');
  const diaSemana = d.getDay(); // 0 domingo .. 6 sabado
  const offset = diaSemana === 0 ? -6 : (1 - diaSemana);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** Calcula el numero de semana ISO-8601 y el anio correspondientes a una fecha. */
export function numeroSemanaISO(fechaIso) {
  const d = new Date(fechaIso + 'T00:00:00');
  const objetivo = new Date(d.valueOf());
  const diaSemanaISO = (d.getDay() + 6) % 7; // lunes = 0 .. domingo = 6
  objetivo.setDate(objetivo.getDate() - diaSemanaISO + 3); // jueves de esa semana
  const primerJueves = new Date(objetivo.getFullYear(), 0, 4);
  const diffSemanas = Math.round((objetivo - primerJueves) / (7 * 24 * 60 * 60 * 1000));
  return { anio: objetivo.getFullYear(), semana: diffSemanas + 1 };
}

/** Formatea una fecha ISO como dd/mm/yyyy para mostrar en pantalla. */
export function formatoFechaCorta(fechaIso) {
  if (!fechaIso) return '';
  const [a, m, d] = fechaIso.split('-');
  return `${d}/${m}/${a}`;
}
