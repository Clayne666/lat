document.addEventListener('DOMContentLoaded', () => {
    const tokenKey = 'leanampAuthToken';
    const authed = Boolean(localStorage.getItem(tokenKey));

    const logoutBtn = document.querySelector('.nav-logout');
    if (logoutBtn) {
        const loginTarget = logoutBtn.getAttribute('data-login') || 'login.html';

        if (authed) {
            logoutBtn.style.display = 'inline-flex';
            logoutBtn.addEventListener('click', () => {
                localStorage.removeItem('leanampAuthToken');
                localStorage.removeItem('leanampCurrentUser');
                localStorage.removeItem('leanampCurrentUserRole');
                window.location.href = loginTarget;
            });
        } else {
            logoutBtn.style.display = 'none';
        }
    }

    const navAuthLink = document.querySelector('.nav-auth-link');
    if (navAuthLink) {
        const defaultLabel = navAuthLink.getAttribute('data-default-label') || navAuthLink.textContent.trim();
        const defaultHref = navAuthLink.getAttribute('data-default-href') || navAuthLink.getAttribute('href');
        const authedLabel = navAuthLink.getAttribute('data-auth-label') || 'Quote Calculator';
        const authedHref = navAuthLink.getAttribute('data-auth-href') || defaultHref;

        if (authed) {
            navAuthLink.textContent = authedLabel;
            navAuthLink.setAttribute('href', authedHref);
        } else {
            navAuthLink.textContent = defaultLabel;
            navAuthLink.setAttribute('href', defaultHref);
        }
    }
});
