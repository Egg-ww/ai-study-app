import { GoogleGenAI } from '@google/genai';

let currentUser = null;
let currentHistoryId = null;
let currentMode = 'interactive';

let currentQuestionsData = null;
let currentSubjectText = '';
let currentDiffText = '標準';

let quizQuestions = [];
let quizCurrentIdx = 0;
let quizUserAnswers = {}; 
let quizRewardedIndexes = new Set(); 

let flashcards = [];
let fcIndex = 0;
let fcKnown = new Set();

const GEMINI_MODEL = 'gemini-2.5-flash';
google.charts.load('current', {'packages':['corechart']});

window.switchMode = function(mode) {
    currentMode = mode;
    ['interactive', 'test', 'flashcard'].forEach(m => {
        document.getElementById(`tab-${m}`).className = `mode-tab ${m === mode ? 'active' : ''}`;
    });
    
    const countUnit = document.getElementById('countUnit');
    const generateBtn = document.getElementById('generateBtn');

    document.getElementById('quiz-section').style.display = 'none';
    document.getElementById('output').style.display = 'none';
    document.getElementById('flashcard-section').style.display = 'none';
    document.getElementById('scoring-section').style.display = 'none';

    if(mode === 'interactive') {
        countUnit.textContent = '問';
        generateBtn.className = 'btn-primary';
        generateBtn.innerHTML = '🎯 クイズ開始';
        if(quizQuestions.length > 0) document.getElementById('quiz-section').style.display = 'block';
    } else if(mode === 'test') {
        countUnit.textContent = '問';
        generateBtn.className = 'btn-success';
        generateBtn.innerHTML = '📝 問題を作る';
        document.getElementById('output').style.display = 'block';
        if(currentQuestionsData) document.getElementById('scoring-section').style.display = 'block';
    } else if(mode === 'flashcard') {
        countUnit.textContent = '枚';
        generateBtn.className = 'btn-purple';
        generateBtn.innerHTML = '🎴 カード作成';
        if(flashcards.length > 0) document.getElementById('flashcard-section').style.display = 'block';
    }
};

window.handleGenerate = function() {
    if(currentMode === 'interactive') makeInteractiveQuiz();
    else if(currentMode === 'flashcard') makeFlashcards();
    else makeQuestion();
};

function showToast(msg, type = 'error') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = `show ${type}`;
    setTimeout(() => { toast.className = toast.className.replace('show', ''); }, 3000);
}

function toggleLoading(isLoading, msg = "AIが思考しているよ...") {
    document.getElementById('loadingSpinner').style.display = isLoading ? 'block' : 'none';
    const txtEl = document.getElementById('loadingText');
    txtEl.style.display = isLoading ? 'block' : 'none';
    txtEl.textContent = msg;
    ['generateBtn', 'gradeBtn', 'showAnswerBtn'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.disabled = isLoading;
    });
}

function safeParseJSON(text) {
    if (!text) return null;
    let clean = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    try {
        return JSON.parse(clean);
    } catch (e) {
        const start = clean.indexOf('{');
        const end = clean.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            try {
                return JSON.parse(clean.substring(start, end + 1));
            } catch(e2) {
                let fixed = clean.substring(start, end + 1).replace(/\\([a-zA-Z]+)/g, '\\\\$1');
                return JSON.parse(fixed);
            }
        }
        throw e;
    }
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeAppendText(container, text) {
    if(!text) return;
    const lines = text.split('\n');
    lines.forEach((line, i) => {
        container.appendChild(document.createTextNode(line));
        if (i < lines.length - 1) container.appendChild(document.createElement('br'));
    });
}

window.closeModal = function(id) { 
    document.getElementById(id).style.display = 'none'; 
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
};

window.addEventListener('click', (e) => {
    if(e.target.classList.contains('modal')) closeModal(e.target.id);
});
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.modal').forEach(m => closeModal(m.id));
});

// ========================================================
// 🔑 隠しコマンド受付機能
// ========================================================
let clickCount = 0;
let clickTimer = null;
const secretIcon = document.getElementById('secretIcon');

if (secretIcon) {
    secretIcon.addEventListener('click', () => {
        clickCount++;
        clearTimeout(clickTimer);
        if (clickCount >= 5) {
            clickCount = 0;
            document.getElementById('commandInput').value = '';
            document.getElementById('secretModal').style.display = 'flex';
            showToast("✨ 隠しコマンド入力画面が開きました！", "success");
        } else {
            clickTimer = setTimeout(() => { clickCount = 0; }, 1000);
        }
    });
}

window.executeCommand = function() {
    const cmd = document.getElementById('commandInput').value.trim().toLowerCase();
    if (!cmd) return showToast("コマンドを入力してください");
    
    closeModal('secretModal');

    if (cmd === "daruma") {
        runOmikuji();
    } else if (cmd === "arashi") {
        runArashiRecommend();
    } else if (cmd === "greeeen" || cmd === "gree4n" || cmd === "gree4nboyz") {
        runGReeeeNRecommend();
    } else if (cmd === "mele") {
        runMeleRecommend();
    } else {
        showToast("存在しないコマンドです", "error");
    }
};

function fetchJsonp(url) {
    return new Promise((resolve, reject) => {
        const callbackName = 'jsonp_callback_' + Math.round(100000 * Math.random());
        const script = document.createElement('script');
        
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error('通信がタイムアウトしました'));
        }, 8000);

        function cleanup() {
            clearTimeout(timer);
            if (script.parentNode) script.parentNode.removeChild(script);
            delete window[callbackName];
        }

        window[callbackName] = function(data) {
            cleanup();
            resolve(data);
        };

        script.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'callback=' + callbackName;
        script.onerror = function() {
            cleanup();
            reject(new Error('スクリプト読み込みエラー'));
        };
        document.body.appendChild(script);
    });
}

function hideAllModeSections() {
    document.getElementById('quiz-section').style.display = 'none';
    document.getElementById('flashcard-section').style.display = 'none';
    document.getElementById('scoring-section').style.display = 'none';
    const out = document.getElementById('output');
    out.style.display = 'block';
    out.innerHTML = '';
}

// --- ⛩️ 隠し機能①: おみくじ ---
window.runOmikuji = async function() {
    let ai; try { ai = getApiInstance(); } catch(e) { return; }
    hideAllModeSections();
    const outputDiv = document.getElementById('output');
    toggleLoading(true, "⛩️ 今日の運勢を占っています...");

    const rand = Math.random() * 100;
    let fortune = "";
    if (rand < 15) fortune = "大吉";
    else if (rand < 30) fortune = "中吉";
    else if (rand < 45) fortune = "小吉";
    else if (rand < 85) fortune = "吉";
    else if (rand < 97) fortune = "凶";
    else fortune = "大凶";

    let fortuneColor = "#333";
    if(fortune === "大吉") fortuneColor = "#e53935";
    else if(fortune === "凶" || fortune === "大凶") fortuneColor = "#5e35b1";

    const prompt = `ユーザーがおみくじを引きました。今日の運勢は「${fortune}」です。
この運勢を踏まえ、今日1日の生活や勉強のアドバイスを優しく前向きに伝えてください。
必ず以下のJSON形式のみを出力してください。
{
  "advice": "アドバイス文章",
  "details": { "願事": "結果", "恋愛": "結果", "待人": "結果", "商売": "結果", "旅行": "結果", "学問": "結果", "病気": "結果" },
  "lucky": { "開運物": ["アイテム1", "アイテム2", "アイテム3"], "開運場所": "場所", "開運行動": "行動", "開運食": "食べ物", "開運色": { "name": "色名", "code": "#カラーコード" } },
  "unlucky": { "不運物": "アイテム", "不運場所": "スポット", "NG行動": "行動", "NGワード": ["言葉1", "言葉2", "言葉3"] }
}`;

    try {
        const response = await ai.models.generateContent({
            model: GEMINI_MODEL, contents: prompt, config: { responseMimeType: "application/json" }
        });
        const data = safeParseJSON(response.text);

        let html = `
            <div style="text-align:center; padding: 10px;">
                <div style="font-size: 60px; margin-bottom: 10px; animation: bounce 1s infinite;">⛩️</div>
                <h2 style="font-size: 40px; margin: 0 0 20px 0; color: ${fortuneColor}; font-weight: 900; letter-spacing: 5px;">${fortune}</h2>
                <div style="background: #fff; padding: 20px; border-radius: 8px; border: 3px dashed #d32f2f; text-align: left; font-size: 15px; line-height: 1.8; margin-bottom: 20px;">
                    ${data.advice ? escapeHtml(data.advice).replace(/\n/g, '<br>') : ''}
                </div>
                <h3 style="text-align: left; border-left: 5px solid #d32f2f; padding-left: 10px; font-size:18px;">✨ 個別の運勢</h3>
                <table class="fortune-table">`;
        for (const [key, value] of Object.entries(data.details || {})) html += `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`;

        html += `</table><h3 style="text-align: left; border-left: 5px solid #28a745; padding-left: 10px; font-size:18px;">🍀 開運のヒント</h3><table class="fortune-table">`;
        for (const [key, value] of Object.entries(data.lucky || {})) {
            if (key === '開運色' && value && value.code) html += `<tr><th>${escapeHtml(key)}</th><td><span class="color-badge" style="background-color: ${escapeHtml(value.code)};"></span>${escapeHtml(value.name)} (${escapeHtml(value.code)})</td></tr>`;
            else if (Array.isArray(value)) html += `<tr><th>${escapeHtml(key)}</th><td>${value.map(escapeHtml).join('、')}</td></tr>`;
            else html += `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`;
        }

        html += `</table><h3 style="text-align: left; border-left: 5px solid #dc3545; padding-left: 10px; font-size:18px;">⚠️ 不運に備える</h3><table class="fortune-table">`;
        for (const [key, value] of Object.entries(data.unlucky || {})) {
            if (Array.isArray(value)) html += `<tr><th>${escapeHtml(key)}</th><td>${value.map(escapeHtml).join('、')}</td></tr>`;
            else html += `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`;
        }

        html += `</table></div>`;
        outputDiv.innerHTML = html;

    } catch (error) {
        showToast("運勢の占いに失敗しました。");
    } finally {
        toggleLoading(false);
    }
};

