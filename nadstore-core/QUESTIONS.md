# QUESTIONS.md — سؤال‌های باز برای مالک پروژه

طبق قاعده ۲ بخش ۲۰ سند: هر ابهام اینجا ثبت می‌شود و حدس زده نمی‌شود. تا پاسخ مالک، روی پیش‌فرض امنِ هر ردیف کار می‌شود و کد به بخش‌های بی‌ارتباط وابسته نیست.

## Q1 — فایل اصلی `001_registry_init.sql` (بخش ۵) — 🔴 مسدودکننده فاز ۳

فایل پیوست سند نبود. نسخه موجود در `migrations/registry/001_registry_init.sql` از روی توصیف‌های پراکندهٔ خود سند بازسازی شده است. ستون‌ها و تصمیم‌های استنتاج‌شده که باید با نسخه اصلی مقایسه شوند:

- `plans`: `code` (یکتا)، `name`، `limits JSON` — بدون ستون قیمت/صورت‌حساب
- `tenants`: `slug VARCHAR(27)`، `name`، `plan_id`، `status ENUM`، `db_password_enc VARBINARY(1024)`، `enc_key_version`، `schema_version`، `allowed_origins JSON`
- `tenant_domains`: `domain` یکتا در کل رجیستری، `kind VARCHAR(32) DEFAULT 'store'` (مقادیر مجاز نامشخص → Q2)، `is_primary TINYINT(1)`، `verified_at`
- `api_keys`: `prefix VARCHAR(15)` غیریکتا (این dex)، `key_hash BINARY(32)` یکتا، `type ENUM('publishable','secret')`، `label`، `scopes JSON`، `last_used_at`، `expires_at`، `revoked_at`
- `tenant_services`: یکتای `(tenant_id, service)`، `enabled TINYINT(1)`، `config_enc VARBINARY(8192)`، `enc_key_version`
- `usage_counters`: یکتای `(tenant_id, service, period)`، `used`، `limit_snapshot`
- `jobs`: `type`، `payload JSON`، `status ENUM('pending','running','done','failed')`، `run_at`، `attempts`، `max_attempts`، `locked_by`، `locked_until`، `last_error VARCHAR(2000)` (ستون `dedupe_key` در migration آینده ۰۰۲ فاز ۵ اضافه می‌شود)
- `admin_users`: `email` یکتا، `password_hash` (argon2id)، `totp_secret_enc` + `enc_key_version`، `role ENUM('owner','operator')`
- `admin_sessions`: `admin_id`، `family_id BINARY(16)`، `token_hash BINARY(32)` یکتا، `expires_at`، `revoked_at`، `last_used_at`
- `audit_logs`: `actor_type ENUM('admin','api_key','system')`، `actor_id`، `action`، `tenant_id` nullable، `metadata JSON`
- `migration_runs`: `tenant_id`، `version`، `name`، `status ENUM('ok','failed')`، `error`
- همه FKها بدون CASCADE (RESTRICT پیش‌فرض)؛ هیچ جدول ستون `deleted_at` مستقیم ندارد جز آنچه سند صریحاً گفته (`media_files` فاز ۸).

**مطلوب:** فایل اصلی برای diff و جایگزینی. اگر فایل اصلی قبل از اولین اجرای `migrate:registry` روی محیط واقعی ارائه شود، نسخه بازسازی‌شده حذف و نسخه اصلی بدون تغییر (طبق بخش ۵) در همان مسیر قرار می‌گیرد.

## Q2 — مقادیر مجاز `tenant_domains.kind` (بخش ۸)

payload ادمین `{ domain, kind, is_primary }` را می‌گوید ولی مقادیر مجاز kind را تعریف نمی‌کند. فعلاً `VARCHAR(32) NOT NULL DEFAULT 'store'` با schema تایپ‌باکس آزاد است. مقادیر در نظر گرفته‌شده در سند؟ مثلاً `store | media | redirect`؟

## Q3 — شفاف‌سازی جدول مرز ماژول‌ها (بخش ۴)

جدول مرز، این وابستگی‌ها را پوشش نمی‌دهد؛ برای اینکه CI سبز بماند این تفسیر اعمال شده (ردیف‌های `eslint.config.js`) — تأیید می‌کنید؟

1. `audit → registry`: ماژول audit برای نوشتن در `nad_registry.audit_logs` باید از repos رجیستری استفاده کند (تنها راه با ممنوعیت kysely/mysql2 در سایر ماژول‌ها).
2. `config` و `logger` به‌عنوان هسته مشترک برای همه ماژول‌ها import آزادند (سند در سطرهای مختلف ارجاع ناسازگار به config دارد).
3. `http → tenancy/keys/registry/audit`: خط لوله درخواست بخش ۹ در سطح HTTP اجرا می‌شود و به tenancy/keys نیاز دارد.
4. `admin → http`: مسیرهای `/admin` پلاگین Fastify هستند و `AppError` در ماژول http زندگی می‌کند.
5. کلاس `AppError` در `src/http/app-error.ts` گذاشته شد؛ اگر مرجع مشترک جدا (مثلاً ماژول `errors`) بخواهید، جابه‌جا می‌شود.

## Q4 — کد خطای ۴۱۳ و ۵۰۳ (بخش ۸)

جدول کدهای خطا برای این دو وضعیت تعریف ندارد:

- تجاوز حد بدنه ۱MB: فعلاً `413` با کد `validation_failed`.
- `GET /internal/ready` وقتی رجیستری در دسترس نیست: فعلاً `503 {"status":"unavailable","registry":"error"}` (خارج از قالب خطای public، چون endpoint داخلی است).

تأیید یا پیشنهاد جایگزین؟

## Q5 — متغیرهای compose (بخش ۱۷)

نام‌های `<...>` سند به متغیر env تبدیل شدند: `DOCKER_NETWORK` (نام شبکه فعلی داکر)، `SHOP_MIGRATIONS_HOST_DIR` (مسیر مهاجرت‌های store روی هاست)، `CORE_TAG`. نام واقعی شبکه داکر سرور چیست تا در runbook فاز ۹ ثابت شود؟

## Q6 — نسخه Node در Dockerfile (بخش ۳)

سند «LTS فعال، حداقل ۲۲» می‌گوید. Dockerfile فعلی `node:24-slim` (LTS فعال فعلی) و `engines: >=22` است. اگر VPS روی ۲۲ قفل باشد اطلاع دهید تا ایمیج و `engines` به ۲۲ بیاید.
