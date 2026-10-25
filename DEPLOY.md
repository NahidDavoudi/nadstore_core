# استقرار NadStore Core — بیلد خودکار ایمیج با GitHub Actions

این سند توضیح می‌دهد که چطور با هر push به گیت‌هاب، ایمیج Docker پروژه به‌صورت خودکار بیلد و منتشر می‌شود و چطور روی سرور فقط ایمیج آماده را بگیرید و اجرا کنید.

## ۱. جریان کلی (CI/CD)

```
git push → GitHub Actions
             │
             ├── job «verify»:  lint + typecheck + تست‌ها (MySQL واقعی) + تست مرزها + docker build
             │
             └── job «publish»: فقط اگر verify سبز شد و push روی main یا تگ v* بود
                              docker build → push به ghcr.io
```

نکات مهم این جریان:

- **هیچ Secret دستی لازم نیست.** ورک‌فلو از `GITHUB_TOKEN` استفاده می‌کند که گیت‌هاب خودکار به اکشن می‌دهد؛ کافی است فایل `.github/workflows/ci.yml` در ریپو باشد.
- **PRها و شاخه‌های فرعی فقط تست می‌شوند** و هرگز ایمیج منتشر نمی‌کنند؛ انتشار فقط برای push روی `main` یا تگ‌های `v...` انجام می‌شود.
- اگر تست‌ها شکست بخورند، ایمیج جدیدی منتشر نمی‌شود — یعنی ایمیج `latest` همیشه از کدی می‌آید که چک‌های سبز را رد کرده است.
- ورک‌فلو روی رویداد `push` برای همهٔ شاخه‌ها فعال است، پس حتی پوش به شاخه‌های دیگر هم تست کامل (شامل تست‌های MySQL) را اجرا می‌کند.

## ۲. تگ‌های ایمیج

ایمیج در GitHub Container Registry (ghcr.io) با نام زیر منتشر می‌شود:

```
ghcr.io/<owner-github>/<repo-name>
```

مثلاً اگر ریپو شما `your-user/nadstore-core` باشد: `ghcr.io/your-user/nadstore-core`

| تگ ایمیج | چه زمانی ساخته می‌شود | کاربرد |
|---|---|---|
| `latest` | هر push به `main` | استقرار عادی سرور |
| `main` | هر push به `main` | معادل `latest` (بدون معنای «آخرین» برای گیج‌نشدن) |
| `sha-<hash>` | هر انتشار | rollback دقیق به یک کامیت خاص |
| `1.2.3` و `1.2` | push تگ گیت `v1.2.3` | انتشار نسخه‌دار (release) |

برای انتشار نسخهٔ رسمی کافی است:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## ۳. دسترسی به پکیج (یک‌بار برای همیشه)

اولین بار که اکشن اجرا شود، پکیج در ghcr.io ساخته می‌شود و به‌صورت **Private** به ریپو متصل است. دو راه دارید:

**گزینهٔ A — پکیج Public (ساده‌تر؛ روی سرور هیچ لاگینی لازم نیست):**

1. در صفحهٔ ریپو در گیت‌هاب، از ستون کناری بخش **Packages** پکیج را باز کنید.
2. `Package settings → Danger Zone → Change visibility` را به `Public` تغییر دهید.

ایمیج فقط باینری کامپایل‌شدهٔ پروژه است؛ هیچ secret یا متغیر محیطی داخل ایمیج قرار نمی‌گیرد (همهٔ تنظیمات در زمان اجرا از `.env` سرور خوانده می‌شود)، پس Public کردن ریسک اطلاعات ندارد.

**گزینهٔ B — پکیج Private (باقی بماند):**

1. در گیت‌هاب: `Settings → Developer settings → Personal access tokens (classic)` یک توکن با دسترسی `read:packages` بسازید.
2. روی سرور یک‌بار لاگین کنید:

```bash
echo "<TOKEN>" | docker login ghcr.io -u <github-username> --password-stdin
```

این لاگین در `~/.docker/config.json` ذخیره می‌شود و برای pullهای بعدی لازم نیست تکرار شود.

## ۴. آماده‌سازی سرور (یک‌بار)

روی سرور فقط به فایل‌های `docker-compose.yml` و `.env` نیاز دارید؛ خودِ کد لازم نیست.

```bash
mkdir -p /opt/nadstore-core && cd /opt/nadstore-core
# docker-compose.yml را از ریپو همین‌جا کپی کنید
```

فایل `.env` را بسازید — دو نقش دارد: هم متغیرهای خودِ کانتینر را تأمین می‌کند و هم متغیرهای interpolate شدن compose (مثل `CORE_IMAGE`) از همین فایل خوانده می‌شود:

