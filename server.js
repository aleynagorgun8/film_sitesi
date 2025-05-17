const express = require('express');
const session = require('express-session');
const sql = require('mssql');
const bcrypt = require('bcrypt');
const cors = require('cors');
const app = express();
const jwt = require('jsonwebtoken');
const JWT_SECRET = 'gizliAnahtar123';
const { spawn } = require('child_process'); // Python script çağırmak için
const axios = require('axios');



// CORS ve session middleware'larını uygulamaya ekliyoruz
app.use(cors({
    origin: 'http://127.0.0.1:5500', // Frontend'in çalıştığı adres
    credentials: true // Credentials'ların gönderilmesine izin ver
}));
app.use(session({
    secret: 'gizliAnahtar',
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: false,
        sameSite: 'lax' // CORS ile uyumlu olması için
    }
}));

// JSON verileri için middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// SQL Server bağlantı ayarları
const yapılandırma = {
    user: 'sa',
    password: '141592',
    server: 'localhost',
    database: 'dbFilms',
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
        connectionTimeout: 30000,
        requestTimeout: 30000,
        pool: {
            max: 10,
            min: 0,
            idleTimeoutMillis: 30000,
            acquireTimeoutMillis: 30000,
            createTimeoutMillis: 30000,
            destroyTimeoutMillis: 30000,
            reapIntervalMillis: 1000,
            createRetryIntervalMillis: 100
        }
    }
};

// Global bağlantı havuzu oluştur
let pool;

async function initializePool() {
    try {
        if (pool) {
            try {
                await pool.close();
            } catch (err) {
                console.error('Eski bağlantı havuzu kapatma hatası:', err);
            }
        }
        pool = await sql.connect(yapılandırma);
        console.log('Veritabanı bağlantı havuzu başarıyla oluşturuldu');
    } catch (err) {
        console.error('Veritabanı bağlantı havuzu oluşturma hatası:', err);
        // Hata durumunda 5 saniye sonra tekrar dene
        setTimeout(initializePool, 5000);
    }
}

// Bağlantı havuzunu başlat
initializePool();

// Bağlantı havuzunu yeniden başlatma fonksiyonu
async function restartPool() {
    try {
        if (pool) {
            await pool.close();
        }
        await initializePool();
    } catch (err) {
        console.error('Bağlantı havuzu yeniden başlatma hatası:', err);
    }
}

// Bağlantı durumunu kontrol et ve gerekirse yeniden başlat
async function ensureConnection() {
    try {
        if (!pool || !pool.connected) {
            console.log('Bağlantı kopmuş, yeniden bağlanılıyor...');
            await restartPool();
        }
        return pool;
    } catch (err) {
        console.error('Bağlantı kontrolü hatası:', err);
        await restartPool();
        return pool;
    }
}

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ mesaj: 'Yetkilendirme gerekli' });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const [userId] = decoded.split(':'); // "userId:timestamp" formatı

    if (!userId) {
      return res.status(401).json({ mesaj: 'Geçersiz token verisi' });
    }

    req.userId = userId;
    next();
  } catch (error) {
    return res.status(401).json({ mesaj: 'Token çözümleme hatası' });
  }
};

// Giriş endpointi
app.post('/giris', async (istek, yanit) => {
    const { email, şifre } = istek.body;

    if (!email || !şifre) {
        return yanit.status(400).json({ mesaj: 'Email ve şifre gerekli.' });
    }

    try {
        await sql.connect(yapılandırma);
        const request = new sql.Request();
        request.input('email', sql.NVarChar, email);
        const result = await request.query(`
            SELECT user_id, kullanıcı_adı, email, şifre_hash
            FROM dbo.kullanıcılar
            WHERE email = @email
        `);

        if (result.recordset.length === 0) {
            return yanit.status(404).json({ mesaj: 'Kullanıcı bulunamadı.' });
        }

        const kullanıcı = result.recordset[0];
        const şifreDoğruMu = await bcrypt.compare(şifre, kullanıcı.şifre_hash);

        if (şifreDoğruMu) {
            // Token oluştur
            const token = Buffer.from(`${kullanıcı.user_id}:${Date.now()}`).toString('base64');
            
            // Session'a kullanıcı bilgilerini kaydet
            istek.session.userId = kullanıcı.user_id;
            istek.session.token = token;
            
            return yanit.json({ 
                mesaj: 'Giriş başarılı!', 
                userId: kullanıcı.user_id,
                token: token
            });
        } else {
            return yanit.status(401).json({ mesaj: 'Yanlış şifre.' });
        }

    } catch (hata) {
        console.error('Giriş Hatası:', hata);
        return yanit.status(500).json({ mesaj: 'Giriş sırasında bir hata oluştu.' });
    }
});

app.post('/degerlendirme', authenticateToken, async (req, res) => {
    const { film_id, senaryo, oyunculuk, yonetmen, yorum } = req.body;
    const userId = req.userId;

    // Puanların geçerli olup olmadığını kontrol et (1-5 arasında)
    if ([senaryo, oyunculuk, yonetmen].some(puan => puan < 1 || puan > 5)) {
        return res.status(400).json({ mesaj: 'Puanlar 1 ile 5 arasında olmalıdır.' });
    }

    try {
        await sql.connect(yapılandırma);
        
        // Önce bu kullanıcının bu film için daha önce değerlendirme yapıp yapmadığını kontrol et
        const eskiDegerlendirme = await sql.query`
            SELECT degerlendirme_id, user_id, film_id, senaryo, oyunculuk, yonetmen, yorum 
            FROM dbo.Degerlendirmeler 
            WHERE user_id = ${userId} AND film_id = ${film_id}
        `;

        if (eskiDegerlendirme.recordset.length > 0) {
            // Eğer varsa güncelle
            await sql.query`
                UPDATE dbo.Degerlendirmeler
                SET senaryo = ${senaryo},
                    oyunculuk = ${oyunculuk},
                    yonetmen = ${yonetmen},
                    yorum = ${yorum}
                WHERE user_id = ${userId} AND film_id = ${film_id}
            `;
        } else {
            // Yoksa yeni değerlendirme ekle
            await sql.query`
                INSERT INTO dbo.Degerlendirmeler (
                    user_id, film_id, senaryo, oyunculuk, yonetmen, yorum
                ) VALUES (
                    ${userId}, ${film_id}, ${senaryo}, ${oyunculuk}, ${yonetmen}, ${yorum}
                )
            `;
        }

        res.json({ mesaj: 'Değerlendirme başarıyla kaydedildi' });
    } catch (err) {
        console.error('Değerlendirme hatası:', err);
        res.status(500).json({ mesaj: 'Değerlendirme kaydedilirken bir hata oluştu' });
    } finally {
        sql.close();
    }
});

