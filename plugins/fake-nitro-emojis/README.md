# Fake Nitro Emojis & Stickers (Pancord Plugin)

Plugin untuk mengirim emoji dan stiker kustom dari server mana pun tanpa memerlukan Discord Nitro.

## Fitur Utama

- **Buka Emoji Picker**: Emoji dari server lain tidak lagi buram/abu-abu dan tanda gembok dihilangkan.
- **Buka Sticker Picker**: Stiker kustom dari server lain dibuka dan bisa diklik bebas tanpa memunculkan modal Nitro.
- **Auto Send Stiker**: Mengklik stiker yang terkunci akan otomatis mengirimkannya ke obrolan sebagai media stiker beresolusi tinggi.
- **Anti-Upsell Modal**: Menekan emoji atau stiker terkunci tidak akan memunculkan popup langganan "Get Nitro".
- **Auto CDN Conversion**: Mengonversi emoji ke link Discord CDN (`.webp` atau `.gif`) dan stiker ke (`media.discordapp.net/stickers/<id>.png`).

## Konfigurasi (`manifest.json`)

```json
{
  "enabled": true,
  "emojiSize": 48,
  "stickerSize": 160,
  "animated": true,
  "unlockPicker": true,
  "unlockStickers": true,
  "sendAsLink": true,
  "sendStickerDirectly": true,
  "quality": "lossless"
}
```

## Penggunaan

1. Buka **Sticker Picker** atau **Emoji Picker** di Discord.
2. Klik stiker atau emoji mana pun yang terkunci (bahkan dari server lain).
3. Stiker akan langsung terkirim ke chat layaknya stiker bawaan Discord!
