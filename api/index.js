require('dotenv').config({path: __dirname + '/.env'});
const path = require('path');
const fs = require('fs');
const { Client, LocalAuth, RemoteAuth  } = require('whatsapp-web.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const QRCode = require('qrcode');
const express = require('express');
const axios = require('axios');
const apiKey = process.env.API_KEY;
const cors = require('cors');
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const clients = {};
let qrCodes = {};
const chromium = require('chrome-aws-lambda');
const puppeteer = require('puppeteer-core');

const mongoURI = process.env.MONGO_URI;

if (!apiKey || !mongoURI) {
    console.error('Erro: Variáveis de ambiente não carregadas corretamente.');
    process.exit(1);
}


async function connectToMongoDB() {
    try {
        await mongoose.connect(mongoURI);
        console.log('Conectado ao MongoDB');
    } catch (err) {
        console.error('Erro ao conectar ao MongoDB', err);
        process.exit(1); 
    }
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
    await connectToMongoDB();
    let qrCodetemp = null;
    const { nome, email, senha, numero, descricao, tipo_de_envio } = req.body;
    const user = { id: numero, nome, email, senha, descricao, tipo_de_envio };
    console.log(user)
    
    if (clients[user.id]) {
        res.status(200).json({ message: 'User already exists' });
    }
    const store = new MongoStore({ mongoose: mongoose, collection : 'CodigosQR' });

    const authDir = path.join('/tmp', '.wwebjs_auth');
    if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
    }

    let executablePath;
        try {
            executablePath = await chromium.executablePath;
            if (!executablePath) {
                throw new Error('Falha ao obter o caminho do Chromium');
            }
        } catch (error) {
            console.error('Falha ao obter o caminho do Chromium', error);
            return res.status(500).json({ message: 'Falha ao obter o caminho do Chromium' });
        }

    const client = new Client({
        authStrategy: new RemoteAuth({
            clientId: user.id,
            store: store,
            backupSyncIntervalMs: 300000,
            dataPath: authDir,
        }),
        puppeteer: {
            executablePath: executablePath,
            args: chromium.args,
            headless: chromium.headless,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
        webCache:null
    });

    client.on('remote_session_saved',  (remoteSession) => {
        console.log('Remote session saved', remoteSession);
    });

    client.on('qr', (qr) => {
        console.log(`QR Code para ${user.id}:`, qr);
        qrCodetemp = qr;
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

    try {
        await client.initialize();
    
        if (client) {
            user.qrCode = qrCodetemp;
            res.status(201).json(user);
        } else {
            res.status(500).json({ message: 'User not created' });
        }
    } catch (err) {
        console.error('Erro ao inicializar o cliente WhatsApp:', err);
        res.status(500).json({ message: 'Erro ao inicializar o cliente WhatsApp' });
    }
        
});



app.get('/qr', (req, res) => {
    res.json(qrCodes);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

module.exports = app;

