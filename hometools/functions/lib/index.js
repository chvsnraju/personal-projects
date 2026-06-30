"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lookupBarcode = exports.generateAiContent = void 0;
const https_1 = require("firebase-functions/v2/https");
const app_1 = require("firebase-admin/app");
const generative_ai_1 = require("@google/generative-ai");
(0, app_1.initializeApp)();
const geminiApiKey = process.env.GEMINI_API_KEY || "";
const ai = new generative_ai_1.GoogleGenerativeAI(geminiApiKey);
// 1. Multimodal AI Generation Function (Gemini API Integration)
exports.generateAiContent = (0, https_1.onCall)({ cors: true }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated.");
    }
    const { prompt, imageData, responseMimeType, responseSchema } = request.data;
    try {
        const model = ai.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
        const parts = [{ text: prompt }];
        if (imageData && imageData.base64) {
            parts.push({
                inlineData: {
                    mimeType: imageData.mimeType || "image/jpeg",
                    data: imageData.base64
                }
            });
        }
        const config = {};
        if (responseMimeType) {
            config.responseMimeType = responseMimeType;
        }
        if (responseSchema) {
            config.responseSchema = responseSchema;
        }
        const result = await model.generateContent({
            contents: [{ role: "user", parts }],
            generationConfig: config
        });
        const response = await result.response;
        return { text: response.text() };
    }
    catch (error) {
        throw new https_1.HttpsError("internal", `AI Generation failed: ${error.message}`);
    }
});
// 2. Barcode UPC database lookup
exports.lookupBarcode = (0, https_1.onCall)({ cors: true }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated.");
    }
    const { upc } = request.data;
    if (!upc) {
        throw new https_1.HttpsError("invalid-argument", "Missing UPC barcode.");
    }
    try {
        const response = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(upc)}`);
        if (!response.ok) {
            throw new Error(`API returned status ${response.status}`);
        }
        const data = await response.json();
        return data;
    }
    catch (error) {
        throw new https_1.HttpsError("internal", `Barcode lookup failed: ${error.message}`);
    }
});
//# sourceMappingURL=index.js.map