from sqlalchemy import create_engine
import pandas as pd
import os

# SQL Server bağlantı bilgileri
server = 'localhost'  # Örneğin: 'localhost' ya da IP adresi
database = 'dbFilms'  # Bağlanmak istediğin veritabanı
username = 'sa'  # SQL Server kullanıcı adı
password = '141592'  # SQL Server şifresi

# SQLAlchemy bağlantı dizesini oluştur
connection_string = f"mssql+pyodbc://{username}:{password}@{server}/{database}?driver=ODBC+Driver+18+for+SQL+Server&TrustServerCertificate=yes"

# SQLAlchemy engine oluştur
engine = create_engine(connection_string)

# SQL sorgusunu çalıştır ve Pandas DataFrame'e aktar
query = 'SELECT * FROM veriSeti'  # Burada 'veriSeti' tablonu kullanıyoruz
df = pd.read_sql(query, engine)

# DataFrame'i yazdır
print(df.head())  # İlk 5 satırı yazdır

# En çok beğenilen filmleri sorgulama
query = '''
SELECT f.film_adi, AVG(d.senaryo + d.oyunculuk + d.yonetmen) / 3 AS ortalama_yildiz
FROM dbo.veriSeti f
JOIN dbo.Degerlendirmeler d ON f.film_id = d.film_id
GROUP BY f.film_adi
ORDER BY ortalama_yildiz DESC
'''
df_beğenilenler = pd.read_sql(query, engine)
print("En Çok Beğenilen Filmler:")
print(df_beğenilenler)

# En az beğenilen filmleri sorgulama
query = '''
SELECT f.film_adi, AVG(d.senaryo + d.oyunculuk + d.yonetmen) / 3 AS ortalama_yildiz
FROM dbo.veriSeti f
JOIN dbo.Degerlendirmeler d ON f.film_id = d.film_id
GROUP BY f.film_adi
ORDER BY ortalama_yildiz ASC
'''
df_az_begendikler = pd.read_sql(query, engine)
print("\nEn Az Beğenilen Filmler:")
print(df_az_begendikler)

# En çok değerlendirilen filmleri sorgulama
query = '''
SELECT f.film_adi, COUNT(d.degerlendirme_id) AS degerlendirme_sayisi
FROM dbo.veriSeti f
JOIN dbo.Degerlendirmeler d ON f.film_id = d.film_id
GROUP BY f.film_adi
ORDER BY degerlendirme_sayisi DESC
'''
df_en_cok_degerlendiril = pd.read_sql(query, engine)
print("\nEn Çok Değerlendirilen Filmler:")
print(df_en_cok_degerlendiril)

# En çok izlenen filmleri sorgulama
query = '''
SELECT f.film_adi, COUNT(i.id) AS izlenme_sayisi
FROM dbo.veriSeti f
JOIN dbo.izlenen_filmler i ON f.film_id = i.film_id
GROUP BY f.film_adi
ORDER BY izlenme_sayisi DESC
'''
df_en_cok_izlenenler = pd.read_sql(query, engine)
print("\nEn Çok İzlenen Filmler:")
print(df_en_cok_izlenenler)




# 'veriler' klasörünü oluştur
os.makedirs("veriler", exist_ok=True)

# JSON dosyalarına kaydet
df_beğenilenler.to_json("veriler/en_cok_begenilenler.json", orient="records", force_ascii=False)
df_az_begendikler.to_json("veriler/en_az_begenilenler.json", orient="records", force_ascii=False)
df_en_cok_degerlendiril.to_json("veriler/en_cok_degerlendirilenler.json", orient="records", force_ascii=False)
df_en_cok_izlenenler.to_json("veriler/en_cok_izlenenler.json", orient="records", force_ascii=False)

