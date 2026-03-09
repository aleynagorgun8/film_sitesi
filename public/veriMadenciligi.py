# icerik_tabanli_ve_film_listesi.py

from sqlalchemy import create_engine
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# Veritabanı bilgileri
sunucu = 'localhost'
veritabani = 'dbFilms'
kullanici_adi = 'sa'
sifre = '141592'
baglanti_dizesi = f"mssql+pyodbc://{kullanici_adi}:{sifre}@{sunucu}/{veritabani}?driver=ODBC+Driver+18+for+SQL+Server&TrustServerCertificate=yes"
engine = create_engine(baglanti_dizesi)

# Film verilerini al
def film_listesi_al():
    sorgu = 'SELECT film_id, film_adi, tur, oyuncular, yonetmen, dil FROM dbo.veriSeti'
    df_filmler = pd.read_sql(sorgu, engine)
    df_filmler = df_filmler.fillna('')
    df_filmler["icerik"] = df_filmler["tur"] + " " + df_filmler["oyuncular"] + " " + df_filmler["yonetmen"] + " " + df_filmler["dil"]
    return df_filmler

# İçerik tabanlı benzerlik hesaplama
def benzerlik_hesapla(df_filmler):
    tfidf = TfidfVectorizer(stop_words='english')
    tfidf_matrisi = tfidf.fit_transform(df_filmler["icerik"])
    return cosine_similarity(tfidf_matrisi, tfidf_matrisi)

# Benzer filmleri döner
def benzer_filmleri_getir(df_filmler, benzerlik_matrisi, film_index, top_n=5):
    benzerlik_skorlari = list(enumerate(benzerlik_matrisi[film_index]))
    benzer_filmler = sorted(benzerlik_skorlari, key=lambda x: x[1], reverse=True)[1:top_n+1]
    return [(df_filmler.iloc[i]['film_adi'], skor) for i, skor in benzer_filmler]

# Test
if __name__ == "__main__":
    df = film_listesi_al()
    matris = benzerlik_hesapla(df)
    print("\nBenzer Filmler:")
    for film_adi, skor in benzer_filmleri_getir(df, matris, 50):
        print(f"- {film_adi} ({skor:.2f})")
