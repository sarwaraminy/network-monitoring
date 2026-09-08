import type { UiMessageKey } from './en';

/**
 * The interface's own strings, in Dari.
 *
 * Machine-drafted and pending review by a native speaker — more urgently than the
 * German, since nobody on the team reads it. Keys absent here fall back to the
 * English string per key, so a partial file is a working file.
 *
 * Interpolated identifiers are bidi-isolated by the renderer rather than here;
 * see ../generated/render.ts. Protocol names and other Latin-script identifiers
 * (IP, MAC, TLS) are left as they are, for the reason the finding catalogue gives.
 */
export const UI_FA_AF: Readonly<Partial<Record<UiMessageKey, string>>> = {
  // --- ناوبری ---

  'nav.main': 'بخش اصلی',
  'nav.panel_title': 'ناوبری',
  'nav.search_placeholder': 'جست‌وجو در ناوبری…',
  'nav.clear_search': 'پاک کردن جست‌وجو',
  'nav.expand_panel': 'باز کردن ناوبری',
  'nav.collapse_panel': 'جمع کردن ناوبری',

  'nav.group.overview': 'نمای کلی',
  'nav.group.security': 'امنیت',
  'nav.group.capture': 'ضبط',
  'nav.group.administration': 'مدیریت',

  'nav.dashboard': 'داشبورد',
  'nav.alerts': 'هشدارهای امنیتی',
  'nav.suppressions': 'سرکوب‌ها',
  'nav.threat_intel': 'اطلاعات تهدید',
  'nav.capture_interface': 'ضبط بر اساس رابط',
  'nav.capture_ip': 'ضبط بر اساس IP',
  'nav.delivery': 'تحویل',
  'nav.audit': 'رد ممیزی',
  'nav.adhoc': 'پرس‌وجوی موردی',

  // --- منوی حساب ---

  'account.signed_in': 'وارد شده',
  'account.add_user': 'افزودن کاربر',
  'account.sign_out': 'خروج',
  'account.theme': 'پوسته',
  'account.theme.light': 'روشن',
  'account.theme.dark': 'تیره',
  'account.theme.auto': 'خودکار',
  'account.language': 'زبان',

  // --- یافته‌ها ---

  'alerts.title': 'هشدارهای امنیتی',
  'alerts.subtitle': 'هر یافتهٔ آشکارسازها، تازه‌ترین در بالا',
  'alerts.search_placeholder': 'جست‌وجوی یافته‌ها',
  'alerts.column.severity': 'شدت',
  'alerts.column.sensor': 'سنسور',
  'alerts.column.detector': 'آشکارساز',
  'alerts.column.finding': 'یافته',
  'alerts.column.source': 'مبدأ',
  'alerts.column.target': 'مقصد',
  'alerts.column.last_seen': 'آخرین مشاهده',
  'alerts.column.status': 'وضعیت',
  'alerts.acknowledge': 'تأیید',
  'alerts.reopen': 'بازگشایی',
  'alerts.open': 'باز',
  'alerts.acknowledged': 'تأیید شد',
  'alerts.acknowledged_by': 'تأییدشده توسط {who}',
  'alerts.delete': 'حذف — یافته و شواهدش با هم می‌روند',
  'alerts.unacknowledged_count': '{count, plural, one {# تأییدنشده} other {# تأییدنشده}}',
  'alerts.what_this_means': 'این یعنی چه',
  'alerts.evidence': 'شواهد',
  'alerts.no_evidence': 'برای این یافته هیچ جزئیات پشتیبانی ثبت نشده است.',
  'alerts.first_seen': 'نخستین مشاهده',
  'alerts.occurrences': 'دفعات',
  'alerts.protocol': 'پروتکل',
  'alerts.source_mac': 'MAC مبدأ',
  'alerts.target_mac': 'MAC مقصد',
  'alerts.unknown_actor': 'نامعلوم',

  // --- ورود ---

  'app.name': 'Network Monitoring Tool',
  'login.subtitle': 'برای ضبط و تحلیل ترافیک وارد شوید',
  'login.email': 'نشانی ایمیل',
  'login.password': 'گذرواژه',
  'login.sign_in': 'ورود',
  'login.signing_in': 'در حال ورود…',
  'login.no_accounts': 'هنوز هیچ حسابی وجود ندارد.',
  'login.create_first_admin': 'ساختن نخستین حساب مدیر',
  'login.no_account': 'حساب ندارید؟',
  'login.register_here': 'اینجا ثبت‌نام کنید',

  // --- ثبت‌نام ---

  'signup.title': 'ساختن حساب',
  'signup.subtitle': 'ثبت یک کاربر برای Network Monitoring Tool',
  'signup.bootstrap_subtitle': 'این نصب هنوز هیچ حسابی ندارد، پس این حساب مدیر خواهد شد',
  'signup.restricted': 'ساختن حساب محدود شده است',
  'signup.restricted_subtitle': 'تنها یک مدیر می‌تواند به این نصب حساب بیفزاید',
  'signup.ask_admin':
    'از یک مدیر بخواهید حساب شما را بسازد. اگر خودتان این سرور را برپا می‌کنید، این را اجرا کنید',
  'signup.back_to_sign_in': 'بازگشت به ورود',
  'signup.confirm_password': 'تأیید گذرواژه',
  'signup.first_name': 'نام',
  'signup.last_name': 'تخلص',
  'signup.role': 'نقش',
  'signup.role_helper': 'شما مدیر هستید، پس این انتخاب پذیرفته می‌شود',
  'signup.submit': 'ثبت‌نام',
  'signup.creating': 'در حال ساختن حساب…',
  'signup.create_administrator': 'ساختن مدیر',
  'signup.back_to_app': 'بازگشت به برنامه',
  'signup.have_account': 'از پیش حساب دارید؟ وارد شوید',

  'role.user': 'کاربر',
  'role.administrator': 'مدیر',

  // --- داشبورد ---

  'dashboard.title': 'داشبورد',
  'dashboard.subtitle': 'آنچه آشکارسازها یافته‌اند، و اینکه کدام میزبان‌ها پیوسته پیدا می‌شوند',
  'dashboard.sensor': 'سنسور',
  'dashboard.period': 'بازه',
  'dashboard.open_findings': 'یافته‌های باز',
  'dashboard.critical_high': 'بحرانی و زیاد',
  'dashboard.needs_attention': 'نخست به این‌ها رسیدگی شود',
  'dashboard.capture': 'ضبط',
  'dashboard.known_devices': 'دستگاه‌های شناخته‌شده',
  'dashboard.macs_seen': 'آدرس‌های MAC دیده‌شده',
  'dashboard.over_time': 'یافته‌ها در گذر زمان',
  'dashboard.by_detector': 'یافته‌ها بر پایهٔ آشکارساز',
  'dashboard.which_firing': 'کدام بررسی‌ها فعال‌اند',
  'dashboard.top_sources': 'پرتکرارترین مبدأها',
  'dashboard.top_sources_subtitle': 'آدرس‌هایی که در بیشترین یافته‌ها دیده می‌شوند',
  'dashboard.severity_breakdown': 'تفکیک بر پایهٔ شدت',
  'dashboard.all_time': 'همهٔ یافته‌ها، در همهٔ زمان',
  'dashboard.findings': 'یافته‌ها',
  'dashboard.no_findings': 'هنوز یافته‌ای نیست.',
  'dashboard.no_source_findings': 'هنوز یافته‌ای با آدرس مبدأ نیست.',

  // --- رد ممیزی ---

  'audit.title': 'رد ممیزی',
  'audit.subtitle': 'چه کسی چیزی را حذف، تغییر یا تغییر مسیر داد — تنها افزودنی، و هرگز هرس‌نشده',
  'audit.when': 'چه وقت',
  'audit.who': 'چه کسی',
  'audit.what': 'چه چیزی',
  'audit.which': 'کدام',
  'audit.action': 'کنش',
  'audit.subject': 'موضوع',
  'audit.detail': 'جزئیات',

  // --- قاعده‌های سرکوب ---

  'suppressions.title': 'قاعده‌های سرکوب',
  'suppressions.subtitle':
    'یافته‌هایی که آن‌ها را مورد انتظار اعلام کرده‌اید. یافتهٔ منطبق پیش از ذخیره شدن دور انداخته ' +
    'می‌شود — نه اینکه پشت یک فیلتر پنهان شود',
  'suppressions.rules': 'قاعده‌ها',
  'suppressions.rules_subtitle':
    'از بالا به پایین خوانده می‌شود: نخستین قاعده‌ای که با یافته‌ای منطبق شود، آن را دور می‌اندازد',
  'suppressions.findings_hidden': 'یافته‌های دورانداخته',
  'suppressions.never_matched': 'هرگز منطبق نشده',
  'suppressions.expired': 'منقضی',
  'suppressions.covers': 'در بر می‌گیرد',
  'suppressions.why': 'چرا مورد انتظار است',
  'suppressions.state': 'وضعیت',
  'suppressions.hidden': 'دورانداخته',
  'suppressions.expires': 'انقضا',
  'suppressions.no_expiry': 'این قاعده تا زمانی که کسی آن را بردارد برقرار می‌ماند.',
  'suppressions.edit': 'ویرایش این قاعده',
  'suppressions.delete': 'حذف — سابقهٔ آنچه پنهان کرده نیز می‌رود',
  'suppressions.none': 'هیچ قاعدهٔ سرکوبی نیست. هر یافته‌ای که آشکارسازها بیابند ذخیره می‌شود.',
  'suppressions.kind': 'نوع یافته',
  'suppressions.kind_helper': 'هر نوعی، مگر آنکه یکی را انتخاب کنید',
  'suppressions.source': 'آدرس یا بازهٔ مبدأ',
  'suppressions.source_helper': 'ترافیک از کجا آمده است',
  'suppressions.target': 'آدرس یا بازهٔ مقصد',
  'suppressions.target_helper': 'به کجا می‌رفته است',
  'suppressions.port': 'پورت مقصد',
  'suppressions.port_helper': 'تنها با یافته‌های مربوط به یک پورت منطبق می‌شود — هرگز با پویش پورت',
  'suppressions.expires_helper': 'خالی یعنی هرگز منقضی نمی‌شود',
  'suppressions.reason': 'چرا این مورد انتظار است؟',
  'suppressions.reason_helper': 'هر کسی این فهرست را شش ماه دیگر بخواند، تنها همین سطر را در دست دارد',
  'suppressions.in_force': 'برقرار',

  // --- اطلاعات تهدید ---

  'intel.title': 'اطلاعات تهدید',
  'intel.subtitle':
    'آدرس‌ها و دامنه‌هایی که با فهرست‌های نشانگر سنجیده می‌شوند — تنها آشکارساز اینجا که بر پایهٔ ' +
    'آستانه نیست',
  'intel.indicators_loaded': 'نشانگرهای بارگذاری‌شده',
  'intel.feeds': 'فهرست‌ها',
  'intel.feeds_subtitle': 'در آخرین بارگذاری، هر منبع از کجا آمد',
  'intel.no_feeds': 'هیچ فهرستی پیکربندی نشده است.',
  'intel.last_loaded': 'آخرین بارگذاری',
  'intel.refused': 'ردشده هنگام بارگذاری',
  'intel.what_loaded': 'چه چیزی بارگذاری شده',
  'intel.by_type': 'بر پایهٔ نوع نشانگر',
  'intel.ipv4': 'آدرس‌های IPv4',
  'intel.ipv4_cidr': 'بازه‌های IPv4 (CIDR)',
  'intel.ipv6': 'آدرس‌های IPv6',
  'intel.domains': 'دامنه‌ها',
  'intel.feed': 'فهرست',
  'intel.source': 'منبع',
  'intel.indicators': 'نشانگرها',
  'intel.skipped': 'ردشده',
  'intel.skipped_explain':
    'سطرهایی که نشانگر قابل استفاده نبودند: توضیحات، سطرهای خالی، و هر چیز بدشکل یا غیرقابل مسیریابی.',

  // --- تحویل ---

  'delivery.title': 'تحویل هشدارها',
  'delivery.subtitle': 'یافته‌ها به کجا می‌روند، و آیا می‌رسند',
  'delivery.for_people': 'برای مردم',
  'delivery.for_people_subtitle': 'دروازه‌دار، محدودشده و دسته‌بندی‌شده، تا کانال بی‌صدا نشود',
  'delivery.min_severity': 'کمینهٔ شدت',
  'delivery.digest_window': 'بازهٔ گزیده',
  'delivery.throttle': 'محدودسازی برای هر یافته',
  'delivery.hourly_ceiling': 'سقف ساعتی',
  'delivery.for_siem': 'برای SIEM',
  'delivery.for_siem_subtitle': 'هر یافته، بدون دروازه',
  'delivery.protocol': 'پروتکل',
  'delivery.format': 'قالب',
  'delivery.framing': 'قاب‌بندی',
  'delivery.evidence': 'شواهد',
  'delivery.right_now': 'هم‌اکنون',
  'delivery.right_now_subtitle': 'صف و محدودیت‌ها چه می‌کنند',
  'delivery.queued': 'در صف گزیدهٔ بعدی',
  'delivery.sent_last_hour': 'فرستاده‌شده در ساعت گذشته',
  'delivery.throttled': 'یافته‌های اکنون محدودشده',

  // --- کنسول پرس‌وجو ---

  'adhoc.subtitle': 'SQL فقط‌خواندنی روی پایگاه دادهٔ این سامانه. هر پرس‌وجو در رد ممیزی ثبت می‌شود.',
  'adhoc.sql': 'SQL',

  // --- ضبط ---

  'capture.interface.title': 'ضبط از یک رابط محلی',
  'capture.interface.subtitle': 'بسته‌های زنده از یک آداپتور، فریم به فریم رمزگشایی‌شده',
  'capture.ip.title': 'ضبط فیلترشده بر اساس آدرس IP',
  'capture.ip.subtitle': 'همان ضبط، محدودشده به ترافیک یک میزبان',
  'capture.packets': 'بسته‌ها',
  'capture.packets_subtitle': 'تازه‌ترین در بالا، رمزگشایی‌شده از روی سیم',
  'capture.network_interface': 'رابط شبکه',
  'capture.filter_ip': 'فیلتر بر اساس آدرس IP',
  'capture.snapshot_length': 'طول نمونه',
  'capture.timeout': 'مهلت (میلی‌ثانیه)',

  'packets.source_ip': 'IP مبدأ',
  'packets.source_mac': 'MAC مبدأ',
  'packets.destination_ip': 'IP مقصد',
  'packets.destination_mac': 'MAC مقصد',
  'packets.ethertype': 'EtherType',
  'packets.llc_dsap': 'LLC DSAP',
  'packets.llc_ssap': 'LLC SSAP',
  'packets.llc_control': 'LLC Control',
  'packets.frame': 'فریم',
  'packets.pad': 'بایت‌های پرکننده',

  // --- نام‌های شدت و آشکارساز ---

  'dashboard.load_failed': 'داشبورد بارگیری نشد',
  'dashboard.total_all_time': '{count} در مجموع، از آغاز',
  'dashboard.capture_running': 'در حال اجرا',
  'dashboard.capture_idle': 'غیرفعال',
  'dashboard.pcap_unavailable': 'کتابخانهٔ pcap در دسترس نیست',
  'dashboard.no_capture': 'هیچ ضبطی آغاز نشده',
  'dashboard.per_hour': 'بر اساس شدت، در هر ساعت',
  'dashboard.per_day': 'بر اساس شدت، در هر روز',
  'dashboard.hours_count': '{count, plural, one {# ساعت} other {# ساعت}}',
  'dashboard.days_count': '{count, plural, one {# روز} other {# روز}}',
  'dashboard.occurrences': '{count, plural, one {# رخداد} other {# رخداد}}',
  'common.never': 'هیچ‌گاه',
  'suppressions.preview_none': 'هیچ‌کدام از {examined} هشدار اخیر با این قاعده مطابقت ندارد.',
  'suppressions.preview_matched':
    'از {examined} هشدار اخیر، {matched} مورد را پنهان می‌کرد — در مجموع {occurrences} مشاهده.',
  'suppressions.preview_window': 'بررسی‌شده از {from} تا {to}',

  // --- حساب‌ها و نقش‌ها ---

  'users.loading': 'در حال پرسش از سرور…',
  'users.load_failed': 'حساب‌ها خوانده نشد',
  'users.change_failed': 'نقش تغییر نکرد',
  'users.role_changed': '{account} اکنون {role} است.',
  'users.that_account': 'آن حساب',
  'users.blocked_self': 'شما نمی‌توانید نقش خود را تغییر دهید. از مدیر دیگری بخواهید.',
  'users.blocked_last_admin': 'تنها مدیر. پیش از تغییر این حساب، حساب دیگری را به مدیر ارتقا دهید.',
  'users.single_admin':
    'یک مدیر. ارتقای یک مدیر دوم همان چیزی است که این حساب را قابل بازیابی می‌سازد — با تنها یک ' +
    'مدیر، فراموشی رمز یعنی ویرایش دستی پایگاه داده.',
  'users.col_account': 'حساب',
  'users.col_name': 'نام',
  'users.col_role': 'نقش',
  'users.you': 'شما',
  'users.account_n': 'حساب {id}',
  'users.role_for': 'نقش برای {account}',
  'users.audit_note':
    'هر تغییر در رد حسابرسی ثبت می‌شود، همراه با اینکه چه کسی آن را انجام داده و نقش به کدام سو ' +
    'تغییر کرده است.',

  // --- کنسول پرس‌وجو: تشخیص ---

  'console.loading': 'در حال پرسش از سرور…',
  'console.status_failed': 'وضعیت کنسول خوانده نشد',
  'console.running': 'کنسول در حال اجرا است',
  'console.running_note':
    'پرس‌وجوها با نقشی از Postgres اجرا می‌شوند که دسترسی‌های آن تعیین می‌کند چه چیزی ممکن است — ' +
    'نه با کاربر پایگاه دادهٔ خود این برنامه.',
  'console.mode_write': 'خواندن و نوشتن',
  'console.mode_read': 'فقط خواندن',
  'console.write_warning':
    'حالت نوشتن روشن است، بنابراین کنسول با نقش خواندن‌ونوشتن وارد می‌شود و می‌تواند روی جدول‌های ' +
    'عملیاتی UPDATE، INSERT و DELETE اجرا کند. با این حال هنوز به رد حسابرسی، ستون‌های رازها، ' +
    'حساب‌ها و تنظیمات تحویل دسترسی ندارد.',
  'console.password_logged': 'رمز کنسول ممکن است در گزارش Postgres باشد',
  'console.password_logged_note':
    'مالک پایگاه داده superuser نیست، بنابراین هنگام تنظیم رمز نمی‌شد ثبت دستورها را خاموش کرد. ' +
    'زیر {ddl} یا {all} رمز به‌صورت متن ساده نوشته شده است. رمز کنسول را مقداری در نظر بگیرید که ' +
    'سرور پایگاه داده ممکن است ثبت کرده باشد — از هر جایی که تنظیم شده باشد.',
  'console.unavailable': 'کنسول در دسترس نیست',
  'console.env_lines': 'در محیط API:',
  'console.db_said': 'آنچه پایگاه داده گفت',
  'console.recheck_failed': 'بازبینی اجرا نشد',
  'console.checking': 'در حال بررسی…',
  'console.check_again': 'دوباره بررسی کن',
  'console.recheck_note':
    'بررسی زمان راه‌اندازی را دوباره روی محیط کنونی اجرا می‌کند. با این کار کنسول روشن نمی‌شود.',
  'console.remedy.disabled.title': 'کنسول روشن نشده است',
  'console.remedy.disabled.note':
    'آن را در «تنظیمات کنسول پرس‌وجو»، ردیف بعدی همین منو، روشن کنید و همان‌جا رمز کنسول را ' +
    'بگذارید. نیازی به راه‌اندازی دوباره نیست. این حالت پیش‌فرض است، نه خرابی.',
  'console.remedy.no_password.title': 'روشن است، اما رمزی برای نصب وجود ندارد',
  'console.remedy.no_password.note':
    'کنسول خواسته شده است، اما نقشی که با آن وارد می‌شود هیچ اعتبارنامه‌ای ندارد و سرور خودش یکی ' +
    'نمی‌سازد. در «تنظیمات کنسول پرس‌وجو»، ردیف بعدی همین منو، یکی بگذارید.',
  'console.remedy.sandbox_failed.title': 'پایگاه داده تأیید نکرد که کنسول محدود شده است',
  'console.remedy.sandbox_failed.note':
    'کنسول پیکربندی شده است و سرور از راه‌اندازی آن خودداری کرد، چون نتوانست ثابت کند که آن نقش نه ' +
    'superuser است و نه می‌تواند بنویسد. بررسی کنید که مهاجرت‌ها اجرا شده باشند و کسی نقش را دستی ' +
    'دوباره نساخته باشد. آن را درست کنید و دوباره بررسی کنید — نیازی به راه‌اندازی دوباره نیست.',

  // --- کنسول پرس‌وجو: تنظیمات ---

  'console_settings.saved': 'ذخیره شد. تغییر هم‌اکنون در اثر است — نیازی به راه‌اندازی دوباره نیست.',
  'console_settings.save_failed': 'تنظیمات ذخیره نشد',
  'console_settings.read_failed': 'تنظیمات خوانده نشد',
  'console_settings.all_pinned': 'هر فیلد تغییریافته اکنون در محیط تنظیم شده است.',
  'console_settings.no_password': 'هیچ رمزی برای کنسول تنظیم نشده است',
  'console_settings.no_password_pinned_before':
    'کنسول تا زمانی که رمزی تنظیم نشود آغاز نمی‌شود، و این مقدار ثابت شده است با',
  'console_settings.no_password_pinned_after':
    'در محیط API — که هم‌اکنون خالی است. آنجا مقداری بگذارید و API را دوباره راه‌اندازی کنید، یا آن ' +
    'خط را بردارید تا به‌جایش اینجا تنظیم شود.',
  'console_settings.no_password_here':
    'کنسول تا زمانی که رمزی تنظیم نشود آغاز نمی‌شود، هرچه این کلیدها بگویند — این اعتبارنامه‌ای ' +
    'است که روی نقش Postgres آن نصب می‌شود. یکی را در «رمز نقش کنسول» در پایین بگذارید.',
  'console_settings.pinned_note':
    'توسط {variable} در محیط تنظیم شده است. آن خط را بردارید و API را دوباره راه‌اندازی کنید تا ' +
    'اینجا مدیریتش کنید.',
  'console_settings.password_set': 'تنظیم شده — برای نگه‌داشتن آن، خالی بگذارید',
  'console_settings.password_unset': 'تنظیم نشده',
  'console_settings.clear_password': 'پاک کردن رمز',
  'console_settings.will_clear':
    'هنگام ذخیره پاک خواهد شد. کنسول بلافاصله متوقف می‌شود — بدون رمز نمی‌تواند وارد شود.',
  'console_settings.saving': 'در حال ذخیره…',
  'console_settings.save': 'ذخیرهٔ تغییرات',
  'console_settings.unsaved': '{count} ذخیره‌نشده',
  'console_settings.field.enabled': 'کنسول پرس‌وجو',
  'console_settings.field.enabled_help':
    'کنسول را اجرا می‌کند. هنوز به رمز کنسول نیاز دارد — یکی را در پایین بگذارید — و هنوز تا زمانی ' +
    'که پایگاه داده محدودبودن نقش آن را تأیید نکند آغاز نمی‌شود.',
  'console_settings.field.writeEnabled': 'اجازهٔ نوشتن',
  'console_settings.field.writeEnabled_help':
    'با نقش دیگری از Postgres وارد می‌شود — نقشی که V12 به آن روی جدول‌های عملیاتی UPDATE، INSERT ' +
    'و DELETE می‌دهد. این یک بررسی در سطح برنامه نیست: خاموش‌کردن آن با نقشی وصل می‌شود که اصلاً ' +
    'نمی‌تواند بنویسد.',
  'console_settings.field.timeoutMs': 'مهلت اجرای دستور (میلی‌ثانیه)',
  'console_settings.field.maxRows': 'سقف ردیف‌ها',
  'console_settings.field.maxQueryLength': 'بیشینهٔ طول پرس‌وجو',
  'console_settings.field.audit': 'حسابرسی',
  'console_settings.field.audit_help':
    'آنچه به رد حسابرسی می‌رسد. تا زمانی که نوشتن مجاز است روی «all» ثابت می‌ماند — کنسولی که ' +
    'می‌تواند DELETE کند و ردی که هیچ‌یک را ثبت نمی‌کند، همان ترکیبی است که نباید وجود داشته باشد.',
  'console_settings.field.dbPassword': 'رمز نقش کنسول',
  'console_settings.field.dbPassword_help':
    'هنگام آغاز روی نقش Postgres کنسول نصب می‌شود. هرگز بازگردانده نمی‌شود — سرور تنها گزارش ' +
    'می‌دهد که آیا رمزی تنظیم شده است. ذخیرهٔ یک تغییر، کنسول را دوباره وصل می‌کند، چون ' +
    'اعتبارنامه هنگام راه‌اندازی نصب می‌شود و در غیر این صورت تا راه‌اندازی بعدی اثر نمی‌کند.',

  'severity.critical': 'بحرانی',
  'severity.high': 'زیاد',
  'severity.medium': 'متوسط',
  'severity.low': 'کم',
  'severity.info': 'اطلاعی',

  'kind.arp_spoofing': 'جعل ARP',
  'kind.port_scan': 'پویش پورت',
  'kind.host_sweep': 'جاروب میزبان',
  'kind.syn_flood': 'سیل SYN',
  'kind.plaintext_credentials': 'گواهی‌نامه‌های آشکار',
  'kind.dns_tunneling': 'تونل‌زنی DNS',
  'kind.new_device': 'دستگاه تازه',
  'kind.threat_intel': 'اطلاعات تهدید',

  'kind.arp_spoofing.description':
    'میزبانی که آدرس IP متعلق به دستگاه دیگری را ادعا می‌کند — پایهٔ بیشتر حمله‌های میانی در شبکهٔ محلی.',
  'kind.port_scan.description':
    'یک مبدأ پورت‌های بسیاری را روی یک میزبان می‌آزماید و نقشهٔ سرویس‌های آن را درمی‌آورد.',
  'kind.host_sweep.description':
    'یک مبدأ یک پورت را روی میزبان‌های بسیار می‌آزماید و به دنبال سرویسی برای بهره‌برداری است.',
  'kind.syn_flood.description':
    'آهنگ باورنکردنی تلاش‌های اتصال، که نشانهٔ از کاراندازی سرویس یا پویشگری پرخاشگر است.',
  'kind.plaintext_credentials.description': 'گواهی‌نامه‌ها یا کوکی‌های نشست که بدون رمزگذاری از شبکه می‌گذرند.',
  'kind.dns_tunneling.description':
    'پرس‌وجوهای DNS که به‌جای جست‌وجوی نام، شکل دادهٔ کدشده دارند و نشانهٔ خروج داده یا C2 هستند.',
  'kind.new_device.description': 'آدرس MAC که پیش از این در این شبکه دیده نشده است.',
  'kind.threat_intel.description':
    'آدرس یا دامنه‌ای که با فهرست نشانگرهای بدخواه شناخته‌شده همخوانی دارد — تنها آشکارساز اینجا ' +
    'که بر پایهٔ آستانه نیست.',

  'alerts.tile.all': 'همهٔ یافته‌ها',

  // --- چارچوب و گفت‌وگوها ---

  'nav.open': 'باز کردن ناوبری',
  'guide.title': 'راهنمای کاربر',
  'guide.aria': 'راهنمای کاربر (در برگهٔ تازه باز می‌شود)',
  'admin.settings': 'تنظیمات مدیریت',
  'admin.settings_short': 'تنظیمات',

  'ipinfo.domain_name': 'نام دامنه',
  'ipinfo.geolocation': 'موقعیت جغرافیایی',
  'ipinfo.whois': 'WHOIS',
  'ipinfo.no_ptr': 'رکورد PTR وجود ندارد',
  'ipinfo.no_whois': 'پاسخ WHOIS دریافت نشد',

  'suppressions.hidden_caption': 'پیش از ذخیره دورانداخته، در همهٔ زمان',
  'suppressions.never_caption': 'برقرار است اما چیزی را پنهان نکرده',
  'suppressions.expired_caption': 'دیگر سرکوب نمی‌کند',
  'suppressions.reason_placeholder': 'پویشگر مجاز Nessus، تکت OPS-1421',

  'delivery.form_subtitle': 'اینجا تغییر می‌کند و بی‌درنگ اثر دارد — نه فایلی برای ویرایش، نه راه‌اندازی دوباره',
  'delivery.form_loading': 'در حال بارگذاری پیکربندی کنونی',

  'adhoc.result': 'نتیجه',
  'adhoc.truncated': 'کوتاه‌شده — سطرهای بیشتری هست',

  'capture.bpf_helper': "به‌عنوان فیلتر BPF با host '<'ip> اعمال می‌شود",
  'capture.snaplen_helper': 'بایت در هر فریم',
  'capture.timeout_helper': 'مهلت خواندن pcap',

  'intel.refused_caption': 'بازه‌های خصوصی و ورودی‌های بدشکل',

  // --- مشترک میان صفحه‌ها ---

  'common.refresh': 'به‌روزرسانی',
  'common.close': 'بستن',
  'common.cancel': 'انصراف',
  'common.save': 'ذخیره',
  'common.delete': 'حذف',
  'common.loading': 'در حال بارگذاری…',
  'common.none': '—',
  'common.error_generic': 'چیزی درست پیش نرفت',
};
