# Durum (11 Ekim 2026)

Çevrimiçi oyun için uygulama, mobil arayüz, testler ve yayın tesisatı tamamlandı.

- Sabit oyuncu kimlikleri, gizli geri dönüş anahtarı, sunucu tarafında rol görünürlüğü, tam durum eşitlemesi.
- Oyuncu bazında taslak adedi/onayı, cam fanus, tek/çift sayıda takım, 4–32 oyuncu.
- Dört aşama, doğru/itiraz/puan iptali, süre taşıma, yönetici ayarları ve oyun içi duraklatma.
- Kopma, yeniden bağlanma, yönetici devri, oyuncu ayrılması/çıkarma, yeni oyun ekranı ve zamanlayıcı yarışları düzeltildi.
- Karakterler, gündüz/gece teması, dokunmatik ve klavye desteği, azaltılmış hareket ve ekran okuyucu bilgileri.
- Kalıcı disk kaydı, sağlık kontrolü, hız sınırları, CSP, güvenli metin işleme, sabitlenmiş bağımlılıklar.
- Docker, Compose, güncel Render Blueprint, GitHub CI ve Türkçe kılavuzlar.

## Arayüz yenilemesi

- Claude Code frontend-design, minimalist-ui ve redesign-existing-projects kaynaklarına dayanan sade gri/mürekkep paleti, yerel Manrope Variable fontu ve daha sakin yüzeyler.
- Emoji seçicinin yerine 15 ayrı üretilmiş, şeffaf hayvan portresi; sabit dosya kimlikleri ve eski oturumlarla uyumluluk.
- Giriş, lobi, anlatıcı/tahminci/hakem, duraklatma ve sonuç ekranlarında ortak tipografi/boşluk sistemi; mobilde sadeleşen düzen.
- Yönetici işlemleri klavyeyle açılıp Escape ile kapanan oyuncu menülerinde. Anlatıcı portresi ve süre merkezi odağı oluşturur.
- Portre promptları, tasarım kararları ve font lisansı docs/ART_DIRECTION.md ile public/assets altında.

## Kontroller

- 35 motor/Socket.IO/kalıcılık testi geçti.
- 12 Chromium masaüstü, Chromium mobil ve WebKit mobil senaryosu geçti.
- Dört aşamalı gerçek tarayıcı oyunu: 4 kişi × 5 kelime × 4 aşama = 80 puan; bütün ekranlar yeni oyuna döndü.
- Node 24 testleri geçti; Docker imajı derlendi. Gerçek container restart/kalıcı volume kontrolü oyuncuları, puanı, havuzu ve kalan süreyi korudu.
- Biçim, lint, WCAG A/AA taramaları ve yatay taşma kontrolleri geçti.
- `npm audit --omit=dev`: bilinen açık yok.

## Yayın sınırları

Canlı servis/alan adı henüz açılmadı. Üretimde tek replika ve kalıcı disk gerekir. Render şablonu ücretli altyapı tanımlar; maliyet oluşturan işlem yapılmadı. Fiziksel cihaz ve gerçek hosting üzerindeki HTTPS/proxy kontrolü yayında tekrar yapılmalıdır. Otomatik testler tüm olası hataların yokluğunu garanti etmez.