// Çıkış endpoint'i
app.post('/cikis', (req, res) => {
    // Session'ı tamamen temizle
    req.session.destroy((err) => {
        if (err) {
            console.error('Çıkış hatası:', err);
            return res.status(500).json({ mesaj: 'Çıkış yapılırken bir hata oluştu' });
        }
        
        // Cookie'yi temizle
        res.clearCookie('connect.sid', {
            path: '/',
            httpOnly: true,
            secure: false, // Development için false, production'da true olmalı
            sameSite: 'lax'
        });
        
        res.json({ mesaj: 'Başarıyla çıkış yapıldı' });
    });
});

// Sunucu dinlemeye başlatılıyor
app.listen(3000, () => {
    console.log('Giriş sunucusu 3000 portunda çalışıyor');
});

// Kayıt için yeni bir express uygulaması oluşturuyoruz
const kayıtUygulama = express();
kayıtUygulama.use(cors({
    origin: 'http://127.0.0.1:5500',
    credentials: true
}));
kayıtUygulama.use(express.json());

// Kayıt olma endpointi
kayıtUygulama.post('/kaydol', async (istek, yanit) => {
    const { kullanıcı_adı, email, şifre, kelime } = istek.body;

    if (!kullanıcı_adı || !email || !şifre || !kelime) {
        return yanit.status(400).json({ mesaj: 'Tüm alanlar gereklidir.' });
    }

    try {
        const şifreHash = await bcrypt.hash(şifre, 10);
        await sql.connect(yapılandırma);

        const result = await sql.query`
            SELECT * FROM dbo.kullanıcılar WHERE email = ${email}
        `;

        if (result.recordset.length > 0) {
            return yanit.status(400).json({ mesaj: 'Bu e-posta ile daha önce kayıt yapılmış.' });
        }

        await sql.query`
            INSERT INTO dbo.kullanıcılar (kullanıcı_adı, email, şifre_hash, kayıt_tarihi, Kelime)
            VALUES (${kullanıcı_adı}, ${email}, ${şifreHash}, GETDATE(), ${kelime})
        `;

        yanit.json({ mesaj: 'Kayıt başarıyla tamamlandı!' });

    } catch (hata) {
        console.error('Kayıt Hatası:', hata);
        yanit.status(500).json({ mesaj: 'Kayıt sırasında bir hata oluştu.' });
    }
});

kayıtUygulama.listen(3001, () => {
    console.log('Kayıt sunucusu 3001 portunda çalışıyor');
});

// Filtreleme verilerini frontend'e gönderen endpoint
app.get('/filtreleme-verileri', async (req, res) => {
    try {
        // SQL bağlantısını oluştur
        const pool = await sql.connect(yapılandırma);
        
        // Tüm sorguları paralel olarak çalıştır (performans için)
        const [dilResult, turResult, oyuncuResult] = await Promise.all([
            pool.request().query('SELECT DISTINCT dil_adi FROM Diller ORDER BY dil_adi'),
            pool.request().query('SELECT DISTINCT tur_ad FROM Turler ORDER BY tur_ad'),
            pool.request().query('SELECT DISTINCT oyuncu_ad FROM Oyuncular ORDER BY oyuncu_ad')
        ]);

        // Bağlantıyı kapat
        await pool.close();

        // Sonuçları gönder
        res.json({
            success: true,
            languages: dilResult.recordset.map(d => d.dil_adi).filter(Boolean),
            genres: turResult.recordset.map(t => t.tur_ad).filter(Boolean),
            actors: oyuncuResult.recordset.map(o => o.oyuncu_ad).filter(Boolean)
        });

    } catch (err) {
        console.error('Veri çekme hatası:', err);
        res.status(500).json({ 
            success: false,
            message: 'Filtreleme verileri alınamadı.',
            error: process.env.NODE_ENV === 'development' ? err.message : null
        });
    }
});

