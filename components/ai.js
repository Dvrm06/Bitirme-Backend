const express = require("express");
const router = express.Router();
const axios = require("axios");
const { isAuthenticated } = require("./functions/middleware");

// ── Configuration ──
const LLM_URL = process.env.LLM_URL || "http://172.18.2.251:31001/v1/chat/completions";
const RAG_API_URL = process.env.RAG_API_URL || "http://localhost:5000";
const BACKEND_URL = `http://localhost:${process.env.PORT || 8001}/api`;

// ── Keyword-based quota detection (replaces double-pass LLM tool call) ──
const QUOTA_KEYWORDS = /kontenjan|kapasite|doluluk|quota|kişi kayıtlı|yer var mı|dolu mu|boş.{0,10}yer|kayıtlı.{0,10}kişi|kapasitesi/i;

// -------------------------------------------------------------------
// Helper: internal API call (forwards cookies for auth)
// -------------------------------------------------------------------
async function callInternalAPI(path, cookies, method = "get") {
    const cookieHeader = Object.entries(cookies || {})
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");

    const res = await axios({
        method,
        url: `${BACKEND_URL}${path}`,
        headers: { Cookie: cookieHeader },
        timeout: 8000
    });
    return res.data;
}

// -------------------------------------------------------------------
// Fetch student context: department, completed & current courses
// -------------------------------------------------------------------
async function fetchStudentContext(userID, cookies) {
    try {
        const [userRes, groupsRes] = await Promise.all([
            callInternalAPI(`/users/${userID}`, cookies).catch(() => null),
            callInternalAPI(`/lessonGroups/my`, cookies).catch(() => null)
        ]);

        const context = {};

        // Department name
        if (userRes?.data?.departmentID) {
            try {
                const deptRes = await callInternalAPI(
                    `/departments/${userRes.data.departmentID}`, cookies
                );
                context.department = deptRes?.data?.departmentName;
            } catch { /* non-fatal */ }
        }

        // Parse enrolled courses by grade status
        const groups = groupsRes?.data || [];
        const failGrades = ["FF", "FD"];

        context.completedCourses = groups
            .filter(g => g.grade && g.grade.toUpperCase() !== "PEND" && !failGrades.includes(g.grade.toUpperCase()))
            .map(g => `${g.lessonName} (${g.grade})`);

        context.currentCourses = groups
            .filter(g => !g.grade || g.grade.toUpperCase() === "PEND")
            .map(g => `${g.lessonName} - ${g.lessonGroupName}`);

        context.failedCourses = groups
            .filter(g => g.grade && failGrades.includes(g.grade.toUpperCase()))
            .map(g => `${g.lessonName} (${g.grade})`);

        return context;
    } catch (err) {
        console.error("Student context fetch error:", err.message);
        return null;
    }
}

// -------------------------------------------------------------------
// Fetch RAG context from Python API (vector search, no LLM)
// -------------------------------------------------------------------
async function fetchRAGContext(question) {
    try {
        const res = await axios.post(
            `${RAG_API_URL}/api/search`,
            { query: question, top_k: 5 },
            { timeout: 10000 }
        );

        const results = res.data?.results || [];
        if (results.length === 0) return null;

        return results
            .filter(r => r.similarity >= 0.25)
            .map(r => `[${r.doc_id}] (benzerlik: ${r.similarity.toFixed(3)})\n${r.text}`)
            .join("\n\n");
    } catch (err) {
        console.error("RAG context fetch error:", err.message);
        return null;
    }
}

// -------------------------------------------------------------------
// Keyword-based quota lookup (replaces double-pass LLM tool detection)
// -------------------------------------------------------------------
async function fetchQuotaContext(question, cookies) {
    try {
        // Get all lessons and find which one the user is asking about
        const lessonsRes = await callInternalAPI("/lessons", cookies);
        const lessons = lessonsRes?.data || [];

        // Simple substring match: find lessons whose name appears in the question
        const questionLower = question.toLowerCase().replace(/ı/g, "i").replace(/ö/g, "o")
            .replace(/ü/g, "u").replace(/ş/g, "s").replace(/ç/g, "c").replace(/ğ/g, "g");

        const matched = lessons.filter(l => {
            const nameLower = (l.lessonName || "").toLowerCase().replace(/ı/g, "i").replace(/ö/g, "o")
                .replace(/ü/g, "u").replace(/ş/g, "s").replace(/ç/g, "c").replace(/ğ/g, "g");
            return questionLower.includes(nameLower) && nameLower.length > 2;
        });

        if (matched.length === 0) return null;

        // Fetch groups for matched lessons
        const allGroups = [];
        for (const lesson of matched.slice(0, 3)) {
            try {
                const groupsRes = await callInternalAPI(
                    `/lessonGroups?lessonID=${lesson.lessonID}`, cookies
                );
                const groups = groupsRes?.data || [];
                groups.forEach(g => {
                    const hours = (g.hours || [])
                        .map(h => `${h.day}. gün ${h.hour} (${h.room || "?"})`)
                        .join(", ");
                    const quota = g.maxNumber != null ? g.maxNumber : "Sınırsız";
                    allGroups.push(
                        `Ders: ${lesson.lessonName} | Grup: ${g.lessonGroupName} | Kontenjan: ${quota}${hours ? ` | Saatler: ${hours}` : ""}`
                    );
                });
            } catch { /* skip this lesson */ }
        }

        return allGroups.length > 0 ? allGroups.join("\n") : null;
    } catch (err) {
        console.error("Quota context fetch error:", err.message);
        return null;
    }
}

