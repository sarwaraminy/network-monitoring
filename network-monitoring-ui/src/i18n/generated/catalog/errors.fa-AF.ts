// GENERATED FILE — DO NOT EDIT.
//
// Copied from api/src/i18n by api/scripts/copy-catalogs.mjs. Edit the original and
// run `npm run i18n:sync`; CI fails if this copy is stale.
import type { PartialErrorCatalog } from './errors.en';

/**
 * The error catalogue in Dari.
 *
 * Machine-drafted and pending review by a native speaker, more urgently than the
 * German one for the reason the finding catalogue gives. Keys absent here fall
 * back to the English pattern per key.
 *
 * The interpolated values — MAC addresses, variable names, interface names — are
 * bidi-isolated at render time rather than here. `error.validation`'s `detail`
 * stays English on purpose; see errors.en.ts.
 */
export const ERRORS_FA_AF: PartialErrorCatalog = {
  // --- اعتبارسنجی ---

  'error.validation': 'درخواست معتبر نیست: {detail}',
  'error.invalid_id': 'id باید یک عدد صحیح مثبت باشد',
  'error.invalid_account_id': 'این شناسهٔ حساب نیست.',
  'error.invalid_mac': 'mac باید یک آدرس MAC باشد',
  'error.invalid_ip': 'آدرس IP معتبر نیست: {value}',
  'error.ip_required': 'ipAddress الزامی است',
  'error.interface_required': 'interfaceName الزامی است',
  'error.since_unparseable': '«since» خوانده نشد: یک تاریخ ISO یا بازه‌ای مانند 24h بدهید',
  'error.body_not_json': 'بدنهٔ درخواست JSON معتبر نیست',
  'error.no_route': 'مسیری برای {method} {path} وجود ندارد',

  // --- یافت نشد ---

  'error.alert_not_found': 'یافته‌ای با id {id} وجود ندارد',
  'error.suppression_not_found': 'قاعدهٔ سرکوبی با id {id} وجود ندارد',
  'error.account_not_found': 'چنین حسابی وجود ندارد.',
  'error.device_not_found': 'دستگاه شناخته‌شده‌ای با {mac} وجود ندارد',
  'error.sensor_not_found':
    'زیر سنسور {sensor} چیزی ثبت نشده است: نه یافته‌ای، نه دستگاهی و نه تاریخچهٔ تجمیع‌شده. ' +
    'چیزی برای از رده خارج کردن وجود ندارد.',
  'error.device_not_on_sensor':
    'دستگاه شناخته‌شده‌ای با {mac} روی سنسور {sensor} نیست. برای این سنسورها شناخته شده است: {sensors}.',
  'error.interface_not_found': 'چنین رابطی یافت نشد: {name}',

  // --- تعارض ---

  'error.device_ambiguous':
    '{mac} برای بیش از یک سنسور شناخته شده است ({sensors}). با ?sensor= مشخص کنید کدام‌یک آن را ' +
    'فراموش کند.',
  'error.last_administrator': 'این تنها مدیر باقی‌مانده است؛ نخست حساب دیگری را به مدیر ارتقا دهید.',
  'error.sensor_still_active':
    'آخرین نشانهٔ {sensor} در {lastSeen} بوده است، پس چیزی هنوز زیر این نام می‌نویسد. از رده ' +
    'خارج کردن آن جدول‌هایی را خالی می‌کند که دوباره پر می‌شوند، و خالی کردن فهرست دستگاه‌هایش ' +
    'هر ماشین آن بخش شبکه را دوباره تازه گزارش می‌کند. نخست آن سنسور را متوقف کنید، یا تا آرام ' +
    'شدنش صبر کنید.',
  'error.sensor_decommission_busy':
    'جاروب نگهداشت در حال اجراست و قفل مورد نیاز را در دست دارد، پس {sensor} دست‌نخورده ماند. ' +
    'چیزی تغییر نکرده است؛ چند دقیقه بعد باز تلاش کنید.',
  'error.sensor_is_self':
    '{sensor} همین نصب است و هنوز یافته و دستگاه می‌نویسد؛ از رده خارج کردن آن جدول‌هایی را ' +
    'خالی می‌کند که بی‌درنگ دوباره پر می‌شوند — و خالی کردن فهرست دستگاه‌ها هر ماشین شبکه را ' +
    'دوباره تازه گزارش می‌کند. سنسوری را از رده خارج کنید که بازنشسته شده است، یا به‌جای آن ' +
    'یافته‌ها را پاک کنید.',
  'error.capture_already_starting':
    'روی این رابط از پیش یک ضبط در حال آغاز است. بگذارید تمام شود، سپس وضعیت ضبط را ببینید.',
  'error.email_in_use': 'این ایمیل قبلاً استفاده شده است.',
  'error.cannot_demote_self':
    'شما نمی‌توانید نقش مدیریتی خودتان را بردارید. از مدیر دیگری بخواهید این کار را انجام دهد.',
  'error.flow_pinned':
    'در محیط تنظیم شده و اینجا تغییرپذیر نیست: {variables}. متغیر را بردارید و API را ' +
    'بازراه‌اندازی کنید تا از این صفحه مدیریت شود.',
  'error.adhoc_pinned':
    'در محیط تنظیم شده و اینجا قابل تغییر نیست: {variables}. متغیر را بردارید و API را دوباره ' +
    'راه‌اندازی کنید تا از این صفحه مدیریت شود.',
  'error.delivery_pinned':
    'در محیط تنظیم شده و اینجا قابل ویرایش نیست: {variables}. متغیر را از api/.env (یا فایل ' +
    'Compose خود) بردارید تا از این صفحه مدیریت شود.',
  'error.no_suppression_criterion':
    'یک قاعدهٔ سرکوب دست‌کم به یکی از نوع، مبدأ، مقصد یا پورت نیاز دارد. قاعده‌ای بدون هیچ‌یک، هر ' +
    'یافته‌ای را در شبکه دور می‌اندازد.',

  // --- احراز هویت و دسترسی ---

  'error.invalid_credentials': 'ایمیل یا گذرواژه نادرست است.',
  'error.missing_authorization': 'سرایند Authorization موجود نیست.',
  'error.not_authenticated': 'وارد نشده‌اید.',
  'error.insufficient_permissions': 'دسترسی کافی نیست.',
  'error.too_many_logins': 'تلاش‌های ناکام بیش از حد. یک دقیقه صبر کنید و دوباره تلاش کنید.',
  'error.too_many_capture': 'درخواست‌های کنترل ضبط بیش از حد. آهسته‌تر.',
  'error.too_many_lookups': 'درخواست‌های جست‌وجوی بیش از حد. آهسته‌تر.',
  'error.too_many_requests': 'درخواست‌های بیش از حد. آهسته‌تر.',
  'error.adhoc_disabled': 'کنسول پرس‌وجو روی این سرور فعال نیست.',
  'error.adhoc_sql_type': 'پرس‌وجو را به‌صورت رشتهٔ `sql` بفرستید.',
  'error.adhoc_sql_empty': 'یک پرس‌وجو برای اجرا وارد کنید.',
  'error.adhoc_sql_too_long': 'پرس‌وجوها به {max} نویسه محدودند.',
  'error.adhoc_one_statement': 'هر بار یک دستور اجرا کنید — این پرس‌وجو بیش از یکی دارد.',
  'error.adhoc_timeout':
    'پرس‌وجو بیش از {ms} میلی‌ثانیه طول کشید و متوقف شد. آن را محدودتر کنید، یا LIMIT بیفزایید.',
  'error.adhoc_busy':
    'کنسول پرس‌وجو مشغول است — هر بار شمار اندکی پرس‌وجو اجرا می‌کند. لحظه‌ای دیگر دوباره تلاش ' + 'کنید.',
  'error.adhoc_denied_write':
    '{detail} — کنسول پرس‌وجو تنها روی جدول‌های عملیاتی می‌نویسد و نمی‌تواند به رد حسابرسی، ' +
    'حساب‌ها یا ستون‌های دارای رازها دست بزند.',
  'error.adhoc_denied_read':
    '{detail} — کنسول پرس‌وجو فقط‌خواندنی است و نمی‌تواند ستون‌های دارای رازها را بخواند.',
  'error.adhoc_passthrough': '{detail}',
  'error.adhoc_failed': 'پرس‌وجو اجرا نشد.',
  'error.permission_denied': 'دسترسی رد شد.',
  'error.capture_enumerate': 'رابط‌های شبکه فهرست نشد: {detail}',
  'error.capture_open': '{name} باز نشد: {detail}',
  'error.capture_filter': 'پالایهٔ ضبط اعمال نشد: {detail}',
  'error.intel_reload_running': 'بارگیری دوباره هم‌اکنون در جریان است؛ نشانگرهای زیر از بارگیری پیشین‌اند.',
  'error.intel_reload_kept': 'بارگیری دوباره مجموعهٔ قابل‌استفاده‌ای نساخت. نشانگرهای پیشین همچنان در کارند.',
  'error.guide_sign_in': 'برای خواندن راهنمای کاربر وارد شوید.',
  'error.token_invalid': 'توکن نامعتبر یا منقضی شده است.',
  'error.account_gone': 'این حساب دیگر وجود ندارد.',
  'error.signup_admin_only': 'تنها یک مدیر می‌تواند حساب بسازد.',
  'error.signup_token_required':
    'ساختن حساب به توکن مدیر نیاز دارد. روی سرور از `npm run user -- create` استفاده کنید، یا ' +
    'به‌عنوان مدیر وارد شوید.',

  // --- ضبط ---

  'error.capture_install_npcap':
    'کتابخانهٔ ضبط بسته‌ها بارگیری نشد. Npcap را از https://npcap.com/#download نصب کنید. ' + '({detail})',
  'error.capture_install_libpcap':
    'کتابخانهٔ ضبط بسته‌ها بارگیری نشد. libpcap را نصب کنید (برای نمونه ' +
    '`sudo apt install libpcap0.8`). ({detail})',
  'error.no_delivery_channel':
    'هیچ کانال تحویلی تنظیم نشده است. یک نشانی وب‌هوک، یک میزبان syslog، یا یک میزبان SMTP ' +
    'با گیرندگان تعیین کنید — در همین صفحه یا در api/.env.',
  'error.email_oauth_incomplete':
    'ایمیل روی OAuth2 تنظیم شده است، اما {settings} تعیین {count, plural, one {نشده} ' +
    'other {نشده‌اند}}، بنابراین صندوق پستی نمی‌تواند احراز هویت کند. این‌ها را در همین صفحه ' +
    'پر کنید، یا روش احراز هویت را به گذرواژه برگردانید.',

  // --- آخرین چاره ---

  'error.network_unreachable': 'دسترسی به سرور API ممکن نیست. آیا در حال اجراست؟',
  'error.internal': 'خطای داخلی سرور',
};