// --- バックアップデータ（嵐の曲用） ---
const FALLBACK_ARASHI_SONGS = [
    {
        trackName: "A・RA・SHI", artistName: "嵐", collectionName: "5×20 All the BEST!! 1999-2019",
        artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/bf/f4/cf/bff4cf23-5e7e-e24c-9f82-a9b0d2d3ce6b/JABA-5214.jpg/300x300bb.jpg",
        previewUrl: ""
    },
    {
        trackName: "Love so sweet", artistName: "嵐", collectionName: "Time",
        artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/e5/22/01/e52201b1-e2db-4a25-c6aa-4c749eb4eb5b/JACA-5064.jpg/300x300bb.jpg",
        previewUrl: ""
    },
    {
        trackName: "Monster", artistName: "嵐", collectionName: "僕の見ている風景",
        artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/be/8a/a5/be8aa5e1-88f5-19e4-c782-b7e67f70b4be/JACA-5232.jpg/300x300bb.jpg",
        previewUrl: ""
    }
];

// --- 🎵 隠し機能②: 嵐ソング ---
window.runArashiRecommend = async function() {
    let ai; try { ai = getApiInstance(); } catch(e) { return; }
    hideAllModeSections();
    const outputDiv = document.getElementById('output');
    toggleLoading(true, "🎵 Apple Musicから嵐の楽曲を探しています...");

    let track = null;
    try {
        const itunesData = await fetchJsonp(`https://itunes.apple.com/search?term=${encodeURIComponent("嵐 ARASHI")}&country=JP&media=music&entity=song&limit=150`);
        const tracks = (itunesData.results || []).filter(t =>
            t.artistName === "嵐" || t.artistName === "ARASHI" || (t.artistName && t.artistName.includes("嵐"))
        );
        if (tracks.length > 0) track = tracks[Math.floor(Math.random() * tracks.length)];
    } catch (apiError) {}
    if (!track) track = FALLBACK_ARASHI_SONGS[Math.floor(Math.random() * FALLBACK_ARASHI_SONGS.length)];

    const songTitle = track.trackName;
    const artistName = track.artistName;
    const albumName = track.collectionName || "";
    const artworkUrl = track.artworkUrl100 ? track.artworkUrl100.replace('100x100bb', '300x300bb') : "";
    const previewUrl = track.previewUrl;

    toggleLoading(true, "✨ AIがこの曲のおすすめポイントを執筆中...");

    try {
        const prompt = `嵐（ARASHI）の楽曲『${songTitle}』（アルバム: ${albumName}）が今日のおすすめ曲として選ばれました！
※この曲がメンバーのソロ曲である場合は、誰のソロ曲であるかも含めて触れてください。
この曲についてのファンに向けた今日のおすすめコメントや魅力、聴きどころを120文字程度で熱く優しく語ってください。
必ず以下のJSON形式のみを出力してください。
{ "comment": "コメント文章", "mood": "今日の一言・テーマ（例: パワーをもらいたい朝に、しっとり聴きたい夜に など）" }`;

        const response = await ai.models.generateContent({
            model: GEMINI_MODEL, contents: prompt, config: { responseMimeType: "application/json" }
        });
        const aiData = safeParseJSON(response.text);

        outputDiv.innerHTML = `
            <div style="padding: 20px; background: linear-gradient(135deg, #e3f2fd, #ffffff); border-radius: 10px; border: 2px solid #90caf9; box-shadow: 0 4px 10px rgba(0,0,0,0.05); text-align: center;">
                <div style="font-size: 13px; font-weight: bold; color: #1976d2; letter-spacing: 2px; margin-bottom: 12px;">🎧 TODAY'S ARASHI SONG</div>
                ${artworkUrl ? `<img src="${escapeHtml(artworkUrl)}" alt="${escapeHtml(songTitle)}" style="width: 180px; height: 180px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); margin-bottom: 15px;">` : ''}
                <h2 style="font-size: 22px; margin: 5px 0; color: #0d47a1; font-weight: bold;">『${escapeHtml(songTitle)}』</h2>
                <div style="font-size: 14px; color: #555; font-weight: bold; margin-bottom: 10px;">${escapeHtml(artistName)} ${albumName ? `<br><span style="font-size:12px; font-weight:normal; color:#777;">(${escapeHtml(albumName)})</span>` : ''}</div>
                ${previewUrl ? `<div style="margin: 15px 0; padding: 10px; background: rgba(255,255,255,0.8); border-radius: 8px;"><p style="font-size: 12px; color: #1976d2; font-weight: bold; margin: 0 0 5px 0;">🎵 30秒試聴プレイヤー</p><audio controls src="${escapeHtml(previewUrl)}" style="width: 100%; max-width: 320px;"></audio></div>` : ''}
                <div style="background: #ffffff; padding: 15px; border-radius: 8px; border-left: 5px solid #2196f3; text-align: left; margin-top: 15px;">
                    <div style="font-weight: bold; color: #1565c0; font-size: 14px; margin-bottom: 5px;">🌈 テーマ：${escapeHtml(aiData.mood)}</div>
                    <div style="font-size: 14px; line-height: 1.7; color: #333;">${aiData.comment ? escapeHtml(aiData.comment).replace(/\n/g, '<br>') : ''}</div>
                </div>
            </div>`;
    } catch (error) {
        showToast("AIの解説作成に失敗しました。");
    } finally {
        toggleLoading(false);
    }
};

