const express = require("express");
const router = express.Router();
const axios = require("axios");

router.post("/ask", async (req, res) => {
    const { question } = req.body;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    try {
        const response = await axios({
            method: 'post',
            url: 'http://172.28.6.252:8080/v1/chat/completions',
            data: {
                messages: [
                    {
                        role: "system",
                        content: "Sen yardımcı bir eğitim asistanısın. Tüm cevaplarını her zaman %100 Türkçe olarak vermelisin. Asla İngilizceye geçiş yapma."
                    },
                    {
                        role: "user",
                        content: question
                    }
                ],
                // STREAM PARAMETRESİ DATA İÇİNDE OLMALI
                stream: true
            },
            // RESPONSE TYPE ANA OBJEDE OLMALI (Senin hatan buradaydı)
            responseType: 'stream'
        });

        response.data.on('data', chunk => {
            res.write(chunk);
        });

        response.data.on('end', () => {
            res.end();
        });

    } catch (error) {
        console.error("Stream Hatası:", error.message);
        res.write("data: " + JSON.stringify({ choices: [{ delta: { content: "Yapay zeka sunucusuyla iletişim kurulamadı." } }] }));
        res.end();
    }
});

module.exports = router;