import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { GoogleGenerativeAI } from "@google/generative-ai";

initializeApp();

const geminiApiKey = process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenerativeAI(geminiApiKey);

// 1. Multimodal AI Generation Function (Gemini API Integration)
export const generateAiContent = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated.");
  }

  const { prompt, imageData, responseMimeType, responseSchema } = request.data as {
    prompt: string;
    imageData?: { base64: string; mimeType: string };
    responseMimeType?: string;
    responseSchema?: any;
  };

  try {
    const model = ai.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
    const parts: any[] = [{ text: prompt }];

    if (imageData && imageData.base64) {
      parts.push({
        inlineData: {
          mimeType: imageData.mimeType || "image/jpeg",
          data: imageData.base64
        }
      });
    }

    const config: any = {};
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
  } catch (error: any) {
    throw new HttpsError("internal", `AI Generation failed: ${error.message}`);
  }
});

// 2. Barcode UPC database lookup
export const lookupBarcode = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated.");
  }

  const { upc } = request.data as { upc: string };
  if (!upc) {
    throw new HttpsError("invalid-argument", "Missing UPC barcode.");
  }

  try {
    const response = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(upc)}`);
    if (!response.ok) {
      throw new Error(`API returned status ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error: any) {
    throw new HttpsError("internal", `Barcode lookup failed: ${error.message}`);
  }
});
