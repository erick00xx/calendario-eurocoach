const SPREADSHEET_ID = '1CURP5Equ3EaH6NcWDNOo_CX190qaoPSfW0ZTxrLy83o';

const USER_SHEET_NAME = 'Usuarios';
const SESSION_TTL_SECONDS = 21600; // 6 horas

function generateSessionToken(username) {
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(token, username, SESSION_TTL_SECONDS);
  return token;
}

function validateSessionToken(token) {
  if (!token) return false;
  return CacheService.getScriptCache().get(token) !== null;
}

function requireValidToken(token) {
  if (!validateSessionToken(token)) {
    throw new Error('No autorizado: sesión inválida o expirada.');
  }
}

function loginAPI(username, password) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(USER_SHEET_NAME);
  if (!sheet) {
    return { success: false, message: 'No existe la hoja Usuarios.' };
  }

  const data = sheet.getDataRange().getDisplayValues();
  for (let i = 1; i < data.length; i++) {
    const user = (data[i][0] || '').toString().trim();
    const pass = (data[i][1] || '').toString();

    if (
      user.toLowerCase() === (username || '').toString().trim().toLowerCase() &&
      pass === (password || '').toString()
    ) {
      const token = generateSessionToken(user);
      return { success: true, message: 'Login exitoso', user: user, token: token };
    }
  }

  return { success: false, message: 'Usuario o contraseña incorrectos.' };
}

function doGet(e) {
  const action = e.parameter.action;
  const tenant = e.parameter.tenant || '';
  const token = e.parameter.token || '';
  
  if (action === 'cancel') {
    const id = e.parameter.id;
    return cancelReservation(id);
  }
  
  // Set CORS headers for GET requests if deployed as Web App
  let result = {};
  try {
    if (action === 'getInitialData') {
      result = {
        programs: getPrograms(),
        slots: obtenerDisponibilidad(tenant),
        profiles: getLatestProfiles(),
        monthlyQuota: obtenerCupoMensualActual(tenant)
      };
    } else if (action === 'validateToken') {
      result = { success: validateSessionToken(token) };
    } else if (action === 'getPrograms') {
      result = getPrograms();
    } else if (action === 'searchUser') {
       const email = e.parameter.email;
       const cleanEmail = email ? email.trim() : '';
       result = searchUserProfile(cleanEmail);
    } else if (action === 'getSlots') {
       result = obtenerDisponibilidad(tenant);
    } else if (action === 'getAllReservations') {
       requireValidToken(token);
       result = getAllReservations();
    }
  } catch(error) {
    result = { error: error.toString() };
  }
  
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let result = {};
  try {
    const rawBody = (e.postData && e.postData.contents) ? e.postData.contents : '';
    let data = {};

    try {
      data = rawBody ? JSON.parse(rawBody) : {};
    } catch (_) {
      data = {};
    }

    const action = e.parameter.action || data.action;

    // Login público
    if (action === 'login') {
      const username = e.parameter.username || data.username || '';
      const password = e.parameter.password || data.password || '';
      result = loginAPI(username, password);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const token = e.parameter.token || data.token || '';
    
    if (action === 'updateReservation') {
      requireValidToken(token);
      result = updateReservationData(data);
    } else if (action === 'updateStudent') {
      requireValidToken(token);
      result = updateStudentData(data);
    } else if (action === 'reschedule') {
      requireValidToken(token);
      result = rescheduleReservation(data);
    } else if (action === 'sendReminder') {
      requireValidToken(token);
      result = sendReminderAction(data);
    } else if (action === 'uploadImage') {
      requireValidToken(token);
      result = uploadImageDrive(data);
    } else if (action === 'deleteRecord') {
      requireValidToken(token);
      result = deleteRecord(data);
    } else {
      // Reserva pública
      result = registrarReserva(data);
    }
  } catch (error) {
    result = { success: false, error: error.toString() };
  }
  
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ----------------------------------------------------
// Lógica para obtener Programas de la hoja "Programas"
// ----------------------------------------------------
function getPrograms() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Programas');
  const data = sheet.getDataRange().getValues();
  // A: Instituto/Universidad, B: Categoria, C: Programas separados por |
  let programsData = [];
  
  for (let i = 1; i < data.length; i++) {
    const inst = data[i][0];
    const cat = data[i][1];
    const progs = data[i][2];
    
    if (inst && progs) {
      programsData.push({
        instituto: inst.trim(),
        categoria: cat ? cat.trim() : '',
        programas: progs.split('|').map(p => p.trim()).filter(p => p)
      });
    }
  }
  return programsData;
}

// ----------------------------------------------------
// Buscar el último perfil del usuario por su correo
// ----------------------------------------------------
function searchUserProfile(email) {
  if (!email) return { found: false };
  
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Data');
  const data = sheet.getDataRange().getValues();
  
  // Buscar desde el final hacia arriba
  for (let i = data.length - 1; i > 0; i--) {
    const rowEmail = data[i][3]; // Col D = indice 3
    if (rowEmail && rowEmail.toString().trim().toLowerCase() === email.toLowerCase()) {
      return {
        found: true,
        nombre: data[i][2], // Col C
        telefono: data[i][4], // Col E
        edad: data[i][5], // Col F
        dedicacion: data[i][6], // Col G
        programa: data[i][8] // Col I
      };
    }
  }
  return { found: false };
}

// ----------------------------------------------------
// Obtener todos los perfiles únicos (el más reciente de cada uno)
// ----------------------------------------------------
function getLatestProfiles() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Data');
  const lastRow = sheet.getLastRow();
  const profilesMap = {};
  
  if (lastRow <= 1) return [];
  
  // Get data without header
  const data = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
  
  // Buscar desde el final hacia arriba
  for (let i = data.length - 1; i >= 0; i--) {
    const rowEmail = data[i][3] ? data[i][3].toString().trim().toLowerCase() : '';
    if (rowEmail && !profilesMap[rowEmail]) {
      // Limpiar telefono quitando el apostrofe si lo tiene
      let phone = data[i][4] ? data[i][4].toString() : '';
      if(phone.startsWith("'")) phone = phone.substring(1);

      profilesMap[rowEmail] = {
        correo: rowEmail,
        nombre: data[i][2],
        telefono: phone,
        edad: data[i][5],
        dedicacion: data[i][6],
        instituto: data[i][7],
        programa: data[i][8]
      };
    }
  }
  return Object.values(profilesMap);
}

