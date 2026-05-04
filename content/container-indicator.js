// ============================================================
// content/container-indicator.js — v4.4
// ============================================================
// نشانگر شناور container در صفحه
// v4.4: اگر showTabColor فعال باشد، نشانگر مخفی می‌شود
//       چون Tab Group رنگی بالای تب، همان نقش را ایفا می‌کند
// ============================================================
(function() {
  if (location.protocol === 'chrome:' || location.protocol === 'chrome-extension:') return;

  try {
    chrome.runtime.sendMessage({ action: 'getTabContainer' }, function(containerId) {
      if (!containerId) return;

      chrome.runtime.sendMessage({ action: 'getContainers' }, function(containers) {
        if (!containers || !Array.isArray(containers)) return;

        var c = containers.find(function(x) { return x.id === containerId; });
        if (!c) return;

        // v4.4: اگر showTabColor فعال باشد، نشانگر را نشان نده
        // چون Tab Group رنگی بالای تب، نشانگر رنگی اضافی لازم ندارد
        if (c.showTabColor) {
          console.log('[MC v4.4] Container indicator hidden (showTabColor is ON)');
          return;
        }

        // Create floating badge
        var badge = document.createElement('div');
        badge.id = 'mc-container-badge';
        badge.setAttribute('data-container', c.id);
        badge.textContent = c.name;

        badge.style.cssText = [
          'position: fixed',
          'bottom: 20px',
          'right: 20px',
          'background: ' + c.color,
          'color: #fff',
          'font-family: Segoe UI, Arial, sans-serif',
          'font-size: 11px',
          'font-weight: 600',
          'padding: 4px 12px',
          'border-radius: 16px',
          'z-index: 2147483647',
          'cursor: grab',
          'user-select: none',
          'opacity: 0.9',
          'transition: opacity 0.2s, transform 0.2s',
          'box-shadow: 0 2px 8px rgba(0,0,0,0.3)',
          'pointer-events: auto',
          'max-width: 200px',
          'overflow: hidden',
          'text-overflow: ellipsis',
          'white-space: nowrap',
        ].join(';');

        var minimized = false;
        var savedText = badge.textContent;

        badge.addEventListener('click', function(e) {
          if (badge._isDragging) return;
          if (minimized) {
            badge.textContent = savedText;
            badge.style.borderRadius = '16px';
            badge.style.padding = '4px 12px';
            badge.style.width = '';
            minimized = false;
          } else {
            savedText = badge.textContent;
            badge.textContent = c.color ? '\u25CF' : '\u2022';
            badge.style.borderRadius = '50%';
            badge.style.padding = '4px 8px';
            badge.style.width = '24px';
            minimized = true;
          }
        });

        // Dragging
        var isDragging = false;
        var startX = 0, startY = 0;
        var offsetX = 0, offsetY = 0;

        badge.addEventListener('mousedown', function(e) {
          isDragging = false;
          badge._isDragging = false;
          startX = e.clientX;
          startY = e.clientY;
          var rect = badge.getBoundingClientRect();
          offsetX = e.clientX - rect.left;
          offsetY = e.clientY - rect.top;
          badge.style.cursor = 'grabbing';
          badge.style.opacity = '1';
          badge.style.transform = 'scale(1.05)';
          badge.style.transition = 'none';

          function onMouseMove(e) {
            var dx = Math.abs(e.clientX - startX);
            var dy = Math.abs(e.clientY - startY);
            if (dx > 3 || dy > 3) {
              isDragging = true;
              badge._isDragging = true;
            }
            if (isDragging) {
              e.preventDefault();
              var newLeft = e.clientX - offsetX;
              var newTop = e.clientY - offsetY;
              newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - badge.offsetWidth));
              newTop = Math.max(0, Math.min(newTop, window.innerHeight - badge.offsetHeight));
              badge.style.left = newLeft + 'px';
              badge.style.top = newTop + 'px';
              badge.style.right = 'auto';
              badge.style.bottom = 'auto';
            }
          }

          function onMouseUp(e) {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            badge.style.cursor = 'grab';
            badge.style.opacity = '0.9';
            badge.style.transform = '';
            badge.style.transition = 'opacity 0.2s, transform 0.2s';
            if (isDragging) {
              e.preventDefault();
              e.stopPropagation();
              setTimeout(function() { badge._isDragging = false; }, 100);
            }
          }

          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        }, true);

        // Touch support
        badge.addEventListener('touchstart', function(e) {
          isDragging = false;
          badge._isDragging = false;
          var touch = e.touches[0];
          startX = touch.clientX;
          startY = touch.clientY;
          var rect = badge.getBoundingClientRect();
          offsetX = touch.clientX - rect.left;
          offsetY = touch.clientY - rect.top;
          badge.style.opacity = '1';
          badge.style.transform = 'scale(1.05)';
          badge.style.transition = 'none';

          function onTouchMove(e) {
            var touch = e.touches[0];
            var dx = Math.abs(touch.clientX - startX);
            var dy = Math.abs(touch.clientY - startY);
            if (dx > 3 || dy > 3) { isDragging = true; badge._isDragging = true; }
            if (isDragging) {
              e.preventDefault();
              var newLeft = touch.clientX - offsetX;
              var newTop = touch.clientY - offsetY;
              newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - badge.offsetWidth));
              newTop = Math.max(0, Math.min(newTop, window.innerHeight - badge.offsetHeight));
              badge.style.left = newLeft + 'px';
              badge.style.top = newTop + 'px';
              badge.style.right = 'auto';
              badge.style.bottom = 'auto';
            }
          }

          function onTouchEnd() {
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend', onTouchEnd);
            badge.style.opacity = '0.9';
            badge.style.transform = '';
            badge.style.transition = 'opacity 0.2s, transform 0.2s';
            setTimeout(function() { badge._isDragging = false; }, 100);
          }

          document.addEventListener('touchmove', onTouchMove, { passive: false });
          document.addEventListener('touchend', onTouchEnd);
        }, true);

        // Auto-hide on scroll
        var hideTimer;
        document.addEventListener('scroll', function() {
          badge.style.opacity = '0.3';
          clearTimeout(hideTimer);
          hideTimer = setTimeout(function() { badge.style.opacity = '0.9'; }, 1500);
        }, { passive: true });

        // Save/restore position
        var posKey = 'mc_badge_pos_' + location.hostname;
        try {
          var savedPos = sessionStorage.getItem(posKey);
          if (savedPos) {
            var pos = JSON.parse(savedPos);
            badge.style.left = pos.left;
            badge.style.top = pos.top;
            badge.style.right = 'auto';
            badge.style.bottom = 'auto';
          }
        } catch {}

        badge.addEventListener('mouseup', function() {
          if (isDragging) {
            try {
              sessionStorage.setItem(posKey, JSON.stringify({ left: badge.style.left, top: badge.style.top }));
            } catch {}
          }
        });

        // Insert into page
        function insert() {
          if (!document.getElementById('mc-container-badge')) {
            document.documentElement.appendChild(badge);
          }
        }
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', insert);
        } else {
          insert();
        }
      });
    });
  } catch(e) {
    console.error('[MC Container Indicator]', e);
  }
})();
