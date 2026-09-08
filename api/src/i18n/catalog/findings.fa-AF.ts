import type { PartialFindingCatalog } from './findings.en.js';

/**
 * The finding catalogue in Dari.
 *
 * **Machine-drafted. Needs review by a native speaker before it is relied on**, and
 * more urgently than the German one: this is the language nobody on the team reads,
 * so a wrong word here has nothing standing between it and an operator. Keys absent
 * from this file fall back to the English pattern per key, so deleting an entry you
 * are unsure of is a safe edit and leaves a readable sentence behind.
 *
 * Written right to left, which is what makes this an architectural change rather
 * than a string-extraction exercise. Three consequences visible in this file:
 *
 * - **The interpolated identifiers are not isolated here.** An address, MAC, port
 *   or domain placed inside a right-to-left sentence renders in the wrong visual
 *   order unless it is isolated, and `192.168.1.10` shown with its octets
 *   reordered is an operator reading an address that is not the one in the
 *   finding. That is applied centrally at render time — U+2068/U+2069 around every
 *   string parameter — rather than being remembered at each of the interpolation
 *   sites below. See ../render.ts.
 * - **Digits stay ASCII inside identifiers.** Eastern Arabic-Indic digits (۱۲۳) are
 *   idiomatic in Dari prose and the counts here use them, because they interpolate
 *   as numbers. Ports, addresses and byte counts interpolate as strings precisely
 *   so they do not: a shaped port stops being copy-pasteable and stops matching
 *   what the switch and `tcpdump` print.
 * - **Dari has plural categories English does not**, which is why `plural` is used
 *   rather than a hand-written conditional. `one` here covers the singular; CLDR
 *   routes everything else to `other`.
 *
 * Protocol and service names — ARP, SMB file sharing, Telnet, POP3 — stay in Latin
 * script for the same reason they stay English in German: they name the string a
 * firewall rule or an `nmap` report prints.
 */