// ----------------------------------------------------
// No Disponible + Disponibilidad
// Se usa la TZ del script para comparar fechas locales y evitar el desfase de -1 día.
// ----------------------------------------------------
function normalizarTextoNoDisponible(valor) {
  if (valor === null || valor === undefined) return '';
  return valor.toString().trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[_\-\/]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function obtenerClaveFecha(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function normalizarAmbitoNoDisponible(valor) {
  const texto = normalizarTextoNoDisponible(valor);
  if (!texto || texto === 'global' || texto === 'todos' || texto === 'todo' || texto === 'all') return 'global';
  if (texto === 'instituto empresa' || texto === 'institutoempresa' || texto === 'empresa' || texto === 'instituto de la empresa') return 'instituto_empresa';
  if (texto === 'blackwell' || texto === 'blackwell global' || texto === 'blackwell global university') return 'blackwell';
  if (texto === 'neumann' || texto === 'jhonn vonn neumann' || texto === 'jhonn von neumann' || texto === 'jhon vonn neumann') return 'neumann';
  if (texto === 'ua chile' || texto === 'uachile' || texto === 'universidad autonoma' || texto === 'universidad autonoma de chile') return 'ua_chile';
  return 'global';
}

function obtenerAmbitoDesdeTenant(tenant) {
  return normalizarAmbitoNoDisponible(tenant);
}

function convertirHoraAMinutos(valor) {
  if (valor === null || valor === undefined || valor === '') return null;

  const texto = valor instanceof Date && !isNaN(valor.getTime())
    ? Utilities.formatDate(valor, Session.getScriptTimeZone(), 'HH:mm')
    : valor.toString().trim();

  if (!texto) return null;

  if (/^\d+(?:[.,]\d+)?$/.test(texto)) {
    const numero = parseFloat(texto.replace(',', '.'));
    if (numero >= 0 && numero <= 24) return Math.round(numero * 60);
    if (numero <= 1440) return Math.round(numero);
    return null;
  }

  const textoLower = texto.toLowerCase().replace(/\s+/g, '');

  // Soporta: 8, 8:30, 8:00:00, 8am, 8:30pm, 8:00 PM
  const regexMatch = textoLower.match(/^(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?([ap]m)?$/i);
  if (!regexMatch) return null;

  let horas = parseInt(regexMatch[1], 10);
  const minutos = parseInt(regexMatch[2] || '0', 10);
  const sufijo = (regexMatch[4] || '').toLowerCase();

  if (horas < 0 || horas > 23 || minutos < 0 || minutos > 59) return null;

  if (sufijo === 'pm' && horas < 12) horas += 12;
  if (sufijo === 'am' && horas === 12) horas = 0;
  
  return horas * 60 + minutos;
}

function obtenerReglasNoDisponible() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('NoDisponible');
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  // Leer como se ve en Sheets para evitar desfases de fecha/hora por TZ/serial interno
  const data = sheet.getRange(2, 1, lastRow - 1, 4).getDisplayValues();
  const reglas = [];

  data.forEach(row => {
    const fechaKey = normalizarFechaNoDisponibleTexto(row[0]);
    if (!fechaKey) return;

    const ambito = normalizarAmbitoNoDisponible(row[3]);
    const inicioOriginal = convertirHoraAMinutos(row[1]);
    const finOriginal = convertirHoraAMinutos(row[2]);

    const esDiaCompleto = inicioOriginal === null && finOriginal === null;
    let inicioMin = inicioOriginal;
    let finMin = finOriginal;

    if (!esDiaCompleto) {
      if (inicioMin !== null && finMin === null) {
        finMin = inicioMin + 60;
      } else if (inicioMin === null && finMin !== null) {
        inicioMin = 0;
      } else if (inicioMin !== null && finMin !== null && finMin <= inicioMin) {
        finMin = inicioMin + 60;
      }
    }

    reglas.push({
      fechaKey,
      ambito,
      esDiaCompleto,
      inicioMin,
      finMin
    });
  });

  return reglas;
}

function normalizarFechaNoDisponibleTexto(valor) {
  if (valor === null || valor === undefined) return '';

  const texto = valor.toString().trim();
  if (!texto) return '';

  // Acepta lo que se ve en la hoja: 14/04/2026, 2026-04-14 o 14-04-2026
  let anio;
  let mes;
  let dia;

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(texto)) {
    [dia, mes, anio] = texto.split('/');
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    [anio, mes, dia] = texto.split('-');
  } else if (/^\d{2}-\d{2}-\d{4}$/.test(texto)) {
    [dia, mes, anio] = texto.split('-');
  } else if (/^\d{4}\/\d{2}\/\d{2}$/.test(texto)) {
    [anio, mes, dia] = texto.split('/');
  } else {
    return '';
  }

  const anioInt = parseInt(anio, 10);
  const mesInt = parseInt(mes, 10);
  const diaInt = parseInt(dia, 10);
  if (isNaN(anioInt) || isNaN(mesInt) || isNaN(diaInt)) return '';

  return `${anioInt.toString().padStart(4, '0')}-${mesInt.toString().padStart(2, '0')}-${diaInt.toString().padStart(2, '0')}`;
}

function obtenerAnioMesDesdeFechaTexto(valor) {
  if (valor === null || valor === undefined) return null;
  const texto = valor.toString().trim();
  if (!texto) return null;

  let anio;
  let mes;
  let dia;

  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    [anio, mes, dia] = texto.split('-');
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(texto)) {
    [dia, mes, anio] = texto.split('/');
  } else if (/^\d{2}-\d{2}-\d{4}$/.test(texto)) {
    [dia, mes, anio] = texto.split('-');
  } else if (/^\d{4}\/\d{2}\/\d{2}$/.test(texto)) {
    [anio, mes, dia] = texto.split('/');
  } else {
    return null;
  }

  const anioInt = parseInt(anio, 10);
  const mesInt = parseInt(mes, 10);
  if (isNaN(anioInt) || isNaN(mesInt)) return null;

  return {
    anio: anioInt,
    mes: mesInt,
    claveMes: `${anioInt.toString().padStart(4, '0')}-${mesInt.toString().padStart(2, '0')}`
  };
}

