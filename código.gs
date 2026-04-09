const SPREADSHEET_ID = '1CURP5Equ3EaH6NcWDNOo_CX190qaoPSfW0ZTxrLy83o';

function doGet(e) {
  const action = e.parameter.action;
  
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
        slots: getAvailability(),
        profiles: getLatestProfiles()
      };
    } else if (action === 'getPrograms') {
      result = getPrograms();
    } else if (action === 'searchUser') {
       const email = e.parameter.email;
       const cleanEmail = email ? email.trim() : '';
       result = searchUserProfile(cleanEmail);
    } else if (action === 'getSlots') {
       result = getAvailability();
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
    // Handling text/plain POST to avoid CORS preflight, parsing manually
    const data = JSON.parse(e.postData.contents);
    result = createReservation(data);
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
  const data = sheet.getDataRange().getValues();
  const profilesMap = {};
  
  // Buscar desde el final hacia arriba
  for (let i = data.length - 1; i > 0; i--) {
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
// Obtener horarios disponibles (Lunes a Sábado, 8am - 6pm, 15 días)
// ----------------------------------------------------
function getAvailability() {
  const now = new Date();
  const endDate = new Date();
  endDate.setDate(now.getDate() + 15);
  
  const events = CalendarApp.getDefaultCalendar().getEvents(now, endDate);
  
  // Mapa de fechas ocupadas
  const bookedSlots = {};
  events.forEach(event => {
    const start = event.getStartTime();
    const dateKey = `${start.getFullYear()}-${(start.getMonth()+1).toString().padStart(2, '0')}-${start.getDate().toString().padStart(2, '0')}`;
    const hours = start.getHours();
    
    if (!bookedSlots[dateKey]) bookedSlots[dateKey] = [];
    bookedSlots[dateKey].push(hours);
  });
  
  const availableDates = {};
  
  // Iterar 15 días
  for (let i = 0; i < 15; i++) {
    let checkDate = new Date();
    checkDate.setDate(now.getDate() + i);
    
    const dayOfWeek = checkDate.getDay();
    // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
    if (dayOfWeek !== 0) { // Excluir domingo
      const dateKey = `${checkDate.getFullYear()}-${(checkDate.getMonth()+1).toString().padStart(2, '0')}-${checkDate.getDate().toString().padStart(2, '0')}`;
      availableDates[dateKey] = [];
      
      const currentBooked = bookedSlots[dateKey] || [];
      
      // Horas de 8am (8) a 6pm (18). 
      // Por regla, son intervalos de 1 hora.
      for (let hour = 8; hour <= 18; hour++) {
        // En "hoy", no mostrar horas pasadas
        if (i === 0 && checkDate.getHours() >= hour) continue;
        
        if (!currentBooked.includes(hour)) {
          // Formato AM/PM
          const ampm = hour >= 12 ? 'PM' : 'AM';
          const h = hour % 12 || 12;
          availableDates[dateKey].push({ hour: hour, label: `${h}:00 ${ampm}` });
        }
      }
    }
  }
  
  return availableDates;
}

function generateId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// ----------------------------------------------------
// Crear Reserva
// ----------------------------------------------------
function createReservation(data) {
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
  const hour = parseInt(data.hora); // int 8 to 18
  
  const [year, month, day] = dateStr.split('-');
  
  const startTime = new Date(year, parseInt(month)-1, day, hour, 0, 0);
  const endTime = new Date(year, parseInt(month)-1, day, hour + 1, 0, 0);
  
  // 1. Crear evento en Google Calendar
  const cal = CalendarApp.getDefaultCalendar();
  const event = cal.createEvent(`Reserva EUROCOACH - ${nombres}`, startTime, endTime, {
    description: `Reserva para: ${nombres}\nCorreo: ${correo}\nTeléfono: ${telefono}\nInstituto: ${instUniv}\nPrograma: ${programa}\nMotivo: ${motivo}`
  });
  const eventId = event.getId();
  
  // 2. Guardar en Sheets
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Data');
  const now = new Date();
  
  const resId = generateId();
  
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hDisplay = (hour % 12 || 12) + ':00 ' + ampm;
  
  // ID, Creado, Nombres, Correo, Teléfono, Edad, Dedicacion, Instituto, Programa, Fecha, Hora, Motivo
  sheet.appendRow([
    resId,
    now.toLocaleString('es-ES', { timeZone: 'America/Lima' }),
    nombres,
    correo,
    "'" + telefono, // apóstrofe para evitar formula error
    edad,
    dedicacion,
    instUniv,
    programa,
    dateStr,
    hDisplay,
    motivo
  ]);
  
  // 3. Enviar correo de confirmación
  sendConfirmationEmail(correo, nombres, dateStr, hDisplay, instUniv, resId, eventId);
  
  return { success: true, message: 'Reserva confirmada con éxito.' };
}

// ----------------------------------------------------
// Envío de correo
// ----------------------------------------------------
function sendConfirmationEmail(correo, nombres, fecha, hora, instituto, resId, eventId) {
  // Ajuste de color según institución pseudo
  let color = '#4a90e2';
  if(instituto.toLowerCase().includes('empresa')) color = '#F28C28'; // Soft orange
  else if(instituto.toLowerCase().includes('blackwell')) color = '#333333'; // Soft black
  else if(instituto.toLowerCase().includes('neumann')) color = '#9b59b6'; // Soft purple
  else if(instituto.toLowerCase().includes('autónoma')) color = '#e74c3c'; // Soft red
  
  const scriptUrl = ScriptApp.getService().getUrl();
  const cancelLink = `${scriptUrl}?action=cancel&id=${resId}`;
  
  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
      <div style="background-color: ${color}; color: white; padding: 20px; text-align: center;">
        <h2>Reserva Confirmada: EUROCOACH</h2>
      </div>
      <div style="padding: 20px; color: #333;">
        <p>Hola <strong>${nombres}</strong>,</p>
        <p>Tu sesión de coaching con <strong>${instituto}</strong> ha sido reservada correctamente.</p>
        <br>
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px;">
           <p style="margin: 0;">📅 <strong>Fecha:</strong> ${fecha}</p>
           <p style="margin: 5px 0 0 0;">⏰ <strong>Hora:</strong> ${hora}</p>
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
    subject: `Confirmación de Reserva EUROCOACH - ${fecha} ${hora}`,
    htmlBody: htmlBody
  });
}

function cancelReservation(id) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Data');
  const data = sheet.getDataRange().getValues();
  
  let found = false;
  let htmlResult = '';
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      // Marcar como cancelada en alguna columna (por ej. Motivo se le agrega "CANCELADO")
      const currentMotivo = data[i][11];
      sheet.getRange(i + 1, 12).setValue("❌ [CANCELADO] " + currentMotivo);
      
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