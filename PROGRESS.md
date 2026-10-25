# PROGRESS.md — پیشرفت پیاده‌سازی NadStore Core

مرجع: «NadStore Core — سند معماری و پیاده‌سازی» (۲۵ اکتبر ۲۰۲۶)

## وضعیت کلی

| فاز | وضعیت | تاریخ |
| --- | --- | --- |
| ۰ — پایه | ✅ کامل (پذیرش در سندباکس بدون Docker اجرا شد؛ `docker compose up` روی VPS تست می‌شود) | ۲۰۲۶-۱۰-۲۵ |
| ۱ — رجیستری و crypto | ✅ کامل (تست‌های MySQL به‌دلیل نبود MySQL در سندباکس skip شدند — روی CI/VPS اجرا شوند) | ۲۰۲۶-۱۰-۲۵ |
| ۲ — کلید و tenancy | ⬜ شروع نشده | — |

## فاز ۰ — پایه

ساخته‌شده‌ها:

- ریپو با TypeScript 5.x، `strict` و `noUncheckedIndexedAccess`، ماژول ESM، `engines.node >= 22`
- `src/config`: تنها جای خواندن `process.env`؛ اعتبارسنجی کامل env با TypeBox (`Value.Default/Convert/Check`)، پیام خطا بدون افشای مقدارها، کد خروج ۱؛ پارس `MASTER_KEYS` (۳۲ بایت)، `MASTER_KEY_CURRENT`، `TRUST_PROXY_CIDR`، طول بایتی `INTERNAL_SECRET` و `ADMIN_JWT_SECRET`
- `src/logger`: pino با لیست redact بخش ۱۴ (هدرها + فیلدهای password/token/secret/botToken/apiKey)؛ `pino-pretty` فقط در `NODE_ENV=development`
- `src/crypto`: تنها ماژول استفاده‌کننده از `node:crypto` — AES-256-GCM با IV ۱۲ بایتی و AAD ستونی، قالب `iv‖tag‖ciphertext`، `sha256`، مقایسه ثابت‌زمان با چک طول، رندوم فقط با `crypto.randomBytes`
- `src/http`: `AppError(code, message)` با جدول کدهای بخش ۸، قالب خطای canonical، هندلر خطا (۴۰۰/۴۲۹/۴۱۳/۵۰۰)، هندلر ۴۰۴، plugin مربوط به `X-Request-Id` (اعتبارسنجی ورودی، تولید UUID)، دو app builder با provider تایپ‌باکس: `buildPublicApp` (۳۰۰۰، helmet، rate limit عمومی ۳۰۰/دقیقه، trustProxy محدود به CIDR، بدنه حداکثر ۱MB) و `buildInternalApp` (۳۰۰۱، الزام `X-Internal-Secret` با مقایسه ثابت‌زمان)
- سه entry: `main.api.ts` (هر دو پورت + خاموشی تمیز SIGTERM/SIGINT)، `main.worker.ts` (اسکلت بی‌کار تا فاز ۵)، `main.cli.ts` (dispatch + usage)
- `dist/healthcheck.js` برای healthcheck داکر (پورت از argv، بدون خواندن env)
- `Dockerfile` چندمرحله‌ای روی `node:24-slim` (LTS فعلی؛ سند حداقل ۲۲ خواسته)، مرحله نهایی فقط dist + prod deps، کاربر `node`، `NODE_OPTIONS=--max-old-space-size=192`
- `docker-compose.yml` مطابق بخش ۱۷: بدون `ports:`، `read_only`، tmpfs، `mem_limit: 256m`، volume رسانه، mount فقط‌خواندنی مهاجرت‌های store، healthcheck، لاگ json-file؛ شبکه external با `${DOCKER_NETWORK}`
- CI (GitHub Actions): `npm ci`، lint، typecheck، vitest با سرویس MySQL 8، `test:boundaries`، build ایمیج داکر؛ job دوم `publish` بعد از سبز شدن همهٔ چک‌ها ایمیج را به ghcr.io منتشر می‌کند (فقط push به `main` یا تگ `v*`؛ PR هرگز منتشر نمی‌کند)

پذیرش فاز ۰:

- [x] `GET /health` → `200 {"status":"ok"}` (smoke در سندباکس با اجرای مستقیم Node)
- [x] lint، typecheck و تست‌ها سبز (تست‌های DB skip شدند)
- [x] فایل با نقض عمدی مرز (`config` → `http`)، lint را fail می‌کند — `npm run test:boundaries`
- [ ] `docker compose up` + `GET /health` روی VPS — اولین قدم انتشار (بخش «اجرا روی VPS»)

