# Kararlar (11 Ekim 2026)

Bu depo Kelime Havuzu oyunudur; komşu `codex` deposundaki regime-bot işlem stratejisi SPEC'i bu uygulamanın ürün gereksinimi değildir.

- Oyun kuralları korunur: 4 faz, aynı havuz, pas yok, 1 doğru = 1 puan, kalan süre sonraki faza taşınır. Tek sayıda oyuncu desteklenir; her takımda en az iki kişi gerekir. Oda sınırı kaynak güvenliği için 32 kişidir.
- Rakipler hakemlik için kelimeyi görür. İtiraz süreyi dondurur; yönetici karar verir. Geçersiz kelime bu fazdan puansız çıkar, sonraki fazın havuzunda yeniden bulunur. Son doğruya 5 saniye içinde itiraz puanı geri alabilir. Yönetici kararı nihai; dijital ses/konuşma denetimi yoktur.
- Süre değişikliği devam eden turu etkilemez, sonraki yeni turda uygulanır. Kelime adedi sadece lobide değişir; mevcut yazılar korunabildiği kadar korunur, onaylar yenilenir.
- Oyuncu kimliği socket ID değildir. Rastgele 256 bit geri dönüş anahtarının özeti sunucuda, anahtar sadece ilgili sekmenin sessionStorage'ında tutulur. Takma ad geri dönüş kanıtı değildir. Aynı oturum başka bağlantıda açılırsa eski bağlantı etkisizleşir.
- Bağlantı eksilince yeterli takım varsa oyun sürer; anlatıcı ayrılırsa veya takımda iki bağlı kişi kalmazsa süre donar. Yönetici oyunu açıkça devam ettirir. Ayrılan yöneticinin görevi en eski bağlı oyuncuya geçer.
- Durum tek Node sürecinde yönetilir. Atomik disk kaydıyla yeniden başlatma sonrası oyunlar duraklatılmış geri gelir. Üretimde kalıcı disk ve tek replika gerekir; Redis/yatay ölçekleme bu sürüm kapsamında değildir.
- Tasarım denetimi: mevcut koyu Inter/mor CTA, rol ekranları ve toast tabanlı kopma uyarısı; korunacak Türkçe dil, kırmızı/mavi takım ve oda kodu. Yeni dil kâğıt/fanus masa oyunu, küçük hayvan karakterleri, gündüz/gece temaları. Native CSS, sistem sans yazı tipi, dış font isteği yok. DESIGN_VARIANCE=7, MOTION_INTENSITY=4, VISUAL_DENSITY=4. Hareket yalnızca geri bildirim, reduced-motion desteği.
