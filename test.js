const puppeteer = require('puppeteer');

async function test() {
    const url = 'https://pooembed.eu/embed/ipl/2026-05-17/dc-rr';
    const m3u8Urls = [];
    const requestUrls = [];
    
    console.log('Testing Puppeteer with network interception...');
    
    try {
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
        });
        
        const page = await browser.newPage();
        
        // Capture all network requests
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const reqUrl = request.url();
            requestUrls.push(reqUrl);
            if (reqUrl.includes('.m3u8') || reqUrl.includes('master') || reqUrl.includes('playlist')) {
                m3u8Urls.push(reqUrl);
            }
            request.continue();
        });
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        
        console.log('Navigating...');
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        console.log('Waiting for content...');
        await new Promise(r => setTimeout(r, 10000));
        
        console.log('\n=== M3U8 URLs found ===');
        console.log(m3u8Urls);
        
        console.log('\n=== All request domains ===');
        const domains = [...new Set(requestUrls.map(u => {
            try { return new URL(u).hostname; } catch { return 'unknown'; }
        }))];
        console.log(domains);
        
        // Also check console logs
        console.log('\n=== Checking video blob source ===');
        const videoInfo = await page.evaluate(() => {
            const video = document.querySelector('video');
            if (!video) return 'No video found';
            return {
                src: video.src,
                currentSrc: video.currentSrc,
                readyState: video.readyState
            };
        });
        console.log(videoInfo);
        
        await browser.close();
    } catch (e) {
        console.error('Error:', e.message);
        console.log('\n=== M3U8 found before error ===');
        console.log(m3u8Urls);
    }
}

test();