// --- 隠し機能③: GRe4N BOYZ ソング ---
window.runGReeeeNRecommend = async function() {
    let ai; try { ai = getApiInstance(); } catch(e) { return; }
    hideAllModeSections();
    const outputDiv = document.getElementById('output');
    toggleLoading(true, "🎵 Apple MusicからGRe4N BOYZの楽曲を探しています...");

    try {
        const targets = ["GRe4N BOYZ", "GReeeeN"];
        const randomTarget = targets[Math.floor(Math.random() * targets.length)];
        const itunesData = await fetchJsonp(`https://itunes.apple.com/search?term=${encodeURIComponent(randomTarget)}&country=JP&media=music&entity=song&limit=100`);
        if (!itunesData.results || itunesData.results.length === 0) throw new Error("楽曲なし");

        const track = itunesData.results[Math.floor(Math.random() * itunesData.results.length)];
        const songTitle = track.trackName;
        const artistName = track.artistName;
        const albumName = track.collectionName || "";
        const artworkUrl = track.artworkUrl100 ? track.artworkUrl100.replace('100x100bb', '300x300bb') : "";
        const previewUrl = track.previewUrl;

        toggleLoading(true, "✨ AIがこの曲のおすすめポイントを執筆中...");

        const prompt = `GRe4N BOYZ (GReeeeN) の楽曲『${songTitle}』（アルバム: ${albumName}）が今日のおすすめ曲として選ばれました！ファンに向けた今日のおすすめコメントや魅力、聴きどころを120文字程度で語ってください。JSON形式のみ: { "comment": "コメント文章", "mood": "今日の一言・テーマ" }`;

        const response = await ai.models.generateContent({
            model: GEMINI_MODEL, contents: prompt, config: { responseMimeType: "application/json" }
        });
        const aiData = safeParseJSON(response.text);

        outputDiv.innerHTML = `
            <div style="padding: 20px; background: linear-gradient(135deg, #e8f5e9, #ffffff); border-radius: 10px; border: 2px solid #a5d6a7; box-shadow: 0 4px 10px rgba(0,0,0,0.05); text-align: center;">
                <div style="font-size: 13px; font-weight: bold; color: #2e7d32; letter-spacing: 2px; margin-bottom: 12px;">💚 TODAY'S GRe4N BOYZ SONG</div>
                ${artworkUrl ? `<img src="${escapeHtml(artworkUrl)}" alt="${escapeHtml(songTitle)}" style="width: 180px; height: 180px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); margin-bottom: 15px;">` : ''}
                <h2 style="font-size: 22px; margin: 5px 0; color: #1b5e20; font-weight: bold;">『${escapeHtml(songTitle)}』</h2>
                <div style="font-size: 14px; color: #555; font-weight: bold; margin-bottom: 10px;">${escapeHtml(artistName)} ${albumName ? `<br><span style="font-size:12px; font-weight:normal; color:#777;">(${escapeHtml(albumName)})</span>` : ''}</div>
                ${previewUrl ? `<div style="margin: 15px 0; padding: 10px; background: rgba(255,255,255,0.8); border-radius: 8px;"><audio controls src="${escapeHtml(previewUrl)}" style="width: 100%; max-width: 320px;"></audio></div>` : ''}
                <div style="background: #ffffff; padding: 15px; border-radius: 8px; border-left: 5px solid #4caf50; text-align: left; margin-top: 15px;">
                    <div style="font-weight: bold; color: #2e7d32; font-size: 14px; margin-bottom: 5px;">🍀 テーマ：${escapeHtml(aiData.mood)}</div>
                    <div style="font-size: 14px; line-height: 1.7; color: #333;">${aiData.comment ? escapeHtml(aiData.comment).replace(/\n/g, '<br>') : ''}</div>
                </div>
            </div>`;
    } catch (error) {
        showToast("おすすめ曲の取得に失敗しました。");
    } finally {
        toggleLoading(false);
    }
};

// --- 隠し機能④: 国内名曲 ---
window.runMeleRecommend = async function() {
    let ai; try { ai = getApiInstance(); } catch(e) { return; }
    hideAllModeSections();
    const outputDiv = document.getElementById('output');
    toggleLoading(true, "🎼 AIが君の世代に刺さる名曲を選んでいます...");

    let songTitle = "", artistName = "", comment = "", mood = "";
    try {
        const pickPrompt = `日本の音楽に詳しい専門家として、現在中学生前後の子が「聴いたことがある」可能性が高い、日本の有名曲（嵐以外）を1曲選び、JSON形式で出力してください。
{ "songTitle": "曲名", "artistName": "アーティスト名", "comment": "魅力や聴きどころを120文字程度", "mood": "テーマ" }`;

        const pickRes = await ai.models.generateContent({
            model: GEMINI_MODEL, contents: pickPrompt, config: { responseMimeType: "application/json" }
        });
        const pickData = safeParseJSON(pickRes.text);
        songTitle = pickData.songTitle || "";
        artistName = pickData.artistName || "";
        comment = pickData.comment || "";
        mood = pickData.mood || "";
        if (!songTitle) throw new Error("曲選定失敗");
    } catch (error) {
        showToast("曲の選定に失敗しました。");
        toggleLoading(false);
        return;
    }

    toggleLoading(true, `🎵 Apple Musicで『${songTitle}』を探しています...`);

    let track = null;
    try {
        const itunesData = await fetchJsonp(`https://itunes.apple.com/search?term=${encodeURIComponent(songTitle + " " + artistName)}&country=JP&media=music&entity=song&limit=10`);
        const results = itunesData.results || [];
        track = results.find(t => t.artistName && (t.artistName.includes(artistName) || artistName.includes(t.artistName))) || results[0] || null;
    } catch (apiError) {}

    const albumName = track ? (track.collectionName || "") : "";
    const artworkUrl = track && track.artworkUrl100 ? track.artworkUrl100.replace('100x100bb', '300x300bb') : "";
    const previewUrl = track ? track.previewUrl : "";
    const displayTitle = track ? track.trackName : songTitle;
    const displayArtist = track ? track.artistName : artistName;

    outputDiv.innerHTML = `
        <div style="padding: 20px; background: linear-gradient(135deg, #fff3e0, #ffffff); border-radius: 10px; border: 2px solid #ffcc80; box-shadow: 0 4px 10px rgba(0,0,0,0.05); text-align: center;">
            <div style="font-size: 13px; font-weight: bold; color: #ef6c00; letter-spacing: 2px; margin-bottom: 12px;">🎼 TODAY'S RECOMMENDED SONG</div>
            ${artworkUrl ? `<img src="${escapeHtml(artworkUrl)}" alt="${escapeHtml(displayTitle)}" style="width: 180px; height: 180px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); margin-bottom: 15px;">` : ''}
            <h2 style="font-size: 22px; margin: 5px 0; color: #e65100; font-weight: bold;">『${escapeHtml(displayTitle)}』</h2>
            <div style="font-size: 14px; color: #555; font-weight: bold; margin-bottom: 10px;">${escapeHtml(displayArtist)} ${albumName ? `<br><span style="font-size:12px; font-weight:normal; color:#777;">(${escapeHtml(albumName)})</span>` : ''}</div>
            ${previewUrl ? `<div style="margin: 15px 0; padding: 10px; background: rgba(255,255,255,0.8); border-radius: 8px;"><audio controls src="${escapeHtml(previewUrl)}" style="width: 100%; max-width: 320px;"></audio></div>` : ''}
            <div style="background: #ffffff; padding: 15px; border-radius: 8px; border-left: 5px solid #ff9800; text-align: left; margin-top: 15px;">
                <div style="font-weight: bold; color: #ef6c00; font-size: 14px; margin-bottom: 5px;">🎧 テーマ：${escapeHtml(mood)}</div>
                <div style="font-size: 14px; line-height: 1.7; color: #333;">${comment ? escapeHtml(comment).replace(/\n/g, '<br>') : ''}</div>
            </div>
        </div>`;
    toggleLoading(false);
};

// ========================================================
// 🎯 1. Gemini風 インタラクティブクイズ
// ========================================================
window.makeInteractiveQuiz = async function() {
    const subject = document.getElementById('subjectInput').value.trim();
    const diff = document.getElementById('diffLevel').value;
    let count = parseInt(document.getElementById('qCount').value) || 4;
    count = Math.max(1, Math.min(15, count));

    if(!subject) return showToast("教科や単元を入力してね！");
    if(!currentUser) return showToast("先にログインしてね！");

    let ai; try { ai = getApiInstance(); } catch(e) { return; }
    toggleLoading(true, "🎯 Gemini風クイズを作成しているよ...");

    const prompt = `あなたは中学校のカリスマ講師です。「${subject}」に関する4択の確認テストを「${diff}」レベルで「${count}問」作成してください。
数式を記述する場合は \\frac ではなく \\\\frac のようにバックスラッシュを2重にしてJSON形式を壊さないようにしてください。
必ず以下の厳密なJSON形式のみで出力してください。
{
  "title": "${subject} 確認テスト",
  "questions": [
    {
      "question": "問題文(数式はLaTeXの$で囲む)",
      "options": ["選択肢Aのテキスト", "選択肢Bのテキスト", "選択肢Cのテキスト", "選択肢Dのテキスト"],
      "correctIndex": (正解の番号: 0から3の整数),
      "hint": "答えを導くための親切なヒント",
      "explanation": "なぜその選択肢が正解なのかの詳しい解説"
    }
  ]
}`;

    try {
        const res = await ai.models.generateContent({ model: GEMINI_MODEL, contents: prompt, config: { responseMimeType: "application/json" } });
        const data = safeParseJSON(res.text);
        if(!data || !data.questions || data.questions.length === 0) throw new Error("クイズ生成失敗");

        quizQuestions = data.questions;
        quizCurrentIdx = 0;
        quizUserAnswers = {};
        quizRewardedIndexes.clear();

        document.getElementById('quiz-title-text').textContent = data.title || `${subject} 確認テスト`;
        document.getElementById('quiz-section').style.display = 'block';
        document.getElementById('output').style.display = 'none';
        document.getElementById('flashcard-section').style.display = 'none';

        renderQuizQuestion();
        showToast(`✨ ${quizQuestions.length}問の確認テストを作成しました！`, "success");

    } catch(e) { showToast("クイズの作成に失敗しました。再試行してください。"); } finally { toggleLoading(false); }
};

