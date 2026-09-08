import type { PartialFindingCatalog } from './findings.en.js';

/**
 * The finding catalogue in German.
 *
 * **Machine-drafted. Needs review by a native speaker before it is relied on** —
 * the security vocabulary especially, where a near-miss reads as competent and
 * means something slightly different. Keys absent here fall back to the English
 * pattern per key, so removing an entry you are unsure of is a safe edit.
 *
 * Two things that are not stylistic preferences:
 *
 * - **Protocol and service names stay as they are** — ARP, SMB file sharing,
 *   Remote Desktop, Telnet. They name a thing an operator will correlate against a
 *   firewall rule or an `nmap` report, which prints the English string.
 * - **German runs roughly 30% longer than English.** The dashboard tiles, the
 *   navigation rail and the settings dialog's two-column grid are where that first
 *   becomes visible; the titles here are kept as tight as the sense allows because
 *   they render into a 420px table column.
 */
export const FINDINGS_DE: PartialFindingCatalog = {
  // --- ARP-Spoofing ---

  'arp_spoofing.configured.title': 'ARP-Spoofing: {ip} wird von {mac} beansprucht',
  'arp_spoofing.configured.description':
    '{mac} hat eine ARP-{operation} gesendet und beansprucht {ip}, obwohl diese Adresse fest auf ' +
    '{configuredMac} konfiguriert ist. Ein Host im Netzwerk gibt sich als {ip} aus und kann damit ' +
    'den Verkehr mitlesen, der für diese Adresse bestimmt ist.',

  'arp_spoofing.conflict.title': 'ARP-Spoofing: {ip} wechselte von {previousMac} zu {mac}',
  'arp_spoofing.conflict.description':
    '{ip} wurde durchgängig von {previousMac} beantwortet ({observations, plural, one {# Beobachtung} ' +
    'other {# Beobachtungen}}) und wird jetzt von {mac} beansprucht. ' +
    '{flipping, select, ' +
    'true {Die beiden Adressen wechseln sich ab — die Signatur eines laufenden ARP-Poisoning-Angriffs: ' +
    'Der Angreifer überschreibt den ARP-Cache des Opfers immer wieder, damit der Verkehr weiter über ' +
    'ihn läuft.} ' +
    'other {Das kann ein ausgetauschtes Gerät oder eine DHCP-Änderung sein, aber genauso schiebt sich ' +
    'ein Man-in-the-Middle dazwischen. Prüfen Sie, ob die neue Adresse zu erwarteter Hardware gehört.}}',

  'arp_spoofing.sprawl.title':
    '{mac} beansprucht {count, plural, one {# verschiedene IP-Adresse} ' +
    'other {# verschiedene IP-Adressen}}',
  'arp_spoofing.sprawl.description':
    '{mac} hat ARP-Nachrichten für {count, plural, one {# unterschiedliche Adresse} ' +
    'other {# unterschiedliche Adressen}} gesendet. Ein normaler Host antwortet nur für seine eigene ' +
    'Adresse. Für viele zu antworten ist die Art, wie ein Angreifer die ARP-Caches eines ganzen ' +
    'Subnetzes auf einmal vergiftet.',

  // --- Portscan ---

  'port_scan.packet.title':
    'Portscan: {source} hat {count, plural, one {# Port} other {# Ports}} auf {target} abgefragt',
  'port_scan.packet.description':
    '{source} hat innerhalb von {seconds, plural, one {# Sekunde} other {# Sekunden}} Verbindungen zu ' +
    '{count, plural, one {# verschiedenen Port} other {# verschiedenen Ports}} auf {target} versucht. ' +
    'Legitime Clients verbinden sich mit einem oder zwei bekannten Ports; einen ganzen Bereich ' +
    'abzutasten ist die Art, wie ein Angreifer ermittelt, welche Dienste ein Host anbietet — meist ' +
    'als Vorbereitung eines Angriffsversuchs.',

  'port_scan.flow.title':
    'Portscan: {source} hat {count, plural, one {# Port} other {# Ports}} auf {target} abgefragt',
  'port_scan.flow.description':
    '{source} hat innerhalb von {seconds, plural, one {# Sekunde} other {# Sekunden}} unbeantwortete ' +
    'Verbindungen zu {count, plural, one {# verschiedenen Port} other {# verschiedenen Ports}} auf ' +
    '{target} geöffnet, gemeldet vom Flow-Exporter {exporter}. Keine dieser Verbindungen wurde ' +
    'bestätigt — es hat also nichts gelauscht oder eine Firewall hat sie verworfen. Das ist die ' +
    'Signatur einer Diensterkundung und geht einem Angriffsversuch meist voraus.',

  // --- Host-Sweep ---

  'host_sweep.packet.title':
    'Host-Sweep: {source} hat Port {port} auf {count, plural, one {# Host} other {# Hosts}} abgefragt',
  'host_sweep.packet.description':
    '{source} hat innerhalb von {seconds, plural, one {# Sekunde} other {# Sekunden}} Verbindungen zu ' +
    'Port {port} auf {count, plural, one {# verschiedenen Host} other {# verschiedenen Hosts}} ' +
    'versucht. Einen einzelnen Dienst über ein ganzes Subnetz abzutasten ist die Art, wie ein ' +
    'Angreifer oder ein Wurm jede Maschine findet, auf der er läuft. Port ' +
    '{port}{hasService, select, true { ({service})} other {}} ist ein häufiges Ziel für laterale ' +
    'Bewegung im Netzwerk.',
  'host_sweep.flow.title':
    'Host-Sweep: {source} hat Port {port} auf {count, plural, one {# Host} other {# Hosts}} abgefragt',
  'host_sweep.flow.description':
    '{source} hat innerhalb von {seconds, plural, one {# Sekunde} other {# Sekunden}} unbeantwortete ' +
    'Verbindungen zu Port {port}{hasService, select, true { ({service})} other {}} auf ' +
    '{count, plural, one {# verschiedenen Host} other {# verschiedenen Hosts}} geöffnet. Einen ' +
    'einzelnen Dienst über ein ganzes Subnetz abzutasten ist die Art, wie ein Angreifer oder ein Wurm ' +
    'jede Maschine findet, auf der er läuft, und ein starker Hinweis auf laterale Bewegung statt auf ' +
    'gewöhnlichen Client-Verkehr.',

  // --- Verbindungsflut ---

  'syn_flood.packet.title':
    'SYN-Flood: {count, plural, one {# Verbindungsversuch} other {# Verbindungsversuche}} von ' +
    '{source} in {seconds}s',
  'syn_flood.packet.description':
    '{source} hat in {seconds, plural, one {# Sekunde} other {# Sekunden}} ' +
    '{count, plural, one {# TCP-Verbindungsversuch} other {# TCP-Verbindungsversuche}} unternommen, ' +
    'ohne den Handshake abzuschließen. Bei dieser Rate handelt es sich entweder um einen ' +
    'Denial-of-Service-Versuch, der die Verbindungstabelle des Ziels erschöpft, oder um einen ' +
    'aggressiven automatisierten Scanner.',

  'syn_flood.flow.title':
    'Verbindungsflut: {count, plural, one {# unbeantworteter Versuch} ' +
    'other {# unbeantwortete Versuche}} von {source} in {seconds}s',
  'syn_flood.flow.description':
    '{source} hat in {seconds, plural, one {# Sekunde} other {# Sekunden}} ' +
    '{count, plural, one {# TCP-Verbindung} other {# TCP-Verbindungen}} geöffnet, die nie bestätigt ' +
    'wurden. Bei dieser Rate handelt es sich entweder um einen Denial-of-Service-Versuch, der die ' +
    'Verbindungstabelle des Ziels erschöpft, oder um einen aggressiven automatisierten Scanner.',

  // --- DNS-Tunneling ---

  'dns_tunneling.detected.title':
    'Mögliches DNS-Tunneling zu {domain} von {hasSource, select, true {{source}} ' +
    'other {unbekanntem Host}}',
  'dns_tunneling.detected.description':
    'DNS-Anfragen an {domain} sehen nicht wie gewöhnliche Namensauflösungen aus: {reasons}. Dieses ' +
    'Muster ist charakteristisch für Daten, die über DNS herausgeschleust werden, oder für Schadsoftware, ' +
    'die DNS zur Command-and-Control-Kommunikation nutzt — denn DNS darf meist auch dann nach außen, ' +
    'wenn anderer Verkehr blockiert ist. Prüfen Sie, ob diese Domain erwartet wird; einige Sicherheits- ' +
    'und CDN-Produkte verwenden legitim kodierte Subdomains.',
  'dns_tunneling.reason.length':
    'der vollständige Name ist {length, plural, one {# Zeichen} other {# Zeichen}} lang',
  'dns_tunneling.reason.encoded':
    'ein Label mit {length} Zeichen wirkt kodiert statt benannt (Entropie {entropy, number, ::.00} ' +
    'Bit/Zeichen, {digitPercent} % Ziffern, {vowelPercent} % Vokale)',
  'dns_tunneling.reason.subdomains':
    '{count, plural, one {# unterschiedliche Subdomain} other {# unterschiedliche Subdomains}} von ' +
    '{domain} {count, plural, one {wurde} other {wurden}} abgefragt',

  // --- Neues Gerät ---

  'new_device.discovered.title': 'Neues Gerät im Netzwerk: {mac}{hasIp, select, true { ({ip})} other {}}',
  'new_device.discovered.description':
    '{mac} wurde in diesem Netzwerk bisher nicht gesehen{hasIp, select, true { und verwendet derzeit ' +
    '{ip}} other {}}. Ein unbekanntes Gerät kann ein Besucher sein, eine neu bereitgestellte Maschine ' +
    'oder eine nicht autorisierte Verbindung. Das Herstellerpräfix ist {vendorPrefix}, was bei der ' +
    'Identifikation der Hardware helfen kann.',

  // --- Zugangsdaten im Klartext ---

  'plaintext_credentials.http_basic.title': 'HTTP-Zugangsdaten im Klartext für „{username}“ an {target}',
  'plaintext_credentials.http_basic.description':
    'Ein HTTP-Basic-„Authorization“-Header wurde auf Port {port} im Klartext mitgeschnitten. Der ' +
    'Benutzername ist „{username}“; das Passwort ließ sich aus demselben Header rekonstruieren und ' +
    'wird hier bewusst nicht festgehalten. Jeder auf diesem Netzwerkpfad — einschließlich des ' +
    'Betreibers jedes zwischengeschalteten Switches, Routers oder WLAN-Access-Points — kann dieses ' +
    'Passwort direkt mitlesen. Stellen Sie den Dienst auf HTTPS um und wechseln Sie die Zugangsdaten.',

  'plaintext_credentials.http_form.title': 'Passwort über unverschlüsseltes HTTP an {target} gesendet',
  'plaintext_credentials.http_form.description':
    'Ein Formularfeld mit dem Namen „{fieldName}“ wurde auf Port {port} über einfaches HTTP gesendet. ' +
    'Der Wert ist für jeden auf dem Netzwerkpfad lesbar und wird hier nicht festgehalten. Jedes ' +
    'Anmeldeformular muss über HTTPS ausgeliefert und abgeschickt werden.',

  'plaintext_credentials.http_cookie.title':
    'Sitzungscookie über unverschlüsseltes HTTP an {target} gesendet',
  'plaintext_credentials.http_cookie.description':
    'Ein Cookie, das wie eine Sitzungskennung aussieht, wurde über einfaches HTTP gesendet. Wer es ' +
    'mitschneidet, kann die Sitzung übernehmen, ohne das Passwort je zu kennen. Der Cookie-Wert wird ' +
    'hier nicht festgehalten. Liefern Sie die Website über HTTPS aus und setzen Sie die Flags Secure ' +
    'und HttpOnly.',

  'plaintext_credentials.ftp.title':
    '{hasUsername, select, true {FTP-Anmeldung im Klartext für „{username}“ an {target}} ' +
    'other {FTP-Passwort im Klartext an {target} gesendet}}',
  'plaintext_credentials.ftp.description':
    'FTP überträgt seine Zugangsdaten konstruktionsbedingt im Klartext. {hasPassword, select, ' +
    'true {Ein PASS-Kommando wurde mitgeschnitten; der Wert wird hier nicht festgehalten. } ' +
    'other {}}Ersetzen Sie diesen Dienst durch SFTP oder FTPS und behandeln Sie die Zugangsdaten als ' +
    'kompromittiert.',

  'plaintext_credentials.telnet.title': 'Unverschlüsselte Telnet-Sitzung zu {target}',
  'plaintext_credentials.telnet.description':
    'Telnet sendet alles — Zugangsdaten, Befehle und Ausgaben — im Klartext. Jedes Gerät auf dem Pfad ' +
    'kann die Sitzung mitlesen und verändern. Ersetzen Sie es durch SSH; es gibt keine Konfiguration, ' +
    'die Telnet sicher macht.',

  'plaintext_credentials.mailbox.title':
    '{hasUsername, select, true {{protocol}-Anmeldung im Klartext für „{username}“ an {target}} ' +
    'other {{protocol}-Passwort im Klartext an {target} gesendet}}',
  'plaintext_credentials.mailbox.description':
    'Eine {protocol}-Anmeldung wurde auf Port {port} unverschlüsselt gesendet. Mail-Passwörter sind ' +
    'besonders wertvoll, weil der Zugriff auf das Postfach Passwort-Rücksetzungen bei anderen Diensten ' +
    'ermöglicht. Das Passwort wird hier nicht festgehalten. Verwenden Sie stattdessen {protocol} über ' +
    'TLS (Port {securePort}).',

  'plaintext_credentials.smtp.title':
    '{hasUsername, select, true {SMTP-Anmeldung im Klartext für „{username}“ an {target}} ' +
    'other {SMTP-Authentifizierung im Klartext an {target}}}',
  'plaintext_credentials.smtp.description':
    'Die SMTP-Authentifizierung wurde ohne STARTTLS gesendet, sodass die Zugangsdaten in trivial ' +
    'dekodierbarer Form über das Netzwerk gingen (Base64 ist eine Kodierung, keine Verschlüsselung). ' +
    'Gestohlene SMTP-Zugangsdaten werden typischerweise genutzt, um Phishing-Mail aus Ihrer Domain zu ' +
    'versenden. Das Passwort wird hier nicht festgehalten.',

  // --- Bedrohungsdaten ---

  'threat_intel.attribution': '{hasNote, select, true {{source}: {note}} other {{source}}}',
  'threat_intel.via.packet_capture': 'Paketmitschnitt',
  'threat_intel.via.dns_query': 'DNS-Anfrage',
  'threat_intel.via.flow_export': '{version} von {exporter}',

  'threat_intel.domain.title': 'Bekannt bösartige Domain abgefragt: {observed}',
  'threat_intel.domain.description':
    '{hasLocalIp, select, true {{localIp}} other {Ein Host im Netzwerk}} hat {observed} aufgelöst, was ' +
    'auf den Indikator {indicator} aus {attribution} passt. Eine Namensauflösung ist meist das Erste, ' +
    'was ein Implantat tut, und sie geschieht auch dann, wenn die folgende Verbindung blockiert wird — ' +
    'oft ist sie deshalb die einzige verbleibende Spur. Behandeln Sie den anfragenden Host als ' +
    'verdächtig, bis Sie erklären können, was dort angefragt hat.',

  'threat_intel.outbound.title': 'Ausgehende Verbindung zur bekannt bösartigen Adresse {observed}',
  'threat_intel.outbound.description':
    '{hasLocalIp, select, true {{localIp}} other {Ein Host im Netzwerk}} hat eine Verbindung nach ' +
    'außen zu {observed} aufgebaut, was auf {indicator} aus {attribution} passt, beobachtet über ' +
    '{via}. Etwas innerhalb des Netzwerks hat sich entschieden, diese Adresse zu kontaktieren — das ' +
    'deutet auf einen kompromittierten Host oder auf nicht genehmigte Software hin. Das ist deutlich ' +
    'schwerwiegender, als von einer gelisteten Adresse gescannt zu werden, und sollte jetzt untersucht ' +
    'werden.',

  'threat_intel.inbound.title': 'Eingehender Verkehr von der bekannt bösartigen Adresse {observed}',
  'threat_intel.inbound.description':
    '{observed} hat {hasLocalIp, select, true {{localIp}} other {einen Host im Netzwerk}} kontaktiert ' +
    'und passt auf {indicator} aus {attribution}, beobachtet über {via}. Unaufgeforderter eingehender ' +
    'Verkehr von gelisteten Adressen ist in jedem mit dem Internet verbundenen Netzwerk ständig ' +
    'vorhanden und meist Hintergrund-Scanning. Relevant wird er, wenn der Host geantwortet hat oder ' +
    'wenn er sich gegen ein einzelnes Ziel wiederholt — prüfen Sie also, was exponiert war, statt dies ' +
    'allein als Kompromittierung zu werten.',

  'threat_intel.unknown.title': 'Verkehr mit Bezug zur bekannt bösartigen Adresse {observed}',
  'threat_intel.unknown.description':
    'Verkehr zwischen {hasLocalIp, select, true {{localIp}} other {unbekannt}} und ' +
    '{hasRemoteIp, select, true {{remoteIp}} other {unbekannt}} betrifft {observed} und passt auf ' +
    '{indicator} aus {attribution}, beobachtet über {via}. Die Richtung ließ sich aus den Adressen ' +
    'nicht bestimmen — klären Sie daher, welche Seite die Verbindung aufgebaut hat, bevor Sie einen ' +
    'Schluss ziehen.',

  // --- Kein Fund ---

  'notification.test.title': 'Testbenachrichtigung von Network Monitoring',
  'notification.test.description':
    'Wenn Sie das lesen, ist die Benachrichtigungszustellung korrekt konfiguriert. Es lag kein Fund ' +
    'zugrunde.',
};
