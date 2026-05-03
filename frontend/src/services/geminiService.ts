import { AirQualityData, Insight } from "../types";
import { sessionCacheFetch } from "./sessionCache";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = "gpt-4.1-nano";
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

const REFRESH_MS = 5 * 60 * 1000;
const CACHE_PREFIX = "piaq:openai:airQualityInsights:v1:";

const getTimeBucket = (timestamp: string): string => {
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) return "unknown";
  return Math.floor(ms / REFRESH_MS).toString();
};

const makeCacheKey = (currentData: AirQualityData): string => {
  // One cached response per 5-minute bucket (per tab/session).
  // This prevents frequent sensor updates from triggering expensive AI calls.
  return `${CACHE_PREFIX}${getTimeBucket(currentData.timestamp)}`;
};

const buildPrompt = (currentData: AirQualityData) => `
  As an expert environmental health scientist, analyze the following air quality data and provide 3 actionable insights or health recommendations.
  
  Current Data:
  - AQI: ${currentData.aqi}
  - PM2.5: ${currentData.pm25} µg/m³
  - PM10: ${currentData.pm10} µg/m³
  - CO2: ${currentData.co2} ppm
  - VOC: ${currentData.voc} ppb
  - Humidity: ${currentData.humidity}%
  - Temperature: ${currentData.temp}°C
  
  Return the response as valid JSON with this shape:
  {
    "insights": [
      {
        "id": "unique-id",
        "type": "health" | "action" | "alert",
        "message": "the insight message",
        "severity": "low" | "medium" | "high"
      }
    ]
  }
`;

const parseInsights = (text: string): Insight[] => {
  const parsed = JSON.parse(text) as { insights?: Insight[] };
  return Array.isArray(parsed.insights) ? parsed.insights : [];
};

export const getAirQualityInsights = async (
  currentData: AirQualityData,
  opts?: { forceRefresh?: boolean }
): Promise<Insight[]> => {
  const cacheKey = makeCacheKey(currentData);

  return sessionCacheFetch(
    cacheKey,
    REFRESH_MS,
    async () => {
      if (!OPENAI_API_KEY) {
        throw new Error("Missing OpenAI API key.");
      }

      const response = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [
            {
              role: "system",
              content: "You analyze indoor air quality data and return concise, practical recommendations as JSON.",
            },
            {
              role: "user",
              content: buildPrompt(currentData),
            },
          ],
          temperature: 0.4,
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI request failed with status ${response.status}.`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const text = data.choices?.[0]?.message?.content;
      if (!text) return [];
      return parseInsights(text);
    },
    opts
  ).catch((error) => {
    console.error("Error fetching insights:", error);
    return [
      {
        id: "error",
        type: "alert",
        message: "Unable to generate AI insights at this time. Please check your connection.",
        severity: "low",
      },
    ];
  });
};