function getQuizCounts() {
    let correct = 0; let wrong = 0;
    Object.keys(quizUserAnswers).forEach(idx => {
        const q = quizQuestions[idx];
        if(q) { if(quizUserAnswers[idx] === q.correctIndex) correct++; else wrong++; }
    });
    return { correct, wrong };
}

function renderQuizQuestion() {
    if(quizQuestions.length === 0) return;
    const q = quizQuestions[quizCurrentIdx];
    const total = quizQuestions.length;
    const counts = getQuizCounts();

    const segBar = document.getElementById('quiz-segments-bar');
    segBar.innerHTML = '';
    for(let i = 0; i < total; i++) {
        const dot = document.createElement('div');
        dot.className = 'quiz-segment-dot';
        if(i === quizCurrentIdx) dot.classList.add('active');
        if(quizUserAnswers[i] !== undefined) dot.classList.add('completed');
        segBar.appendChild(dot);
    }

    document.getElementById('quiz-counter').textContent = `${quizCurrentIdx + 1}/${total}`;
    document.getElementById('quiz-badge-wrong').textContent = `✕ ${counts.wrong}`;
    document.getElementById('quiz-badge-correct').textContent = `✓ ${counts.correct}`;
    document.getElementById('quiz-q-num').textContent = `問題 ${quizCurrentIdx + 1}`;
    
    const qTextEl = document.getElementById('quiz-q-text');
    qTextEl.innerHTML = ''; safeAppendText(qTextEl, q.question);

    const optContainer = document.getElementById('quiz-options-container');
    optContainer.innerHTML = '';
    const letters = ['A', 'B', 'C', 'D'];
    const isAnswered = quizUserAnswers[quizCurrentIdx] !== undefined;

    q.options.forEach((optText, optIdx) => {
        const btn = document.createElement('button');
        btn.className = 'quiz-option-btn';
        btn.disabled = isAnswered;

        const letterSpan = document.createElement('span');
        letterSpan.className = 'quiz-opt-letter';
        letterSpan.textContent = `${letters[optIdx]}.`;
        btn.appendChild(letterSpan);

        const textSpan = document.createElement('span');
        safeAppendText(textSpan, optText);
        btn.appendChild(textSpan);

        if(isAnswered) {
            const userSelected = quizUserAnswers[quizCurrentIdx];
            if(optIdx === q.correctIndex) btn.classList.add('selected-correct');
            else if(optIdx === userSelected) btn.classList.add('selected-wrong');
        } else {
            btn.onclick = () => selectQuizOption(optIdx);
        }
        optContainer.appendChild(btn);
    });

    const hintContent = document.getElementById('quiz-hint-content');
    hintContent.style.display = 'none';
    hintContent.innerHTML = `💡 ${escapeHtml(q.hint || 'よく問題を読んで考えてみよう！')}`;
    document.getElementById('quiz-hint-arrow').textContent = 'ヒント ∨';

    const expContent = document.getElementById('quiz-exp-content');
    if(isAnswered && q.explanation) {
        expContent.style.display = 'block';
        expContent.innerHTML = `<strong>解説:</strong> ${escapeHtml(q.explanation)}`;
    } else {
        expContent.style.display = 'none';
    }

    document.getElementById('btn-quiz-back').disabled = (quizCurrentIdx === 0);
    const nextBtn = document.getElementById('btn-quiz-next');
    
    if(isAnswered) {
        nextBtn.disabled = false;
        nextBtn.classList.add('ready');
        nextBtn.textContent = (quizCurrentIdx === total - 1) ? '結果を見る 🎉' : '次へ';
    } else {
        nextBtn.disabled = true;
        nextBtn.classList.remove('ready');
        nextBtn.textContent = '次へ';
    }

    if(window.MathJax && window.MathJax.typesetPromise) window.MathJax.typesetPromise([qTextEl, optContainer]).catch(() => {});
}

window.selectQuizOption = function(selectedIdx) {
    if(quizUserAnswers[quizCurrentIdx] !== undefined) return; 

    const q = quizQuestions[quizCurrentIdx];
    quizUserAnswers[quizCurrentIdx] = selectedIdx;

    if(selectedIdx === q.correctIndex && !quizRewardedIndexes.has(quizCurrentIdx)) {
        quizRewardedIndexes.add(quizCurrentIdx);
        if(currentUser) {
            const curScore = parseInt(localStorage.getItem(getUserKey('score'))) || 0;
            localStorage.setItem(getUserKey('score'), curScore + 10);
            updateStatsUI();
        }
    }
    renderQuizQuestion();
};

window.toggleQuizHint = function() {
    const hintContent = document.getElementById('quiz-hint-content');
    const arrow = document.getElementById('quiz-hint-arrow');
    if(hintContent.style.display === 'block') { hintContent.style.display = 'none'; arrow.textContent = 'ヒント ∨'; }
    else { hintContent.style.display = 'block'; arrow.textContent = 'ヒント ∧'; }
};

window.navQuiz = function(dir) {
    if(dir > 0 && quizUserAnswers[quizCurrentIdx] === undefined) {
        showToast("選択肢を選んで回答してください！"); return;
    }
    const nextIdx = quizCurrentIdx + dir;
    if(nextIdx >= 0 && nextIdx < quizQuestions.length) { quizCurrentIdx = nextIdx; renderQuizQuestion(); }
    else if(nextIdx >= quizQuestions.length) { showQuizResult(); }
};

function showQuizResult() {
    const total = quizQuestions.length;
    const counts = getQuizCounts();
    const score = Math.round((counts.correct / total) * 100);
    const quizBox = document.getElementById('quiz-section');

    if(currentUser) {
        let currentQCount = parseInt(localStorage.getItem(getUserKey('qCount'))) || 0;
        localStorage.setItem(getUserKey('qCount'), currentQCount + total);
        updateStatsUI();
    }

    quizBox.innerHTML = `
        <div style="text-align:center; padding:20px;">
            <div style="font-size: 55px; margin-bottom: 10px;">🎉</div>
            <h2 style="margin:0 0 10px 0; color:#1a73e8;">確認テスト終了！</h2>
            <div style="font-size: 32px; font-weight:bold; color:${score>=70?'#28a745':'#ea4335'}; margin-bottom:15px;">
                ${score} 点 <span style="font-size:16px; color:#666;">(${counts.correct}/${total}問 正解)</span>
            </div>
            <div style="display:flex; justify-content:center; gap:15px; margin-bottom:25px;">
                <div style="background:#e6f4ea; padding:12px 20px; border-radius:12px; color:#137333; font-weight:bold;">⭕ 正解: ${counts.correct}問</div>
                <div style="background:#fce8e6; padding:12px 20px; border-radius:12px; color:#c5221f; font-weight:bold;">❌ 不正解: ${counts.wrong}問</div>
            </div>
            <button class="btn-primary" style="padding:12px 25px; font-size:16px;" onclick="makeInteractiveQuiz()">🔄 もう一度挑戦する</button>
        </div>
    `;
    
    saveHistoryData(`[クイズ] ${document.getElementById('quiz-title-text').textContent}`, document.getElementById('diffLevel').value, quizQuestions.map(q => ({ text: q.question })));
    updateHistoryScore(currentHistoryId, score);
}

// ========================================================
// 🎴 2. フラッシュカード ロジック
// ========================================================
window.makeFlashcards = async function() {
    const subject = document.getElementById('subjectInput').value.trim();
    const diff = document.getElementById('diffLevel').value;
    let count = parseInt(document.getElementById('qCount').value) || 8;

    if(!subject || !currentUser) return showToast("教科入力とログインをしてね！");
    let ai; try { ai = getApiInstance(); } catch(e) { return; }
    toggleLoading(true, "🎴 暗記カードを作成中...");

    const prompt = `「${subject}」に関する学習用暗記カードを「${diff}」レベルで「${count}枚」作成してください。JSON形式のみ:
{ "cards": [ { "front": "表面", "back": "裏面", "hint": "コツ" } ] }`;

    try {
        const res = await ai.models.generateContent({ model: GEMINI_MODEL, contents: prompt, config: { responseMimeType: "application/json" } });
        const data = safeParseJSON(res.text);
        flashcards = data.cards || [];
        fcIndex = 0;
        fcKnown.clear();

        document.getElementById('flashcard-section').style.display = 'block';
        document.getElementById('output').style.display = 'none';
        document.getElementById('quiz-section').style.display = 'none';
        renderCurrentCard();
    } catch(e) { showToast("カード作成失敗"); } finally { toggleLoading(false); }
};

