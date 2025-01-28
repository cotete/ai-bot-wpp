require('dotenv').config();
const { Client, NoAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const QRCode = require('qrcode');
const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer');
const apiKey = process.env.API_KEY;

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const client = new Client({
    authStrategy: new NoAuth(),
    puppeteer: {
        executablePath: '/usr/bin/chromium-browser',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

let qrCodeData = '';
let phoneNumber = '';

client.on('ready', async () => {
    console.log('Client is ready!');
    const state = await client.getState();
    if (state === 'CONNECTED') {
        const info = await client.info;
        phoneNumber = info.wid.user;
        console.log('Phone number:', phoneNumber);
    }
});

const getClient = async () => {
    const users = await axios.get('https://api-atendimentos.onrender.com/usuarios.json');
    const user = users.data.find(user => user.numero === phoneNumber);
    return user;
}

const postMessage = async (message, numero,respostaIa) => {
    const user = await getClient();
    const data = {
        mensagem: message,
        usuario_id: user.id,
        status_chat: true,
        nm_cliente: user.nome,
        nr_cliente: numero,
        reposta_ia: respostaIa,
    };
    const response = await axios.post('https://api-atendimentos.onrender.com/mensagens.json', data);
    return response;
}

client.on('qr', qr => {
    qrCodeData = qr;
    qrcode.generate(qr, {small: true});
    console.log(qr);
});

client.on('message_create', async message => {
    console.log('New message received', message);

    const prompt = `Faça uma resposta como se você fosse um assistente de uma empresa, respondendo para que setor essa mensagem seria direcionada: "${message.body}", exemplo de mensagem que você deve enviar: "Redirecionando você ao seter (nome do setor)..."`;
    const result = await model.generateContent(prompt);
    await postMessage(message.body, message.getContact(), result);
    message.reply(result);
});

client.initialize();

const app = express();

app.use(express.static('public'));

app.get('/qr', (req, res) => {
    if (qrCodeData) {
        QRCode.toDataURL(qrCodeData, (err, url) => {
            if (err) {
                res.status(500).send('Error generating QR code');
            } else {
                res.send(`<img src="${url}" alt="QR Code" />`);
            }
        });
    } else {
        res.send('QR code not available yet');
    }
});


module.exports = app;