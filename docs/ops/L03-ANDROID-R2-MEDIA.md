# L03 Android R2 media: audit and QA
Reference: #125; Cloudflare R2 read-only inventory 2026-10-18.

- Bucket `hot-pot`, r2.dev public delivery enabled. Existing scoped JPEG/WebP keys in `products-image/`, `catalog-media/` serve catalog, category, offers, hero and popup. `system-image/login-hero.png` is `image/png`, 2,381,942 bytes.
- Admin browser PUT CORS `https://admin.bepsi.click` configured; no change made to existing objects, ACL, or CORS.
- A valid Cloudflare object does **not** prove Android RN Image works. Verify the same URL on native/Android Chrome/PWA, decode, TLS, loading/errors, cache and retry.
- Login hero, product/combos, categories, offers, Home hero/popup and order VietQR now show a reload control instead of hiding a failed image permanently. Android resumes and retries failed images when foregrounded; preserve the original URL and its cache key.
- Audio objects are not present under `sound`, `audio/`, or `notification/` prefixes. Native background push cannot stream a channel sound from R2: Admin `new-orders-v2` must use locally bundled `res/raw/new_order_alert.mp3` generated from repo-root `sound-native-android.mp3`. Customer uses Android system sound. No audio assets uploaded in L03.

QA to finish on Android (NOT TESTED in cloud): same image in Chrome/native/PWA; disconnect/reconnect during image load, retry in place; Home slider/swipe/popups, category/product/detail, VietQR; 320/360/390/428 layouts. Admin Test âm thanh / Test FCM with real Firebase APK, foreground/background/normal close; check notification channel's audible sound, not merely successful send.

No backend change, DB migration or production deployment in this PR. CI fixture APK cannot verify live media/FCM or device sound.
