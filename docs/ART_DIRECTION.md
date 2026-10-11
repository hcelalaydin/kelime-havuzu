# Kelime Havuzu: arayüz ve karakter dili

## Tasarım

Minimal bir sosyal oyun masası. Sevimlilik karakterlerin mimiklerinden gelir; alanlar ve kontroller sakin kalır. Girişte iki portre kartı ve tek katılma formu; lobide ortak fanus, özel yazma alanı ve açık takım listeleri; oyunda kelime, süre ve doğru/itiraz eylemleri önceliklidir.

- Zemin: `#F5F6F7`; yüzey: `#FFFFFF`; metin: `#28333C`; ikincil metin: `#59656F`; çizgi: `#DCE1E5`; ana eylem: `#303E49`.
- Kırmızı ve mavi yalnızca takım ve hata anlamı taşır.
- Manrope Variable yerel olarak sunulur. Latin ve Türkçe karakter dosyaları ile OFL lisansı `public/assets/fonts/` içindedir. Kaynak: `@fontsource-variable/manrope@5.3.0`.
- Kontrollerde 7–8 px, ana alanlarda 12–14 px köşe yarıçapı. Yüzeylerde dekoratif gölge yok; oyuncu menüsü ve üst üste duran karakter kartlarında derinliği anlatan hafif gölge var.
- Büyük harfli dekoratif etiketler ve emoji karakterler kaldırıldı. Sayılar tabular; dokunma hedefleri en az 44 px; odak, koyu tema ve azaltılmış hareket korunur.
- Mobilde giriş illüstrasyonu kaldırılır; karakter seçici ve oda formu öncelik kazanır. Oyun alanı yan sütun yüksekliğine uzamaz. Yönetici işlemleri yerel, klavyeyle kullanılabilen oyuncu menülerindedir.

Uygulanan kaynaklar: Claude Code `frontend-design`, `minimalist-ui`, `redesign-existing-projects`. `high-end-visual-design` içindeki boşluk, yüzey ve hareket önerileri kullanıcının minimalist oyun isteğine göre değerlendirildi; gösterişli navigasyon ve ağır sahne efektleri eklenmedi.

## Portre üretimi

15 ayrı portre, yerleşik `image_gen` aracıyla, `transparent_background: true` olarak üretildi. CLI/API kullanılmadı. Her görselin son prompt'u aşağıdaki ortak metin ile tablodaki Subject cümlesinin birleşimidir. Görsel içerik yeniden çizilmeden, aynı çözünürlük ve alfa korunarak WebP kodlaması yapıldı (`cwebp -q 85 -alpha_q 100`). Oyun varlıkları `public/assets/avatars/` altındadır.

### Ortak prompt

```text
Use case: stylized-concept. Production game avatar for a professionally art-directed minimalist social word game. A single original chibi animal HEAD ONLY, centered square composition, all ears fully inside generous 12% transparent margins, head occupies 76% width. Hand-crafted contemporary editorial character illustration: bold rounded silhouette, matte flat gouache-like color blocks, restrained dry brush edge texture, dark charcoal soft medium outlines, tiny expressive black eyes, subtle witty facial asymmetry. Warm natural desaturated animal colors. Looks like an independent animation studio's premium board-game character, funny and charming for adults, not a stock emoji, not glossy 3D, not anime eyes, no body, no accessories, no circle, no sticker border, no text, no shadow, no background. Consistent front-facing near-frontal view and soft left-top lighting. Subject:
```

### Subject cümleleri

| Karakter | Dosya           | Subject                                                                                                     |
| -------- | --------------- | ----------------------------------------------------------------------------------------------------------- |
| Tilki    | `fox.webp`      | a ginger fox with angular oversized ears, cream cheeks, a sly raised eyebrow                                |
| Ayı      | `bear.webp`     | a cinnamon brown bear with round ears, tiny oval eyes, a deadpan amused expression                          |
| Kurbağa  | `frog.webp`     | a sage green frog with wide-set eyes, a tiny crooked smile and one raised eye ridge                         |
| Kedi     | `cat.webp`      | a charcoal and cream cat with triangular ears, sleepy half closed eyes and a mischievous little fang        |
| Panda    | `panda.webp`    | a cream and black panda with asymmetric eye patches and a surprised expression                              |
| Koala    | `koala.webp`    | a soft grey koala with huge fluffy ears, slate nose, a slightly bewildered smile                            |
| Baykuş   | `owl.webp`      | a tawny owl with round facial discs and comically serious heavy eyebrows                                    |
| Ahtapot  | `octopus.webp`  | a dusty coral octopus with a round oversized head and a few short curled tentacles beneath, a knowing smirk |
| Tavşan   | `rabbit.webp`   | an ivory rabbit with one straight ear and one folded ear, cheeky little front teeth                         |
| Rakun    | `raccoon.webp`  | a grey raccoon with a dark eye mask, fluffy cheek tufts and a conspiratorial smile                          |
| Kapibara | `capybara.webp` | a caramel capybara with tiny ears and a wonderfully calm unimpressed expression                             |
| Penguen  | `penguin.webp`  | a charcoal and cream penguin with a tiny apricot beak, raised eyebrow, proud expression                     |
| Kaplan   | `tiger.webp`    | an ochre tiger with bold charcoal stripes and cream muzzle, a playful crooked grin                          |
| Koyun    | `sheep.webp`    | a fluffy ivory sheep with charcoal face, tiny ears and a dazed sweet expression                             |
| Köpek    | `dog.webp`      | a golden floppy-eared puppy with a cream muzzle, one ear tilted and a charming goofy smile                  |

Portreler büyük ve küçük boyutta, açık ve koyu zeminde kontrol edildi. Önceki emoji oturum kayıtları aynı hayvanın yeni portre kimliğine dönüştürülür; bilinmeyen kimlikler Tilki'ye düşer. Dosya yolları yalnızca sabit karakter listesinden oluşturulur.