function renderCurrentCard() {
    if(flashcards.length === 0) return;
    const c = flashcards[fcIndex];
    document.getElementById('fc-active-card').classList.remove('is-flipped');
    document.getElementById('fc-counter').textContent = `カード ${fcIndex + 1} / ${flashcards.length}`;
    document.getElementById('fc-progress-fill').style.width = `${((fcIndex+1)/flashcards.length)*100}%`;
    
    const fEl = document.getElementById('fc-front-text'); fEl.innerHTML = ''; safeAppendText(fEl, c.front);
    const bEl = document.getElementById('fc-back-text'); bEl.innerHTML = ''; safeAppendText(bEl, c.back);
    document.getElementById('fc-back-hint').textContent = c.hint ? `💡 ${c.hint}` : '';
    if(window.MathJax && window.MathJax.typesetPromise) window.MathJax.typesetPromise([fEl, bEl]).catch(()=>{});
}

window.flipCurrentCard = () => document.getElementById('fc-active-card').classList.toggle('is-flipped');
window.markCard = function(isKnown) {
    if(isKnown && currentUser && !fcKnown.has(fcIndex)) {
        fcKnown.add(fcIndex);
        const curScore = parseInt(localStorage.getItem(getUserKey('score'))) || 0;
        localStorage.setItem(getUserKey('score'), curScore + 3);
        updateStatsUI();
    }
    if(fcIndex < flashcards.length - 1) { fcIndex++; renderCurrentCard(); } 
    else { showToast(`🎉 暗記完了！ 覚えたカード: ${fcKnown.size}/${flashcards.length}`, "success"); }
};
window.shuffleCards = () => { flashcards.sort(() => Math.random() - 0.5); fcIndex = 0; renderCurrentCard(); };

// ========================================================
// 📝 3. 通常の一覧テスト ロジック
// ========================================================
window.makeQuestion = async function() {
    const subject = document.getElementById('subjectInput').value.trim();
    const diff = document.getElementById('diffLevel').value;
    let count = parseInt(document.getElementById('qCount').value) || 5;
    count = Math.max(1, Math.min(20, count));
    document.getElementById('qCount').value = count;

    if(!subject) return showToast("教科や単元を入力してね！");
    if(!currentUser) return showToast("先にログインしてね！");
    let ai; try { ai = getApiInstance(); } catch(e) { return; }

    document.getElementById('output').innerHTML = '';
    document.getElementById('scoring-section').style.display = 'none';
    document.getElementById('grade-result').style.display = 'none';
    document.getElementById('userAnswerInput').value = '';

    toggleLoading(true, "🤖 問題を作成中だよ。少し待ってね...");

    const prompt = `あなたは優秀な中学校の先生です。「${subject}」の問題を「${diff}」レベルで「${count}問」作成してください。
数式はLaTeXの$で囲んでください。LaTeX記法のバックスラッシュは \\\\frac のようにエスケープしてください。
以下の厳密なJSON形式で出力してください。
{
  "questions": [
    {
      "text": "問題文(英語問題の場合は日本語の指示文のみ書き、英文はenglishTextフィールドに入れること)",
      "englishText": "英語問題のとき、読み上げる英文または英単語のみ。他教科は空文字",
      "chartType": "none | linear | quadratic | pie | bar",
      "chartData": "linear/quadraticなら係数JSON。pie/barならデータJSON。不要なら空文字",
      "chartTitle": "グラフタイトル",
      "musicAbc": "ABC記法楽譜。他教科は空文字",
      "greatMan": "偉人の名前。歴史人物以外は空文字"
    }
  ]
}`;

    try {
        const res = await ai.models.generateContent({ model: GEMINI_MODEL, contents: prompt, config: { responseMimeType: "application/json" } });
        const data = safeParseJSON(res.text);
        currentQuestionsData = data.questions;
        currentSubjectText = subject;
        currentDiffText = diff;

        renderQuestionsUI(currentQuestionsData, subject);
        saveHistoryData(subject, diff, currentQuestionsData);
        document.getElementById('scoring-section').style.display = 'block';
    } catch(e) { showToast("問題の生成または解析に失敗しました。再試行してください。"); } finally { toggleLoading(false); }
};

const musicSynthMap = {};

function renderQuestionsUI(questions, subjectText) {
    const container = document.getElementById('output');
    container.style.display = 'block';
    container.innerHTML = '';
    Object.values(musicSynthMap).forEach(s => { try { s.stop(); } catch(e){} });
    Object.keys(musicSynthMap).forEach(k => delete musicSynthMap[k]);

    let chartsToDraw = [];
    let musicToDraw = [];
    const searchSubject = (subjectText || '').toLowerCase();
    const isEnglishQuestion = searchSubject.includes('英語') || searchSubject.includes('英単語') || searchSubject.includes('english');

    questions.forEach((q, idx) => {
        const qBlock = document.createElement('div');
        qBlock.className = 'question-block';

        const textDiv = document.createElement('div');
        textDiv.style.marginBottom = '10px';
        textDiv.innerHTML = `<strong>【問${idx + 1}】</strong><br>`;
        const span = document.createElement('span');
        safeAppendText(span, q.text);
        textDiv.appendChild(span);
        qBlock.appendChild(textDiv);

        if(isEnglishQuestion && q.englishText && q.englishText.trim()) {
            const engDiv = document.createElement('div');
            engDiv.className = 'english-text-block';
            safeAppendText(engDiv, q.englishText.trim());
            qBlock.appendChild(engDiv);
        }

        if(q.musicAbc && q.musicAbc.trim()) {
            const musicDiv = document.createElement('div');
            musicDiv.className = 'dynamic-paper';
            musicDiv.id = `music_${idx}`;
            qBlock.appendChild(musicDiv);
            const formattedAbc = q.musicAbc.replace(/\\n/g, '\n').trim();
            musicToDraw.push({ id: musicDiv.id, abc: formattedAbc, idx });
        }

        if(q.greatMan) {
            const imgDiv = document.createElement('div');
            imgDiv.className = 'img-container';
            qBlock.appendChild(imgDiv);
            fetchWikipediaImage(q.greatMan, imgDiv);
        }

        if(q.chartType && q.chartType !== 'none' && q.chartData && q.chartData.trim()) {
            const badge = document.createElement('div');
            badge.className = 'chart-type-badge';
            const typeLabel = { linear:'一次関数グラフ', quadratic:'二次関数グラフ', pie:'円グラフ', bar:'棒グラフ' };
            badge.textContent = `📊 ${typeLabel[q.chartType] || q.chartType}`;
            qBlock.appendChild(badge);

            const chartDiv = document.createElement('div');
            chartDiv.className = 'chart-container';
            chartDiv.id = `chart_${idx}`;
            qBlock.appendChild(chartDiv);
            chartsToDraw.push({ id: chartDiv.id, type: q.chartType, dataStr: q.chartData, title: q.chartTitle });
        }

        const toolsDiv = document.createElement('div');
        toolsDiv.className = 'tools';

        const hintBtn = document.createElement('button');
        hintBtn.className = 'btn-warning';
        hintBtn.textContent = '💡 ヒントをもらう';
        hintBtn.onclick = () => showHint(q.text);
        toolsDiv.appendChild(hintBtn);

        if(isEnglishQuestion) {
            const speechBtn = document.createElement('button');
            speechBtn.className = 'btn-secondary';
            speechBtn.style.backgroundColor = '#17a2b8';
            speechBtn.textContent = '🔊 英文を読み上げ';
            const readTarget = (q.englishText && q.englishText.trim()) ? q.englishText.trim() : q.text;
            speechBtn.onclick = () => speakEnglish(readTarget);
            toolsDiv.appendChild(speechBtn);
        }

        if(q.musicAbc && q.musicAbc.trim()) {
            const playBtn = document.createElement('button');
            playBtn.className = 'btn-music';
            playBtn.id = `playBtn_${idx}`;
            playBtn.textContent = '▶ 楽譜を再生';
            const formattedAbc = q.musicAbc.replace(/\\n/g, '\n').trim();
            playBtn.onclick = () => toggleMusicPlay(idx, formattedAbc, playBtn);
            toolsDiv.appendChild(playBtn);
        }

        qBlock.appendChild(toolsDiv);
        container.appendChild(qBlock);
    });

    musicToDraw.forEach(m => {
        try {
            const visualObj = ABCJS.renderAbc(m.id, m.abc, { responsive: "resize" });
            if(ABCJS.synth && ABCJS.synth.supportsAudio()) {
                const synth = new ABCJS.synth.CreateSynth();
                synth.init({ visualObj: visualObj[0] }).then(() => {
                    musicSynthMap[m.idx] = { synth, visualObj: visualObj[0], playing: false };
                }).catch(() => {});
            }
        } catch(e) { }
    });

    if (chartsToDraw.length > 0) {
        const drawAll = () => chartsToDraw.forEach(c => renderChart(c.id, c.type, c.dataStr, c.title));
        if (google.visualization) { drawAll(); } else { google.charts.setOnLoadCallback(drawAll); }
    }

    if(window.MathJax && window.MathJax.typesetPromise) window.MathJax.typesetPromise([container]).catch(err => {});
}