function estadoCuentaParaCupo(estado) {
  const estadoNormalizado = normalizarTextoNoDisponible(estado);
  return estadoNormalizado === 'programada' || estadoNormalizado === 'realizada';
}

function obtenerMaximosReservasPorAmbito() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('MaxReservas');
  const mapa = {};
  if (!sheet || sheet.getLastRow() < 2) return mapa;

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues();
  data.forEach(row => {
    const ambito = normalizarAmbitoNoDisponible(row[0]);
    const maximo = parseInt((row[1] || '').toString().trim(), 10);
    if (!isNaN(maximo) && maximo >= 0) {
      mapa[ambito] = maximo;
    }
  });

  return mapa;
}

function contarReservasPorAmbitoYMes() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Data');
  const conteos = {};
  if (!sheet || sheet.getLastRow() < 2) return conteos;

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 14).getDisplayValues();
  data.forEach(row => {
    const fechaInfo = obtenerAnioMesDesdeFechaTexto(row[9]); // Col J
    if (!fechaInfo) return;

    const estado = row[13]; // Col N
    if (!estadoCuentaParaCupo(estado)) return;

    const ambito = normalizarAmbitoNoDisponible(row[7]); // Col H
    const key = `${ambito}|${fechaInfo.claveMes}`;
    conteos[key] = (conteos[key] || 0) + 1;
  });

  return conteos;
}

function obtenerBloqueosActivosPorFechaHora(excluirId = '') {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Data');
  const bloqueos = {};
  if (!sheet || sheet.getLastRow() < 2) return bloqueos;

  // Se usan los valores visibles de la hoja para evitar desfases de fecha/hora.
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 14).getDisplayValues();

  data.forEach(row => {
    const rowId = row[0] ? row[0].toString().trim() : '';
    if (excluirId && rowId === excluirId.toString().trim()) return;

    if (!estadoCuentaParaCupo(row[13])) return;

    const fechaKey = normalizarFechaNoDisponibleTexto(row[9]);
    const horaMin = convertirHoraAMinutos(row[10]);
    if (!fechaKey || horaMin === null) return;

    const hora = Math.floor(horaMin / 60);
    if (!bloqueos[fechaKey]) bloqueos[fechaKey] = [];
    bloqueos[fechaKey].push(hora);
  });

  return bloqueos;
}

function obtenerCupoMensualPorAmbito(ambito, anio, mes, cacheMaximos, cacheConteos) {
  const ambitoNormalizado = normalizarAmbitoNoDisponible(ambito);
  const claveMes = `${anio.toString().padStart(4, '0')}-${mes.toString().padStart(2, '0')}`;

  const maximos = cacheMaximos || obtenerMaximosReservasPorAmbito();
  const conteos = cacheConteos || contarReservasPorAmbitoYMes();

  const maximo = Object.prototype.hasOwnProperty.call(maximos, ambitoNormalizado) ? maximos[ambitoNormalizado] : 0;
  const usadas = conteos[`${ambitoNormalizado}|${claveMes}`] || 0;
  const restantes = Math.max(0, maximo - usadas);

  return {
    ambito: ambitoNormalizado,
    anio,
    mes,
    claveMes,
    maximo,
    usadas,
    restantes
  };
}

function obtenerCupoMensualActual(tenant) {
  const now = new Date();
  const tz = Session.getScriptTimeZone();
  const anio = parseInt(Utilities.formatDate(now, tz, 'yyyy'), 10);
  const mes = parseInt(Utilities.formatDate(now, tz, 'MM'), 10);
  const ambito = obtenerAmbitoDesdeTenant(tenant);

  return obtenerCupoMensualPorAmbito(ambito, anio, mes);
}

