require('dotenv').config();
const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const admin = require('firebase-admin');

const app = express();
const server = http.createServer(app);
app.use(cors());
app.use(express.json());

// Имя чата из переменной окружения
const CHAT_ID = process.env.discussion || 'general';

let db = null;
try {
  const serviceAccount = require('/etc/secrets/serviceAccountKey.json');
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  db = admin.firestore();
  console.log('🔥 Firebase OK');
} catch(e) {
  console.error('Firebase error:', e.message);
}

app.get('/', (req, res) => res.json({ status: 'ok', chat: CHAT_ID }));

// ===== ИСТОРИЯ ЧАТА =====
app.get('/api/chat/history', async (req, res) => {
  if (!db) return res.json({ messages: [] });
  try {
    const snapshot = await db
      .collection('publicChats').doc(CHAT_ID)
      .collection('messages')
      .orderBy('time', 'desc').limit(200).get();
    
    const messages = [];
    snapshot.forEach(d => messages.push(d.data()));
    res.json({ messages: messages.reverse() });
  } catch(e) {
    res.json({ messages: [] });
  }
});

// ===== СОХРАНЕНИЕ СООБЩЕНИЯ =====
app.post('/api/chat/message', async (req, res) => {
  if (!db) return res.json({ success: false });
  try {
    const { message } = req.body;
    if (!message?.id) return res.status(400).json({ error: 'no message' });
    
    // Проверка: в новостной канал могут писать только админы
    if (CHAT_ID === 'news') {
      const accountId = message.authorId;
      const doc = await db.collection('admin_levels').doc(String(accountId)).get();
      const level = doc.exists ? (doc.data().level || 0) : 0;
      if (level < 4) return res.status(403).json({ error: 'Только для администраторов' });
    }
    
    await db.collection('publicChats').doc(CHAT_ID)
      .collection('messages').doc(String(message.id)).set(message);
    
    broadcast({ type: 'new_message', data: message });
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== УДАЛЕНИЕ СООБЩЕНИЯ =====
app.delete('/api/chat/message/:messageId', async (req, res) => {
  if (!db) return res.json({ success: false });
  try {
    await db.collection('publicChats').doc(CHAT_ID)
      .collection('messages').doc(req.params.messageId).delete();
    broadcast({ type: 'delete', id: req.params.messageId });
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== ЦВЕТА НИКОВ (общие для всех чатов) =====
app.get('/api/nickname-colors', async (req, res) => {
  if (!db) return res.json({});
  try {
    const doc = await db.collection('publicChatSettings').doc('nicknameColors').get();
    res.json(doc.exists ? doc.data() : {});
  } catch(e) {
    res.json({});
  }
});

// ===== WEBSOCKET =====
const wss = new WebSocket.Server({ server });
const clients = new Set();

function broadcast(data) {
  const msg = JSON.stringify(data);
  clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

setInterval(() => {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (url) require('https').get(url + '/', () => {}).on('error', () => {});
}, 10 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`✅ CHAT [${CHAT_ID}]:${PORT}`));