export const FINDINGS_FA_AF: PartialFindingCatalog = {
  // --- جعل ARP ---

  'arp_spoofing.configured.title': 'جعل ARP: آدرس {ip} توسط {mac} ادعا شد',
  'arp_spoofing.configured.description':
    '{mac} یک پیام {operation} از نوع ARP فرستاده و {ip} را ادعا می‌کند، در حالی که این آدرس روی ' +
    '{configuredMac} پیکربندی شده است. میزبانی در شبکه خود را به جای {ip} جا می‌زند و از این راه ' +
    'می‌تواند ترافیکِ مقصدِ آن آدرس را شنود کند.',

  'arp_spoofing.conflict.title': 'جعل ARP: آدرس {ip} از {previousMac} به {mac} منتقل شد',
  'arp_spoofing.conflict.description':
    'آدرس {ip} به‌طور پیوسته توسط {previousMac} پاسخ داده می‌شد ({observations, plural, one {# مشاهده} ' +
    'other {# مشاهده}}) و اکنون {mac} آن را ادعا می‌کند. ' +
    '{flipping, select, ' +
    'true {این دو آدرس به‌نوبت جای یکدیگر را می‌گیرند؛ این امضای یک حملهٔ فعال مسموم‌سازی ARP است: ' +
    'مهاجم پیوسته حافظهٔ ARP قربانی را بازنویسی می‌کند تا ترافیک از مسیر او بگذرد.} ' +
    'other {این می‌تواند تعویض یک دستگاه یا تغییر DHCP باشد، اما راه ورود یک مهاجم میانی نیز همین ' +
    'است. تأیید کنید که آدرس تازه به سخت‌افزار مورد انتظار تعلق دارد.}}',

  'arp_spoofing.sprawl.title':
    '{mac} ادعای {count, plural, one {# آدرس IP متفاوت} other {# آدرس IP متفاوت}} را دارد',
  'arp_spoofing.sprawl.description':
    '{mac} پیام‌های ARP فرستاده و {count, plural, one {# آدرس مجزا} other {# آدرس مجزا}} را ادعا کرده ' +
    'است. یک میزبان عادی تنها برای آدرس خودش پاسخ می‌دهد. پاسخ دادن برای آدرس‌های بسیار، روشی است که ' +
    'مهاجم با آن حافظهٔ ARP یک زیرشبکهٔ کامل را یک‌جا مسموم می‌کند.',

  // --- پویش پورت ---

  'port_scan.packet.title':
    'پویش پورت: {source} تعداد {count, plural, one {# پورت} other {# پورت}} را روی {target} آزمود',
  'port_scan.packet.description':
    '{source} در {seconds, plural, one {# ثانیه} other {# ثانیه}} به ' +
    '{count, plural, one {# پورت متفاوت} other {# پورت متفاوت}} روی {target} تلاش اتصال کرده است. ' +
    'کارخواه‌های مجاز تنها به یک یا دو پورت شناخته‌شده وصل می‌شوند؛ جاروب کردن یک محدوده روشی است که ' +
    'مهاجم با آن نقشهٔ سرویس‌های یک میزبان را درمی‌آورد و معمولاً پیش‌درآمد تلاش برای بهره‌برداری است.',

  'port_scan.flow.title':
    'پویش پورت: {source} تعداد {count, plural, one {# پورت} other {# پورت}} را روی {target} آزمود',
  'port_scan.flow.description':
    '{source} در {seconds, plural, one {# ثانیه} other {# ثانیه}} به ' +
    '{count, plural, one {# پورت متفاوت} other {# پورت متفاوت}} روی {target} اتصال‌های بی‌پاسخ باز ' +
    'کرده است؛ این را صادرکنندهٔ جریان در {exporter} گزارش کرده است. هیچ‌یک از این اتصال‌ها تأیید ' +
    'نشده، یعنی چیزی در حال شنیدن نبوده یا دیوار آتش آن‌ها را دور انداخته است — امضای نقشه‌برداری از ' +
    'سرویس‌های یک میزبان، که معمولاً پیش‌درآمد تلاش برای بهره‌برداری است.',

  // --- جاروب میزبان ---

  'host_sweep.packet.title':
    'جاروب میزبان: {source} پورت {port} را روی {count, plural, one {# میزبان} other {# میزبان}} آزمود',
  'host_sweep.packet.description':
    '{source} در {seconds, plural, one {# ثانیه} other {# ثانیه}} به پورت {port} روی ' +
    '{count, plural, one {# میزبان متفاوت} other {# میزبان متفاوت}} تلاش اتصال کرده است. جاروب کردن ' +
    'یک سرویس در سراسر یک زیرشبکه روشی است که مهاجم یا کرم با آن هر ماشینی را که آن سرویس را اجرا ' +
    'می‌کند پیدا می‌کند. پورت {port}{hasService, select, true { ({service})} other {}} هدف رایجی برای ' +
    'حرکت جانبی در شبکه است.',
  'host_sweep.flow.title':
    'جاروب میزبان: {source} پورت {port} را روی {count, plural, one {# میزبان} other {# میزبان}} آزمود',
  'host_sweep.flow.description':
    '{source} در {seconds, plural, one {# ثانیه} other {# ثانیه}} به پورت ' +
    '{port}{hasService, select, true { ({service})} other {}} روی ' +
    '{count, plural, one {# میزبان متفاوت} other {# میزبان متفاوت}} اتصال‌های بی‌پاسخ باز کرده است. ' +
    'جاروب کردن یک سرویس در سراسر یک زیرشبکه روشی است که مهاجم یا کرم با آن هر ماشینی را که آن سرویس ' +
    'را اجرا می‌کند پیدا می‌کند، و نشانهٔ نیرومندی از حرکت جانبی است تا ترافیک عادی کارخواه.',

  // --- سیل اتصال ---

  'syn_flood.packet.title':
    'سیل SYN: {count, plural, one {# تلاش اتصال} other {# تلاش اتصال}} از {source} در {seconds} ثانیه',
  'syn_flood.packet.description':
    '{source} در {seconds, plural, one {# ثانیه} other {# ثانیه}} تعداد ' +
    '{count, plural, one {# تلاش اتصال TCP} other {# تلاش اتصال TCP}} انجام داده بدون آنکه دست‌دهی را ' +
    'کامل کند. با این آهنگ، ترافیک یا تلاشی برای از کاراندازی سرویس است — که جدول اتصال‌های هدف را ' +
    'تهی می‌کند — یا یک پویشگر خودکار پرخاشگر.',

  'syn_flood.flow.title':
    'سیل اتصال: {count, plural, one {# تلاش بی‌پاسخ} other {# تلاش بی‌پاسخ}} از {source} در ' +
    '{seconds} ثانیه',
  'syn_flood.flow.description':
    '{source} در {seconds, plural, one {# ثانیه} other {# ثانیه}} تعداد ' +
    '{count, plural, one {# اتصال TCP} other {# اتصال TCP}} باز کرده که هرگز تأیید نشدند. با این ' +
    'آهنگ، ترافیک یا تلاشی برای از کاراندازی سرویس است — که جدول اتصال‌های هدف را تهی می‌کند — یا یک ' +
    'پویشگر خودکار پرخاشگر.',

  // --- تونل‌زنی DNS ---

  'dns_tunneling.detected.title':
    'احتمال تونل‌زنی DNS به {domain} از {hasSource, select, true {{source}} other {میزبان ناشناس}}',
  'dns_tunneling.detected.description':
    'پرس‌وجوهای DNS به {domain} شبیه جست‌وجوی عادی نام نیستند: {reasons}. این الگو ویژهٔ داده‌ای است ' +
    'که از راه DNS بیرون برده می‌شود، یا بدافزاری که از DNS برای فرماندهی و کنترل استفاده می‌کند — ' +
    'زیرا DNS معمولاً حتی وقتی ترافیک دیگر مسدود است اجازهٔ خروج دارد. بررسی کنید که آیا این دامنه ' +
    'مورد انتظار است؛ برخی محصولات امنیتی و CDN به‌طور مجاز از زیردامنه‌های کدشده استفاده می‌کنند.',
  'dns_tunneling.reason.length': 'نام کامل {length, plural, one {# نویسه} other {# نویسه}} طول دارد',
  'dns_tunneling.reason.encoded':
    'برچسبی با {length} نویسه به‌جای نام‌گذاری‌شده، کدشده به نظر می‌رسد (آنتروپی ' +
    '{entropy, number, ::.00} بیت بر نویسه، {digitPercent}٪ رقم، {vowelPercent}٪ واکه)',
  'dns_tunneling.reason.subdomains':
    '{count, plural, one {# زیردامنهٔ مجزا} other {# زیردامنهٔ مجزا}} از {domain} پرس‌وجو شد',

  // --- دستگاه تازه ---

  'new_device.discovered.title': 'دستگاه تازه در شبکه: {mac}{hasIp, select, true { ({ip})} other {}}',
  'new_device.discovered.description':
    '{mac} پیش از این در این شبکه دیده نشده بود{hasIp, select, true { و هم‌اکنون از {ip} استفاده ' +
    'می‌کند} other {}}. یک دستگاه ناشناخته می‌تواند مهمان باشد، ماشینی که تازه آماده‌سازی شده، یا ' +
    'اتصالی بدون اجازه. پیشوند سازنده {vendorPrefix} است که می‌تواند به شناسایی سخت‌افزار کمک کند.',

  // --- گواهی‌نامه‌های آشکار ---

  'plaintext_credentials.http_basic.title': 'گواهی‌نامهٔ HTTP به‌صورت آشکار برای «{username}» به {target}',
  'plaintext_credentials.http_basic.description':
    'یک سرآیند «Authorization» از نوع HTTP Basic روی پورت {port} به‌صورت آشکار ضبط شد. نام کاربری ' +
    '«{username}» است و گذرواژه از همان سرآیند بازیابی شد (به‌عمد اینجا ثبت نمی‌شود). هر کسی که روی ' +
    'این مسیر شبکه قرار داشته باشد — از جمله گردانندهٔ هر سویچ، مسیریاب یا نقطهٔ دسترسی وای‌فای میانی ' +
    '— می‌تواند این گذرواژه را مستقیم بخواند. سرویس را به HTTPS ببرید و گواهی‌نامه را تعویض کنید.',

  'plaintext_credentials.http_form.title': 'گذرواژه از راه HTTP رمزنشده به {target} فرستاده شد',
  'plaintext_credentials.http_form.description':
    'میدانی از فرم با نام «{fieldName}» روی پورت {port} از راه HTTP ساده فرستاده شد. مقدار آن برای هر ' +
    'کسی روی مسیر شبکه خواندنی است و اینجا ثبت نمی‌شود. هر فرم ورود باید از راه HTTPS ارائه و ارسال ' +
    'شود.',

  'plaintext_credentials.http_cookie.title': 'کوکی نشست از راه HTTP رمزنشده به {target} فرستاده شد',
  'plaintext_credentials.http_cookie.description':
    'کوکی‌ای که شبیه شناسهٔ نشست است از راه HTTP ساده فرستاده شد. ضبط آن به مهاجم اجازه می‌دهد نشست را ' +
    'برباید بی‌آنکه هرگز گذرواژه را بداند. مقدار کوکی اینجا ثبت نمی‌شود. سایت را از راه HTTPS ارائه ' +
    'کنید و نشانه‌های Secure و HttpOnly را بگذارید.',

  'plaintext_credentials.ftp.title':
    '{hasUsername, select, true {ورود آشکار FTP برای «{username}» به {target}} ' +
    'other {گذرواژهٔ آشکار FTP به {target} فرستاده شد}}',
  'plaintext_credentials.ftp.description':
    'FTP بنا بر طراحی‌اش گواهی‌نامه‌ها را به‌صورت متن ساده می‌فرستد. {hasPassword, select, ' +
    'true {یک فرمان PASS ضبط شد؛ مقدار آن اینجا ثبت نمی‌شود. } other {}}این سرویس را با SFTP یا FTPS ' +
    'جایگزین کنید و گواهی‌نامه را افشاشده بدانید.',

  'plaintext_credentials.telnet.title': 'نشست رمزنشدهٔ Telnet به {target}',
  'plaintext_credentials.telnet.description':
    'Telnet همه‌چیز را — گواهی‌نامه، فرمان و خروجی — به‌صورت متن ساده می‌فرستد. هر دستگاهی روی مسیر ' +
    'می‌تواند نشست را بخواند و تغییر دهد. آن را با SSH جایگزین کنید؛ هیچ پیکربندی‌ای Telnet را امن ' +
    'نمی‌کند.',

  'plaintext_credentials.mailbox.title':
    '{hasUsername, select, true {ورود آشکار {protocol} برای «{username}» به {target}} ' +
    'other {گذرواژهٔ آشکار {protocol} به {target} فرستاده شد}}',
  'plaintext_credentials.mailbox.description':
    'یک ورود {protocol} روی پورت {port} بدون رمزگذاری فرستاده شد. گذرواژه‌های ایمیل ارزش بالایی دارند، ' +
    'زیرا دسترسی به صندوق پستی بازنشانی گذرواژه در سرویس‌های دیگر را ممکن می‌کند. گذرواژه اینجا ثبت ' +
    'نمی‌شود. به‌جای آن از {protocol} روی TLS (پورت {securePort}) استفاده کنید.',

  'plaintext_credentials.smtp.title':
    '{hasUsername, select, true {ورود آشکار SMTP برای «{username}» به {target}} ' +
    'other {احراز هویت آشکار SMTP به {target}}}',
  'plaintext_credentials.smtp.description':
    'احراز هویت SMTP بدون STARTTLS فرستاده شد، پس گواهی‌نامه به شکلی که به‌سادگی رمزگشایی می‌شود از ' +
    'شبکه گذشت (base64 کدگذاری است، نه رمزگذاری). گواهی‌نامهٔ دزدیده‌شدهٔ SMTP معمولاً برای فرستادن ' +
    'ایمیل فیشینگ از دامنهٔ شما به کار می‌رود. گذرواژه اینجا ثبت نمی‌شود.',

  // --- اطلاعات تهدید ---

  'threat_intel.attribution': '{hasNote, select, true {{source}: {note}} other {{source}}}',
  'threat_intel.via.packet_capture': 'ضبط بسته',
  'threat_intel.via.dns_query': 'پرس‌وجوی DNS',
  'threat_intel.via.flow_export': '{version} از {exporter}',

  'threat_intel.domain.title': 'پرس‌وجوی دامنهٔ بدخواه شناخته‌شده: {observed}',
  'threat_intel.domain.description':
    '{hasLocalIp, select, true {{localIp}} other {میزبانی در شبکه}} دامنهٔ {observed} را جست‌وجو کرد ' +
    'که با نشانگر {indicator} از {attribution} همخوانی دارد. جست‌وجوی نام معمولاً نخستین کاری است که ' +
    'یک کاشته انجام می‌دهد و حتی وقتی اتصال پس از آن مسدود شود هم رخ می‌دهد — پس اغلب تنها ردِ ' +
    'برجای‌مانده همین است. تا وقتی نتوانید توضیح دهید چه چیزی پرس‌وجو کرده، میزبانِ پرسنده را مشکوک ' +
    'بدانید.',

  'threat_intel.outbound.title': 'اتصال خروجی به آدرس بدخواه شناخته‌شدهٔ {observed}',
  'threat_intel.outbound.description':
    '{hasLocalIp, select, true {{localIp}} other {میزبانی در شبکه}} به بیرون و به {observed} وصل شد ' +
    'که با {indicator} از {attribution} همخوانی دارد و از راه {via} دیده شد. چیزی درون شبکه تصمیم ' +
    'گرفته با این آدرس تماس بگیرد، و این به میزبانی افشاشده یا نرم‌افزاری بی‌اجازه اشاره دارد. این ' +
    'به‌مراتب جدی‌تر از پویش‌شدن توسط یک آدرس فهرست‌شده است و همین حالا ارزش بررسی دارد.',

  'threat_intel.inbound.title': 'ترافیک ورودی از آدرس بدخواه شناخته‌شدهٔ {observed}',
  'threat_intel.inbound.description':
    '{observed} با {hasLocalIp, select, true {{localIp}} other {میزبانی در شبکه}} تماس گرفت و با ' +
    '{indicator} از {attribution} همخوانی دارد؛ از راه {via} دیده شد. ترافیک ورودیِ ناخواسته از ' +
    'آدرس‌های فهرست‌شده در هر شبکهٔ متصل به اینترنت پیوسته وجود دارد و معمولاً پویش پس‌زمینه است. وقتی ' +
    'اهمیت پیدا می‌کند که میزبان پاسخ داده باشد یا رویداد علیه یک هدف تکرار شود؛ پس بررسی کنید چه چیزی ' +
    'در معرض بوده، به‌جای آنکه این را به‌تنهایی افشا شدن بدانید.',

  'threat_intel.unknown.title': 'ترافیک مرتبط با آدرس بدخواه شناخته‌شدهٔ {observed}',
  'threat_intel.unknown.description':
    'ترافیک میان {hasLocalIp, select, true {{localIp}} other {نامعلوم}} و ' +
    '{hasRemoteIp, select, true {{remoteIp}} other {نامعلوم}} به {observed} مربوط است و با ' +
    '{indicator} از {attribution} همخوانی دارد؛ از راه {via} دیده شد. جهت اتصال از روی آدرس‌ها معلوم ' +
    'نشد، پس پیش از نتیجه‌گیری روشن کنید کدام سو آغازگر بوده است.',

  // --- یافته نیست ---

  'notification.test.title': 'اعلان آزمایشی از Network Monitoring',
  'notification.test.description':
    'اگر این را می‌خوانید، تحویل اعلان‌ها درست پیکربندی شده است. هیچ یافته‌ای در میان نبوده است.',
};
