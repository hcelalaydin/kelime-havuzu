# İnternette yayımlama

## Gereken ortam

Sürekli çalışan Node.js 22/24, WebSocket desteği, HTTPS ve kalıcı disk. Tek süreç ve tek replika kullanın. Oyun verisi dış veritabanı yerine `STATE_DIR/rooms.json` dosyasına atomik olarak kaydedilir. Disk kullanıcıya yazılabilir olmalı; dizin Git'e/halka açık dosya servisine eklenmemeli.

## Render

1. GitHub deposunu Render hesabına bağlayın. Blueprint olarak `render.yaml` dosyasını seçin.
2. Şablon bir **ücretli 0.5 CPU / 512 MB web service ve 1 GB kalıcı disk** tanımlar. Sağlayıcının gösterdiği güncel maliyeti onaylamadan hizmeti oluşturmayın. Ücretsiz/geçici dosya sistemi kalıcılık sağlamaz.
3. Yayımlanacak branch'i seçin. Otomatik deploy kapalıdır; oyun oynanırken plansız güncelleme olmaz.
4. Başlangıç: `npm start`; derleme: `npm ci --omit=dev --ignore-scripts`; sağlık yolu: `/healthz`.
5. Özel alan adınız varsa `APP_ORIGIN=https://alan-adiniz` ekleyin (sonunda `/` yok). Birden fazla kabul edilen alan adı virgülle ayrılır. Ayar yoksa isteğin Origin alanı Host ile eşleştirilir.
6. HTTPS adresini iki ayrı cihazda açın, oda oluşturup katılmayı, kelime görünürlüğünü ve bağlantı dönüşünü deneyin.
7. Bir deneme oyunu açıkken kontrollü restart yapın. Aynı sekmelerin odaya dönmesini ve yöneticinin oyunu devam ettirebilmesini kontrol edin.

Referanslar: [Render WebSockets](https://render.com/docs/websocket), [kalıcı disk](https://render.com/docs/disks). Yapılandırma hazırlanmıştır; bu çalışma sırasında ücretli hizmet oluşturulmamış veya canlı alan adı yayımlanmamıştır.

## Docker / kendi sunucun

```sh
docker compose up --build -d
```

Compose servisi yalnızca `127.0.0.1:3000` üzerinde açar. İnternete açmak için önüne HTTPS ve WebSocket yükseltmesini destekleyen Caddy/Nginx koyun. `APP_ORIGIN` değerini alan adınıza ayarlayın. Named volume oyun kayıtlarını korur. `docker compose down -v` kayıtları siler; normal güncellemede `-v` kullanmayın.

Bir ters vekil varsa `TRUST_PROXY_HOPS=1`; doğrudan erişimde `0`. Bu ayar yalnızca gerçekten güvenilir vekil sayısına göre değiştirilmelidir. Aksi halde IP hız sınırı yanlış uygulanabilir. Uygulama soket başına ve ağ adresi başına limit uygular; bir ağdan 128 eşzamanlı bağlantı desteklenir.

## Güncelleme ve işletim

- Daima `npm ci`, `npm run lint`, `npm test`, `npm run test:e2e` çalıştırın; lockfile'ı koruyun.
- Oyunculara haber verip güncellemeyi oyun aralarında yapın. SIGTERM aktif oyunu durdurup diske yazar; ani kesintide en son saniyelik kayıt geri yüklenir.
- `/healthz` kayıt hizmeti çalışmıyorsa 503 döner; oyunlar durur. Disk doluluğunu ve dosya izinlerini düzeltin, sonra yönetici devam ettirsin.
- `state/` dizininin özel yedeğini alın; oyuncu kelimelerini ve oturum anahtarlarının özetlerini içerir. Anahtarların kendisi diske kaydedilmez.
- Kullanılmayan odalar son işlemden altı saat sonra kapanır. Bağlantısı kesilen oyuncu iki dakika sonra çıkarılır. Bütün oyuncular ayrılınca oda silinir.
- Bu sürümde hesap/parola, merkezi skor tablosu, izleyici modu, oyun ortasında yeni katılım veya çok sunuculu ölçekleme yoktur.
- Beklenmedik sunucu hataları loglanır; komut içeriği, kelimeler ve oturum anahtarları loglanmaz.
- Gerçek dağıtım sağlayıcısında TLS, proxy ve disk smoke testi ayrıca yapılmalıdır; yerel tarayıcı testi bunları doğrulamaz.
