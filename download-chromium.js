const chromium = require('chrome-aws-lambda');
const fs = require('fs');
const path = require('path');

async function downloadChromium() {
    const executablePath = await chromium.executablePath;
    if (!executablePath) {
        console.error('Falha ao obter o caminho do Chromium');
        process.exit(1);
    }
    console.log('Chromium baixado com sucesso');
}

downloadChromium();