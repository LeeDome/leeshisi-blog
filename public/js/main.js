document.addEventListener('DOMContentLoaded', function() {
  var hamburger = document.getElementById('hamburgerBtn');
  var nav = document.getElementById('siteNav');
  if (hamburger && nav) {
    hamburger.addEventListener('click', function() {
      nav.classList.toggle('active');
      hamburger.classList.toggle('active');
    });
  }

  var stars = document.querySelectorAll('.star-rating .star');
  stars.forEach(function(star) {
    star.addEventListener('click', function() {
      var score = parseInt(this.getAttribute('data-score'));
      var articleId = this.closest('.star-rating').getAttribute('data-article-id');
      if (!articleId) return;

      var formData = new URLSearchParams();
      formData.append('article_id', articleId);
      formData.append('score', score);

      fetch('/article/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.success) {
          var ratingScore = document.querySelector('.rating-score');
          if (ratingScore) ratingScore.textContent = data.rating_score.toFixed(2);
          var ratingCount = document.querySelector('.rating-count');
          if (ratingCount) ratingCount.textContent = '(' + data.rating_count + '人评分)';
          stars.forEach(function(s, i) {
            s.classList.toggle('active', i < score);
          });
        } else {
          alert(data.message || '评分失败');
        }
      })
      .catch(function() {});
    });
  });

  document.querySelectorAll('.comment-like-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var commentId = this.getAttribute('data-comment-id');
      var countEl = this.querySelector('.count');
      fetch('/comment/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'comment_id=' + commentId
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.success && countEl) {
          countEl.textContent = data.like_count;
        }
      })
      .catch(function() {});
    });
  });

  document.querySelectorAll('.comment-dislike-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var commentId = this.getAttribute('data-comment-id');
      var countEl = this.querySelector('.count');
      fetch('/comment/dislike', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'comment_id=' + commentId
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.success && countEl) {
          countEl.textContent = data.dislike_count;
        }
      })
      .catch(function() {});
    });
  });

  document.querySelectorAll('.comment-reply-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var parentId = this.getAttribute('data-comment-id');
      var form = document.querySelector('.reply-form[data-parent-id="' + parentId + '"]');
      if (form) {
        form.style.display = form.style.display === 'none' ? 'block' : 'none';
      }
    });
  });

  var runtimeEl = document.getElementById('siteRuntime');
  if (runtimeEl) {
    var startTime = runtimeEl.getAttribute('data-start');
    if (startTime) {
      function updateRuntime() {
        var start = new Date(startTime).getTime();
        var now = Date.now();
        var diff = Math.floor((now - start) / 1000);
        var days = Math.floor(diff / 86400);
        var hours = Math.floor((diff % 86400) / 3600);
        var minutes = Math.floor((diff % 3600) / 60);
        var seconds = diff % 60;
        runtimeEl.textContent = '本站已运行 ' + days + ' 天 ' + hours + ' 小时 ' + minutes + ' 分 ' + seconds + ' 秒';
      }
      updateRuntime();
      setInterval(updateRuntime, 1000);
    }
  }

  var searchForm = document.querySelector('.search-box');
  if (searchForm) {
    searchForm.addEventListener('submit', function(e) {
      var input = this.querySelector('input[name="q"]');
      if (!input || !input.value.trim()) {
        e.preventDefault();
      }
    });
  }
});