window.toggleMusicPlay = async function(idx, abcStr, btn) {
    const entry = musicSynthMap[idx];
    if(!ABCJS.synth || !ABCJS.synth.supportsAudio()) { showToast("このブラウザは音楽再生に対応していません"); return; }
    if(entry && entry.playing) {
        try { entry.synth.stop(); } catch(e){}
        entry.playing = false; btn.textContent = '▶ 楽譜を再生'; btn.className = 'btn-music'; return;
    }
    btn.textContent = '⏳ 読み込み中...'; btn.disabled = true;
    try {
        let synth, visualObj;
        if(entry && entry.synth) { synth = entry.synth; visualObj = entry.visualObj; } 
        else {
            const rendered = ABCJS.renderAbc(`music_${idx}`, abcStr, { responsive: "resize" });
            visualObj = rendered[0]; synth = new ABCJS.synth.CreateSynth();
            await synth.init({ visualObj }); musicSynthMap[idx] = { synth, visualObj, playing: false };
        }
        await synth.prime(); synth.start();
        musicSynthMap[idx].playing = true; btn.textContent = '⏹ 停止'; btn.className = 'btn-music-stop'; btn.disabled = false;
        const dur = visualObj.getTotalTime ? (visualObj.getTotalTime() * 1000 + 500) : 10000;
        setTimeout(() => {
            if(musicSynthMap[idx] && musicSynthMap[idx].playing) {
                musicSynthMap[idx].playing = false; btn.textContent = '▶ 楽譜を再生'; btn.className = 'btn-music';
            }
        }, dur);
    } catch(e) { showToast("音楽の再生に失敗しました"); btn.textContent = '▶ 楽譜を再生'; btn.className = 'btn-music'; btn.disabled = false; }
};

function renderChart(id, type, dataStr, title) {
    if(!google.visualization) return;
    const container = document.getElementById(id);
    if(!container) return;
    try {
        if(type === 'linear') {
            let a = 1, b = 0; const trimmed = dataStr.trim();
            if(trimmed.startsWith('{')) { const parsed = JSON.parse(trimmed); a = Number(parsed.a ?? 1); b = Number(parsed.b ?? 0); }
            else {
                const expr = trimmed.replace(/\s+/g, '').split('=')[1] || '';
                const xIdx = expr.indexOf('x');
                if(xIdx !== -1) {
                    const aStr = expr.substring(0, xIdx);
                    a = (aStr === '' || aStr === '+') ? 1 : (aStr === '-' ? -1 : Number(aStr));
                    const bStr = expr.substring(xIdx + 1); b = bStr ? Number(bStr) : 0;
                }
            }
            const range = Math.max(10, Math.ceil(Math.abs(b / (a || 1)) + 3));
            const xMin = -range, xMax = range;
            const data = new google.visualization.DataTable();
            data.addColumn('number', 'x'); data.addColumn('number', `y = ${a}x ${b >= 0 ? '+' : ''}${b}`);
            for(let x = xMin; x <= xMax; x++) data.addRow([x, a * x + b]);
            new google.visualization.LineChart(container).draw(data, { title: title || '', legend: 'none', chartArea: { width: '80%', height: '70%' }, colors: ['#007BFF'], lineWidth: 3, hAxis: { title: 'x', viewWindowMode: 'explicit', viewWindow: { min: xMin, max: xMax } }, vAxis: { title: 'y' } });
        } else if(type === 'quadratic') {
            let a = 1, b = 0, c = 0; const trimmed = dataStr.trim();
            if(trimmed.startsWith('{')) { const parsed = JSON.parse(trimmed); a = Number(parsed.a ?? 1); b = Number(parsed.b ?? 0); c = Number(parsed.c ?? 0); }
            const vx = (a !== 0) ? -b / (2 * a) : 0;
            const xMin = Math.floor(vx - 6), xMax = Math.ceil(vx + 6); const step = (xMax - xMin) / 60;
            const data = new google.visualization.DataTable();
            data.addColumn('number', 'x'); data.addColumn('number', `y = ${a}x² ${b >= 0 ? '+' : ''}${b}x ${c >= 0 ? '+' : ''}${c}`);
            for(let i = 0; i <= 60; i++) { const x = xMin + i * step; data.addRow([x, a * x * x + b * x + c]); }
            new google.visualization.LineChart(container).draw(data, { title: title || '', legend: 'none', chartArea: { width: '80%', height: '70%' }, colors: ['#e05c00'], lineWidth: 3, hAxis: { title: 'x' }, vAxis: { title: 'y' }, curveType: 'none' });
        } else if(type === 'pie' || type === 'bar') {
            const parsed = JSON.parse(dataStr.trim());
            const data = new google.visualization.DataTable();
            data.addColumn('string', '項目'); data.addColumn('number', '値');
            for(const [k, v] of Object.entries(parsed)) data.addRow([k, Number(v)]);
            const opts = { title: title || '', chartArea: { width: '80%', height: '70%' } };
            if(type === 'pie') { opts.legend = { position: 'right' }; new google.visualization.PieChart(container).draw(data, opts); }
            else { opts.legend = 'none'; opts.colors = ['#28a745']; new google.visualization.ColumnChart(container).draw(data, opts); }
        }
    } catch(e) { container.innerHTML = `<div style="color:#dc3545;padding:20px;text-align:center;font-size:13px;">⚠️ グラフ描画エラー</div>`; }
}

async function fetchWikipediaImage(name, container) {
    container.innerHTML = '<span>画像読込中...</span>';
    try {
        const res = await fetch(`https://ja.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`);
        const data = await res.json();
        const url = data.thumbnail?.source || data.originalimage?.source;
        if(url) { container.innerHTML=''; container.style.backgroundImage = `url('${url}')`; }
        else { container.style.height = 'auto'; container.style.border = 'none'; container.textContent = '(画像なし)'; }
    } catch(e) { container.style.height = 'auto'; container.style.border = 'none'; container.textContent = '(取得エラー)'; }
}

// 📷 画像による手書き答案採点（新機能）
window.gradeWithImage = async function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        const base64Data = e.target.result.split(',')[1];
        const preview = document.getElementById('imagePreview');
        preview.src = e.target.result;
        document.getElementById('imagePreviewArea').style.display = 'block';

        let ai; try { ai = getApiInstance(); } catch(err) { return; }
        toggleLoading(true, "📸 ノートの画像を解析して採点中...");

        const qText = currentQuestionsData.map((q, i) => `問${i+1}: ${q.text}`).join('\n');
        const prompt = `生徒がノートに書いた回答画像です。以下の問題に対する回答を読み取って採点してください。\n【問題】\n${qText}\n
JSON形式のみで出力してください:
{
  "score": (0から100の数値),
  "explanation": "手書き文字の読み取り結果と総評",
  "questionResults": [
    { "number": (問題番号), "verdict": "correct/partial/incorrect", "comment": "指摘", "correctAnswer": "模範解答" }
  ]
}`;

        try {
            const response = await ai.models.generateContent({
                model: GEMINI_MODEL,
                contents: [
                    prompt,
                    { inlineData: { mimeType: file.type, data: base64Data } }
                ],
                config: { responseMimeType: "application/json" }
            });
            handleGradeResult(response.text);
        } catch(err) {
            showToast("画像採点に失敗しました。文字が鮮明な写真を試してください。");
        } finally {
            toggleLoading(false);
        }
    };
    reader.readAsDataURL(file);
};

window.gradeQuestion = async function() {
    const answer = document.getElementById('userAnswerInput').value.trim();
    if(!answer) return showToast("回答を入力してね！");
    let ai; try { ai = getApiInstance(); } catch(e) { return; }

    toggleLoading(true, "💯 採点中...");
    const qText = currentQuestionsData.map((q, i) => `問${i+1}: ${q.text}`).join('\n');
    const prompt = `生徒の回答を採点してください。\n【問題】\n${qText}\n【生徒の回答】\n${answer}\n
JSON形式のみで出力してください:
{
  "score": (0から100の数値),
  "explanation": "総評",
  "questionResults": [
    { "number": (問題番号), "verdict": "correct/partial/incorrect", "comment": "指摘", "correctAnswer": "模範解答" }
  ]
}`;

    try {
        const response = await ai.models.generateContent({ model: GEMINI_MODEL, contents: prompt, config: { responseMimeType: "application/json" } });
        handleGradeResult(response.text);
    } catch(err) { showToast("採点に失敗しました。"); } finally { toggleLoading(false); }
};