// -------------------------------------------------------------------
// Build enriched system prompt with student profile + RAG guidance
// -------------------------------------------------------------------
function buildSystemPrompt(studentContext, hasRAG, hasQuota) {
    let prompt =
        "Sen bir üniversite ders seçim asistanısın. " +
        "Tüm cevaplarını her zaman %100 Türkçe olarak vermelisin. " +
        "Asla İngilizceye geçiş yapma. " +
        "Sadece ders seçimi, müfredat, kredi, kontenjan ve akademik konularda yardımcı ol.";

    // Inject student profile
    if (studentContext) {
        prompt += "\n\nÖĞRENCİ PROFİLİ:";
        if (studentContext.department) {
            prompt += `\n- Bölüm: ${studentContext.department}`;
        }
        if (studentContext.completedCourses?.length) {
            prompt += `\n- Geçtiği dersler: ${studentContext.completedCourses.join(", ")}`;
        }
        if (studentContext.currentCourses?.length) {
            prompt += `\n- Şu an aldığı dersler: ${studentContext.currentCourses.join(", ")}`;
        }
        if (studentContext.failedCourses?.length) {
            prompt += `\n- Kaldığı dersler: ${studentContext.failedCourses.join(", ")}`;
        }
        prompt += "\nBu öğrenciye özel cevap ver.";
    }

    // RAG guidance
    if (hasRAG) {
        prompt +=
            "\n\nAşağıda verilen BAĞLAM bilgilerini kullanarak soruyu yanıtla. " +
            "Kaynaklarını [doc_id] formatında belirt. " +
            "BAĞLAM yetersizse bunu söyle ve genel bilgini ekle.";
    }

    // Quota guidance
    if (hasQuota) {
        prompt +=
            "\n\nAşağıda verilen KONTENJAN BİLGİSİ canlı verilerdir, aynen aktar.";
    }

    return prompt;
}

// -------------------------------------------------------------------
// POST /api/ai/ask — Single-pass streaming with RAG + student context
// -------------------------------------------------------------------
router.post("/ask", isAuthenticated, async (req, res) => {
    const { question } = req.body;

    if (!question || !question.trim()) {
        return res.status(400).json({ success: false, message: "Soru boş olamaz." });
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

    try {
        // ── Step 1: Parallel data fetching ──
        const needsQuota = QUOTA_KEYWORDS.test(question);

        const [studentContext, ragContext, quotaContext] = await Promise.all([
            fetchStudentContext(req.user.id, req.cookies),
            fetchRAGContext(question),
            needsQuota ? fetchQuotaContext(question, req.cookies) : Promise.resolve(null)
        ]);

        // ── Step 2: Build enriched prompt ──
        const systemPrompt = buildSystemPrompt(studentContext, !!ragContext, !!quotaContext);

        let userPrompt = question;
        if (ragContext) {
            userPrompt += `\n\nBAĞLAM:\n${ragContext}`;
        }
        if (quotaContext) {
            userPrompt += `\n\nKONTENJAN BİLGİSİ:\n${quotaContext}`;
        }

        const messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
        ];

        // ── Step 3: Single streaming LLM call ──
        const stream = await axios({
            method: "post",
            url: LLM_URL,
            data: {
                messages,
                stream: true,
                temperature: 0.2
            },
            responseType: "stream",
            timeout: 60000
        });

        stream.data.on("data", chunk => res.write(chunk));
        stream.data.on("end", () => res.end());
        stream.data.on("error", err => {
            console.error("Stream error:", err.message);
            res.end();
        });

    } catch (error) {
        console.error("AI Endpoint Error:", error.message);
        const errMsg = "Yapay zeka sunucusuyla iletişim kurulamadı.";
        res.write(
            "data: " +
            JSON.stringify({ choices: [{ delta: { content: errMsg } }] }) +
            "\n\n"
        );
        res.end();
    }
});

module.exports = router;