# Resmi kaynaklar (11 Ekim 2026)

- Socket.IO teslimat varsayılanı at-most-once; kayıp bağlantıda komut belirsiz kalabilir. Komut kimliği/ack ve tekrarları etkisizleştirme, tam durum eşitleme kullanıyoruz. https://socket.io/docs/v4/delivery-guarantees/
- Socket.IO kullanıcı kimliği ve kalıcılığı uygulamanın sorumluluğudur. https://socket.io/docs/v4/faq/
- Render Web Service WebSocket kabul eder. Statik site olarak yayımlanamaz. https://render.com/docs/websocket
- Render varsayılan dosya sistemi geçicidir; kalıcı disk ücretli servise takılır. Üretim şablonu tek servis + disk kullanır. https://render.com/docs/disks

- Render güncel Blueprint şemasında servis planı `0.5c-512mb`, otomatik dağıtımı kapatma alanı `autoDeployTrigger: "off"`; şablon resmi değerlerle güncellendi. https://render.com/docs/blueprint-spec
