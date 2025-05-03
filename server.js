// server.js
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import cron from 'node-cron';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { sendAudioMessage } from './whatsappService.js';  // ajusta ruta si es necesario


dotenv.config();

import { db } from './firebaseAdmin.js';
import {
  connectToWhatsApp,
  getLatestQR,
  getConnectionStatus,
  sendMessageToLead,
  getSessionPhone
} from './whatsappService.js';
import {
  processSequences,
  generateLetras,
  sendLetras
} from './scheduler.js';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());

// Endpoint para consultar el estado de WhatsApp (QR y conexión)
app.get('/api/whatsapp/status', (req, res) => {
  res.json({
    status: getConnectionStatus(),
    qr: getLatestQR()
  });
});

// Nuevo endpoint para obtener el número de sesión
app.get('/api/whatsapp/number', (req, res) => {
  const phone = getSessionPhone();
  if (phone) {
    res.json({ phone });
  } else {
    res.status(503).json({ error: 'WhatsApp no conectado' });
  }
});

// Endpoint para enviar mensaje de WhatsApp
app.post('/api/whatsapp/send-message', async (req, res) => {
  const { leadId, message } = req.body;
  if (!leadId || !message) {
    return res.status(400).json({ error: 'Faltan leadId o message en el body' });
  }

  try {
    const leadRef = db.collection('leads').doc(leadId);
    const leadDoc = await leadRef.get();
    if (!leadDoc.exists) {
      return res.status(404).json({ error: "Lead no encontrado" });
    }

    const { telefono } = leadDoc.data();
    if (!telefono) {
      return res.status(400).json({ error: "Lead sin número de teléfono" });
    }

    // Delega la normalización y el guardado a sendMessageToLead
    const result = await sendMessageToLead(telefono, message);
    return res.json(result);
  } catch (error) {
    console.error("Error enviando mensaje de WhatsApp:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Recibe el audio y lo envía por Baileys
app.post(
  '/api/whatsapp/send-audio',
  upload.single('audio'),
  async (req, res) => {
    try {
      const { phone } = req.body;             // número limpio del front
      const filePath = req.file.path;         // ruta temporal del audio

      // Llama a tu función que envía la nota de voz
      await sendAudioMessage(phone, filePath);

      // Borra el archivo temporal
      fs.unlinkSync(filePath);

      return res.json({ success: true });
    } catch (error) {
      console.error('Error enviando audio:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);


// (Opcional) Marcar todos los mensajes de un lead como leídos
app.post('/api/whatsapp/mark-read', async (req, res) => {
  const { leadId } = req.body;
  if (!leadId) {
    return res.status(400).json({ error: "Falta leadId en el body" });
  }
  try {
    await db.collection('leads')
            .doc(leadId)
            .update({ unreadCount: 0 });
    return res.json({ success: true });
  } catch (err) {
    console.error("Error marcando como leídos:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Arranca el servidor y conecta WhatsApp
app.listen(port, () => {
  console.log(`Servidor corriendo en el puerto ${port}`);
  connectToWhatsApp().catch(err =>
    console.error("Error al conectar WhatsApp en startup:", err)
  );

  // Arranque inmediato de generación/envío de letras pendientes
  generateLetras().catch(err =>
    console.error("Error inicial en generateLetras:", err)
  );
  sendLetras().catch(err =>
    console.error("Error inicial en sendLetras:", err)
  );
});

// Scheduler: ejecuta las secuencias activas cada minuto
cron.schedule('* * * * *', () => {
  console.log('⏱️ processSequences:', new Date().toISOString());
  processSequences().catch(err => console.error('Error en processSequences:', err));
});

// Genera letras pendientes cada minuto
cron.schedule('* * * * *', () => {
  console.log('🖋️ generateLetras:', new Date().toISOString());
  generateLetras().catch(err => console.error('Error en generateLetras:', err));
});

// Envía letras pendientes cada minuto
cron.schedule('* * * * *', () => {
  console.log('📨 sendLetras:', new Date().toISOString());
  sendLetras().catch(err => console.error('Error en sendLetras:', err));
});