```bash
# --- انتخاب ایمیج (برای deploy) ---
CORE_IMAGE=ghcr.io/<owner>/<repo>
CORE_TAG=latest

# --- زیرساخت ---
DOCKER_NETWORK=nadstore                 # شبکه‌ای که MySQL و Nginx روی آن هستند
SHOP_MIGRATIONS_HOST_DIR=/opt/shop-migrations   # مسیر مایگریشن‌های فروشگاه (PHP) روی هاست

# --- اپلیکیشن (منبع حقیقت: src/config/env-schema.ts) ---
NODE_ENV=production
ROLE=all
LOG_LEVEL=info
PORT_PUBLIC=3000
PORT_INTERNAL=3001
API_PUBLIC_HOST=<دامنه یا نام سرویس پشت nginx>
TRUST_PROXY_CIDR=<CIDR شبکهٔ داکر، مثلا 172.18.0.0/16>

REGISTRY_DB_HOST=mysql
REGISTRY_DB_PORT=3306
REGISTRY_DB_NAME=nadstore_registry
REGISTRY_DB_USER=nadstore
REGISTRY_DB_PASSWORD=<رمز>
PROV_DB_USER=nadstore_provisioner
PROV_DB_PASSWORD=<رمز provisioner>
SHOP_DB_HOST=mysql
SHOP_DB_PORT=3306

MASTER_KEYS=<کلید ۳۲ بایتی فعلی؛ برای چرخش چند کلید با کاما>
MASTER_KEY_CURRENT=<شناسهٔ کلید فعال>
INTERNAL_SECRET=<رشتهٔ تصادفی حداقل ۳۲ کاراکتر>
ADMIN_JWT_SECRET=<رشتهٔ تصادفی حداقل ۳۲ کاراکتر>
ADMIN_ORIGIN=https://admin.example.com

MEDIA_BASE_URL=https://media.example.com
```

برای تولید مقادیر تصادفی:

```bash
openssl rand -base64 32          # MASTER_KEYS (کلید ۳۲ بایتی)
openssl rand -hex 32             # INTERNAL_SECRET / ADMIN_JWT_SECRET
```

> هر متغیری که در `env-schema.ts` تعریف شده و default ندارد باید در `.env` باشد؛ در غیر این صورت پروسه در استارتاپ با خطای واضح config متوقف می‌شود (این رفتار عمدی و مطابق سند معماری است).

## ۵. استقرار

```bash
cd /opt/nadstore-core

# ۱) گرفتن ایمیج
docker compose pull

# ۲) مایگریشن رجیستری (اول نصب، و بعد از هر آپدیت) — اول dry-run:
docker compose run --rm core node dist/main.cli.js migrate:registry --dry-run
docker compose run --rm core node dist/main.cli.js migrate:registry

# ۳) اجرا
docker compose up -d

# ۴) بررسی سلامت
docker compose ps                          # STATUS باید healthy شود
docker compose logs -f core                # لاگ pino
```

چند نکته دربارهٔ این دستورات:

- سرویس پورت بیرونی ندارد (طبق سند معماری، Nginx از داخل شبکهٔ داکر به پورت 3000 پروکسی می‌کند)، پس تست سلامت را از داخل خود کانتینر انجام دهید: `docker compose exec core node dist/healthcheck.js` یا از `docker compose ps` که وضعیت healthcheck را نشان می‌دهد.
- `docker compose run` همان تنظیمات سرویس (شبکه، env، read-only) را به‌کار می‌برد و چون ایمیج `CMD` پیش‌فرض دارد، دستور جلوی آن جایگزین می‌شود — برای همین مایگریشن با همین یک خط اجرا می‌شود.
- مایگریشن‌ها داخل خود ایمیج کپی شده‌اند (`/app/migrations`)، پس همیشه نسخهٔ مایگریشن و کدی که اجرا می‌کنید از یک ایمیج واحد می‌آیند و ناهماهنگ نسخه پیش نمی‌آید.

## ۶. آپدیت روتین (هر بار که push جدید می‌کنید)

```bash
cd /opt/nadstore-core
docker compose pull
docker compose run --rm core node dist/main.cli.js migrate:registry --dry-run
docker compose run --rm core node dist/main.cli.js migrate:registry
docker compose up -d
docker image prune -f
```

## ۷. Rollback

هر انتشار یک تگ `sha-<hash>` دارد. در `.env` مقدار `CORE_TAG` را عوض کنید و دوباره بالا بیاورید:

```bash
# در .env:
CORE_TAG=sha-1a2b3c4

docker compose up -d
```

> اگر مایگریشنِ نسخهٔ جدید اسکیمای مخرب داشته باشد، rollback کامل به نسخهٔ قبل نیازمند بازگردانی دیتابیس است؛ به همین دلیل مایگریشن‌های این پروژه فقط add-only طراحی شده‌اند تا rollback کانتینر به‌تنهایی کافی باشد.

## ۸. اشکال‌یابی سریع

| مشکل | بررسی |
|---|---|
| `denied` هنگام pull | پکیج Private است؛ بخش ۳ (لاگین با PAT یا Public کردن پکیج) |
| ایمیج در ghcr.io نیست | تب Actions ریپو را ببینید؛ job دوم (`publish`) باید سبز شده باشد — فقط push به `main` یا تگ `v*` منتشر می‌کند |
| کانتینر بلافاصله exit می‌شود | تقریباً همیشه کمبود متغیر `.env` است؛ پیام دقیق در `docker compose logs core` آمده و نام متغیر را صریح می‌گوید |
| `unhealthy` | `docker compose logs core` و دسترسی MySQL از داخل شبکهٔ داکر را چک کنید |
