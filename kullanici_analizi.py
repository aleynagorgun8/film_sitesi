from flask import Flask, request, jsonify
import pandas as pd
from sqlalchemy import create_engine

app = Flask(__name__)

# Veritabanı bağlantısı
sunucu = 'localhost'
veritabani = 'dbFilms'
kullanici_adi = 'sa'
sifre = '141592'
driver = 'ODBC Driver 18 for SQL Server'

baglanti_dizesi = f"mssql+pyodbc://{kullanici_adi}:{sifre}@{sunucu}/{veritabani}?driver={driver}&TrustServerCertificate=yes"
engine = create_engine(baglanti_dizesi)

# Tür tercihlerini analiz et
def tur_tercihlerini_analiz_et(kullanici_id):
    sorgu = f'''
    SELECT d.film_id,
           (CAST(d.senaryo AS FLOAT) + CAST(d.oyunculuk AS FLOAT) + CAST(d.yonetmen AS FLOAT)) / 3.0 AS ortalama_puan,
           t.tur_ad
    FROM Degerlendirmeler d
    JOIN Turler t ON d.film_id = t.film_id
    WHERE d.user_id = {kullanici_id}
    '''
    df = pd.read_sql(sorgu, engine)
    tur_puanlari = df.groupby('tur_ad')['ortalama_puan'].mean().sort_values(ascending=False)
    return tur_puanlari

# Öneri yapan fonksiyon
def film_oner(tur_puanlari, kullanici_id, top_n=5):
    # Kullanıcının değerlendirme sayısını kontrol et
    degerlendirme_sayisi = pd.read_sql(f'''
        SELECT COUNT(*) as sayi 
        FROM Degerlendirmeler 
        WHERE user_id = {kullanici_id}
    ''', engine).iloc[0]['sayi']

    # Eğer yeterli değerlendirme yoksa, IMDB puanına göre öner
    if degerlendirme_sayisi < 3:
        sorgu = f'''
        SELECT TOP {top_n} v.*
        FROM veriSeti v
        WHERE v.film_id NOT IN (
            SELECT film_id FROM Degerlendirmeler WHERE user_id = {kullanici_id}
        )
        ORDER BY v.imdb_puani DESC
        '''
        return pd.read_sql(sorgu, engine)

    # Kullanıcının tercih ettiği türleri belirle
    tercih_edilen_turler = tur_puanlari[tur_puanlari >= 3.0].index.tolist()
    
    # Eğer tercih edilen tür yoksa, en yüksek puanlı türü al
    if not tercih_edilen_turler:
        tercih_edilen_turler = [tur_puanlari.index[0]] if not tur_puanlari.empty else []

    if not tercih_edilen_turler:
        # Hiç değerlendirme yoksa, en popüler filmleri öner
        sorgu = f'''
        SELECT TOP {top_n} v.*
        FROM veriSeti v
        WHERE v.film_id NOT IN (
            SELECT film_id FROM Degerlendirmeler WHERE user_id = {kullanici_id}
        )
        ORDER BY v.imdb_puani DESC
        '''
        return pd.read_sql(sorgu, engine)

    # Tercih edilen türlere göre film öner
    tur_listesi = "', '".join(tercih_edilen_turler)
    sorgu = f'''
    SELECT DISTINCT TOP {top_n} v.*
    FROM veriSeti v
    JOIN Turler t ON v.film_id = t.film_id
    WHERE t.tur_ad IN ('{tur_listesi}')
      AND v.film_id NOT IN (
          SELECT film_id FROM Degerlendirmeler WHERE user_id = {kullanici_id}
      )
    ORDER BY v.imdb_puani DESC
    '''
    df = pd.read_sql(sorgu, engine)
    
    # Eğer yeterli film bulunamazsa, IMDB puanına göre ek filmler ekle
    if len(df) < top_n:
        ek_film_sayisi = top_n - len(df)
        ek_sorgu = f'''
        SELECT TOP {ek_film_sayisi} v.*
        FROM veriSeti v
        WHERE v.film_id NOT IN (
            SELECT film_id FROM Degerlendirmeler WHERE user_id = {kullanici_id}
        )
        AND v.film_id NOT IN ({','.join(map(str, df['film_id'].tolist())) if not df.empty else '0'})
        ORDER BY v.imdb_puani DESC
        '''
        ek_df = pd.read_sql(ek_sorgu, engine)
        df = pd.concat([df, ek_df])
    
    return df

# API endpointi
@app.route("/onerilen-filmler", methods=["GET"])
def onerilen_filmler():
    kullanici_id = request.args.get("kullanici_id", type=int)
    if kullanici_id is None:
        return jsonify({"hata": "kullanici_id parametresi gerekli"}), 400

    try:
        tur_puanlari = tur_tercihlerini_analiz_et(kullanici_id)
        onerilen_df = film_oner(tur_puanlari, kullanici_id)

        if isinstance(onerilen_df, pd.DataFrame) and not onerilen_df.empty:
            return jsonify({
                "success": True,
                "filmler": onerilen_df.to_dict(orient="records")
            })
        else:
            return jsonify({
                "success": False,
                "mesaj": "Şu an için öneri yapılamıyor. Lütfen daha fazla film değerlendirin."
            })
    except Exception as e:
        return jsonify({
            "success": False,
            "mesaj": f"Öneri oluşturulurken bir hata oluştu: {str(e)}"
        }), 500

# Sunucuyu başlat
if __name__ == "__main__":
    app.run(debug=True, port=5000)
