// on/off の状態は storage に保存し、各タブの content.js が storage.onChanged で拾う
const toggle = document.getElementById('enabled');

chrome.storage.local.get({ enabled: true }, ({ enabled }) => {
  toggle.checked = enabled;
  toggle.disabled = false;
});

toggle.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: toggle.checked });
});