function handleGradeResult(responseText) {
    const resultDiv = document.getElementById('grade-result');
    resultDiv.style.display = 'block';

    const result = safeParseJSON(responseText);
    if (!result) throw new Error("empty result");

    let scoreNum = Number(result.score) || 0;
    scoreNum = Math.max(0, Math.min(100, Math.round(scoreNum)));

    resultDiv.innerHTML = '';
    const header = document.createElement('h4');
    header.style.cssText = 'margin:0 0 10px 0; color:var(--danger); font-size:18px;';
    header.textContent = `得点: ${scoreNum} 点 / 100点`;
    resultDiv.appendChild(header);

    if (Array.isArray(result.questionResults)) {
        const listTitle = document.createElement('h4');
        listTitle.style.cssText = 'margin:15px 0 8px 0; color:#0056b3; font-size:15px;';
        listTitle.textContent = '📋 問題ごとの振り返り';
        resultDiv.appendChild(listTitle);

        const verdictMap = { correct: { icon: '✅', label: '正解', color: '#28a745' }, partial: { icon: '🔶', label: '一部正解', color: '#f0ad4e' }, incorrect: { icon: '❌', label: '不正解', color: '#dc3545' } };

        result.questionResults.forEach(qr => {
            const v = verdictMap[qr.verdict] || { icon: 'ℹ️', label: qr.verdict || '', color: '#555' };
            const box = document.createElement('div');
            box.style.cssText = `background:#fff; border-left:4px solid ${v.color}; border-radius:4px; padding:10px 12px; margin-bottom:8px;`;
            const titleLine = document.createElement('div');
            titleLine.style.cssText = `font-weight:bold; color:${v.color}; font-size:14px; margin-bottom:4px;`;
            titleLine.textContent = `${v.icon} 問${qr.number ?? ''}：${v.label}`;
            box.appendChild(titleLine);

            if (qr.comment) {
                const commentDiv = document.createElement('div');
                commentDiv.style.cssText = 'font-size:14px; line-height:1.6; margin-bottom:4px;';
                safeAppendText(commentDiv, qr.comment);
                box.appendChild(commentDiv);
            }
            if (qr.correctAnswer) {
                const ansDiv = document.createElement('div');
                ansDiv.style.cssText = 'font-size:13px; color:#333; background:#f8f9fa; padding:6px 8px; border-radius:4px; margin-top:4px;';
                ansDiv.innerHTML = '<strong>模範解答: </strong>';
                safeAppendText(ansDiv, qr.correctAnswer);
                box.appendChild(ansDiv);
            }
            resultDiv.appendChild(box);
        });
    }

    if (result.explanation) {
        const expTitle = document.createElement('h4');
        expTitle.style.cssText = 'margin:15px 0 8px 0; color:#333; font-size:15px;';
        expTitle.textContent = '📝 総評';
        resultDiv.appendChild(expTitle);
        const expSpan = document.createElement('div');
        safeAppendText(expSpan, result.explanation);
        resultDiv.appendChild(expSpan);
    }

    if(window.MathJax && window.MathJax.typesetPromise) window.MathJax.typesetPromise([resultDiv]);

    const multiplierMap = { '基礎': 1, '標準': 1.5, '応用': 2 };
    const multiplier = multiplierMap[currentDiffText] || 1;

    let currentScore = parseInt(localStorage.getItem(getUserKey('score'))) || 0;
    let currentQCount = parseInt(localStorage.getItem(getUserKey('qCount'))) || 0;

    localStorage.setItem(getUserKey('score'), currentScore + Math.floor(scoreNum * multiplier));
    localStorage.setItem(getUserKey('qCount'), currentQCount + currentQuestionsData.length);
    updateStatsUI();
    updateHistoryScore(currentHistoryId, scoreNum);
}

window.showDirectAnswer = async function() {
    let ai; try { ai = getApiInstance(); } catch(e) { return; }
    toggleLoading(true, "🔑 解答作成中...");
    const resultDiv = document.getElementById('grade-result');
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<div style="text-align: center; color: #856404; font-size: 15px;">⏳ AIが解答を作成しているよ... 少し待ってね！</div>';
    const qText = currentQuestionsData.map((q, i) => `問${i+1}: ${q.text}`).join('\n');
    try {
        const response = await ai.models.generateContent({ model: GEMINI_MODEL, contents: `以下の問題の正確な解答と解説を作成してください。\n${qText}` });
        resultDiv.innerHTML = '<h4 style="margin:0 0 10px 0; color:#333; font-size:18px;">模範解答</h4>';
        const span = document.createElement('div');
        safeAppendText(span, response.text);
        resultDiv.appendChild(span);
        if(window.MathJax && window.MathJax.typesetPromise) window.MathJax.typesetPromise([resultDiv]);
    } catch(err) { showToast("生成失敗"); } finally { toggleLoading(false); }
};

window.showHint = async function(qText) {
    let ai; try { ai = getApiInstance(); } catch(e) { return; }
    document.getElementById('hintModal').style.display = 'flex';
    const hintDiv = document.getElementById('hintText');
    hintDiv.textContent = "💡 AIが優しいヒントを考えているよ...";
    try {
        const res = await ai.models.generateContent({ model: GEMINI_MODEL, contents: `直接答えを言わずに解き方のヒントを出してください。\n${qText}` });
        hintDiv.innerHTML = '';
        safeAppendText(hintDiv, res.text);
        if(window.MathJax && window.MathJax.typesetPromise) window.MathJax.typesetPromise([hintDiv]);
    } catch(e) { hintDiv.textContent = "エラーが発生しました"; }
};

window.speakEnglish = function(englishText) {
    if(!('speechSynthesis' in window)) { showToast("このブラウザは読み上げに対応していません"); return; }
    window.speechSynthesis.cancel();
    const cleanText = englishText.replace(/[\$\\]/g, '').trim();
    if(!cleanText) return;
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'en-US';
    utterance.rate = 0.85;
    window.speechSynthesis.speak(utterance);
};

window.changeBackground = function(e) {
    const file = e.target.files[0];
    if(!file || !currentUser) return;
    if(file.size > 2 * 1024 * 1024) return showToast("画像サイズは2MB以下にしてください");
    const reader = new FileReader();
    reader.onload = (evt) => {
        const dataUrl = evt.target.result;
        document.body.style.backgroundImage = `url('${dataUrl}')`;
        try { localStorage.setItem(getUserKey('bg'), dataUrl); } catch(err) { showToast("保存容量オーバーです"); }
    };
    reader.readAsDataURL(file);
};

window.resetBackground = function() {
    document.body.style.backgroundImage = 'none';
    if(currentUser) localStorage.removeItem(getUserKey('bg'));
    document.getElementById('bgInput').value = '';
};

function loadBackground() {
    const bg = localStorage.getItem(getUserKey('bg'));
    document.body.style.backgroundImage = bg ? `url('${bg}')` : 'none';
}

// 💾 バックアップ＆復元（新機能）
window.exportData = function() {
    if (!currentUser) return showToast("先にログインしてください");
    const data = {
        user: currentUser,
        score: localStorage.getItem(getUserKey('score')),
        qCount: localStorage.getItem(getUserKey('qCount')),
        history: localStorage.getItem(getUserKey('history'))
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentUser}_学習データ.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("学習データをダウンロードしました！", "success");
};

window.importData = function(event) {
    const file = event.target.files[0];
    if (!file || !currentUser) return showToast("先にログインしてください");
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data.score) localStorage.setItem(getUserKey('score'), data.score);
            if (data.qCount) localStorage.setItem(getUserKey('qCount'), data.qCount);
            if (data.history) localStorage.setItem(getUserKey('history'), data.history);
            updateStatsUI();
            showToast("学習データを正常に復元しました！", "success");
        } catch(err) {
            showToast("データの読み込みに失敗しました");
        }
    };
    reader.readAsText(file);
};

// --- 認証 & 共通 ---
window.login = function() {
    const name = document.getElementById('usernameInput').value.trim();
    const pin = document.getElementById('pinInput').value.trim();
    if(!name || pin.length < 4) return showToast("名前と4桁以上のPINを入力してください");

    let users = JSON.parse(localStorage.getItem('app_users_db') || '{}');
    if(users[name]) {
        if(users[name] !== pin) return showToast("PINコードが違います", "error");
    } else {
        users[name] = pin;
        localStorage.setItem('app_users_db', JSON.stringify(users));
        showToast("新規アカウントを作成しました", "success");
    }
    currentUser = name;
    sessionStorage.setItem('current_user', name);
    updateAuthUI();
};

window.logout = function() { currentUser = null; sessionStorage.removeItem('current_user'); updateAuthUI(); };

