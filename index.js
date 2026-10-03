const express = require('express');
const axios = require('axios');
// Sintaxe moderna do Firebase Admin
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

// Lê o ficheiro secreto
const serviceAccount = require('./serviceAccountKey.json');

// Inicializa o Firebase com a nova sintaxe
initializeApp({
  credential: cert(serviceAccount)
});
const db = getFirestore();

const app = express();
app.use(express.json());

// Puxa o Token configurado no painel do Render
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

app.post('/webhook', async (req, res) => {
    const message = req.body.message;
    
    if (message && message.text) {
        const text = message.text;
        const chatId = message.chat.id;

        if (text.toLowerCase().includes('tarefa:')) {
            const parts = text.split('|').map(p => p.trim());
            const titulo = parts[0] ? parts[0].replace(/tarefa:/i, '').trim() : 'Sem título';
            const prazo = parts[1] ? parts[1].replace(/prazo:/i, '').trim() : 'Sem prazo';
            const materia = parts[2] ? parts[2].replace(/materia:/i, '').trim() : 'Geral';

            try {
                // Guarda na base de dados
                await db.collection('tarefas').add({
                    titulo, prazo, materia, concluida: false,
                    criadoEm: FieldValue.serverTimestamp(),
                    origem: 'Telegram'
                });

                // Responde no Telegram
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                    chat_id: chatId,
                    text: `✅ Tarefa "${titulo}" guardada com sucesso no Tecer!`
                });
            } catch (error) {
                console.error("Erro ao guardar no Firebase:", error);
            }
        }
    }
    res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor a correr na porta ${PORT}`);
});