const express = require('express');
const axios = require('axios');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const serviceAccount = require('./serviceAccountKey.json');
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const SITE = 'https://tecer-planner.web.app/';
const send = (chat_id, text) =>
    axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id, text, disable_web_page_preview: true });

// Interpreta "25/10 14:30", "25/10/2026 às 14h", "hoje 18:00", "amanhã" ou "Não".
// Retorna { ok, prazo } com prazo no formato do site: "YYYY-MM-DD" ou "YYYY-MM-DDTHH:mm" (ou null).
function parsePrazo(txt) {
    const t = txt.trim().toLowerCase();
    if (/^(n[aã]o|nao|n|sem prazo|-)$/.test(t)) return { ok: true, prazo: null };
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const p = n => String(n).padStart(2, '0');
    let y, m, d;
    const dm = t.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (dm) {
        d = +dm[1]; m = +dm[2]; y = dm[3] ? (+dm[3] < 100 ? 2000 + +dm[3] : +dm[3]) : now.getFullYear();
        if (!dm[3] && new Date(y, m - 1, d, 23, 59) < now) y++;
    } else if (/hoje|amanh[aã]/.test(t)) {
        const x = new Date(now); if (/amanh/.test(t)) x.setDate(x.getDate() + 1);
        y = x.getFullYear(); m = x.getMonth() + 1; d = x.getDate();
    } else return { ok: false };
    const chk = new Date(y, m - 1, d);
    if (chk.getMonth() !== m - 1 || chk.getDate() !== d) return { ok: false };
    const tm = t.replace(dm ? dm[0] : '', '').match(/(\d{1,2})\s*(?::|h)\s*(\d{2})?/);
    let prazo = `${y}-${p(m)}-${p(d)}`;
    if (tm) { if (+tm[1] > 23 || +(tm[2] || 0) > 59) return { ok: false }; prazo += `T${p(tm[1])}:${p(tm[2] || 0)}`; }
    return { ok: true, prazo };
}

app.post('/webhook', async (req, res) => {
    res.status(200).send('OK'); // responde logo para o Telegram não reenviar
    const message = req.body.message;
    if (!message || !message.text) return;
    const text = message.text.trim(), chatId = message.chat.id;

    try {
        // 1) Conta vinculada?
        const found = await db.collection('users').where('telegramChatId', '==', chatId).limit(1).get();
        if (found.empty) {
            const code = text.toUpperCase();
            const byCode = /^[A-Z0-9]{6}$/.test(code) ? await db.collection('users').where('codigo', '==', code).limit(1).get() : null;
            if (byCode && !byCode.empty) {
                await byCode.docs[0].ref.update({ telegramChatId: chatId });
                return send(chatId, `Conta vinculada, ${byCode.docs[0].data().nome}! Mande qualquer mensagem para criar uma tarefa.`);
            }
            return send(chatId, `Para começar, envie o código de vínculo que aparece em Configurações no Tecer: ${SITE}`);
        }
        const userRef = found.docs[0].ref;

        // 2) Fluxo conversacional (estado guardado no Firestore para sobreviver a reinícios)
        const sRef = db.collection('telegramSessions').doc(String(chatId));
        const s = (await sRef.get()).data();

        if (!s || /^\/(start|cancelar)/i.test(text)) {
            await sRef.set({ etapa: 'nome' });
            return send(chatId, 'Qual o nome da tarefa?');
        }
        if (s.etapa === 'nome') {
            await sRef.set({ etapa: 'prazo', titulo: text });
            return send(chatId, "Deseja adicionar um prazo? (Responda com a data/hora ou 'Não')");
        }
        if (s.etapa === 'prazo') {
            const r = parsePrazo(text);
            if (!r.ok) return send(chatId, "Não entendi a data. Tente '25/10 14:30', 'amanhã 18:00' ou 'Não'.");
            await userRef.collection('tarefas').add({
                titulo: s.titulo, prazo: r.prazo, descricao: '', prioridade: 'media', esforco: 'normal',
                subtarefas: [], tagIds: [], disciplinaId: null, concluida: false,
                criadoEm: FieldValue.serverTimestamp(), origem: 'Telegram'
            });
            await sRef.delete();
            return send(chatId, `Tarefa criada com sucesso! Verifique aqui: ${SITE}`);
        }
    } catch (error) {
        console.error('Erro no webhook:', error);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor a correr na porta ${PORT}`));
