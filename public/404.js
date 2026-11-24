// Page-not-found helper: back to the page the visitor came from (same website only), otherwise to the app.
// Text is set with textContent only, in the language the visitor chose in the app (English if none).
(function () {
  var TEXT = {
    en: { title: 'We can’t find that page', text: 'The address may have a typo, or the page may have moved. Nothing is wrong with your account or your data.', back: 'Go back', home: 'Go to the app', go: 'Go to the app', backIn: 'Taking you back in {n}', homeIn: 'Taking you to the app in {n}', stay: 'Stay here' },
    ms: { title: 'Kami tidak menemui halaman itu', text: 'Alamat mungkin ada kesilapan taip, atau halaman telah berpindah. Akaun dan data anda tidak terjejas.', back: 'Kembali', home: 'Pergi ke aplikasi', go: 'Pergi ke aplikasi', backIn: 'Membawa anda kembali dalam {n}', homeIn: 'Membawa anda ke aplikasi dalam {n}', stay: 'Kekal di sini' },
    zh: { title: '找不到该页面', text: '地址可能输入有误，或页面已被移动。你的账户和数据都没有问题。', back: '返回', home: '前往应用', go: '前往应用', backIn: '{n} 秒后返回', homeIn: '{n} 秒后前往应用', stay: '留在此页' },
  };
  var SECONDS = 8;
  var lang = 'en';
  try { var stored = localStorage.getItem('ve_lang'); if (stored === 'ms' || stored === 'zh') lang = stored; } catch { /* storage blocked: English */ }
  var words = TEXT[lang];

  var back = document.getElementById('back');
  var home = document.getElementById('home');
  var note = document.getElementById('count');
  if (!back || !home || !note) return;
  document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : lang;
  document.getElementById('title').textContent = words.title;
  document.getElementById('text').textContent = words.text;
  home.textContent = words.home;

  var cameFromHere = false;
  try { cameFromHere = !!document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1; } catch { cameFromHere = false; }

  back.textContent = cameFromHere ? words.back : words.go;
  home.hidden = !cameFromHere; // with no previous page the main button already goes to the app

  function leave() {
    if (cameFromHere) history.back();
    else location.replace(home.href);
  }
  back.addEventListener('click', leave);

  var left = SECONDS;
  var timer = null;
  function tick() {
    note.textContent = (cameFromHere ? words.backIn : words.homeIn).replace('{n}', String(left)) + ' ';
    var stay = document.createElement('button');
    stay.type = 'button';
    stay.className = 'link';
    stay.textContent = words.stay;
    stay.addEventListener('click', function () { clearInterval(timer); note.textContent = ''; });
    note.appendChild(stay);
  }
  tick();
  timer = setInterval(function () {
    left -= 1;
    if (left <= 0) { clearInterval(timer); leave(); return; }
    tick();
  }, 1000);
})();
