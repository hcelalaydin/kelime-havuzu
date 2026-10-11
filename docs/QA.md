# Doğrulama

## Kapsam

- Node test runner: 4, 5, 6, 7, 8, 9, 32 oyuncuyla dört faz ve puan korunumu; tekrar kelimeler; sıra rotasyonu; aynı anda süre bitimi/doğru; faza kalan süre taşıma.
- Taslak gizliliği, kelime adedi revizyonu, bağlı/hazır ön koşulları, geçersiz paketler, Türkçe takma ad eşlemesi, oda kapasitesi.
- Rakip kelime görünürlüğü, tahminci gizliliği (yönetici olsa bile), itiraz/puan iptali, tekrarlı itiraz, son kelime ve ayrılma çakışmaları.
- Oyuncu/yönetici kopması, süre dondurma, 2 dakikalık rezervasyon, oyuncu çıkarma, countdown iptali, kalıcı kayıt ve anahtarla geri dönüş.
- Gerçek Socket.IO bağlantıları: ack tekrarları, oturum devri, takma adla kimlik taklidini reddetme, hatalı girişte sunucunun ayakta kalması, farklı Origin reddi.
- Karma eylem dizileri: her aşamada doğru + ihlal + havuz = toplam kelime; toplam puan = aşama puanları; zaman negatif değil; mevcut kart havuzda bulunur.
- Chromium masaüstü, Chromium telefon görünümü, WebKit iPhone görünümü: giriş, tema, kurallar, taslak/reload, 5 oyuncu, rol gizliliği, itiraz, bağlantı dönüşü, süre değişimi, lobiye dönüş, 4 faz/80 puan.
- axe-core WCAG 2 A/AA ve 2.1 AA kontrolleri; yatay taşma kontrolü; açık/koyu tema; gerçek ekran görüntüleri.

## Sınırlar

Emüle edilmiş mobil tarayıcılar fiziksel telefon testinin yerini tam olarak tutmaz. Canlı sağlayıcıda HTTPS/WebSocket/proxy/disk kontrolü gereklidir. Her olası hatanın yokluğu garanti edilemez; kapsamlı regresyon testleri bilinen hata yollarını korur.

## Son çalıştırma (11 Ekim 2026)

- `npm run format:check`, `npm run lint`, `npm test`: başarılı; 32 test.
- `npm run test:e2e`: 12/12 başarılı (masaüstü Chrome, mobil Chrome, mobil WebKit).
- Son kayıt-hatası düzeltmesinden sonra beş oyunculu masaüstü tarayıcı akışı ayrıca yeniden geçti.
- Node 24.21.0 üzerinde motor ve bağlantı testleri başarılı.
- `npm audit --omit=dev`: 0 bilinen açık.
- `docker build`, `docker compose config --quiet` ve `npm run test:docker`: başarılı. Gerçek container restart ve kalıcı volume testi oyuncu kimliklerini, 1 puanı, kalan 19 kelimeyi ve süreyi korudu.
- `docs/screenshots/` altındaki görüntüler gerçek tarayıcı testlerinden alınmıştır; örnek oyuncular kullanılır.
