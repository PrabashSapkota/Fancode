const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

let streamData = {
    m3u8Url: null,
    token: null,
    startDate: null,
    endDate: null,
    domain: null,
    channel: null,
    lastUpdated: null
};

let browser = null;

async function getBrowser() {
    if (!browser) {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
    }
    return browser;
}

function parseM3U8Url(url) {
    try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(p => p);
        const secureIndex = pathParts.indexOf('secure');
        if (secureIndex === -1) return null;

        return {
            fullUrl: url,
            token: pathParts[secureIndex + 1],
            startDate: parseInt(pathParts[secureIndex + 2]),
            endDate: parseInt(pathParts[secureIndex + 3]),
            channel: pathParts[secureIndex + 4],
            domain: `${urlObj.protocol}//${urlObj.host}`
        };
    } catch (e) {
        return null;
    }
}

function generateTimestamps() {
    const now = Math.floor(Date.now() / 1000);
    return { startDate: now, endDate: now + 3600 };
}

function constructUrl(data) {
    const ts = generateTimestamps();
    return `${data.domain}/secure/${data.token}/${ts.startDate}/${ts.endDate}/${data.channel}/index.m3u8`;
}

async function extractWithPuppeteer(iframeUrl) {
    try {
        console.log('Using Puppeteer to extract stream...');
        const browser = await getBrowser();
        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Referer': 'https://pooembed.eu/'
        });

        await page.goto(iframeUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Wait a bit for any dynamic content
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Get all iframes
        const frames = page.frames();
        console.log('Number of frames:', frames.length);

        for (const frame of frames) {
            try {
                const url = frame.url();
                if (url && url.includes('.m3u8')) {
                    console.log('Found m3u8 in frame:', url);
                    await page.close();
                    return url;
                }
            } catch (e) {}
        }

        // Look for video elements
        const videos = await page.$$eval('video', els => els.map(e => ({
            src: e.src,
            dataSrc: e.getAttribute('data-src')
        })));
        
        for (const v of videos) {
            if (v.src && v.src.includes('.m3u8')) {
                console.log('Found m3u8 in video:', v.src);
                await page.close();
                return v.src;
            }
            if (v.dataSrc && v.dataSrc.includes('.m3u8')) {
                console.log('Found m3u8 in video data-src:', v.dataSrc);
                await page.close();
                return v.dataSrc;
            }
        }

        // Look for source elements
        const sources = await page.$$eval('source', els => els.map(e => ({
            src: e.src,
            type: e.type
        })));

        for (const s of sources) {
            if (s.src && (s.src.includes('.m3u8') || s.type?.includes('mpegurl'))) {
                console.log('Found m3u8 in source:', s.src);
                await page.close();
                return s.src;
            }
        }

        // Get page content and look for m3u8
        const content = await page.content();
        const m3u8Match = content.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/);
        if (m3u8Match) {
            console.log('Found m3u8 in page content:', m3u8Match[0]);
            await page.close();
            return m3u8Match[0];
        }

        // Try to find any iframe src
        const iframes = await page.$$eval('iframe', els => els.map(e => e.src));
        if (iframes.length > 0) {
            console.log('Found iframes:', iframes[0]);
            await page.close();
            return iframes[0];
        }

        await page.close();
        return null;
    } catch (e) {
        console.error('Puppeteer error:', e.message);
        return null;
    }
}

async function extractM3U8(iframeUrl) {
    try {
        // First try regular HTTP request
        console.log('Trying regular extraction...');
        
        const response = await axios.get(iframeUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://pooembed.eu/'
            },
            timeout: 15000
        });

        const $ = cheerio.load(response.data);
        
        // Look for iframe
        const iframeSrc = $('iframe').attr('src');
        if (iframeSrc) {
            if (iframeSrc.includes('.m3u8')) return iframeSrc;
            
            // If relative URL, construct full URL
            if (!iframeSrc.startsWith('http')) {
                const urlObj = new URL(iframeUrl);
                return `${urlObj.protocol}//${urlObj.host}${iframeSrc}`;
            }
        }

        // Direct regex search
        const m3u8Regex = /https?:\/\/[^\s"']+\.m3u8[^\s"']*/g;
        const matches = response.data.match(m3u8Regex);
        if (matches) return matches[0];

        // Try Puppeteer
        console.log('Regular extraction failed, trying Puppeteer...');
        return await extractWithPuppeteer(iframeUrl);
        
    } catch (e) {
        console.error('Extract error:', e.message);
        // Try Puppeteer as fallback
        return await extractWithPuppeteer(iframeUrl);
    }
}

