const sql = require("mssql");

const config = {
    server: "localhost",  // SQL Server adresi
    database: "dbFilms",  // Veritabanı ismi
    options: {
        encrypt: true,  // Bağlantı şifreli olmalı
        enableArithAbort: true,
        trustServerCertificate: true  // Sertifikayı güvenilir kabul et
    },
    authentication: {
        type: "default",
        options: {
            userName: "sa",  // Kullanıcı adı
            password: "141592"  // Şifre
        }
    }
};

let poolPromise;

// Veritabanı bağlantı fonksiyonu
async function connectDB() {
    try {
        if (!poolPromise) {
            poolPromise = sql.connect(config);  // İlk bağlantı sağlanıyor
            console.log("✅ Veritabanına başarılı bir şekilde bağlandık!");
        }
        return poolPromise;
    } catch (err) {
        console.error("❌ Bağlantı hatası:", err);
        throw err;  // Hata durumunda dışarıya hata fırlatıyoruz
    }
}

module.exports = { connectDB, sql };
