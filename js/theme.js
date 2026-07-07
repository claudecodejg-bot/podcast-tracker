// Applies the saved theme before first paint — include as a plain
// (non-module) script in the <head> of every page, after style.css.
// Themes: 'medium' (default), 'dark', 'light'. Stored per device;
// a device with no saved preference gets 'medium'.
(function () {
  var t = localStorage.getItem('pt-theme') || 'medium'
  if (t === 'medium' || t === 'light') {
    document.documentElement.setAttribute('data-theme', t)
  }
  // 'dark' => no attribute, falls through to :root
})()