function slotBloqueadoPorNoDisponible(inicioSlot, finSlot, tenant, reglas) {
  if (!(inicioSlot instanceof Date) || !(finSlot instanceof Date)) return false;

  const reglasNoDisponible = Array.isArray(reglas) ? reglas : obtenerReglasNoDisponible();
  const fechaKeySlot = obtenerClaveFecha(inicioSlot);
  if (!fechaKeySlot) return false;

  const ambitoTenant = obtenerAmbitoDesdeTenant(tenant);
  const inicioSlotMin = inicioSlot.getHours() * 60 + inicioSlot.getMinutes();
  const finSlotMin = finSlot.getHours() * 60 + finSlot.getMinutes();

  return reglasNoDisponible.some(regla => {
    if (regla.fechaKey !== fechaKeySlot) return false;
    if (regla.ambito !== 'global' && regla.ambito !== ambitoTenant) return false;
    if (regla.esDiaCompleto) return true;
    if (regla.inicioMin === null || regla.finMin === null) return true;
    return inicioSlotMin < regla.finMin && finSlotMin > regla.inicioMin;
  });
}

function obtenerDisponibilidad(tenant = '') {
  const now = new Date();
  const endDate = new Date(now);
  endDate.setDate(now.getDate() + 15);

  const reglasNoDisponible = obtenerReglasNoDisponible();
  const tenantAmbito = obtenerAmbitoDesdeTenant(tenant);
  const maximosCache = obtenerMaximosReservasPorAmbito();
  const conteosCache = contarReservasPorAmbitoYMes();
  const bookedSlots = obtenerBloqueosActivosPorFechaHora();

  const availableDates = {};

  for (let i = 0; i < 15; i++) {
    const checkDate = new Date(now);
    checkDate.setDate(now.getDate() + i);

    const dayOfWeek = checkDate.getDay();
    if (dayOfWeek !== 0) {
      const dateKey = obtenerClaveFecha(checkDate);
      availableDates[dateKey] = [];

      const cupoMes = obtenerCupoMensualPorAmbito(tenantAmbito, checkDate.getFullYear(), checkDate.getMonth() + 1, maximosCache, conteosCache);
      if (cupoMes.restantes <= 0) {
        continue;
      }

      const currentBooked = bookedSlots[dateKey] || [];

      for (let hour = 8; hour <= 18; hour++) {
        if (i === 0 && checkDate.getHours() >= hour) continue;

        const slotStart = new Date(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate(), hour, 0, 0);
        const slotEnd = new Date(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate(), hour + 1, 0, 0);

        if (currentBooked.includes(hour)) continue;
        if (slotBloqueadoPorNoDisponible(slotStart, slotEnd, tenantAmbito, reglasNoDisponible)) continue;

        const ampm = hour >= 12 ? 'PM' : 'AM';
        const h = hour % 12 || 12;
        availableDates[dateKey].push({ hour: hour, label: `${h}:00 ${ampm}` });
      }
    }
  }

  return availableDates;
}

function getAvailability(tenant = '') {
  return obtenerDisponibilidad(tenant);
}

function generateId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// ----------------------------------------------------
// Crear Reserva
// ----------------------------------------------------
function createReservation(data) {
  return registrarReserva(data);
}

function registrarReserva(data) {
  // Limpiar espacios
  const correo = data.correo ? data.correo.trim() : '';
  const nombres = data.nombre ? data.nombre.trim() : '';
  const telefono = data.telefono ? data.telefono.trim() : '';
  const edad = data.edad ? data.edad.toString().trim() : '';
  const dedicacion = data.dedicacion ? data.dedicacion.trim() : '';
  const instUniv = data.instituto ? data.instituto.trim() : '';
  const programa = data.programa ? data.programa.trim() : '';
  const motivo = data.motivo ? data.motivo.trim() : '';
  
  const dateStr = data.fecha; // YYYY-MM-DD
  const hour = parseInt(data.hora, 10); // int 8 to 18
  
  const [year, month, day] = dateStr.split('-');
  const startTime = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), hour, 0, 0);
  const endTime = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), hour + 1, 0, 0);
  const reglasNoDisponible = obtenerReglasNoDisponible();
  const tenantAmbito = obtenerAmbitoDesdeTenant(instUniv);
  const cupoMes = obtenerCupoMensualPorAmbito(tenantAmbito, parseInt(year, 10), parseInt(month, 10));
  const bookedSlots = obtenerBloqueosActivosPorFechaHora();
  const dateKey = `${parseInt(year, 10).toString().padStart(4, '0')}-${parseInt(month, 10).toString().padStart(2, '0')}-${parseInt(day, 10).toString().padStart(2, '0')}`;

  if (cupoMes.restantes <= 0) {
    return { success: false, error: `No hay cupos disponibles para ${cupoMes.claveMes}.` };
  }

  if ((bookedSlots[dateKey] || []).includes(hour)) {
    return { success: false, error: 'Ese horario ya tiene una reserva programada.' };
  }

  if (slotBloqueadoPorNoDisponible(startTime, endTime, tenantAmbito, reglasNoDisponible)) {
    return { success: false, error: 'El horario seleccionado no está disponible por una restricción en NoDisponible.' };
  }
  
  const resId = generateId();
  
  // 1. Crear evento en Google Calendar y linkear ID Interno
  const cal = CalendarApp.getDefaultCalendar();
  cal.createEvent(`Reserva EUROCOACH - ${nombres}`, startTime, endTime, {
    description: `Reserva para: ${nombres}\nCorreo: ${correo}\nTeléfono: ${telefono}\nInstituto: ${instUniv}\nPrograma: ${programa}\nMotivo: ${motivo}\n\n[ID Reserva: ${resId}]`
  });
  
  // 2. Guardar en Sheets
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Data');
  const now = new Date();
  
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hDisplay = (hour % 12 || 12) + ':00 ' + ampm;
  
  // Encontrar N° de Sesion buscando registros previos del correo
  let sessionNumber = 1;
  const existingData = sheet.getDataRange().getValues();
  for (let i = existingData.length - 1; i >= 1; i--) {
     if (existingData[i][3] && existingData[i][3].toString().trim().toLowerCase() === correo.toLowerCase()) {
         let rawNum = existingData[i][12] ? existingData[i][12].toString() : '0';
         let matchNum = rawNum.match(/\d+/);
         let lastNum = matchNum ? parseInt(matchNum[0]) : 0;
         sessionNumber = lastNum + 1;
         break;
     }
  }
  
  const sesionFormatted = "Sesión " + sessionNumber;
  
  // ID, Creado, Nombres, Correo, Teléfono, Edad, Dedicacion, Instituto, Programa, Fecha, Hora, Motivo, N° Sesión, Estado + resto en blanco
  sheet.appendRow([
    resId,                                                      // A (0)
    now.toLocaleString('es-ES', { timeZone: 'America/Lima' }),  // B (1)
    nombres,                                                    // C (2)
    correo,                                                     // D (3)
    "'" + telefono,                                             // E (4)
    edad,                                                       // F (5)
    dedicacion,                                                 // G (6)
    instUniv,                                                   // H (7)
    programa,                                                   // I (8)
    dateStr,                                                    // J (9)
    hDisplay,                                                   // K (10)
    motivo,                                                     // L (11)
    sesionFormatted,                                            // M (12)
    "Programada",                                               // N (13)
    "", "", "", "", "", "", "", ""                              // O to V (14-21)
  ]);
  
  // 3. Enviar correo de confirmación
  sendConfirmationEmail(correo, nombres, dateStr, hDisplay, instUniv, resId);
  
  return { success: true, message: 'Reserva confirmada con éxito.' };
}