// filtreleme endpointi
app.post('/filtrele', async (req, res) => {
    const {
        movieName,
        directorName,
        selectedGenres = [],
        selectedActors = [],
        selectedLanguages = [],
        minIMDB,
        maxIMDB
    } = req.body;

    try {
        const pool = await sql.connect(yapılandırma);
        let request = pool.request();

        // Ana sorgu oluşturuluyor
        let query = `
            SELECT DISTINCT v.* 
            FROM veriSeti v
            WHERE 1=1
        `;

        // Film adına göre filtreleme
        if (movieName?.trim()) {
            query += ` AND v.film_adi LIKE @filmAdi`;
            request.input('filmAdi', sql.NVarChar, `%${movieName.trim()}%`);
        }

        // Yönetmene göre filtreleme
        if (directorName?.trim()) {
            query += ` AND v.yonetmen LIKE @yonetmenAdi`;
            request.input('yonetmenAdi', sql.NVarChar, `%${directorName.trim()}%`);
        }

        // IMDB puanına göre filtreleme
        if (minIMDB) {
            query += ` AND v.imdb_puani >= @minIMDB`;
            request.input('minIMDB', sql.Float, minIMDB);
        }
        if (maxIMDB) {
            query += ` AND v.imdb_puani <= @maxIMDB`;
            request.input('maxIMDB', sql.Float, maxIMDB);
        }

        // Türlere göre filtreleme
        if (selectedGenres.length > 0) {
            query += ` AND EXISTS (
                SELECT 1 FROM Turler t 
                WHERE t.film_id = v.film_id 
                AND t.tur_ad IN (${selectedGenres.map((_, i) => `@tur${i}`).join(',')})
            )`;
            selectedGenres.forEach((tur, i) => {
                request.input(`tur${i}`, sql.NVarChar, tur);
            });
        }

        // Oyunculara göre filtreleme
        if (selectedActors.length > 0) {
            query += ` AND EXISTS (
                SELECT 1 FROM Oyuncular o 
                WHERE o.film_id = v.film_id 
                AND o.oyuncu_ad IN (${selectedActors.map((_, i) => `@oyuncu${i}`).join(',')})
            )`;
            selectedActors.forEach((oyuncu, i) => {
                request.input(`oyuncu${i}`, sql.NVarChar, oyuncu);
            });
        }

        // Dillere göre filtreleme
        if (selectedLanguages.length > 0) {
            query += ` AND EXISTS (
                SELECT 1 FROM Diller d 
                WHERE d.film_id = v.film_id 
                AND d.dil_adi IN (${selectedLanguages.map((_, i) => `@dil${i}`).join(',')})
            )`;
            selectedLanguages.forEach((dil, i) => {
                request.input(`dil${i}`, sql.NVarChar, dil);
            });
        }

        const result = await request.query(query);

        res.json({ 
            success: true, 
            filmler: result.recordset,
            count: result.recordset.length
        });

    } catch (error) {
        console.error("Filtreleme hatası:", error);
        res.status(500).json({ 
            success: false, 
            message: "Filtreleme sırasında bir hata oluştu",
            error: process.env.NODE_ENV === 'development' ? error.message : null
        });
    }
});

app.listen(3002, () => {
    console.log('Filtreleme sunucusu 3002 portunda çalışıyor');
});

// Film detay endpointi
app.get('/film-detay/:id', async (req, res) => {
    const filmId = req.params.id;
    console.log(`Alınan Film ID: ${filmId}`);  // Parametreyi konsola yazdırıyoruz.
    
    // Film ID'sinin geçerli olup olmadığını kontrol et
    if (!filmId || isNaN(filmId)) {
        console.log("Geçersiz Film ID'si.");
        return res.status(400).send("Geçersiz film ID'si.");
    }

    try {
        // Veritabanı bağlantısı
        const pool = await sql.connect(yapılandırma);
        console.log("Veritabanına bağlanıldı."); // Bağlantı durumu
        
        // Film detaylarını almak için sorgu
        const result = await pool.request()
    .input('filmId', sql.Int, filmId)
    .query(`
        SELECT 
            film_id,
            film_adi AS ad,  
            yil,
            sure_dk AS sure,
            afis_url,
            tur,
            yonetmen,
            oyuncular,
            imdb_puani,
            dil,
            ulke,
            konu,
            yapim_sirketi
        FROM veriSeti
        WHERE film_id = @filmId
    `);
        // Sorgu sonucunu kontrol et
        console.log("Sorgu Sonucu:", result.recordset);  // Sorgudan dönen sonucu kontrol edelim.
        
        if (result.recordset.length > 0) {
            console.log("Film Detayları Bulundu:", result.recordset[0]);  // Film detaylarını kontrol edelim.
            res.json(result.recordset[0]);  // Film detaylarını JSON formatında dönder
        } else {
            console.log("Film bulunamadı.");  // Film yoksa hata mesajı konsola yazdırılacak.
            res.status(404).send("Film bulunamadı.");
        }
    } catch (err) {
        // Hata durumunda, hata mesajını daha açıklayıcı hale getirelim
        console.error("Veritabanı hatası:", err);  // Hata durumu
        res.status(500).send("Sunucu hatası. Lütfen tekrar deneyin.");
    }
});

// Sunucu Dinlemeye Başlasın
app.listen(3003, () => {
    console.log('Detay API çalışıyor: http://localhost:3003');
}).on('error', (err) => {
    console.error('Sunucu başlatılamadı. Hata:', err);
});

