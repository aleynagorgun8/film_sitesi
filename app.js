const express = require("express");
const app = express();
const port = 3002;  // Film verilerini sağlayacak port
const path = require("path");
const { connectDB } = require("./db");  // db.js'den bağlantı fonksiyonunu alıyoruz

// Statik dosyaları serve etmek için express.static kullanıyoruz
app.use(express.static(path.join(__dirname, "public")));

// Ana sayfa isteği
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Veri seti getirme isteği (Filmleri çekeceğiz)
app.get("/veriSeti", async (req, res) => {
    try {
        const pool = await connectDB();  // Veritabanına bağlanıyoruz
        // Sadece film adlarını çeken SQL sorgusu
        const result = await pool.request().query("SELECT film_adi FROM dbo.veriSeti");  
        res.json(result.recordset);  // Verileri JSON olarak döndürüyoruz
    } catch (err) {
        console.error("Veri çekme hatası:", err);  // Hata mesajını konsola yazıyoruz
        res.status(500).send("Veri alınamadı.");
    }
});

// Sunucuyu başlatıyoruz
app.listen(port, () => {
    console.log(`Film verilerini sağlayan sunucu ${port} portunda çalışıyor...`);
});