// ----------------------------------------------------
// Envío de correo
// ----------------------------------------------------
function sendConfirmationEmail(correo, nombres, fecha, hora, instituto, resId, isReschedule = false, oldFecha = null, oldHora = null) {
  // Ajuste de color según institución pseudo
  let color = '#311b54'; // Eurocoach brand purple default
  if(instituto.toLowerCase().includes('empresa')) color = '#F28C28'; 
  else if(instituto.toLowerCase().includes('blackwell')) color = '#003c8f'; 
  else if(instituto.toLowerCase().includes('neumann')) color = '#7b2282'; 
  else if(instituto.toLowerCase().includes('autónoma')) color = '#e3000f'; 
  
  const scriptUrl = ScriptApp.getService().getUrl();
  const cancelLink = `${scriptUrl}?action=cancel&id=${resId}`;
  
  let headerTitle = isReschedule ? "Sesión Reprogramada: EUROCOACH" : "Reserva Confirmada: EUROCOACH";
  let bodyTitle = isReschedule ? `Tu sesión de coaching con <strong>${instituto}</strong> ha sido reprogramada.` : `Tu sesión de coaching con <strong>${instituto}</strong> ha sido reservada correctamente.`;
  
  let oldInfoHtml = '';
  if (isReschedule) {
      oldInfoHtml = `<p style="color:#e74c3c; font-size:0.9rem; margin-top:0;"><i>Anteriormente programada para: ${oldFecha} a las ${oldHora}</i></p>`;
  }
  
  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
      <div style="background-color: ${color}; color: white; padding: 20px; text-align: center;">
        <h2>${headerTitle}</h2>
      </div>
      <div style="padding: 20px; color: #333;">
        <p>Hola <strong>${nombres}</strong>,</p>
        <p>${bodyTitle}</p>
        ${oldInfoHtml}
        <br>
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; border-left: 5px solid #06c0cf;">
           <p style="margin: 0; font-size:1.1rem;">📅 <strong>Nueva Fecha:</strong> ${fecha}</p>
           <p style="margin: 5px 0 0 0; font-size:1.1rem;">⏰ <strong>Hora:</strong> ${hora}</p>
        </div>
        <br>
        <p>Si deseas cancelar tu cita, por favor haz click en el siguiente botón:</p>
        <div style="text-align: center; margin: 20px 0;">
           <a href="${cancelLink}" style="background-color: #e74c3c; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Cancelar Cita</a>
        </div>
        <p style="font-size: 12px; color: #888;">Si no solicitaste esta cita o crees que es un error, por favor ignora este correo.</p>
      </div>
    </div>
  `;
  
  MailApp.sendEmail({
    to: correo,
    cc: Session.getActiveUser().getEmail(),
    subject: isReschedule ? `Recalendarización EUROCOACH - ${fecha} ${hora}` : `Confirmación de Reserva EUROCOACH - ${fecha} ${hora}`,
    htmlBody: htmlBody
  });
}

function freeCalendarSlot(dateStrObj, hourStr, nombres, resId) {
  if (!dateStrObj || !hourStr || !nombres) return;
  try {
    const cal = CalendarApp.getDefaultCalendar();
    
    let dateStr = '';
    if (dateStrObj instanceof Date) {
      dateStr = Utilities.formatDate(dateStrObj, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } else {
      dateStr = dateStrObj.toString();
    }
    
    let y, m, d;
    if (dateStr.includes('/')) {
        let parts = dateStr.split('/');
        if (parts[2].length === 4) { y = parts[2]; m = parts[1]; d = parts[0]; }
        else { y = parts[0]; m = parts[1]; d = parts[2]; }
    } else {
        let parts = dateStr.split('-');
        y = parts[0]; m = parts[1]; d = parts[2];
    }
    
    let dInt = parseInt(d);
    let mInt = parseInt(m);
    let yInt = parseInt(y);
    
    // Búsqueda extremadamente holgada (-2 y +2 días) para burlar completamente cualquier zona horaria o UTC local del calendario
    const start = new Date(yInt, mInt-1, dInt - 2, 0, 0, 0);
    const end = new Date(yInt, mInt-1, dInt + 2, 23, 59, 59);
    
    const evts = cal.getEvents(start, end);
    evts.forEach(e => {
        try {
            let desc = e.getDescription() || '';
            let title = e.getTitle() || '';
            
            // Match Exacto y Único por ID de Reserva incrustado en el evento
            if (resId && desc.includes(resId.toString().trim())) {
                e.deleteEvent();
            }
        } catch(ex) {
            // Continuar con los demás si uno falla (ejem: no hay permiso sobre eventos de feriados)
        }
    });
  } catch(err) {
      console.log('Error deleting calendar event: ' + err);
  }
}

function cancelReservation(id) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Data');
  const data = sheet.getDataRange().getDisplayValues();
  
  let found = false;
  let htmlResult = '';
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      // Marcar como Cancelada en columna N (índice 13 -> Columna 14 para getRange)
      sheet.getRange(i + 1, 14).setValue("Cancelada");
      
      // Free the slot using Col A (0) Which is the resId
      freeCalendarSlot(data[i][9], data[i][10], data[i][2], data[i][0]);
      
      htmlResult = `
        <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
          <h2 style="color: #e74c3c;">Cita Cancelada</h2>
          <p>La reserva ha sido cancelada exitosamente.</p>
          <p>Ya puedes cerrar esta pestaña.</p>
        </div>
      `;
      found = true;
      break;
    }
  }
  
  if (!found) {
    htmlResult = `
        <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
          <h2 style="color: #e74c3c;">Error al Cancelar</h2>
          <p>No se encontró la reserva con ese identificador. Es posible que ya haya sido cancelada.</p>
        </div>
      `;
  }
  
  return ContentService.createTextOutput(htmlResult)
    .setMimeType(ContentService.MimeType.HTML);
}

// ----------------------------------------------------
// Admin Panel Functions
// ----------------------------------------------------
function getAllReservations() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Data');
  const data = sheet.getDataRange().getDisplayValues();
  if (data.length <= 1) return [];
  
  const list = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    
    // Al usar getDisplayValues, ya no necesitamos parsear Fechas con formatDate
    let created = row[1] || '';
    let reservaDate = row[9] || '';
    // A veces DisplayValues da fechas con guiones dependiendo de la configuración de celda. Reemplazamos si fuera necesario a dd/MM/yyyy
    if(reservaDate.includes('-') && reservaDate.split('-')[0].length === 4) {
       const p = reservaDate.split('-');
       reservaDate = `${p[2]}/${p[1]}/${p[0]}`;
    }
    
    list.push({
      id: row[0] ? row[0].toString() : '',
      creado: created.toString(),
      nombres: row[2] ? row[2].toString() : '',
      correo: row[3] ? row[3].toString() : '',
      telefono: row[4] ? row[4].toString().replace("'", "") : '',
      edad: row[5] ? row[5].toString() : '',
      dedicacion: row[6] ? row[6].toString() : '',
      instituto: row[7] ? row[7].toString() : '',
      programa: row[8] ? row[8].toString() : '',
      fecha: reservaDate.toString(),
      hora: row[10] ? row[10].toString() : '',
      motivo: row[11] ? row[11].toString() : '',
      sesionNumero: row[12] ? row[12].toString() : '',
      estado: row[13] ? row[13].toString() : 'Programada',
      problema: row[14] ? row[14].toString() : '',
      profundidad: row[15] ? row[15].toString() : '',
      objetivo: row[16] ? row[16].toString() : '',
      impacto: row[17] ? row[17].toString() : '',
      tipoDificultad: row[18] ? row[18].toString() : '',
      nivelCompromiso: row[19] ? row[19].toString() : '',
      notas: row[20] ? row[20].toString() : '',
      capturas: row[21] ? row[21].toString() : ''
    });
  }
  return list.reverse(); // Newest first
}

function updateReservationData(payload) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Data');
  const data = sheet.getDataRange().getDisplayValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === payload.id) {
      const rowIndex = i + 1;
      const oldState = data[i][13];
      sheet.getRange(rowIndex, 14).setValue(payload.estado);
      sheet.getRange(rowIndex, 13).setValue(payload.sesionNumero);
      sheet.getRange(rowIndex, 15).setValue(payload.problema);
      sheet.getRange(rowIndex, 16).setValue(payload.profundidad);
      sheet.getRange(rowIndex, 17).setValue(payload.objetivo);
      sheet.getRange(rowIndex, 18).setValue(payload.impacto);
      sheet.getRange(rowIndex, 19).setValue(payload.tipoDificultad);
      sheet.getRange(rowIndex, 20).setValue(payload.nivelCompromiso);
      sheet.getRange(rowIndex, 21).setValue(payload.notas);
      sheet.getRange(rowIndex, 22).setValue(payload.capturas);
      
      if ((payload.estado === 'Cancelada' || payload.estado === 'Reprogramada' || payload.estado === 'No asistió') 
           && oldState !== payload.estado) {
         freeCalendarSlot(data[i][9], data[i][10], data[i][2], data[i][0]);
      }
      
      return { success: true };
    }
  }
  return { success: false, message: 'No encontrado' };
}

function updateStudentData(payload) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Data');
  const data = sheet.getDataRange().getDisplayValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === payload.id) {
      const rowIndex = i + 1;
      sheet.getRange(rowIndex, 3).setValue(payload.nombres);
      sheet.getRange(rowIndex, 5).setValue("'" + payload.telefono);
      sheet.getRange(rowIndex, 6).setValue(payload.edad);
      sheet.getRange(rowIndex, 7).setValue(payload.dedicacion);
      sheet.getRange(rowIndex, 8).setValue(payload.instituto);
      sheet.getRange(rowIndex, 9).setValue(payload.programa);
      return { success: true };
    }
  }
  return { success: false };
}

function rescheduleReservation(payload) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Data');
  const data = sheet.getDataRange().getDisplayValues();
  
  let oldRow = null;
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === payload.id) {
      oldRow = data[i];
      rowIndex = i + 1;
      break;
    }
  }
  if (!oldRow) return { success: false, message: 'Reserva no encontrada' };

  const reglasNoDisponible = obtenerReglasNoDisponible();
  const [nuevoAnio, nuevoMes, nuevoDia] = payload.nuevaFecha.toString().split('-');
  const nuevaHora = parseInt(payload.nuevaHora, 10);
  const nuevoInicio = new Date(parseInt(nuevoAnio, 10), parseInt(nuevoMes, 10) - 1, parseInt(nuevoDia, 10), nuevaHora, 0, 0);
  const nuevoFin = new Date(parseInt(nuevoAnio, 10), parseInt(nuevoMes, 10) - 1, parseInt(nuevoDia, 10), nuevaHora + 1, 0, 0);
  const cupoMes = obtenerCupoMensualPorAmbito(oldRow[7], parseInt(nuevoAnio, 10), parseInt(nuevoMes, 10));
  const bookedSlots = obtenerBloqueosActivosPorFechaHora(oldRow[0]);
  const dateKeyNuevo = `${parseInt(nuevoAnio, 10).toString().padStart(4, '0')}-${parseInt(nuevoMes, 10).toString().padStart(2, '0')}-${parseInt(nuevoDia, 10).toString().padStart(2, '0')}`;

  // Si la cita anterior ya contaba en ese mismo mes/ámbito, se libera un cupo al reprogramar.
  let restantesAjustados = cupoMes.restantes;
  const oldFechaInfo = obtenerAnioMesDesdeFechaTexto(oldRow[9]);
  const oldAmbito = normalizarAmbitoNoDisponible(oldRow[7]);
  if (
    oldFechaInfo &&
    oldFechaInfo.claveMes === cupoMes.claveMes &&
    oldAmbito === cupoMes.ambito &&
    estadoCuentaParaCupo(oldRow[13])
  ) {
    restantesAjustados += 1;
  }

  if (restantesAjustados <= 0) {
    return { success: false, message: `No hay cupos disponibles para ${cupoMes.claveMes}.` };
  }
  if ((bookedSlots[dateKeyNuevo] || []).includes(nuevaHora)) {
    return { success: false, message: 'Ese horario ya tiene una reserva programada.' };
  }
  if (slotBloqueadoPorNoDisponible(nuevoInicio, nuevoFin, oldRow[7], reglasNoDisponible)) {
    return { success: false, message: 'El nuevo horario está bloqueado por una restricción en NoDisponible.' };
  }
  
  // Set old to Reprogramada
  sheet.getRange(rowIndex, 14).setValue("Reprogramada");
  if (payload.motivoReprogramacion) {
     const currentNotas = oldRow[20] || '';
     sheet.getRange(rowIndex, 21).setValue(currentNotas + " [Reprogramó por: " + payload.motivoReprogramacion + "]");
  }
  
  // Free old Calendar Event! using Event resId in Col 0
  freeCalendarSlot(oldRow[9], oldRow[10], oldRow[2], oldRow[0]);
  
  // Parse old oldF to proper string
  let oldF = oldRow[9];
  if(oldF instanceof Date) oldF = Utilities.formatDate(oldF, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  
  // Create New Reservation using old data but new Date/Time
  const createPayload = {
    nombre: oldRow[2],
    correo: oldRow[3],
    telefono: oldRow[4].toString().replace("'", ""),
    edad: oldRow[5],
    dedicacion: oldRow[6],
    instituto: oldRow[7],
    programa: oldRow[8],
    fecha: payload.nuevaFecha,
    hora: payload.nuevaHora,
    motivo: payload.motivoReprogramacion || "Reprogramación de Sesión"
  };
  return createReservationModified(createPayload, true, oldF, oldRow[10]);
}

function createReservationModified(data, isReschedule, oldFecha, oldHora) {
  const correo = data.correo ? data.correo.trim() : '';
  const nombres = data.nombre ? data.nombre.trim() : '';
  const telefono = data.telefono ? data.telefono.trim() : '';
  const edad = data.edad ? data.edad.toString().trim() : '';
  const dedicacion = data.dedicacion ? data.dedicacion.trim() : '';
  const instUniv = data.instituto ? data.instituto.trim() : '';
  const programa = data.programa ? data.programa.trim() : '';
  const motivo = data.motivo ? data.motivo.trim() : '';
  
  const dateStr = data.fecha; 
  const hour = parseInt(data.hora, 10); 
  const [year, month, day] = dateStr.split('-');
  
  const resId = generateId();
  
  const startTime = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), hour, 0, 0);
  const endTime = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), hour + 1, 0, 0);
  const reglasNoDisponible = obtenerReglasNoDisponible();
  const cupoMes = obtenerCupoMensualPorAmbito(instUniv, parseInt(year, 10), parseInt(month, 10));
  const bookedSlots = obtenerBloqueosActivosPorFechaHora();
  const dateKey = `${parseInt(year, 10).toString().padStart(4, '0')}-${parseInt(month, 10).toString().padStart(2, '0')}-${parseInt(day, 10).toString().padStart(2, '0')}`;
  if (cupoMes.restantes <= 0) {
    return { success: false, message: `No hay cupos disponibles para ${cupoMes.claveMes}.` };
  }
  if ((bookedSlots[dateKey] || []).includes(hour)) {
    return { success: false, message: 'Ese horario ya tiene una reserva programada.' };
  }
  if (slotBloqueadoPorNoDisponible(startTime, endTime, obtenerAmbitoDesdeTenant(instUniv), reglasNoDisponible)) {
    return { success: false, message: 'El nuevo horario está bloqueado por una restricción en NoDisponible.' };
  }
  
  const cal = CalendarApp.getDefaultCalendar();
  cal.createEvent(`Reserva EUROCOACH - ${nombres}`, startTime, endTime, {
    description: `Reserva para: ${nombres}\nCorreo: ${correo}\nTeléfono: ${telefono}\nInstituto: ${instUniv}\nPrograma: ${programa}\nMotivo: ${motivo}\n\n[ID Reserva: ${resId}]`
  });
  
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Data');
  const now = new Date();
  
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hDisplay = (hour % 12 || 12) + ':00 ' + ampm;
  
  let sessionNumber = 1;
  const existingData = sheet.getDataRange().getValues();
  for (let i = existingData.length - 1; i >= 1; i--) {
     if (existingData[i][3] && existingData[i][3].toString().trim().toLowerCase() === correo.toLowerCase()) {
         let rawNum = existingData[i][12] ? existingData[i][12].toString() : '0';
         let matchNum = rawNum.match(/\d+/);
         let lastNum = matchNum ? parseInt(matchNum[0]) : 0;
         sessionNumber = lastNum + 1;
         break;
     }
  }
  const sesionFormatted = "Sesión " + sessionNumber;
  
  sheet.appendRow([
    resId, now.toLocaleString('es-ES', { timeZone: 'America/Lima' }), nombres, correo, "'" + telefono,
    edad, dedicacion, instUniv, programa, dateStr, hDisplay, motivo, sesionFormatted, "Programada",
    "", "", "", "", "", "", "", ""
  ]);
  
  sendConfirmationEmail(correo, nombres, dateStr, hDisplay, instUniv, resId, isReschedule, oldFecha, oldHora);
  
  return { success: true, message: 'Reserva reprogramada con éxito.' };
}

// ----------------------------------------------------
// Upload Images to Drive
// ----------------------------------------------------
function uploadImageDrive(payload) {
  try {
    const folder = DriveApp.getFolderById("1RMtfFtzCKwtBLYtUIzx4p3UiPZTQAQtP");
    // Decode base64 to blob
    const rawBase64 = payload.base64.replace(/^data:image\/[a-z]+;base64,/, "");
    const blob = Utilities.newBlob(Utilities.base64Decode(rawBase64), payload.mimeType, payload.filename);
    
    const file = folder.createFile(blob);
    
    // Obtener link limpio mediante lh3
    const url = "https://lh3.googleusercontent.com/d/" + file.getId();
    
    return { success: true, url: url };
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}

function deleteRecord(payload) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Data');
  const data = sheet.getDataRange().getDisplayValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === payload.id) {
       // Also free calendar exactly before deleting row! using Col 0 (resId)
       freeCalendarSlot(data[i][9], data[i][10], data[i][2], data[i][0]);
       
       sheet.deleteRow(i + 1);
       return { success: true };
    }
  }
  return { success: false, message: "No encontrado" };
}


function sendReminderAction(payload) {
  let color = '#4a90e2';
  const instituto = payload.instituto || '';
  if(instituto.toLowerCase().includes('empresa')) color = '#df6621'; 
  else if(instituto.toLowerCase().includes('blackwell')) color = '#003c8f'; 
  else if(instituto.toLowerCase().includes('neumann')) color = '#7b2282'; 
  else if(instituto.toLowerCase().includes('autónoma')) color = '#e3000f';

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
      <div style="background-color: ${color}; color: white; padding: 20px; text-align: center;">
        <h2>EUROCOACH</h2>
      </div>
      <div style="padding: 20px; color: #333;">
        <p>Hola <strong>${payload.nombres}</strong>,</p>
        <p>${payload.mensaje.replace(/\\n/g, '<br>')}</p>
        <br>
        ${payload.links ? `<p><strong>Enlaces:</strong> <br> <a href="${payload.links}">${payload.links}</a></p>` : ''}
      </div>
    </div>
  `;
  
  MailApp.sendEmail({
    to: payload.correo,
    subject: payload.asunto,
    htmlBody: htmlBody
  });
  
  return { success: true };
}