## فاز ۱ — رجیستری و crypto

ساخته‌شده‌ها:

- `migrations/registry/001_registry_init.sql`: بازسازی‌شده از سند (⚠️ فایل اصلی پیوست نشده بود — حتماً Q1 در `QUESTIONS.md` را ببینید). ۱۲ جدول، utf8mb4/0900_ai_ci، بدون `ON DELETE CASCADE`، DATETIME(3) UTC، JSON تایپ‌دار، BINARY(32) برای هش‌ها، VARBINARY برای blobهای رمز
- runner مهاجرت (`src/migrations`): فهرست `NNN_name.sql`، قفل `GET_LOCK('nad_migrate_registry', 10)`، اتصال اختصاصی `multipleStatements` با یوزر provisioner، تشخیص دیتابیس تازه، ثبت نسخه بعد از هر فایل، `--dry-run`، خروج با خطا در شکست
- `src/registry/db.ts`: pool مشترک mysql2 با `timezone: 'Z'`، `connectionLimit` ۱۰ (api) / ۵ (worker)، `SET time_zone = '+00:00'` روی هر اتصال، نمونه Kysely
- `src/registry/types.ts`: ۱۲ تایپ جدول دقیقاً مطابق DDL (BINARY→Buffer، DATETIME→Date، JSON→تایپ مشخص)
- repos فاز ۱: `tenants` (insert/findById/findBySlug) و `audit` (فقط insert/list — بدون update/delete، با تست بازرسی سورس)
- CLI `migrate:registry [--dry-run]`
- تست‌های crypto (ردیف ۴ سند): رفت‌وبرگشت، دستکاری tag/AAD/ciphertext، نسخه ناشناخته، چرخش کلید
- تست‌های یکپارچه skip-if-no-db: ساخت ۱۲ جدول و idempotency، dry-run، درج/خواندن tenant با رمز رمزشده، UTC بودن session، audit، بازرسی insert-only

پذیرش فاز ۱:

- [x] تست‌های ردیف ۴ (crypto) سبز
- [ ] `migrate:registry` روی MySQL واقعی — روی CI (سرویس mysql:8) یا VPS اجرا شود؛ اولین اجرا باید ۱۲ جدول بسازد
- [ ] تست‌های یکپارچه رجیستری روی MySQL واقعی سبز شوند (`TEST_DB_*` در CI تنظیم شده)

## اجرا روی VPS (برای مالک)

بیلد دستی روی سرور لازم نیست: هر push به `main` بعد از سبز شدن تست‌ها ایمیج را در ghcr.io منتشر می‌کند و روی سرور فقط pull و اجرا انجام می‌شود.

```bash
docker compose pull
docker compose run --rm core node dist/main.cli.js migrate:registry --dry-run
docker compose run --rm core node dist/main.cli.js migrate:registry
docker compose up -d
docker compose ps   # STATUS باید healthy شود
```

پیش‌نیازهای یک‌باره (دسترسی پکیج ghcr، لاگین، `.env` کامل، بوت‌استریپ دستی دیتابیس طبق بخش ۵ سند و rollback): راهنمای کامل در **`DEPLOY.md`**.

## سیاست تست

- تست‌های واحد: همیشه اجرا می‌شوند (config، crypto، http).
- تست‌های یکپارچه: `skip-if-no-db` — اگر `TEST_DB_HOST/PORT/USER/PASSWORD` در دسترس نباشد skip می‌شوند؛ روی CI و VPS واقعاً اجرا می‌شوند.

## تصمیم‌های دامنه این نوبت

- repos فاز ۱ فقط tenants و audit است؛ بقیه repos (domains/keys/services/usage/jobs/admins) همراه فاز مصرف‌کنندهٔ خودشان و با تست اجباری همان فاز ساخته می‌شوند تا هیچ متد بدون تست نماند (بخش ۲۰، قاعده ۵).
- تایپ‌های Kysely خواندنی با `Selectable<Row>` صادر می‌شوند؛ تایپ جدول با `Generated<T>` برای idها.

## قدم بعدی

فاز ۲ — ساخت و اعتبارسنجی کلید، کش، TenantContext، `GET /v1/me`، `/internal/resolve`، rate limit سطح tenant و تست‌های ردیف‌های ۱، ۲، ۳، ۹، ۱۱، ۱۲ سند.
