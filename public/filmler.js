document.addEventListener('DOMContentLoaded', function() { 
    // Sayfa tamamen yüklendiğinde çalışacak kod
    fetch('http://localhost:3000/veriSeti')  // Sunucudaki API endpoint'ine istek gönderiyoruz
        .then(response => response.json())  // JSON formatında yanıtı alıyoruz
        .then(filmler => {
            const filmListesiDiv = document.querySelector('.film-listesi'); // film listesi div'ini seçiyoruz

            // Filmler üzerinde dönerek HTML içerikleri oluşturuyoruz
            filmler.forEach(film => {
                const filmDiv = document.createElement('div'); // Yeni bir film div'i oluşturuyoruz
                filmDiv.classList.add('film'); // Film div'ine sınıf ekliyoruz

                filmDiv.innerHTML = `
                    <h3>${film.film_adi}</h3>
                    <p><strong>Yapım Yılı:</strong> ${film.yil}</p>
                    <p><strong>Tür:</strong> ${film.tur}</p>
                    <p><strong>Yönetmen:</strong> ${film.yonetmen}</p>
                    <p><strong>Oyuncular:</strong> ${film.oyuncular}</p>
                    <p><strong>IMDb Puanı:</strong> ${film.imdb_puani}</p>
                    <p><strong>Süre:</strong> ${film.sure_dk} dakika</p>
                    <p><strong>Dil:</strong> ${film.dil}</p>
                    <p><strong>Ülke:</strong> ${film.ulke}</p>
                    <p><strong>Konu:</strong> ${film.konu}</p>
                    <p><strong>Yapım Şirketi:</strong> ${film.yapim_sirketi}</p>
                `;

                // Yeni oluşturduğumuz film div'ini film listesine ekliyoruz
                filmListesiDiv.appendChild(filmDiv);
            });
        })
        .catch(err => {
            console.error('Veri çekme hatası:', err);
        });
});
