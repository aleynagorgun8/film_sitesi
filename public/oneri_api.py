from flask import Flask, request, jsonify
from sqlalchemy import create_engine
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

app = Flask(__name__)

# SQL Server bağlantı bilgileri
sunucu = 'localhost'
veritabani = 'dbFilms'
kullanici_adi = 'sa'
sifre = '141592'
baglanti_dizesi = f"mssql+pyodbc://{kullanici_adi}:{sifre}@{sunucu}/{veritabani}?driver=ODBC+Driver+18+for+SQL+Server&TrustServerCertificate=yes"
engine = create_engine(baglanti_dizesi)

# Film verilerini bir kez çek ve modelle (istek başına tekrar yapmaya gerek yok)
sorgu = 'SELECT film_id, film_adi, tur, oyuncular, yonetmen, dil FROM dbo.veriSeti'
df_filmler = pd.read_sql(sorgu, engine)
df_filmler = df_filmler.fillna('')
df_filmler["icerik"] = (df_filmler["tur"] + " " + 
                        df_filmler["oyuncular"] + " " +
                        df_filmler["yonetmen"] + " " + 
                        df_filmler["dil"]).str.lower()

# TF-IDF modeli oluştur
tfidf = TfidfVectorizer(stop_words='english')
tfidf_matrisi = tfidf.fit_transform(df_filmler["icerik"])
benzerlik_matrisi = cosine_similarity(tfidf_matrisi, tfidf_matrisi)

@app.route('/oner', methods=['GET'])
def oner():
    film_adi = request.args.get('film_adi')
    if not film_adi:
        return jsonify({'hata': 'film_adi parametresi eksik'}), 400

    # Filmin indexini bul
    try:
        film_index = df_filmler[df_filmler["film_adi"].str.lower() == film_adi.lower()].index[0]
    except IndexError:
        return jsonify({'hata': 'Film bulunamadı'}), 404

    # Benzer filmleri bul
    benzerlik_skorlari = list(enumerate(benzerlik_matrisi[film_index]))
    benzer_filmler = sorted(benzerlik_skorlari, key=lambda x: x[1], reverse=True)[1:6]

    print(f"\nSeçilen Film: {df_filmler.iloc[film_index]['film_adi']}")
    print("Benzer Filmler:")
    oneri_listesi = []
    for i, skor in benzer_filmler:
        film_adi_benzer = df_filmler.iloc[i]['film_adi']
        print(f"{film_adi_benzer} (Benzerlik: {skor:.2f})")
        oneri_listesi.append({
            'film_adi': film_adi_benzer,
            'benzerlik': round(skor, 2)
        })

    return jsonify({
        'secilen_film': df_filmler.iloc[film_index]['film_adi'],
        'oneriler': oneri_listesi
    })

if __name__ == '__main__':
    app.run(debug=True)
