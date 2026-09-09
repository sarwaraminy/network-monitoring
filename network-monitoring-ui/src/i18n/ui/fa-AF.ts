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
  'dashboard.total_all_time': '{count, number} در مجموع، از آغاز',
  'dashboard.capture_running': 'در حال اجرا',
  'dashboard.capture_idle': 'غیرفعال',
  'dashboard.pcap_unavailable': 'کتابخانهٔ pcap در دسترس نیست',
  'dashboard.no_capture': 'هیچ ضبطی آغاز نشده',
  'dashboard.per_hour': 'بر اساس شدت، در هر ساعت',
  'dashboard.per_day': 'بر اساس شدت، در هر روز',
  'dashboard.per_week': 'بر اساس شدت، در هر هفته',
  'dashboard.per_month': 'بر اساس شدت، در هر ماه',
  'dashboard.hours_count': '{count, plural, one {# ساعت} other {# ساعت}}',
  'dashboard.days_count': '{count, plural, one {# روز} other {# روز}}',
  'dashboard.weeks_count': '{count, plural, one {# هفته} other {# هفته}}',
  'dashboard.months_count': '{count, plural, one {# ماه} other {# ماه}}',
  'dashboard.occurrences': '{count, plural, one {# رخداد} other {# رخداد}}',
  'common.never': 'هیچ‌گاه',
  'suppressions.preview_none': 'هیچ‌کدام از {examined, number} هشدار اخیر با این قاعده مطابقت ندارد.',
  'suppressions.preview_matched':
    'از {examined, number} هشدار اخیر، {matched, number} مورد را پنهان می‌کرد — در مجموع {occurrences, number} مشاهده.',
  'suppressions.preview_window': 'بررسی‌شده از {from} تا {to}',

  'capture.resume': 'از سرگیری',
  'capture.interrupted_note_anon':
    'ضبط روی {interface} به‌طور غیرمنتظره متوقف شد. در {at} آغاز شده بود و اکنون در حال ' + 'اجرا نیست.',
  'capture.interrupted_note':
    'ضبط روی {interface} به‌طور غیرمنتظره متوقف شد. {by} آن را در {at} آغاز کرده بود و اکنون ' +
    'در حال اجرا نیست.',
  'capture.unavailable_note':
    'ضبط زنده روی سرور در دسترس نیست: کتابخانهٔ ضبط بسته بارگذاری نشد. Npcap (ویندوز) یا libpcap ' +
    '(لینوکس/مک) را نصب کنید و API را دوباره راه‌اندازی کنید. باقی این صفحه همچنان کار می‌کند.',
  'capture.dropped': '{count, number} بستهٔ قدیمی‌تر از بافر دور انداخته شد',
  'packets.non_ip_hidden': '{count, number} غیر IP پنهان شد',
  'capture.loading_interfaces': 'در حال بارگیری رابط‌ها…',
  'capture.no_interfaces': 'سرور هیچ رابطی گزارش نکرد',
  'capture.hide_settings': 'پنهان‌کردن تنظیمات ضبط',
  'capture.show_settings': 'نمایش تنظیمات ضبط',
  'capture.link_type': 'پیوند: {type}',
  'intel.reloading': 'در حال بارگیری دوباره…',
  'intel.reload_feeds': 'بارگیری دوبارهٔ خوراک‌ها',
  'intel.origin.network': 'زنده',
  'intel.origin.network_hint': 'در آخرین تازه‌سازی دانلود شد — این خوراک به‌روز است.',
  'intel.origin.cache': 'ذخیره‌شده',
  'intel.origin.cache_hint':
    'دانلود ناکام ماند و به‌جایش آخرین نسخهٔ ذخیره‌شده به کار رفت. شناسایی همچنان کار می‌کند، اما ' +
    'این نشانگرها به کهنگی آخرین دریافت موفق‌اند.',
  'intel.origin.file': 'پروندهٔ محلی',
  'intel.origin.file_hint': 'از دیسک خوانده شد. تازگی آن به روال خودتان بستگی دارد.',
  'intel.origin.failed': 'ناکام',
  'intel.origin.failed_hint': 'از این منبع چیزی بارگذاری نشد. نشانگرهای آن اصلاً تطبیق داده نمی‌شوند.',
  'intel.subdomain_note':
    'یک نشانگر دامنه، زیردامنه‌های آن را نیز در بر می‌گیرد. نشانی‌های خصوصی و رزروشده هنگام ' +
    'بارگذاری رد می‌شوند، هر چه خوراک بگوید — یکی که به اشتباه فهرست شده باشد، هم‌زمان برای هر ' +
    'میزبان هشدار می‌دهد.',
  'intel.enable_hint': 'برای روشن‌کردن، بیفزایید به',
  'intel.off_note':
    'هیچ‌چیز در برابر نشانی‌ها یا دامنه‌های بدخواه شناخته‌شده تطبیق داده نمی‌شود. به‌صورت پیش‌فرض ' +
    'خاموش است، چون تصمیم دربارهٔ اینکه به کدام اطلاعات اعتماد شود از آنِ شماست، و یک ابزار امنیتی ' +
    'نباید خودسرانه به فهرستی که کسی برنگزیده درخواست بیرونی بفرستد.',
  'intel.local_file_note':
    'مسیر یک پروندهٔ محلی نیز کار می‌کند و انتخاب درست برای میزبانی است که اینترنت خروجی ندارد.',

  // --- قواعد سرکوب، وضعیت تحویل و سلامت خوراک‌ها ---

  'suppressions.state.active': 'فعال',
  'suppressions.state.active_hint': 'یافته‌های همخوان با این قاعده پیش از ذخیره‌شدن دور انداخته می‌شوند.',
  'suppressions.state.disabled': 'خاموش',
  'suppressions.state.disabled_hint': 'خاموش است. یافته‌های همخوان مانند همیشه ذخیره و تحویل می‌شوند.',
  'suppressions.state.expired': 'منقضی',
  'suppressions.state.expired_hint':
    'زمان انقضا گذشته است، پس این قاعده دیگر چیزی را سرکوب نمی‌کند. آن را تمدید یا حذف کنید.',
  'suppressions.state.invalid': 'نامعتبر',
  'suppressions.state.invalid_hint':
    'سرور نتوانست بازهٔ نشانی این قاعده را تجزیه کند، پس با هیچ‌چیز همخوان نیست. بازه را ویرایش ' +
    'کنید — یافته‌هایی که گمان می‌کنید سرکوب شده‌اند، نشده‌اند.',
  'suppressions.enabled_toast': 'قاعدهٔ #{id} روشن است. یافته‌های همخوان دور انداخته می‌شوند.',
  'suppressions.disabled_toast': 'قاعدهٔ #{id} خاموش است. یافته‌های همخوان دوباره ذخیره می‌شوند.',
  'suppressions.update_failed': 'قاعده به‌روز نشد',
  'suppressions.deleted_toast': 'قاعده حذف شد.',
  'suppressions.delete_failed': 'قاعده حذف نشد',
  'suppressions.confirm_delete':
    'قاعدهٔ #{id} حذف شود؟ سابقهٔ {count, number} یافتهٔ پنهان‌شدهٔ آن هم می‌رود. خاموش‌کردن هر دو را ' +
    'نگه می‌دارد.',
  'suppressions.read_failed': 'قواعد سرکوب خوانده نشد',
  'suppressions.invalid_warning':
    '{count, plural, one {# قاعده} other {# قاعده}} نمی‌تواند با چیزی همخوان شود، پس یافته‌هایی که ' +
    'گمان می‌کنید سرکوب شده‌اند سرکوب نمی‌شوند:',
  'suppressions.created_toast': 'قاعدهٔ #{id} ساخته شد و در اثر است.',
  'suppressions.updated_toast': 'قاعدهٔ #{id} به‌روز شد.',
  'suppressions.added_by': ' · افزوده‌شده توسط ',
  'suppressions.edit_rule': 'ویرایش قاعدهٔ {id}',
  'suppressions.switch_off_hint': 'خاموش کنید — یافته‌های همخوان بازمی‌گردند',
  'suppressions.switch_on_hint': 'روشن کنید',
  'suppressions.toggle_rule': '{enabled, select, true {غیرفعال‌کردن} other {فعال‌کردن}} قاعدهٔ {id}',
  'suppressions.delete_rule': 'حذف قاعدهٔ {id}',
  'suppressions.in_force_count': '{count} در اثر',
  'suppressions.search': 'جست‌وجوی قواعد',
  'suppressions.check_failed': 'قاعده بررسی نشد',
  'suppressions.save_failed': 'قاعده ذخیره نشد',
  'suppressions.edit_title': 'ویرایش قاعدهٔ #{id}',
  'suppressions.new_title': 'قاعدهٔ سرکوب تازه',
  'suppressions.dialog_note':
    'یک یافته زمانی سرکوب می‌شود که با هر میدانی که پر می‌کنید همخوان باشد. میدان خالی یعنی «هر ' +
    'چیزی». یافته‌های سرکوب‌شده دور انداخته می‌شوند، پس هیچ‌چیز در پایین‌دست — فهرست هشدارها، ' +
    'وب‌هوک، جریان SIEM — هرگز آن‌ها را نمی‌بیند.',
  'suppressions.cidr_placeholder': '10.20.30.40 یا 10.20.30.0/24',
  'suppressions.checking': 'در حال بررسی…',
  'suppressions.check_against': 'بررسی در برابر هشدارهای اخیر',
  'suppressions.unknown_source': 'ناشناخته',
  'suppressions.saving': 'در حال ذخیره…',
  'suppressions.save_changes': 'ذخیرهٔ تغییرات',
  'suppressions.create_rule': 'ساختن قاعده',

  'delivery.gate.throttle_note': 'همان یافته درون این بازه دوباره اطلاع‌رسانی نمی‌کند.',
  'delivery.gate.ceiling_note': 'سقفی قطعی برای پیام در ساعت، هر چه شناسایی انجام دهد.',
  'delivery.test_partial': 'به {delivered} تحویل شد. ناکام: {failures}',
  'delivery.test_ok': 'به {delivered} کانال تحویل شد. بررسی کنید که هر یک رسیده باشد.',
  'delivery.test_failed': 'ارسال آزمایشی ناکام ماند',
  'delivery.sending': 'در حال ارسال…',
  'delivery.send_test': 'ارسال آزمایشی',
  'delivery.status_failed': 'وضعیت تحویل خوانده نشد',
  'delivery.nothing_configured': 'هیچ‌چیز پیکربندی نشده، پس یافته‌ها ثبت می‌شوند و به کسی گفته نمی‌شود.',
  'delivery.nothing_configured_admin':
    ' زیر چرخ‌دندهٔ تنظیمات یک میزبان گردآورنده، یک نشانی وب‌هوک، یا یک میزبان SMTP با گیرندگان ' +
    'تعیین کنید — نه پرونده‌ای برای ویرایش و نه راه‌اندازی دوباره.',
  'delivery.nothing_configured_user': ' یک مدیر می‌تواند وب‌هوک، ایمیل یا گردآورندهٔ syslog را پیکربندی کند.',
  'delivery.switched_off': 'کانال‌ها پیکربندی شده‌اند اما تحویل خاموش است، پس هیچ هشداری فرستاده نمی‌شود.',
  'delivery.switched_off_admin': ' «تحویل هشدارها» را زیر چرخ‌دندهٔ تنظیمات روشن کنید.',
  'delivery.test_still_works':
    ' ارسال آزمایشی همچنان کار می‌کند — به‌عمد از این می‌گذرد، چون پرسشی که پاسخ می‌دهد این است ' +
    'که آیا تحویل اصلاً به شما می‌رسد.',
  'delivery.syslog_unaffected': ' syslog تحت تأثیر نیست: از این کلید مستقل است.',
  'delivery.channel.webhook': 'وب‌هوک',
  'delivery.channel.webhook_hint': 'Slack، Teams، Discord یا JSON ساده',
  'delivery.channel.webhook_format': 'قالب {format}',
  'delivery.channel.email': 'ایمیل',
  'delivery.channel.email_hint': 'میزبان SMTP، فرستنده و دست‌کم یک گیرنده',
  'delivery.channel.recipients': '{count, plural, one {# گیرنده} other {# گیرنده}}',
  'delivery.channel.syslog': 'Syslog',
  'delivery.channel.syslog_hint': 'برای روشن‌کردن، SYSLOG_HOST را تنظیم کنید',
  'delivery.four_limits':
    'پیش از فرستادن هر چیزی، چهار حد اعمال می‌شود. هر یک از آن‌ها دلیلی است برای اینکه چرا هشداری ' +
    'که انتظارش را داشتید نرسید — و برای همین اینجا هستند، نه دفن‌شده در یک پروندهٔ پیکربندی.',
  'delivery.siem_note':
    'هیچ‌یک از حدهای سمت چپ اینجا اعمال نمی‌شود. یک SIEM خودش همبستگی می‌سازد و تکرارها را حذف ' +
    'می‌کند، و این کار را با این فرض انجام می‌دهد که جریان کامل رویدادها را دارد — خلاصه‌سازی باعث ' +
    'می‌شود هر قاعده‌ای که رویدادها را در یک بازه می‌شمارد خاموشانه کمتر گزارش دهد، و رویدادهای ' +
    'سرکوب‌شده را به دوره‌هایی به‌ظاهر آرام تبدیل می‌کند.',
  'delivery.included': 'گنجانده‌شده',
  'delivery.omitted': 'حذف‌شده',
  'delivery.configured': 'پیکربندی‌شده',
  'delivery.off': 'خاموش',
  'delivery.saved': 'ذخیره شد. تغییر هم‌اکنون در اثر است — نیازی به راه‌اندازی دوباره نیست.',
  'delivery.save_failed': 'تنظیمات ذخیره نشد',
  'delivery.tls_587':
    'درگاه ۵۸۷ با TLS ضمنی تا پایان مهلت اتصال معلق می‌ماند: ۵۸۷ انتظار STARTTLS دارد. از درگاه ' +
    '۴۶۵ استفاده کنید، یا TLS ضمنی را خاموش کنید.',
  'delivery.tls_465':
    'درگاه ۴۶۵ از نخستین بایت انتظار TLS ضمنی دارد. TLS ضمنی را روشن کنید، یا از درگاه ۵۸۷ ' +
    'استفاده کنید.',
  'delivery.all_pinned_note':
    'هر میدان تغییریافته اکنون در محیط تنظیم شده و ذخیره نمی‌شود. برای پاک‌کردن این ویرایش‌ها ' +
    'دور بیندازید.',
  'delivery.unsaved': '{count} ذخیره‌نشده',
  'delivery.saving': 'در حال ذخیره…',
  'delivery.save_changes': 'ذخیرهٔ تغییرات',
  'delivery.pinned_note':
    '{count, plural, one {# تنظیم} other {# تنظیم}} در محیط تعیین شده و اینجا تغییرپذیر نیست. ' +
    'برای مدیریت از این صفحه، متغیر را از api/.env (یا پروندهٔ Compose خود) بردارید.',
  'delivery.secret_stored_unused': 'ذخیره‌شده، و روش کنونی از آن استفاده نمی‌کند',
  'delivery.secret_configured': 'پیکربندی‌شده — برای جایگزینی تایپ کنید',
  'delivery.secret_unset': 'پیکربندی‌نشده',
  'delivery.secret_unused_note':
    'روش احراز هویت کنونی از این استفاده نمی‌کند. هنوز ذخیره شده است — مگر آنکه قصد بازگشت ' +
    'دارید، آن را پاک کنید.',
  'delivery.set_not_set': 'تنظیم‌نشده',
  'delivery.pinned_by': 'توسط {name} تنظیم شده. برای ویرایش اینجا، آن را از api/.env بردارید.',
  'delivery.the_environment': 'محیط',
  'delivery.environment': 'محیط',

  'intel.health_failing': '{count} ناکام',
  'intel.health_stale': '{count} روی نسخهٔ ذخیره‌شده',
  'intel.health_ok': 'همه بارگذاری شد',
  'intel.reloaded_toast': '{count, number} نشانگر از {feeds} خوراک دوباره بارگیری شد.',
  'intel.reload_failed': 'بارگیری دوباره ناکام ماند',
  'intel.status_failed': 'وضعیت اطلاعات تهدید خوانده نشد',
  'intel.no_feeds_body':
    'اطلاعات تهدید روشن است اما هیچ خوراکی پیکربندی نشده، پس چیزی تطبیق داده نمی‌شود. تنظیم کنید',
  'intel.no_feeds_tail': 'به یک یا چند جفت نام=مکان.',
  'intel.failed_feeds':
    '{count, plural, one {# خوراک} other {# خوراک}} اصلاً بارگذاری نشد: {names}. نشانگرهای آن‌ها ' +
    'تطبیق داده نمی‌شوند.',
  'intel.stale_feeds':
    '{count, plural, one {# خوراک} other {# خوراک}} به نسخهٔ ذخیره‌شده بازگشت: {names}. شناسایی ' +
    'همچنان کار می‌کند، اما این نشانگرها تنها به تازگی آخرین دانلود موفق‌اند.',
  'intel.search': 'جست‌وجوی خوراک‌ها',

  // --- رد حسابرسی، هشدارها و کنسول ---

  'audit.empty_failed': 'رد حسابرسی خوانده نشد، پس این به معنای آن نیست که چیزی رخ نداده است.',
  'audit.empty_none':
    'هنوز چیزی حذف، تغییر یا تغییرمسیر نشده است. به‌محض اینکه چنین شود، ورودی‌ها اینجا نمایان ' + 'می‌شوند.',
  'audit.empty_for_action': 'برای این کنش ورودی‌ای نیست.',
  'audit.admin_only':
    'رد حسابرسی برای مدیران دیدنی است. ثبت می‌کند چه کسی چه چیزی را حذف، تغییر یا تغییرمسیر داده ' +
    'و نام حساب‌ها را می‌آورد.',
  'audit.filter_by_action': 'پالایش بر پایهٔ کنش',
  'audit.load_failed': 'رد حسابرسی بارگیری نشد',
  'audit.actions_failed': 'فهرست کنش‌ها بارگیری نشد — پالایش بر پایهٔ کنش در دسترس نیست',
  'audit.loading_more': 'در حال بارگیری…',
  'audit.load_older': 'بارگیری ورودی‌های قدیمی‌تر',

  'alerts.load_failed': 'هشدارها بارگیری نشد',
  'alerts.summary_failed': 'خلاصهٔ هشدارها بارگیری نشد',
  'alerts.update_failed': 'هشدار به‌روز نشد',
  'alerts.delete_failed': 'هشدار حذف نشد',
  'alerts.delete_finding': 'حذف یافتهٔ {id}',
  'alerts.this_sensor': ' (همین یکی)',
  'alerts.empty_body':
    'هیچ یافته‌ای با این پالایه‌ها همخوان نیست. فهرست خالی در هنگام ضبط یعنی آشکارسازها چیز ' +
    'مشکوکی ندیده‌اند — که در یک شبکهٔ سالم نتیجهٔ مورد انتظار است.',
  'alerts.yes': 'بله',
  'alerts.no': 'نه',
  'alerts.evidence_more': '{shown} و {count} مورد دیگر',

  'adhoc.admin_only': 'کنسول پرس‌وجو تنها در دسترس مدیران است.',
  'adhoc.availability_failed': 'نشد از سرور پرسید که آیا کنسول پرس‌وجو در دسترس است. {detail}',
  'adhoc.hide_query': 'پنهان‌کردن پرس‌وجو',
  'adhoc.show_query': 'نمایش پرس‌وجو',
  'adhoc.running': 'در حال اجرا',
  'adhoc.run': 'اجرا',
  'adhoc.shortcut_note':
    'Ctrl/Cmd + Enter هم اجرا می‌کند. نوشتن و ستون‌های دارای رازها را پایگاه داده رد می‌کند، نه ' + 'این صفحه.',
  'adhoc.rows_affected': '{command} — {count, plural, one {# ردیف} other {# ردیف}} در {ms} ms',
  'adhoc.rows_in': '{count, plural, one {# ردیف} other {# ردیف}} در {ms} ms',

  'packets.search': 'جست‌وجوی بسته‌ها',
  'packets.frame_data': 'دادهٔ فریم ({bytes} بایت)',
  'packets.no_frame_data': 'هیچ دادهٔ فریمی ضبط نشد',
  'packets.padding': 'پرکنندهٔ اترنت ({bytes} بایت)',
  'packets.no_padding': 'این فریم پرکننده ندارد',
  'packets.waiting': 'در انتظار بسته‌ها…',
  'packets.none_yet': 'هنوز بسته‌ای ضبط نشده. یک رابط برگزینید و ضبط را آغاز کنید.',
  'capture.start_failed': 'ضبط آغاز نشد',
  'capture.stop_failed': 'ضبط متوقف نشد',
  'capture.clear_failed': 'بسته‌های ضبط‌شده پاک نشد',
  'capture.interfaces_failed': 'رابط‌های شبکه بارگیری نشد',
  'capture.packets_failed': 'بسته‌های ضبط‌شده دریافت نشد',
  'capture.filter_chip': 'پالایه: {filter}',
  'capture.findings_chip': '{count, plural, one {# یافته} other {# یافته}} — دیدن هشدارها',

  'ipinfo.postal_code': 'کد پستی',
  'ipinfo.timezone': 'منطقهٔ زمانی',
  'ipinfo.isp': 'ISP',
  'ipinfo.organization': 'سازمان',
  'ipinfo.lookup_of_failed': 'جست‌وجوی {ipAddress} ناکام ماند',
  'login.failed': 'ورود ناکام ماند',
  'signup.create_failed': 'حساب ساخته نشد',
  'signup.min_length': 'دست‌کم {count} نویسه',
  'signup.mismatch': 'رمزها یکسان نیستند',
  'signup.on_the_server': 'روی سرور.',
  'common.account': 'حساب',
  'common.nothing_to_show': 'چیزی برای نمایش نیست.',
  'common.something_wrong': 'چیزی خطا رفت',

  // --- منوی مدیریت ---

  'admin.group.database': 'پایگاه داده',
  'admin.group.notifications': 'اطلاع‌رسانی‌ها',
  'admin.group.accounts': 'حساب‌ها',
  'admin.tool.console': 'کنسول پرس‌وجو',
  'admin.tool.console_desc': 'اینکه آیا کنسول SQL موردی می‌تواند آغاز شود، و چرا نه.',
  'admin.tool.console_settings': 'تنظیمات کنسول پرس‌وجو',
  'admin.tool.console_settings_desc': 'روشن یا خاموش کردن آن و تعیین حدودش، بدون راه‌اندازی دوباره.',
  'admin.tool.delivery': 'تنظیمات تحویل',
  'admin.tool.delivery_desc': 'اینکه یافته‌ها کجا می‌روند و هر چند وقت. با ذخیره در اثر می‌آید.',
  'admin.tool.users': 'کاربران و نقش‌ها',
  'admin.tool.users_desc': 'اینکه چه کسی مدیر است. در رد حسابرسی ثبت می‌شود.',

  // --- نام‌های میدان شواهد ---

  'evidence.feed': 'خوراک',
  'evidence.feedNote': 'یادداشت خوراک',
  'evidence.exporter': 'فرستنده',
  'evidence.direction': 'جهت',
  'evidence.indicator': 'نشانگر',
  'evidence.indicatorType': 'نوع نشانگر',
  'evidence.matchedAddress': 'نشانی منطبق',
  'evidence.observedVia': 'مشاهده‌شده از راه',
  'evidence.flowBytes': 'بایت‌های جریان',
  'evidence.flowPackets': 'بسته‌های جریان',
  'evidence.destinationPort': 'درگاه مقصد',
  'evidence.port': 'درگاه',
  'evidence.count': 'شمار',
  'evidence.seconds': 'ثانیه',
  'evidence.scanner': 'پویشگر',
  'evidence.service': 'سرویس',
  'evidence.hasService': 'سرویس دارد',
  'evidence.sampleHosts': 'میزبان‌های نمونه',
  'evidence.distinctPortsProbed': 'درگاه‌های متمایز آزموده‌شده',
  'evidence.distinctHostsProbed': 'میزبان‌های متمایز آزموده‌شده',
  'evidence.distinctTargets': 'هدف‌های متمایز',
  'evidence.attemptsInWindow': 'تلاش‌ها در بازه',
  'evidence.username': 'نام کاربری',
  'evidence.passwordLength': 'طول رمز',
  'evidence.passwordRecorded': 'رمز ثبت شد',
  'evidence.previousMac': 'MAC پیشین',
  'evidence.knownDevicesBefore': 'دستگاه‌های شناخته‌شدهٔ پیشین',
  'evidence.vendor': 'سازنده',

  // --- بازه‌های زمانی و دیگر کنترل‌ها ---

  'period.1h': 'یک ساعت گذشته',
  'period.12m': '۱۲ ماه گذشته',
  'period.24h': '۲۴ ساعت گذشته',
  'period.7d': '۷ روز گذشته',
  'period.30d': '۳۰ روز گذشته',
  'period.90d': '۹۰ روز گذشته',
  'period.5y': '۵ سال گذشته',
  'period.all': 'همهٔ زمان‌ها',
  'ipinfo.looking_up': 'در حال اجرای جست‌وجوی DNS معکوس، WHOIS و موقعیت جغرافیایی…',
  'ipinfo.lookup_failed': 'جست‌وجو ناکام ماند: {reason}',
  'ipinfo.no_geo': 'داده‌ای از موقعیت جغرافیایی نیست',
  'suppressions.any_finding': 'هر یافته‌ای',
  'suppressions.rule_from': 'از {cidr}',
  'suppressions.rule_to': 'به {cidr}',
  'suppressions.rule_port': 'روی درگاه {port}',
  'intel.matched_on_all': 'بر هر بسته و هر جریان تطبیق داده می‌شود',
  'intel.is_off': 'اطلاعات تهدید خاموش است',
  'intel.refreshes_every': 'هر {hours} ساعت تازه می‌شود',

  // --- کنترل‌های مشترک ---

  'common.refresh': 'تازه‌سازی',
  'common.cancel': 'انصراف',
  'common.close': 'بستن',
  'common.discard': 'دورانداختن',
  'delivery.settings_title': 'تنظیمات',
  'delivery.read_failed': 'تنظیمات تحویل خوانده نشد',
  'delivery.moved_note':
    'تنظیمات تحویل به «تنظیمات مدیریت» منتقل شد — چرخ‌دنده در سربرگ — تا به‌جای دو جا، یک جا برای تغییر آن‌ها باشد. این صفحه چیزی را نگه می‌دارد که جای دیگری نیست: اینکه آیا تحویل کار می‌کند، و ارسال آزمایشی.',
  'login.admin_required': 'ضبط ترافیک به یک نشست مدیر نیاز دارد',
  'packets.captured': 'بسته‌های ضبط‌شده',
  'packets.shown': '{count, number} نمایش‌داده‌شده',
  'common.clear': 'پاک کردن',
  'grid.page_range': '{start, number}–{end, number} از {total, number}',
  'grid.page_range_filtered': '{range}، فیلترشده از {unfiltered, number}',
  'common.rows_per_page': 'ردیف در هر صفحه',
  'common.all_sensors': 'همهٔ حسگرها',
  'common.all_detectors': 'همهٔ آشکارسازها',
  'common.all_actions': 'همهٔ کنش‌ها',
  'common.any_kind': 'هر نوعی',
  'common.open_only': 'فقط باز',
  'common.no_error_message': 'هیچ پیام خطایی ارائه نشد.',
  'common.try_again': 'دوباره تلاش کنید',
  'common.reload_app': 'بارگیری دوبارهٔ برنامه',
  'common.render_failed': 'در نمایش این صفحه چیزی خراب شد',
  'capture.start': 'آغاز ضبط',
  'capture.stop': 'توقف',
  'capture.capturing': 'در حال ضبط',
  'capture.idle': 'غیرفعال',
  'ipinfo.title': 'اطلاعات IP',
  'ipinfo.country': 'کشور',
  'ipinfo.region': 'منطقه',
  'ipinfo.city': 'شهر',
  'ipinfo.coordinates': 'مختصات',
  'alerts.nothing_to_report': 'چیزی برای گزارش نیست',
  'chart.no_findings_period': 'در این بازه یافته‌ای نیست.',
  'chart.detail_from_here': 'جزئیات از اینجا نگهداری می‌شود',
  'suppressions.new_rule': 'قاعدهٔ تازه',
  'adhoc.no_rows': 'پرس‌وجو اجرا شد و هیچ ردیفی برنگرداند.',
  'intel.off': 'اطلاعات تهدید خاموش است',
  'intel.licence_note': 'پیش از تکیه بر هر خوراک برای مقاصد تجاری، پروانهٔ آن را بررسی کنید.',

  // --- تحویل هشدارها ---

  'delivery.section.0': 'دروازه‌ها',
  'delivery.section.0_subtitle': 'بر کانال‌هایی اعمال می‌شود که انسان می‌خواند، هرگز بر جریان SIEM',
  'delivery.field.enabled': 'تحویل هشدارها',
  'delivery.field.enabled_help':
    'خاموش یعنی یافته‌ها ثبت می‌شوند و به کسی گفته نمی‌شود. syslog تحت تأثیر قرار نمی‌گیرد.',
  'delivery.field.minSeverity': 'کمینهٔ شدت',
  'delivery.field.digestSeconds': 'بازهٔ خلاصه (ثانیه)',
  'delivery.field.digestSeconds_help':
    'یافته‌ها به این اندازه دسته می‌شوند، تا یک انفجار یک پیام شود. صفر یعنی بدون دسته‌بندی.',
  'delivery.field.throttleSeconds': 'محدودیت هر یافته (ثانیه)',
  'delivery.field.throttleSeconds_help': 'همان یافته درون این بازه دوباره اطلاع‌رسانی نمی‌کند.',
  'delivery.field.maxPerHour': 'بیشینهٔ پیام در ساعت',
  'delivery.field.maxPerHour_help': 'یک سقف قطعی، هر چه شناسایی انجام دهد.',
  'delivery.field.includeEvidence': 'گنجاندن شواهد',
  'delivery.field.includeEvidence_help':
    'شواهد هرگز رمز یا محتوای بسته را در بر ندارد، اما نشانی‌های داخلی و نام‌های کاربری را دارد ' +
    '— که آنگاه یک سرویس گفت‌وگوی بیرونی آن را نگه می‌دارد.',
  'delivery.field.dashboardUrl': 'پیوند داشبورد',
  'delivery.field.dashboardUrl_help': 'در هر پیام پیوند داده می‌شود، مثلاً https://nmt.example.com/alerts',
  'delivery.section.1': 'وب‌هوک',
  'delivery.section.1_subtitle': 'Slack، Teams، Discord یا هر چیزی که JSON بپذیرد',
  'delivery.field.webhookUrl': 'نشانی وب‌هوک',
  'delivery.field.webhookUrl_help':
    'برای Teams یک وب‌هوک Workflows بسازید — نشانی آن روی logic.azure.com است. به‌عنوان ' +
    'اعتبارنامه رفتار می‌شود و هرگز بازگردانده نمی‌شود.',
  'delivery.field.webhookFormat': 'قالب بار',
  'delivery.field.webhookFormat_help':
    '«auto» میزبان را می‌خواند و شکل درست را برمی‌گزیند، از جمله رابط بازنشستهٔ Office 365 برای ' +
    'نشانی webhook.office.com.',
  'delivery.section.2': 'ایمیل',
  'delivery.section.2_subtitle':
    'یک رلهٔ داخلی به اعتبارنامه نیاز ندارد و پاسخ درست برای یک حسگر درون‌سازمانی است',
  'delivery.field.emailHost': 'میزبان SMTP',
  'delivery.field.emailPort': 'درگاه',
  'delivery.field.emailSecure': 'TLS ضمنی',
  'delivery.field.emailSecure_help':
    'تنها برای درگاه ۴۶۵ درست است. روی ۵۸۷ آن را خاموش بگذارید — به‌جایش STARTTLS مذاکره می‌شود، ' +
    'و روشن‌کردن آن اینجا تا پایان مهلت اتصال معلق می‌ماند.',
  'delivery.field.emailFrom': 'نشانی فرستنده',
  'delivery.field.emailTo': 'گیرندگان',
  'delivery.field.emailTo_help': 'هر کدام در یک سطر، یا جداشده با کاما.',
  'delivery.field.emailAuthMethod': 'احراز هویت',
  'delivery.field.emailAuthMethod_help':
    'OAuth2 همان XOAUTH2 با توکن تازه‌سازی است، برای مستأجری از Microsoft 365 یا Google که چیز ' +
    'دیگری را نمی‌پذیرد.',
  'delivery.field.emailUser': 'نام کاربری',
  'delivery.field.emailUser_help':
    'برای رله‌ای که احراز هویت نمی‌خواهد خالی بگذارید. زیر OAuth2 این همان صندوقی است که از آن ' +
    'فرستاده می‌شود و الزامی است.',
  'delivery.field.emailPassword': 'رمز',
  'delivery.field.emailPassword_help':
    'Microsoft 365 و Google به‌صورت پیش‌فرض SMTP AUTH ساده را غیرفعال می‌کنند، بنابراین رمز درست ' +
    'هم ممکن است رد شود.',
  'delivery.field.emailOauthTokenUrl': 'نقطهٔ پایانی توکن',
  'delivery.field.emailOauthTokenUrl_help':
    'مایکروسافت: https://login.microsoftonline.com/[tenant]/oauth2/v2.0/token — گوگل: ' +
    'https://oauth2.googleapis.com/token',
  'delivery.field.emailOauthClientId': 'شناسهٔ کارخواه',
  'delivery.field.emailOauthClientSecret': 'راز کارخواه',
  'delivery.field.emailOauthRefreshToken': 'توکن تازه‌سازی',
  'delivery.field.emailOauthRefreshToken_help':
    'یک‌بار با رضایت‌دادن به ثبت برنامه به دست می‌آید. Nodemailer آن را با توکن دسترسی مبادله ' +
    'می‌کند و خودش آن را تازه می‌کند.',
  'delivery.field.emailOauthScope': 'دامنه',
  'delivery.field.emailOauthScope_help':
    'اختیاری. گوگل آن را نادیده می‌گیرد؛ برخی مستأجران مایکروسافت به ' +
    'https://outlook.office.com/SMTP.Send offline_access نیاز دارند.',
  'delivery.section.3': 'Syslog / SIEM',
  'delivery.section.3_subtitle': 'به‌عمد بدون دروازه: یک SIEM خودش همبستگی می‌سازد و به جریان کامل نیاز دارد',
  'delivery.field.syslogHost': 'میزبان گردآورنده',
  'delivery.field.syslogPort': 'درگاه',
  'delivery.field.syslogProtocol': 'پروتکل',
  'delivery.field.syslogFormat': 'قالب',
  'delivery.field.syslogRfc': 'RFC',
  'delivery.field.syslogRfc_help': '۳۱۶۴ در مهر زمانی خود نه سال دارد و نه منطقهٔ زمانی؛ ۵۴۲۴ را ترجیح دهید.',
  'delivery.field.syslogFacility': 'Facility',
  'delivery.field.syslogFacility_help': '۱۶ تا ۲۳ برای استفادهٔ محلی‌اند؛ ۱۶ همان local0 است.',
  'delivery.field.syslogAppName': 'نام برنامه',
  'delivery.field.syslogIncludeEvidence': 'گنجاندن شواهد',
  'delivery.field.syslogIncludeEvidence_help':
    'اینجا به‌صورت پیش‌فرض روشن است، برخلاف کانال‌های گفت‌وگو: استدلال افشا دربارهٔ گردآورنده‌ای ' +
    'درون شبکهٔ خودتان صدق نمی‌کند.',

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
};
