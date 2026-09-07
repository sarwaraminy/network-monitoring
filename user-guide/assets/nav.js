/*
 * The table of contents, in one place.
 *
 * Every topic page includes this script and carries an empty <nav class="toc">;
 * the list below fills it, marks the current page, and builds the previous/next
 * links at the foot of the topic. One list to edit when a topic is added, rather
 * than the same markup pasted into a dozen files and slowly diverging.
 *
 * A classic script rather than a module, and no fetch: there is no build step for
 * these pages, so anything here has to run in a browser exactly as written.
 *
 * It used to say the guide had to work when opened straight off disk. That was
 * never true of the shipped design and is now plainly false: guard.js reads the
 * access token from localStorage, and on a file:// origin that is not the
 * application's storage — it finds nothing and navigates to /login, out of the
 * guide and into a filesystem path that does not exist. These files are served by
 * the API behind a cookie, which is the whole reason they are not in public/.
 */
(function () {
  'use strict';

  var GROUPS = [
    {
      label: 'Getting started',
      items: [
        { href: 'about.html', title: 'About Network Monitoring' },
        { href: 'getting-started.html', title: 'Signing in' },
        { href: 'interface.html', title: 'Finding your way around' },
      ],
    },
    {
      label: 'Watching the network',
      items: [
        { href: 'dashboard.html', title: 'The dashboard' },
        { href: 'security-alerts.html', title: 'Security alerts' },
        { href: 'suppressions.html', title: 'Suppression rules' },
        { href: 'threat-intel.html', title: 'Threat intelligence' },
        { href: 'packet-capture.html', title: 'Packet capture' },
      ],
    },
    {
      label: 'Being told',
      items: [
        { href: 'alert-delivery.html', title: 'Alert delivery' },
        { href: 'delivery-settings.html', title: 'Delivery settings' },
        { href: 'email-oauth2.html', title: 'Email over OAuth2' },
      ],
    },
    {
      label: 'Administration',
      items: [
        { href: 'administration-settings.html', title: 'Administration settings' },
        { href: 'access-and-roles.html', title: 'Who can do what' },
        { href: 'accounts.html', title: 'Accounts' },
        { href: 'audit-trail.html', title: 'Audit trail' },
        { href: 'adhoc-query.html', title: 'Ad hoc query' },
      ],
    },
  ];

  /** Every topic in reading order, for the pager. */
  var FLAT = GROUPS.reduce(function (all, group) {
    return all.concat(group.items);
  }, []);

  var path = window.location.pathname;
  var here = path.split('/').pop() || 'index.html';

  /*
   * The landing page sits one level above the topics, so every link needs a prefix
   * that depends on which of the two is being rendered. Derived from the path rather
   * than declared per page, so a new topic is one line in the list below and nothing
   * else.
   */
  var inTopics = path.indexOf('/topics/') !== -1;
  var toTopic = inTopics ? '' : 'topics/';
  var toHome = inTopics ? '../index.html' : 'index.html';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function buildToc(container) {
    var heading = el('h2', null, 'Contents');
    container.appendChild(heading);

    // The landing page sits above the groups rather than inside one: it is not a
    // topic, and burying it in "Getting started" makes it look like the first step.
    var home = el('a', here === 'index.html' ? 'current' : null, 'Guide home');
    home.href = toHome;
    container.appendChild(home);

    GROUPS.forEach(function (group) {
      var block = el('div', 'group');
      block.appendChild(el('span', 'group-label', group.label));
      group.items.forEach(function (item) {
        var link = el('a', item.href === here ? 'current' : null, item.title);
        link.href = toTopic + item.href;
        if (item.href === here) link.setAttribute('aria-current', 'page');
        block.appendChild(link);
      });
      container.appendChild(block);
    });
  }

  function buildPager(topic) {
    var index = -1;
    for (var i = 0; i < FLAT.length; i += 1) {
      if (FLAT[i].href === here) index = i;
    }
    if (index === -1) return;

    var pager = el('nav', 'pager');
    pager.setAttribute('aria-label', 'Topic navigation');

    if (index > 0) {
      var previous = el('a', null, '← ' + FLAT[index - 1].title);
      previous.href = toTopic + FLAT[index - 1].href;
      pager.appendChild(previous);
    }

    pager.appendChild(el('span', 'spacer'));

    if (index < FLAT.length - 1) {
      var next = el('a', null, FLAT[index + 1].title + ' →');
      next.href = toTopic + FLAT[index + 1].href;
      pager.appendChild(next);
    }

    topic.appendChild(pager);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var toc = document.querySelector('.toc');
    if (toc) buildToc(toc);

    var topic = document.querySelector('.topic');
    if (topic) buildPager(topic);
  });
})();