function buildPlayer(streamUrl) {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Stream Player</title>
    <link href="https://vjs.zencdn.net/8.10.0/video-js.css" rel="stylesheet" />
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body, #video-container { width: 100%; height: 100vh; overflow: hidden; background: #000; }
        .video-js { width: 100%; height: 100%; }
        .video-js .vjs-tech { width: 100%; height: 100%; }
        .vjs-poster { background-size: cover; }
    </style>
</head>
<body>
    <div id="video-container">
        <video id="my-video" class="video-js vjs-big-play-centered vjs-fluid" controls preload="auto" playsinline>
            <source src="${streamUrl}" type="application/x-mpegURL">
        </video>
    </div>
    <script src="https://vjs.zencdn.net/8.10.0/video.min.js"></script>
    <script>
        const player = videojs('my-video', {
            autoplay: true,
            muted: false,
            fluid: true,
            playbackRates: [0.5, 1, 1.5, 2],
            sources: [{ src: '${streamUrl}', type: 'application/x-mpegURL' }]
        });

        player.on('error', function() {
            console.log('Error, attempting refresh...');
            window.location.reload();
        });

        setInterval(() => {
            fetch('/refresh').then(r => r.json()).then(data => {
                if (data.newUrl) {
                    player.src({ src: data.newUrl, type: 'application/x-mpegURL' });
                    console.log('Token refreshed');
                }
            }).catch(() => {});
        }, 55000);
    </script>
</body>
</html>`;
}

app.get('/', async (req, res) => {
    const iframeUrl = req.query.stream;
    
    if (!iframeUrl) {
        return res.send(`<!DOCTYPE html>
<html>
<head>
    <title>Stream Proxy</title>
    <style>
        body { font-family: Arial; max-width: 600px; margin: 100px auto; padding: 20px; }
        input, button { padding: 12px; width: 100%; margin-bottom: 10px; }
        input { font-size: 16px; }
        button { background: #007bff; color: white; border: none; cursor: pointer; font-size: 16px; }
        .help { background: #f5f5f5; padding: 15px; border-radius: 5px; margin-top: 20px; }
    </style>
</head>
<body>
    <h2>Stream Proxy Server</h2>
    <form action="/" method="GET">
        <input type="text" name="stream" placeholder="Enter iframe URL..." required>
        <button type="submit">Load Stream</button>
    </form>
    <div class="help">
        <strong>Usage:</strong><br>
        <code>/?stream=IFRAME_URL</code><br><br>
        <strong>Example:</strong><br>
        <code>/?stream=https://example.com/embed/stream</code>
    </div>
</body>
</html>`);
    }

    console.log('=== Processing:', iframeUrl);
    
    const m3u8Url = await extractM3U8(iframeUrl);
    
    if (!m3u8Url) {
        return res.status(400).send('Could not extract m3u8 from iframe. The page may require browser-based extraction.');
    }

    console.log('Extracted m3u8:', m3u8Url);
    
    const parsed = parseM3U8Url(m3u8Url);
    if (!parsed) {
        if (m3u8Url.includes('.m3u8')) {
            streamData = {
                m3u8Url: m3u8Url,
                token: null,
                isDirect: true
            };
            return res.send(buildPlayer(m3u8Url));
        }
        return res.status(400).send('Could not parse m3u8 URL');
    }

    streamData = {
        m3u8Url,
        token: parsed.token,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        domain: parsed.domain,
        channel: parsed.channel,
        lastUpdated: new Date(),
        isDirect: false
    };

    const freshUrl = constructUrl(streamData);
    res.send(buildPlayer(freshUrl));
});

app.get('/refresh', async (req, res) => {
    if (!streamData.token) return res.json({ error: 'No stream' });

    try {
        const timestamps = generateTimestamps();
        const newUrl = `${streamData.domain}/secure/${streamData.token}/${timestamps.startDate}/${timestamps.endDate}/${streamData.channel}/index.m3u8`;
        
        const testResponse = await axios.get(newUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0...' },
            timeout: 10000,
            validateStatus: () => true
        });

        if (testResponse.status === 200) {
            streamData.startDate = timestamps.startDate;
            streamData.endDate = timestamps.endDate;
            streamData.lastUpdated = new Date();
            return res.json({ newUrl, success: true });
        }
        
        return res.json({ error: 'Stream expired' });
    } catch (e) {
        return res.json({ error: e.message });
    }
});

process.on('SIGINT', async () => {
    if (browser) await browser.close();
    process.exit();
});

app.listen(PORT, () => {
    console.log(`Server: http://localhost:${PORT}/?stream=IFRAME_URL`);
});