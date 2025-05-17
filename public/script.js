// Arrow butonları ve film listeleri
const arrows = document.querySelectorAll(".arrow");
const movieLists = document.querySelectorAll(".movie-list");

// Arama çubuğu için gerekli öğeler
const searchIcon = document.getElementById('search-icon');
const searchInput = document.getElementById('search-input');

// Büyüteç simgesine tıklandığında arama çubuğunu göster
searchIcon.addEventListener('click', function() {
    // Arama çubuğunun görünürlüğünü kontrol et
    if (searchInput.style.display === 'none' || searchInput.style.display === '') {
        searchInput.style.display = 'block'; // Arama çubuğunu göster
    } else {
        searchInput.style.display = 'none'; // Arama çubuğunu gizle
    }
});

// Kullanıcı Enter tuşuna bastığında arama işlemini yap
searchInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
        // Arama sorgusunu al
        const query = searchInput.value;
        console.log("Arama yapılıyor:", query);
        
        // Burada arama işlemi yapılabilir
        // Örneğin, sayfa üzerinde arama yapmak veya veritabanı sorgusu yapmak
    }
});

// Arrows ile movie-list'leri kaydırma işlemi
arrows.forEach((arrow, i) => {
    let clickCounter = 0;
    const imageItemCount = movieLists[i].querySelectorAll("img").length;

    arrow.addEventListener("click", function() {
        clickCounter++;

        // Eğer daha fazla resim varsa kaydırmaya devam et
        if (imageItemCount - (6 + clickCounter) >= 0) {
            // Mevcut kaydırma değerini al ve 300px kaydır
            const currentTransform = movieLists[i].style.transform || 'translateX(0)';
            const currentX = parseInt(currentTransform.split('(')[1].split('px')[0]);

            movieLists[i].style.transform = `translateX(${currentX - 300}px)`;
        } else {
            // Kaydırma yapmayacaksa başlangıç pozisyonuna dön
            movieLists[i].style.transform = "translateX(0)";
            clickCounter = 0; // Tıklama sayacını sıfırla
        }
    });
});

// Film verilerini çekme ve listeleme işlemi
async function fetchFilms() {
    try {
        const response = await fetch("http://localhost:3000/veriSeti");  // Backend'den veri çekme
        const films = await response.json();  // JSON formatında yanıtı alıyoruz

        const filmList = document.getElementById('film-list');
        filmList.innerHTML = '';  // Önceden yüklenen filmleri temizle

        films.forEach(film => {
            const filmCard = document.createElement('div');
            filmCard.classList.add('film-card');
            
            // Film ismini ekle
            const filmTitle = document.createElement('h3');
            filmTitle.textContent = film.film_adi;
            filmCard.appendChild(filmTitle);

            // Film kartını filme ekle
            filmList.appendChild(filmCard);
        });
    } catch (err) {
        console.error("Film verileri alınırken hata oluştu:", err);
    }
}

// Sayfa yüklendiğinde filmleri çek
window.onload = fetchFilms;
