require('dotenv').config({path:'../.env'});
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const QRCode = require('qrcode');
const express = require('express');
const axios = require('axios');
const apiKey = process.env.API_KEY;
const chromium = require('chrome-aws-lambda');
const puppeteer = require('puppeteer');
const cors = require('cors');
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
const clients = {};
let qrCodes = {};


const getClient = async () => {
    try {
        const response = await axios.get('https://api-atendimentos.onrender.com/usuarios.json');
        const users = response.data;
        const user = users.find(user => user.numero === phoneNumber);
        return user;
    } catch (error) {
        console.error('Error fetching users:', error);
        return null;
    }
}

function createClient(clientId) {

    if (clients[clientId]) {
        return clients[clientId];
    }
    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: clientId 
        }),
        puppeteer: {
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        }
    });

    client.on('qr', (qr) => {
        console.log(`QR Code para ${clientId}:`, qr);
        qrCodes[clientId] = qr;
    });

    client.on('ready', () => {
        console.log(`Cliente ${clientId} está pronto.`);
    });

    client.on('message_create', async message => {
        console.log('New message received', message);
    
        const prompt = `Faça uma resposta como se você fosse um assistente de uma empresa, respondendo para que setor essa mensagem seria direcionada: "${message.body}", exemplo de mensagem que você deve enviar: "Redirecionando você ao seter (nome do setor)..."`;
        const result = await model.generateContent(prompt);
        await postMessage(clientId, message.body, message.getContact(), result);
        message.reply(result);
    });

    client.initialize();
    clients[clientId] = client; 
    return client;
}

const postMessage = async (clientId, message, numero, respostaIa) => {
    try {
        const user = clients[clientId];
        if (!user) {
            throw new Error('User not found');
        }
        const data = {
            mensagem: message,
            usuario_id: user.id,
            status_chat: true,
            nm_cliente: user.nome,
            nr_cliente: numero,
            reposta_ia: respostaIa,
        };
        const response = await axios.post('https://api-atendimentos.onrender.com/mensagens', data);
        return response;
    } catch (error) {
        console.error('Error posting message:', error);
        return null;
    }
}



const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.post('/user', async (req, res) => {
    console.log(req.body)
    const { nome, email, senha, numero, descricao, tipo_de_envio } = req.body;
    const user = { id: numero, nome, email, senha, descricao, tipo_de_envio };
    console.log(user)
    
    if (clients[user.id]) {
        return clients[user.id];
    }
    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: user.id 
        }),
        puppeteer: {
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        }
    });

    client.on('qr', (qr) => {
        console.log(`QR Code para ${user.id}:`, qr);
        qrCodes[user.id] = qr;
    });

    client.on('ready', () => {
        console.log(`Cliente ${user.id} está pronto.`);
    });

    client.on('message_create', async message => {
        console.log('New message received', message);
    
        const prompt = `Faça uma resposta como se você fosse um assistente de uma empresa, respondendo para que setor essa mensagem seria direcionada: "${message.body}", exemplo de mensagem que você deve enviar: "Redirecionando você ao seter (nome do setor)..."`;
        const result = await model.generateContent(prompt);
        await postMessage(user.id, message.body, message.getContact(), result);
        message.reply(result);
    });

    client.initialize();
    clients[user.id] = client;

    if (client) {
        res.status(201).json({ message: 'User created', client });
        return client;
    }else
        res.status(500).json({ message: 'User not created'});
        return null;
});

app.get('/user', async (req, res) => {
    if (user) {
        res.status(200).json(JSON.parse(clients));
    } else {
        res.status(404).json({ message: 'User not found'});
    }
});




app.get('/qr/:clientId', (req, res) => {
    const clientId = req.params.clientId;
    const qr = qrCodes[clientId];
    if (qr) {
        QRCode.toDataURL(qr, (err, url) => {
            if (err) {
                res.status(500).json({ message: 'Error generating QR code'});
            } else {
                res.send(`<img src="${url}" alt="QR Code" />`);
            }
        });
    } else {
        res.send('QR code not available yet');
    }
});

module.exports = app;

