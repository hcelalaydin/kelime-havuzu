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

## Ubuntu + systemd kurulumu

`ops/kelime-havuzu.service`, ayrı ve giriş yapamayan `kelime-havuzu` kullanıcısıyla çalışır. Node.js 24'ün resmi Linux arşivi SHA-256 doğrulamasıyla `/opt` altına kurulur; `/opt/kelime-havuzu/node` bu kurulumun bağlantısıdır. Sürümler `/opt/kelime-havuzu/releases/<commit>` altında tutulur; `current` çalıştırılan sürüme bağlanır. Kod ve bağımlılıklar root'a aittir, servis bunları değiştiremez.

- Servis dosyası: `/etc/systemd/system/kelime-havuzu.service`
- Ortam dosyası: `/etc/kelime-havuzu/environment` (root, 600; örnek `ops/environment.example`)
- Kalıcı kayıt: `/var/lib/kelime-havuzu` (servis kullanıcısı, 700; snapshot 600)
- Nginx başlangıç yapılandırması: `ops/nginx.conf`; sertifika kurulduktan sonra Certbot HTTPS yapılandırmasını ekler.
- Nginx, istemcinin gönderdiği forwarded IP'yi kendi gördüğü adresle değiştirir. Uygulama `TRUST_PROXY_HOPS=1` kullanır. UFW'de 3000 açılmaz; sadece Nginx'in 80/443 portları kullanılır.

İlk kurulumdan sonra:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now kelime-havuzu
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d kelimehavuzu.pqcrypt.xyz --non-interactive --agree-tos --redirect
```

Sertifika komutundan önce alan adının A kaydı sunucuya yönlenmiş olmalıdır. HTTPS açıldıktan sonra ortam dosyasındaki `APP_ORIGIN` yalnızca `https://kelimehavuzu.pqcrypt.xyz` olarak daraltılır ve servis yeniden başlatılır. Certbot'un yenileme zamanlayıcısını ve `certbot renew --dry-run` sonucunu kontrol edin.

İşletim komutları:

```sh
sudo systemctl status kelime-havuzu
sudo journalctl -u kelime-havuzu -n 100 --no-pager
sudo systemctl restart kelime-havuzu
curl -f https://kelimehavuzu.pqcrypt.xyz/healthz
```

Güncellemede yeni commit ayrı sürüm dizinine açılır ve `npm ci --omit=dev --ignore-scripts` çalıştırılır. `current` bağlantısı atomik olarak yeni sürüme çevrilir, servis yeniden başlatılır ve sağlık kontrolü yapılır. Sorun varsa önceki sürüme geri dönülür; kalıcı kayıt dizinine dokunulmaz. Yedekleri web kökü dışında, yalnızca yönetici erişebilecek izinlerle tutun.

### Doğrulanan canlı kurulum — 11 Ekim 2026

Adres: **https://kelimehavuzu.pqcrypt.xyz**. Sunucuda Node.js **24.21.0**, Nginx ve `kelime-havuzu.service` kullanılıyor. Uygulama sürümü `f2f4f6d`; sonrasındaki işletim dosyası değişiklikleri oyun kodunu değiştirmez. Servis açılışta etkin, kayıt izinleri 700/600, yalnızca HTTPS alan adı Origin olarak kabul ediliyor.

Canlı doğrulama: sağlık kontrolü, tarayıcı açılışı ve bütün portrelerin yüklenmesi, dört oyuncuyla bağlantı ve kelime görünürlüğü, Nginx üzerinden WebSocket ve polling, kontrollü systemd restart sonrasında aynı oturumların 20 kelimelik havuza ve duraklatılmış oyuna dönüşü. TLS sertifikası doğrulandı; HTTP, HTTPS'e yönleniyor. `certbot.timer` etkin ve bu alan adı için `certbot renew --dry-run` başarılı. Sunucunun tamamı yeniden başlatılmadı; otomatik açılış systemd enablement üzerinden doğrulandı.

DNS yayılımı sırasında kullanıcı isteğiyle `http://202.92.21.56` (port 80) erişimi de açıldı. Ayrı `/etc/nginx/sites-available/kelime-havuzu-ip` yapılandırması aynı uygulamaya vekillik yapar; ortam dosyasında bu HTTP Origin'i de kabul edilir. IP erişimi TLS kullanmaz. DNS yayılımından sonra alan adının HTTPS adresini kullanın; geçici IP erişimi kaldırılırken bu Nginx site bağlantısını ve `APP_ORIGIN` içindeki IP adresini kaldırıp Nginx'i reload, uygulamayı restart edin.

11 Ekim 2026 HTTP uyumluluk düzeltmesi: `randomUUID()` güvenli bağlam gerektirdiği için IP üzerinden oda oluşturma bozuluyordu. Ön yüzde `getRandomValues()` tabanlı UUID alternatifi kullanıldı. Kaynaklar: [MDN randomUUID](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID), [MDN getRandomValues](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues). Canlı ön yüz hotfix commit'i `ecd9e3c`; dağıtım sunucu restart gerektirmedi.