// Değerlendirme API
app.post('/film-degerlendir', async (istek, yanit) => {
    const token = istek.headers.authorization?.split(' ')[1];
    if (!token) {
        return yanit.status(401).json({ mesaj: 'Giriş yapmalısınız.' });
    }

    // Token'ı decode et ve kullanıcı ID'sini al
    const decodedToken = Buffer.from(token, 'base64').toString('ascii');
    const [userIdStr] = decodedToken.split(':');
    const userId = parseInt(userIdStr, 10);

    if (isNaN(userId)) {
        return yanit.status(401).json({ mesaj: 'Geçersiz token.' });
    }

    const { filmId, yorum, senaryoDeger, oyunculukDeger, yonetmenDeger } = istek.body;

    // Gerekli alanların kontrolü
    if (!filmId || !senaryoDeger || !oyunculukDeger || !yonetmenDeger) {
        return yanit.status(400).json({ mesaj: 'Tüm alanlar gereklidir.' });
    }

    // Puanların geçerli olup olmadığını kontrol et (1-5 arasında)
    if ([senaryoDeger, oyunculukDeger, yonetmenDeger].some(puan => puan < 1 || puan > 5)) {
        return yanit.status(400).json({ mesaj: 'Puanlar 1 ile 5 arasında olmalıdır.' });
    }

    try {
        // SQL bağlantısını oluştur
        await sql.connect(yapılandırma);

        // Kullanıcının daha önce bu filme değerlendirme yapıp yapmadığını kontrol et
        const eskiDegerlendirme = await sql.query`
            SELECT * FROM dbo.Degerlendirmeler 
            WHERE film_id = ${filmId} AND user_id = ${userId}
        `;

        if (eskiDegerlendirme.recordset.length > 0) {
            // Kullanıcı daha önce değerlendirme yaptıysa, değerlendirmeyi güncelle
            await sql.query`
                UPDATE dbo.Degerlendirmeler
                SET 
                    senaryo = ${senaryoDeger}, 
                    oyunculuk = ${oyunculukDeger}, 
                    yonetmen = ${yonetmenDeger}, 
                    yorum = ${yorum},
                    degerlendirme_tarihi = GETDATE()  -- Tarihi güncelliyoruz
                WHERE film_id = ${filmId} AND user_id = ${userId}
            `;
        } else {
            // Kullanıcı daha önce değerlendirme yapmamışsa, yeni bir değerlendirme ekle
            await sql.query`
                INSERT INTO dbo.Degerlendirmeler (
                    film_id, 
                    user_id, 
                    senaryo, 
                    oyunculuk, 
                    yonetmen, 
                    yorum,
                    degerlendirme_tarihi  -- Yeni tarih sütununu ekliyoruz
                )
                VALUES (
                    ${filmId}, 
                    ${userId}, 
                    ${senaryoDeger}, 
                    ${oyunculukDeger}, 
                    ${yonetmenDeger}, 
                    ${yorum},
                    GETDATE()  -- Geçerli tarihi ekliyoruz
                )
            `;
        }

        yanit.json({ mesaj: 'Değerlendirme başarıyla kaydedildi.' });
    } catch (hata) {
        console.error('Değerlendirme hatası:', hata);
        yanit.status(500).json({ 
            mesaj: 'Değerlendirme kaydedilirken bir hata oluştu.',
            hata: process.env.NODE_ENV === 'development' ? hata.message : null
        });
    } finally {
        sql.close();
    }
});


// Değerlendirme API için sunucu dinlemeye başlatma
app.listen(3004, () => {
    console.log('Değerlendirme API çalışıyor: http://localhost:3004');
});



// Kullanıcının değerlendirmelerini getiren endpoint
app.get('/kullanici-degerlendirmeleri', authenticateToken, async (req, res) => {
    const userId = req.userId;
    const queryUserId = req.query.userId;

    try {
        await sql.connect(yapılandırma); // Bağlantıyı aç
        const kullanilacakUserId = queryUserId || userId;

        // Kullanıcı adı çekme
        const kullaniciResult = await sql.query`
            SELECT kullanıcı_adı FROM dbo.kullanıcılar WHERE user_id = ${kullanilacakUserId}`;

        if (kullaniciResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                mesaj: 'Kullanıcı bulunamadı'
            });
        }

        const kullaniciAdi = kullaniciResult.recordset[0].kullanıcı_adı;

        // Değerlendirmeler çekme
        const result = await sql.query`
            SELECT d.*, v.film_adi, v.afis_url as poster_url
            FROM dbo.Degerlendirmeler d
            JOIN dbo.veriSeti v ON d.film_id = v.film_id
            WHERE d.user_id = ${kullanilacakUserId}`;

        res.json({
            success: true,
            kullaniciAdi: kullaniciAdi,
            degerlendirmeler: result.recordset
        });

    } catch (err) {
        console.error('Değerlendirmeler getirilirken hata:', err);
        res.status(500).json({
            success: false,
            mesaj: 'Değerlendirmeler getirilirken bir hata oluştu'
        });
    }
});




