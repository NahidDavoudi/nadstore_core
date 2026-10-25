# DECISIONS.md — تصمیم‌های پیاده‌سازی و وابستگی‌ها

طبق قاعده ۴ بخش ۲۰: هر وابستگی خارج از جدول بخش ۳ فقط با ثبت دلیل اینجا مجاز است.

## وابستگی‌ها

| # | بسته | نوع | دلیل |
| --- | --- | --- | --- |
| D1 | `eslint-import-resolver-typescript` | dev | پلاگین `boundaries` برای تشخیص importهای ESM سبک `.js → .ts` (قرارداد پروژه) به resolver تایپ‌اسکریپت نیاز دارد؛ بدون آن قوانین مرز قابل اعمال نیستند. فقط ابزار lint، اثری در runtime ندارد. |

## شفاف‌سازی‌های معماری (نیازمند تأیید مالک — بخش ۲۰ قاعده ۲)

### D2 — محل `AppError`

کلاس `AppError` در `src/http/app-error.ts` است (بخش ۴: «http/ — plugin های مشترک: خطا»). ماژول‌های سطح پایین (registry، tenancy، keys) به‌جای پرتاب AppError، نتیجه تایپ‌دار/null برمی‌گردانند و لایه‌های نزدیک HTTP آن را به خطای قراردادی ترجمه می‌کنند — با جدول مرز سازگار است. ← تأیید در QUESTIONS.md Q3.

### D3 — هسته مشترک `config` و `logger`

هر ماژولی می‌تواند `config` و `logger` را import کند. سند در جدول مرز ارجاع config را در همه سطرها نمی‌آورد، اما: config تنها نقطه اعتبارسنجی env است و logger تنها راه لاگ («هیچ console.log»). بدون این آزادی، هیچ ماژولی نمی‌تواند لاگ کند.

### D4 — `audit → registry`

ماجر audit برای نوشتن در `audit_logs` (جدول داخل `nad_registry`) از repos رجیستری استفاده می‌کند، چون فقط `registry/provisioning/migrations` حق import مستقیم kysely/mysql2 دارند.

### D5 — نام پروپرتی‌های تایپ Kysely با snake_case

تایپ‌های جدول‌ها در `registry/types.ts` نام ستون‌ها را عیناً snake_case نگه می‌دارند تا نگاشت DDL↔Type شفاف بماند («SQL شفاف»، بدون ORM). تایپ‌های خواندنی با `Selectable<Row>` صادر می‌شوند. (قاعده camelCase بخش ۲۰ برای متغیرهای دامنه کد است، نه آینه ستون‌های SQL.)

### D6 — کدهای خطای مکمل سطح داخلی

- `invalid_internal_secret` (401) برای شکست `X-Internal-Secret` روی پورت ۳۰۰۱ — در جدول بخش ۸ نیست چون surface داخلی است.
- ۴۱۳ حد بدنه با کد `validation_failed`؛ ۵۰۳ آماده‌نبودن رجیستری با بدنه غیرقراردادی ready. ← تأیید در QUESTIONS.md Q4.

### D7 — نسخه Node در ایمیج

`node:24-slim` (LTS فعال در زمان ساخت؛ سند: حداقل ۲۲). `engines: ">=22"`. ← QUESTIONS.md Q6.

## بسته‌های مجاز فازهای بعدی (هنوز نصب نشده‌اند)

طبق بخش ۳ در فاز خودشان اضافه می‌شوند: `@fastify/cors` و `@fastify/cookie` (فاز ۲ و ۴)، `@node-rs/argon2` و `otpauth` و `jose` (فاز ۴)، `@fastify/multipart` (فاز ۸)، `sharp` (فاز ۸، فقط در صورت نیاز).
