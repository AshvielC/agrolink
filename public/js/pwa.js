document.addEventListener('DOMContentLoaded', () => {
    if (!('serviceWorker' in navigator)) {
        return;
    }

    window.addEventListener('load', async () => {
        try {
            await navigator.serviceWorker.register('/service-worker.js', {
                scope: '/',
                updateViaCache: 'none'
            });

            console.log('AgroLink service worker registered.');
        } catch (error) {
            console.error('AgroLink service worker registration failed:', error);
        }
    });
});