// Kullanıcı bilgilerini getiren endpoint
app.get('/kullanici-bilgileri', authenticateToken, async (req, res) => {
    try {
        const userId = req.userId;

        // Kullanıcı bilgilerini veritabanından çek
        const pool = await sql.connect(yapılandırma);
        const request = pool.request();
        request.input('userId', sql.Int, userId);

        const result = await request.query(`
            SELECT kullanıcı_adı, email, Kelime
            FROM dbo.kullanıcılar 
            WHERE user_id = @userId
        `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        }

        const kullanici = result.recordset[0];
        res.json({
            kullaniciBilgileri: {
                kullaniciAdi: kullanici.kullanıcı_adı,
                email: kullanici.email,
                kelime: kullanici.Kelime,
            }
        });
    } catch (error) {
        console.error('Kullanıcı bilgileri getirilirken hata:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});


//kullanıcı bilgilerini güncelleme endpointi
app.put('/kullanici-guncelle', authenticateToken, async (req, res) => {
    const userId = req.userId;
    const { kullanıcı_adı, email, şifre, kelime } = req.body;

    try {
        await sql.connect(yapılandırma);
        
        // Email veya kullanıcı adının başka bir kullanıcı tarafından kullanılıp kullanılmadığını kontrol et
        if (email) {
            const emailKontrol = await sql.query`
                SELECT user_id FROM dbo.kullanıcılar 
                WHERE email = ${email} AND user_id != ${userId}
            `;
            if (emailKontrol.recordset.length > 0) {
                return res.status(400).json({ mesaj: 'Bu e-posta adresi başka bir kullanıcı tarafından kullanılıyor.' });
            }
        }

        if (kullanıcı_adı) {
            const kullanıcıAdıKontrol = await sql.query`
                SELECT user_id FROM dbo.kullanıcılar 
                WHERE kullanıcı_adı = ${kullanıcı_adı} AND user_id != ${userId}
            `;
            if (kullanıcıAdıKontrol.recordset.length > 0) {
                return res.status(400).json({ mesaj: 'Bu kullanıcı adı başka bir kullanıcı tarafından kullanılıyor.' });
            }
        }

        // Güncelleme sorgusunu oluştur
        let updateQuery = 'UPDATE dbo.kullanıcılar SET ';
        const params = [];
        
        // Kullanıcı adı, email, kelime ve şifre için güncellenebilecek alanları kontrol et
        if (kullanıcı_adı) {
            params.push(`kullanıcı_adı = @kullanıcı_adı`);
        }
        if (email) {
            params.push(`email = @email`);
        }
        if (kelime) {
            params.push(`kelime = @kelime`);
        }
        if (şifre) {
            const şifreHash = await bcrypt.hash(şifre, 10); // Şifre hash'le
            params.push(`şifre_hash = @şifre_hash`); // Hash'lenmiş şifreyi ekle
        }

        // Güncellenecek alan yoksa hata döndür
        if (params.length === 0) {
            return res.status(400).json({ mesaj: 'Güncellenecek bilgi bulunamadı.' });
        }

        // UPDATE sorgusunu oluştur
        updateQuery += params.join(', ') + ' WHERE user_id = @userId';

        const request = new sql.Request();
        request.input('userId', sql.Int, userId);
        
        if (kullanıcı_adı) request.input('kullanıcı_adı', sql.NVarChar, kullanıcı_adı);
        if (email) request.input('email', sql.NVarChar, email);
        if (kelime) request.input('kelime', sql.NVarChar, kelime);
        if (şifre) request.input('şifre_hash', sql.NVarChar, await bcrypt.hash(şifre, 10)); // Şifreyi hash'le ve sorguya ekle

        await request.query(updateQuery);

        res.json({ mesaj: 'Kullanıcı bilgileri başarıyla güncellendi.' });
    } catch (error) {
        console.error('Kullanıcı güncelleme hatası:', error);
        res.status(500).json({ mesaj: 'Kullanıcı bilgileri güncellenirken bir hata oluştu.' });
    } finally {
    }
});

//şifre sıfırlamak isteyen kullanıcının olup olmadığını kontrol eden endpoint

app.post('/kullanici_kontrol', async (req, res) => {
    const { emailOrUsername, recoveryWord } = req.body;

    console.log('Gelen veri:', { emailOrUsername, recoveryWord });

    try {
        // Kullanıcı adı veya mail ile sorgulama
        const query = `
            SELECT [user_id], [kullanıcı_adı], [email], [Kelime]
            FROM [dbFilms].[dbo].[kullanıcılar]
            WHERE [kullanıcı_adı] = @emailOrUsername OR [email] = @emailOrUsername;
        `;

        // Veritabanına bağlan
        await sql.connect(yapılandırma);

        // Sorguyu çalıştır
        const result = await new sql.Request()
            .input('emailOrUsername', sql.VarChar, emailOrUsername)
            .query(query);

        // Kullanıcıyı bulduk mu kontrol et
        if (result.recordset.length > 0) {
            const kullanici = result.recordset[0];

            // ✅ Eğer recoveryWord gönderildiyse, onu da kontrol et
            if (recoveryWord) {
                const kelimeDB = kullanici.Kelime?.trim().toLowerCase();
                const kelimeGelen = recoveryWord.trim().toLowerCase();

                if (kelimeDB === kelimeGelen) {
                    // ✅ Kelime doğru
                    res.json({ 
                        exists: true, 
                        user: kullanici, 
                        kelimeDogru: true,
                        mesaj: "Kullanıcı bulundu ve kurtarma kelimesi doğru" 
                    });
                } else {
                    // ❌ Kelime yanlış
                    res.json({ 
                        exists: true, 
                        user: kullanici, 
                        kelimeDogru: false,
                        mesaj: "Kullanıcı bulundu ama kurtarma kelimesi hatalı" 
                    });
                }
            } else {
                // 🔄 Sadece kullanıcı kontrolü istenmiş (kelime gönderilmemiş)
                res.json({ exists: true, user: kullanici });
            }

        } else {
            // Kullanıcı bulunamadı
            res.status(404).json({ exists: false, mesaj: "Böyle bir hesap bulunamadı" });
        }
    } catch (error) {
        console.error("Veritabanı hatası:", error);
        res.status(500).json({ mesaj: 'Veritabanı hatası' });
    }
});

// Şifre sıfırlama endpoint
app.post('/sifre_sifirla', async (req, res) => {
    const { emailOrUsername, recoveryWord } = req.body;

    try {
        // Veritabanında recoveryWord'ün doğruluğunu kontrol et
        const query = `
            SELECT [user_id], [kullanıcı_adı], [email], [Kelime]
            FROM [dbFilms].[dbo].[kullanıcılar]
            WHERE [kullanıcı_adı] = @emailOrUsername OR [email] = @emailOrUsername;
        `;

        await sql.connect(yapılandırma);

        const result = await new sql.Request()
            .input('emailOrUsername', sql.VarChar, emailOrUsername)
            .query(query);

        if (result.recordset.length > 0) {
            const kullanici = result.recordset[0];
            const kelimeDB = kullanici.Kelime?.trim().toLowerCase();
            const kelimeGelen = recoveryWord.trim().toLowerCase();

            if (kelimeDB === kelimeGelen) {
                res.json({ success: true, mesaj: "Şifre sıfırlama kelimesi doğru" });
            } else {
                res.json({ success: false, mesaj: "Şifre sıfırlama kelimesi hatalı" });
            }
        } else {
            res.status(404).json({ success: false, mesaj: "Böyle bir hesap bulunamadı" });
        }
    } catch (error) {
        console.error("Veritabanı hatası:", error);
        res.status(500).json({ mesaj: 'Veritabanı hatası' });
    }
});

// Şifre güncelleme endpoint
app.post('/guncelle_sifre', async (req, res) => {
    const { emailOrUsername, newPassword } = req.body;

    try {
        // Şifreyi bcrypt ile hashle
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Şifreyi veritabanında güncelle
        const query = `
            UPDATE [dbFilms].[dbo].[kullanıcılar]
            SET [şifre_hash] = @hashedPassword
            WHERE [kullanıcı_adı] = @emailOrUsername OR [email] = @emailOrUsername;
        `;

        await sql.connect(yapılandırma);

        await new sql.Request()
            .input('emailOrUsername', sql.VarChar, emailOrUsername)
            .input('hashedPassword', sql.VarChar, hashedPassword)
            .query(query);

        res.json({ success: true, mesaj: "Şifre başarıyla güncellendi" });
    } catch (error) {
        console.error("Veritabanı hatası:", error);
        res.status(500).json({ mesaj: 'Şifre güncelleme hatası' });
    }
});

// Sunucuya bağlanıyoruz
app.listen(3005, () => {
    console.log('Kullanıcı kontrol servisi 3005 portunda çalışıyor');
});





// Film kaydetme endpoint'i
app.post('/film-kaydet', authenticateToken, async (req, res) => {
    const { film_id } = req.body;
    const userId = req.userId;

    try {
        await sql.connect(yapılandırma);
        
        // Önce bu film zaten kaydedilmiş mi kontrol et
        const kontrol = await sql.query`
            SELECT * FROM dbo.kaydedilen_filmler 
            WHERE user_id = ${userId} AND film_id = ${film_id}
        `;

        if (kontrol.recordset.length > 0) {
            return res.status(400).json({ mesaj: 'Bu film zaten kaydedilmiş.' });
        }

        // Filmi kaydet
        await sql.query`
            INSERT INTO dbo.kaydedilen_filmler (user_id, film_id)
            VALUES (${userId}, ${film_id})
        `;

        res.json({ mesaj: 'Film başarıyla kaydedildi' });
    } catch (err) {
        console.error('Film kaydetme hatası:', err);
        res.status(500).json({ mesaj: 'Film kaydedilirken bir hata oluştu' });
    } finally {
        sql.close();
    }
});

// Kaydedilen filmleri getirme endpoint'i
app.get('/kaydedilen-filmler', authenticateToken, async (req, res) => {
    const userId = req.userId;

    try {
        await sql.connect(yapılandırma);
        
        const result = await sql.query`
            SELECT f.* 
            FROM dbo.veriSeti f
            INNER JOIN dbo.kaydedilen_filmler k ON f.film_id = k.film_id
            WHERE k.user_id = ${userId}
            ORDER BY k.id DESC
        `;

        res.json(result.recordset);
    } catch (err) {
        console.error('Kaydedilen filmleri getirme hatası:', err);
        res.status(500).json({ mesaj: 'Kaydedilen filmler getirilirken bir hata oluştu' });
    } finally {
        sql.close();
    }
});

// Film kaydını kaldırma endpoint'i
app.delete('/film-kaldir', authenticateToken, async (req, res) => {
    const { film_id } = req.body;
    const userId = req.userId;

    try {
        await sql.connect(yapılandırma);
        
        await sql.query`
            DELETE FROM dbo.kaydedilen_filmler 
            WHERE user_id = ${userId} AND film_id = ${film_id}
        `;

        res.json({ mesaj: 'Film kaydedilenlerden kaldırıldı' });
    } catch (err) {
        console.error('Film kaldırma hatası:', err);
        res.status(500).json({ mesaj: 'Film kaldırılırken bir hata oluştu' });
    } finally {
        sql.close();
    }
});

// Sunucu Dinlemeye Başlasın 
app.listen(3006, () => {
    console.log('kaydedilenlerden kaldır: http://localhost:3006');
});


// Kullanıcıya ait kaydedilen filmleri listeleme endpointi
app.get('/kaydedilen-filmler/:user_id', async (req, res) => {
    const userId = req.params.user_id;
    console.log(`Kullanıcı ID: ${userId}`);

    if (!userId || isNaN(userId)) {
        return res.status(400).send("Geçersiz kullanıcı ID'si.");
    }

    try {
        const pool = await sql.connect(yapılandırma);
        console.log("Veritabanına bağlanıldı.");

        // Kullanıcıya ait kaydedilen filmleri almak için sorgu
        const result = await pool.request()
            .input('user_id', sql.Int, userId)  // user_id parametresi
            .query(`
                SELECT 
                    f.film_id,
                    f.film_adi AS ad,
                    f.yil,
                    f.sure_dk AS sure,
                    f.afis_url,
                    f.tur,
                    f.yonetmen,
                    f.oyuncular,
                    f.imdb_puani,
                    f.dil,
                    f.ulke,
                    f.konu,
                    f.yapim_sirketi
                FROM kaydedilen_filmler kf
                JOIN veriSeti f ON kf.film_id = f.film_id
                WHERE kf.user_id = @user_id
            `);

        if (result.recordset.length > 0) {
            res.json(result.recordset);  // Kaydedilen filmleri döndürüyoruz
        } else {
            res.status(404).send("Hiç kaydedilen film yok.");
        }
    } catch (err) {
        console.error("Veritabanı hatası:", err);
        res.status(500).send("Sunucu hatası. Lütfen tekrar deneyin.");
    }
});



app.listen(3007, () => {
    console.log('kaydedilenler listesi: http://localhost:3007');
});
// Kullanıcıya ait kaydedilen filmleri listeleme endpointi (JWT veya session doğrulama eklenmiş)
app.get('/kaydedilen-filmler', async (req, res) => {
    const userId = req.user_id;  // JWT veya session ile alınan kullanıcı ID'si
    if (!userId) {
        return res.status(401).send("Kullanıcı girişi yapılmamış.");
    }

    try {
        const pool = await sql.connect(yapılandırma);
        console.log("Veritabanına bağlanıldı.");

        // Kullanıcıya ait kaydedilen filmleri almak için sorgu
        const result = await pool.request()
            .input('user_id', sql.Int, userId)
            .query(`
                SELECT 
                    f.film_id,
                    f.film_adi AS ad,
                    f.yil,
                    f.sure_dk AS sure,
                    f.afis_url,
                    f.tur,
                    f.yonetmen,
                    f.oyuncular,
                    f.imdb_puani,
                    f.dil,
                    f.ulke,
                    f.konu,
                    f.yapim_sirketi
                FROM kaydedilen_filmler kf
                JOIN veriSeti f ON kf.film_id = f.film_id
                WHERE kf.user_id = @user_id
            `);

        if (result.recordset.length > 0) {
            res.json(result.recordset);  // Kaydedilen filmleri döndürüyoruz
        } else {
            res.status(404).send("Hiç kaydedilen film yok.");
        }
    } catch (err) {
        console.error("Veritabanı hatası:", err);
        res.status(500).send("Sunucu hatası. Lütfen tekrar deneyin.");
    }
});

// Sunucu Dinlemeye Başlasın 
app.listen(3008, () => {
  //  console.log('Kaydedilenler listesi : http://localhost:3008');
});


// İzlenen filmleri kaydetmek için yeni endpoint
app.post('/film-izlendi', authenticateToken, async (req, res) => {
    const { film_id } = req.body;
    const userId = req.userId;

    try {
        await sql.connect(yapılandırma);
        
        // Önce bu film daha önce izlenmiş mi kontrol et
        const izlenmeKontrol = await sql.query`
            SELECT * FROM dbo.izlenen_filmler 
            WHERE user_id = ${userId} AND film_id = ${film_id}
        `;

        if (izlenmeKontrol.recordset.length > 0) {
            return res.status(400).json({ mesaj: 'Bu film zaten izlenmiş olarak işaretlenmiş.' });
        }

        // Filmi izlendi olarak kaydet
        await sql.query`
            INSERT INTO dbo.izlenen_filmler (user_id, film_id, izleme_tarihi)
            VALUES (${userId}, ${film_id}, GETDATE())
        `;

        res.json({ mesaj: 'Film başarıyla izlendi olarak işaretlendi' });
    } catch (err) {
        console.error('Film izleme kaydı hatası:', err);
        res.status(500).json({ mesaj: 'Film izleme kaydı oluşturulurken bir hata oluştu' });
    } finally {
        sql.close();
    }
});

// İzlenen filmleri getirmek için endpoint
app.get('/izlenen-filmler', authenticateToken, async (req, res) => {
    const userId = req.userId;

    try {
        await sql.connect(yapılandırma);
        
        const result = await sql.query`
            SELECT f.* 
            FROM dbo.veriSeti f
            INNER JOIN dbo.izlenen_filmler iz ON f.film_id = iz.film_id
            WHERE iz.user_id = ${userId}
            ORDER BY iz.izleme_tarihi DESC
        `;

        res.json(result.recordset);
    } catch (err) {
        console.error('İzlenen filmleri getirme hatası:', err);
        res.status(500).json({ mesaj: 'İzlenen filmler getirilirken bir hata oluştu' });
    } finally {
        sql.close();
    }
});


// Sunucu Dinlemeye Başlasın 
app.listen(3009, () => {
  console.log('İzlenenler listesi : http://localhost:3009');
});



// Benzer filmleri getiren endpoint
app.get('/benzer-filmler/:filmId', async (req, res) => {
    let connection;
    try {
        // Yeni bir bağlantı oluştur
        connection = new sql.ConnectionPool(yapılandırma);
        await connection.connect();
        
        // Önce mevcut filmin bilgilerini al
        const filmQuery = await connection.request()
            .input('filmId', sql.Int, req.params.filmId)
            .query(`
                SELECT film_id, film_adi, tur, oyuncular, yonetmen, dil, konu
                FROM veriSeti 
                WHERE film_id = @filmId
            `);

        if (filmQuery.recordset.length === 0) {
            return res.status(404).json({ mesaj: 'Film bulunamadı' });
        }

        const film = filmQuery.recordset[0];

        // Benzer filmleri getir
        const benzerFilmlerQuery = await connection.request()
            .input('filmId', sql.Int, req.params.filmId)
            .input('filmTur', sql.NVarChar, '%' + film.tur + '%')
            .input('filmOyuncu', sql.NVarChar, '%' + film.oyuncular.split(',')[0] + '%')
            .input('filmYonetmen', sql.NVarChar, film.yonetmen)
            .input('filmDil', sql.NVarChar, film.dil)
            .query(`
                SELECT TOP 7 
                    f.film_id,
                    f.film_adi,
                    f.afis_url,
                    f.imdb_puani,
                    f.yil,
                    f.tur,
                    f.oyuncular,
                    f.yonetmen,
                    f.dil,
                    f.konu
                FROM veriSeti f
                WHERE f.film_id != @filmId
                AND (
                    f.tur LIKE @filmTur
                    OR f.oyuncular LIKE @filmOyuncu
                    OR f.yonetmen = @filmYonetmen
                    OR f.dil = @filmDil
                )
                ORDER BY 
                    CASE 
                        WHEN f.tur LIKE @filmTur THEN 3
                        WHEN f.oyuncular LIKE @filmOyuncu THEN 2
                        WHEN f.yonetmen = @filmYonetmen THEN 2
                        WHEN f.dil = @filmDil THEN 1
                        ELSE 0
                    END DESC,
                    f.imdb_puani DESC
            `);

        res.json(benzerFilmlerQuery.recordset);

    } catch (err) {
        console.error('Benzer filmler getirme hatası:', err);
        res.status(500).json({ 
            mesaj: 'Benzer filmler getirilirken bir hata oluştu',
            hata: process.env.NODE_ENV === 'development' ? err.message : null
        });
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (err) {
                console.error('Bağlantı kapatma hatası:', err);
            }
        }
    }
});

// Sunucu Dinlemeye Başlasın 
app.listen(3010, () => {
  console.log('Benzer Filmler : http://localhost:3010');
});

app.get('/filtreli-oneriler', async (req, res) => {
    const { tur, zaman, filtre } = req.query;
    let connection;

    try {
        connection = await ensureConnection();
        const request = connection.request();

        let tarihSiniri = null;
        const kosullar = [];

        if (zaman) {
            tarihSiniri = new Date();
            if (zaman === '1week') tarihSiniri.setDate(tarihSiniri.getDate() - 7);
            else if (zaman === '1month') tarihSiniri.setMonth(tarihSiniri.getMonth() - 1);
            else if (zaman === '3months') tarihSiniri.setMonth(tarihSiniri.getMonth() - 3);
            else if (zaman === '6months') tarihSiniri.setMonth(tarihSiniri.getMonth() - 6);
            else if (zaman === '1year') tarihSiniri.setFullYear(tarihSiniri.getFullYear() - 1);

            request.input('tarihSiniri', sql.DateTime, tarihSiniri);
        }

        if (tur) {
            request.input('tur', sql.NVarChar, `%${tur}%`);
        }

        let query = '';
        if (filtre === 'begeni_cok' || filtre === 'begeni_az') {
            if (tarihSiniri) kosullar.push("d.degerlendirme_tarihi >= @tarihSiniri");
            if (tur) kosullar.push("v.tur LIKE @tur");

            query = `
                SELECT TOP 5 v.*, 
                       AVG(CAST((d.senaryo + d.oyunculuk + d.yonetmen)/3.0 AS FLOAT)) AS ortalama
                FROM Degerlendirmeler d
                INNER JOIN veriSeti v ON CAST(v.film_id AS NVARCHAR) = CAST(d.film_id AS NVARCHAR)
                ${kosullar.length > 0 ? "WHERE " + kosullar.join(" AND ") : ""}
                GROUP BY v.film_id, v.film_adi, v.tur, v.imdb_puani, v.yonetmen, v.dil, v.sure_dk, v.yil, v.afis_url,
                         v.oyuncular, v.ulke, v.konu, v.yapim_sirketi
                ORDER BY ortalama ${filtre === 'begeni_cok' ? 'DESC' : 'ASC'}
            `;
        } else if (filtre === 'degerlendirme_cok') {
            if (tarihSiniri) kosullar.push("d.degerlendirme_tarihi >= @tarihSiniri");
            if (tur) kosullar.push("v.tur LIKE @tur");

            query = `
                SELECT TOP 5 v.*, 
                       COUNT(d.degerlendirme_id) AS sayi
                FROM Degerlendirmeler d
                INNER JOIN veriSeti v ON CAST(v.film_id AS NVARCHAR) = CAST(d.film_id AS NVARCHAR)
                ${kosullar.length > 0 ? "WHERE " + kosullar.join(" AND ") : ""}
                GROUP BY v.film_id, v.film_adi, v.tur, v.imdb_puani, v.yonetmen, v.dil, v.sure_dk, v.yil, v.afis_url,
                         v.oyuncular, v.ulke, v.konu, v.yapim_sirketi
                ORDER BY sayi DESC
            `;
        } else if (filtre === 'izlenme_cok') {
            if (tarihSiniri) kosullar.push("i.izleme_tarihi >= @tarihSiniri");
            if (tur) kosullar.push("v.tur LIKE @tur");

            query = `
                SELECT TOP 5 v.*, 
                       COUNT(i.id) AS sayi
                FROM izlenen_filmler i
                INNER JOIN veriSeti v ON CAST(v.film_id AS NVARCHAR) = CAST(i.film_id AS NVARCHAR)
                ${kosullar.length > 0 ? "WHERE " + kosullar.join(" AND ") : ""}
                GROUP BY v.film_id, v.film_adi, v.tur, v.imdb_puani, v.yonetmen, v.dil, v.sure_dk, v.yil, v.afis_url,
                         v.oyuncular, v.ulke, v.konu, v.yapim_sirketi
                ORDER BY sayi DESC
            `;
        } else {
            return res.status(400).json({ success: false, mesaj: 'Geçersiz filtre parametresi' });
        }

        const result = await request.query(query);
        res.json({ success: true, filmler: result.recordset });

    } catch (err) {
        console.error('Filtreli öneriler hatası:', err);
        res.status(500).json({ success: false, mesaj: 'Sunucu hatası' });
    } finally {
        if (connection) await connection.close().catch(console.error);
    }
});

app.listen(3011, () => {
    console.log('Filtreli öneriler API: http://localhost:3011');
});



app.get('/onerilen-filmler', authenticateToken, async (req, res) => {
    const userId = req.userId;

    try {
        // Flask servisine istek yaparken hata yönetimini geliştir
        const flaskUrl = `http://localhost:5000/onerilen-filmler?kullanici_id=${userId}`;
        const response = await axios.get(flaskUrl, {
            timeout: 5000, // 5 saniye timeout
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.data) {
            throw new Error('Flask servisinden veri alınamadı');
        }

        res.json(response.data);
    } catch (error) {
        console.error('Flask servisi hatası:', error.message);
        
        // Flask servisi çalışmıyorsa varsayılan önerileri döndür
        try {
            const pool = await sql.connect(yapılandırma);
            const result = await pool.request()
                .input('userId', sql.Int, userId)
                .query(`
                    SELECT TOP 5 v.*
                    FROM veriSeti v
                    WHERE v.film_id NOT IN (
                        SELECT film_id FROM Degerlendirmeler WHERE user_id = @userId
                    )
                    ORDER BY v.imdb_puani DESC
                `);
            
            res.json({ 
                success: true, 
                filmler: result.recordset,
                mesaj: 'Flask servisi geçici olarak kullanılamıyor. Varsayılan öneriler gösteriliyor.'
            });
        } catch (sqlError) {
            console.error('Veritabanı hatası:', sqlError);
            res.status(500).json({ 
                success: false, 
                mesaj: 'Öneriler getirilirken bir hata oluştu. Lütfen daha sonra tekrar deneyin.' 
            });
        }
    }
});

// Server'ı başlat
app.listen(3012, () => {
    console.log(`🎬 Kullanıcı öneri servisi 3012 portunda çalışıyor.`);
});