function updateAuthUI() {
    const loginArea = document.getElementById('loginFormArea');
    const loggedInArea = document.getElementById('loggedInArea');
    if(currentUser) {
        loginArea.style.display = 'none';
        loggedInArea.style.display = 'flex';
        document.getElementById('welcomeMessage').textContent = `👤 ${currentUser} さん、こんにちは！`;
        updateStatsUI();
        loadBackground();
    } else {
        loginArea.style.display = 'block';
        loggedInArea.style.display = 'none';
        document.getElementById('usernameInput').value = '';
        document.getElementById('pinInput').value = '';
        document.getElementById('userBadge').textContent = 'ゲスト';
        document.getElementById('totalScore').textContent = '0';
        document.getElementById('totalQuestions').textContent = '0';
        document.body.style.backgroundImage = 'none';
    }
}

function getUserKey(key) { return currentUser ? `u$${encodeURIComponent(currentUser)}$${key}` : null; }

function updateStatsUI() {
    if(!currentUser) return;
    const score = parseInt(localStorage.getItem(getUserKey('score'))) || 0;
    const qCount = parseInt(localStorage.getItem(getUserKey('qCount'))) || 0;
    document.getElementById('totalScore').textContent = score;
    document.getElementById('totalQuestions').textContent = qCount;

    let badge = "かけだし中学生";
    if(score >= 1000) badge = "⚡ 学問の覇王 ⚡";
    else if(score >= 500) badge = "🎓 勉強 of 勉強";
    else if(score >= 250) badge = "✍️ 期待のホープ";
    else if(score >= 100) badge = "📖 がんばり屋";
    document.getElementById('userBadge').textContent = badge;
}

function getApiInstance() {
    const key = document.getElementById('apiKeyInput').value.trim();
    if(!key) { showToast("APIキーを入力してください"); throw new Error(); }
    return new GoogleGenAI({ apiKey: key });
}

window.saveApiKey = function() {
    localStorage.setItem('user_api_key', document.getElementById('apiKeyInput').value.trim());
    showToast("APIキーを保存しました", "success");
};

window.addEventListener('DOMContentLoaded', () => {
    const savedKey = localStorage.getItem('user_api_key');
    if(savedKey) document.getElementById('apiKeyInput').value = savedKey;
    const savedUser = sessionStorage.getItem('current_user');
    if(savedUser) { currentUser = savedUser; updateAuthUI(); }
    switchMode('interactive');
});

function saveHistoryData(subj, diff, data) {
    let history = JSON.parse(localStorage.getItem(getUserKey('history')) || '[]');
    currentHistoryId = Date.now().toString();
    history.push({ id: currentHistoryId, date: new Date().toLocaleString(), subject: subj, difficulty: diff, questions: data, score: null });
    localStorage.setItem(getUserKey('history'), JSON.stringify(history));
}

function updateHistoryScore(id, score) {
    if(!id) return;
    let history = JSON.parse(localStorage.getItem(getUserKey('history')) || '[]');
    const target = history.find(h => h.id === id);
    if(target) { target.score = score; localStorage.setItem(getUserKey('history'), JSON.stringify(history)); }
}

window.showHistory = function() {
    if(!currentUser) return showToast("ログインしてください");
    document.getElementById('historyModal').style.display = 'flex';
    const listDiv = document.getElementById('historyList');
    const history = JSON.parse(localStorage.getItem(getUserKey('history')) || '[]');

    listDiv.innerHTML = '';
    if(history.length === 0) {
        listDiv.innerHTML = "<p style='text-align:center;color:#666;'>まだ学習履歴がありません。</p>";
        document.getElementById('scoreChartArea').style.display = 'none';
        document.getElementById('weakPointArea').style.display = 'none';
        return;
    }

    const scoredItems = history.filter(h => h.score !== null && Number.isFinite(Number(h.score))).map(h => ({ ...h, score: Number(h.score) }));
    const chartDiv = document.getElementById('scoreChartArea');
    if (scoredItems.length > 1 && google.visualization) {
        chartDiv.style.display = "block";
        const data = new google.visualization.DataTable();
        data.addColumn('string', '回数'); data.addColumn('number', '得点');
        scoredItems.forEach((h, idx) => data.addRow([`${idx+1}回目`, h.score]));
        const options = { title: '📈 得点の推移', legend: 'none', chartArea:{width:'85%',height:'65%'}, colors:['#28a745'] };
        new google.visualization.LineChart(chartDiv).draw(data, options);
    } else { chartDiv.style.display = "none"; }

    const weakPointDiv = document.getElementById('weakPointArea');
    const bySubject = {};
    scoredItems.forEach(h => {
        const key = h.subject || '(不明)';
        if (!bySubject[key]) bySubject[key] = { total: 0, count: 0 };
        bySubject[key].total += h.score; bySubject[key].count += 1;
    });
    const subjectStats = Object.entries(bySubject).map(([subject, s]) => ({ subject, avg: Math.round(s.total / s.count), count: s.count })).sort((a, b) => a.avg - b.avg);

    if (subjectStats.length > 0) {
        weakPointDiv.style.display = 'block';
        let wpHtml = `<h4 style="margin:0 0 8px 0; color:#dc3545; font-size:15px;">🎯 重点的に復習したい分野</h4><table class="fortune-table" style="margin:0;">`;
        subjectStats.slice(0, 3).forEach(s => {
            const color = s.avg < 60 ? '#dc3545' : (s.avg < 80 ? '#f0ad4e' : '#28a745');
            wpHtml += `<tr><th>${escapeHtml(s.subject)}</th><td style="color:${color}; font-weight:bold;">平均 ${s.avg}点（${s.count}回）</td></tr>`;
        });
        wpHtml += `</table>`;
        weakPointDiv.innerHTML = wpHtml;
    } else { weakPointDiv.style.display = 'none'; }

    history.slice().reverse().forEach(h => {
        const div = document.createElement('div');
        div.style.cssText = "background:#f8f9fa; border-left:5px solid #11998e; padding:12px; margin-bottom:10px; border-radius:5px;";
        div.innerHTML = `
            <div style="font-size:12px; color:#888; margin-bottom:5px;">${escapeHtml(h.date)}</div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span style="font-weight:bold;">${escapeHtml(h.subject)} (${escapeHtml(h.difficulty)})</span>
                <span style="font-size:16px; font-weight:bold; color:${h.score !== null ? '#e74c3c' : '#888'};">${h.score !== null ? h.score + '点' : '未採点'}</span>
            </div>
            <button class="btn-secondary" style="width:100%; background-color:#17a2b8;" onclick="viewHistoryDetail('${h.id}')">📝 出題内容を見る</button>
        `;
        listDiv.appendChild(div);
    });
};

window.viewHistoryDetail = function(id) {
    let history = JSON.parse(localStorage.getItem(getUserKey('history')) || '[]');
    const item = history.find(h => h.id === id);
    if(!item) return;

    document.getElementById('detailTitle').textContent = `📜 ${item.subject} (${item.difficulty})`;
    document.getElementById('detailDate').textContent = `実施日時: ${item.date} | 得点: ${item.score !== null ? item.score + '点' : '未採点'}`;

    const questionsDiv = document.getElementById('detailQuestions');
    questionsDiv.innerHTML = '';
    if (item.questions && item.questions.length > 0) {
        item.questions.forEach((q, i) => { safeAppendText(questionsDiv, `【問${i+1}】\n${q.text}\n\n`); });
    } else { questionsDiv.textContent = "問題データがありません。"; }

    document.getElementById('retryBtn').onclick = () => retryQuestion(item.id);
    document.getElementById('historyDetailModal').style.display = 'flex';
    if(window.MathJax && window.MathJax.typesetPromise) window.MathJax.typesetPromise([questionsDiv]);
};

window.retryQuestion = function(id) {
    let history = JSON.parse(localStorage.getItem(getUserKey('history')) || '[]');
    const item = history.find(h => h.id === id);
    if(!item) return;

    if(confirm("現在の画面にある問題をクリアして、この問題をもう一度解き直しますか？")) {
        switchMode('test');
        document.getElementById('subjectInput').value = item.subject;
        document.getElementById('diffLevel').value = item.difficulty;
        document.getElementById('qCount').value = item.questions ? item.questions.length : 5;

        currentQuestionsData = item.questions;
        currentSubjectText = item.subject;
        currentDiffText = item.difficulty;
        renderQuestionsUI(currentQuestionsData, item.subject);
        saveHistoryData(item.subject, item.difficulty, currentQuestionsData);

        document.getElementById('scoring-section').style.display = 'block';
        document.getElementById('grade-result').style.display = 'none';
        document.getElementById('userAnswerInput').value = '';

        closeModal('historyDetailModal');
        closeModal('historyModal');
        document.getElementById('output').scrollIntoView({ behavior: 'smooth' });
    }
};
