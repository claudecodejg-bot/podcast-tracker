// Applies the saved theme before first paint — include as a plain
// (non-module) script in the <head> of every page, after style.css.
// Themes: 'dark' (default), 'medium', 'light'. Stored per device.
(function () {
  var t = localStorage.getItem('pt-theme')
  if (t === 'medium' || t === 'light') {
    document.documentElement.setAttribute('data-theme', t)
  }
})()
