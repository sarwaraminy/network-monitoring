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
